/**
 * Agent tools: the registry, the parser for tool calls the model emits, and a
 * permission-enforcing runner (TODO 7.x). A tool call is only ever performed
 * after inline approval. Most of this module is the pure parse + permission +
 * execute core; tools that persist (e.g. Remember) receive db/dispatch +
 * provenance through ToolContext.
 *
 * Protocol: the model requests a tool by emitting a fenced block in its reply:
 *
 *   ```tool
 *   { "tool": "Page Reader", "args": { "url": "https://example.com" } }
 *   ```
 */
import type { BrowserClawDB } from '../db/db.ts';
import type { AppDispatch } from '../store/store.ts';
import type { MemoryRow } from '../db/types.ts';
import { recordAudit } from '../audit/auditSink.ts';
import { classifyFetchUrl } from '../net/urlSafety.ts';

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ToolContext {
  /** Injectable fetch so network tools are testable. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Network-fetch timeout in ms (injectable for tests). Defaults to 15s. */
  timeoutMs?: number;
  /** Durable store — present for tools that persist (e.g. Remember). */
  db?: BrowserClawDB;
  /** Dispatch for tools that audit their effect. */
  dispatch?: AppDispatch;
  /** Provenance for a persisted record: the originating conversation/skill. */
  conversationId?: string;
  skillId?: string;
}

export interface Tool {
  /** Canonical name a skill declares in its `tools` permission. */
  name: string;
  description: string;
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}

/** A skill (or the agent) tried to run a tool it did not declare. */
export class ToolNotPermittedError extends Error {
  constructor(name: string) {
    super(`Tool not permitted: ${name}`);
    this.name = 'ToolNotPermittedError';
  }
}

/** The model asked for a tool that isn't in the registry. */
export class UnknownToolError extends Error {
  constructor(name: string) {
    super(`Unknown tool: ${name}`);
    this.name = 'UnknownToolError';
  }
}

/**
 * Parse the first ```tool fenced JSON block from a model reply into a ToolCall,
 * or null if there is no well-formed tool call. Malformed JSON or a missing
 * `tool` name yields null (treated as "no tool call", not an error).
 */
export function parseToolCall(reply: string): ToolCall | null {
  const match = /```tool\s*\n([\s\S]*?)```/.exec(reply);
  if (!match || match[1] === undefined) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.tool !== 'string' || obj.tool.length === 0) return null;
  const args =
    typeof obj.args === 'object' &&
    obj.args !== null &&
    !Array.isArray(obj.args)
      ? (obj.args as Record<string, unknown>)
      : {};
  return { name: obj.tool, args };
}

/** Max characters of page text returned — keeps a huge page out of the prompt. */
const MAX_PAGE_TEXT = 20_000;
/** Hard cap on response bytes read — refuse oversized bodies (A1.4). */
const MAX_PAGE_BYTES = 2_000_000;
/** Default network timeout for a page fetch (A1.4). */
const DEFAULT_FETCH_TIMEOUT_MS = 15_000;

/** Strip a page to readable text: drop scripts/styles/tags, collapse space. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Read a response body as text, refusing oversized content. A declared
 * Content-Length over the cap is rejected BEFORE reading; otherwise the stream
 * is read incrementally and aborted the moment it exceeds the cap, so a huge
 * (or lying) body is never fully buffered.
 */
async function readCappedText(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error('Page Reader response is too large.');
  }
  const body = response.body;
  if (!body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).length > maxBytes) {
      throw new Error('Page Reader response is too large.');
    }
    return text;
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error('Page Reader response is too large.');
      }
      chunks.push(value);
    }
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

/**
 * Page Reader: fetch an http(s) page and return its readable text. The URL is
 * run through the shared SSRF validator (no localhost/private/link-local/cloud
 * metadata targets, http(s) only); the fetch omits credentials, times out, and
 * caps the body size; the final URL after redirects is re-validated; and the
 * HTML is reduced to plain text so nothing from the page can execute. A blocked
 * URL is audited (`web.fetch_blocked`) when a store is available.
 */
export const pageReaderTool: Tool = {
  name: 'Page Reader',
  description: 'Fetch a web page and return its readable text.',
  async run(args, ctx) {
    const raw = typeof args.url === 'string' ? args.url.trim() : '';

    const auditBlocked = (message: string): void => {
      if (!ctx.db || !ctx.dispatch) return;
      void recordAudit(ctx.db, ctx.dispatch, {
        type: 'web.fetch_blocked',
        summary: `Blocked fetch: ${message}`,
        source: 'skill',
        risk: 'medium',
        status: 'failure',
        toolName: 'Page Reader',
        ...(ctx.skillId ? { skillId: ctx.skillId } : {}),
      });
    };

    const safety = classifyFetchUrl(raw);
    if (!safety.ok) {
      auditBlocked(safety.message);
      throw new Error(safety.message);
    }
    const url = safety.url;

    const fetchImpl = ctx.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timeoutMs = ctx.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(url.href, {
        signal: controller.signal,
        redirect: 'follow',
        // No ambient cookies/credentials on agent-driven fetches (A1.4).
        credentials: 'omit',
        // No custom headers unless explicitly approved (A1.4).
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error('Page Reader timed out.', { cause: error });
      }
      throw new Error(
        `Page Reader could not reach the URL (network/CORS error): ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    } finally {
      clearTimeout(timer);
    }

    // Re-validate the final URL after any redirects (response.url is empty for
    // synthetic responses, so this only fires on real redirected fetches).
    if (response.url) {
      const finalSafety = classifyFetchUrl(response.url);
      if (!finalSafety.ok) {
        auditBlocked(`redirect -> ${finalSafety.message}`);
        throw new Error(
          `Page Reader blocked a redirect: ${finalSafety.message}`,
        );
      }
    }
    if (!response.ok) {
      throw new Error(`Page Reader failed to fetch (${response.status}).`);
    }
    const html = await readCappedText(response, MAX_PAGE_BYTES);
    return htmlToText(html).slice(0, MAX_PAGE_TEXT);
  },
};

/**
 * Remember: persist a memory the agent proposed. Goes through the same
 * propose -> skill-permission -> inline-approval (editable) -> run path as any
 * tool; on run it writes a MemoryRow tagged with its provenance (the active
 * conversation + the skill that called it) and audits memory.created.
 */
export const rememberTool: Tool = {
  name: 'Remember',
  description: 'Save a memory (title, text, optional tags) for later recall.',
  async run(args, ctx) {
    if (!ctx.db) {
      throw new Error('Remember is unavailable (no store).');
    }
    const title = typeof args.title === 'string' ? args.title.trim() : '';
    const text = typeof args.text === 'string' ? args.text.trim() : '';
    if (!title || !text) {
      throw new Error('Remember needs a non-empty title and text.');
    }
    const tags = Array.isArray(args.tags)
      ? args.tags.filter((t): t is string => typeof t === 'string')
      : [];
    const memory: MemoryRow = {
      id: crypto.randomUUID(),
      title,
      text,
      tags,
      source: 'skill',
      createdBy: 'assistant',
      createdAt: Date.now(),
      pinned: false,
      sensitivity: 'normal',
      ...(ctx.conversationId ? { conversationId: ctx.conversationId } : {}),
      ...(ctx.skillId ? { skillId: ctx.skillId } : {}),
    };
    await ctx.db.memories.put(memory);
    if (ctx.dispatch) {
      void recordAudit(ctx.db, ctx.dispatch, {
        type: 'memory.created',
        summary: `Memory saved: ${title}`,
        source: 'skill',
        risk: 'info',
        status: 'success',
        ...(ctx.skillId ? { skillId: ctx.skillId } : {}),
        ...(ctx.conversationId ? { conversationId: ctx.conversationId } : {}),
      });
    }
    return `Saved memory: ${title}`;
  },
};

export const TOOL_REGISTRY: Record<string, Tool> = {
  [pageReaderTool.name]: pageReaderTool,
  [rememberTool.name]: rememberTool,
};

export interface RunToolOptions {
  /** Tool names the caller (skill) is allowed to run — its declared tools. */
  allowedTools: readonly string[];
  ctx?: ToolContext;
}

/**
 * Run a tool call, failing closed: the caller must have DECLARED the tool
 * (permission enforcement — TODO 7.4) and the tool must exist in the registry.
 * Throws {@link ToolNotPermittedError} / {@link UnknownToolError} accordingly;
 * otherwise returns the tool's textual result.
 */
export async function runToolCall(
  call: ToolCall,
  options: RunToolOptions,
): Promise<string> {
  if (!options.allowedTools.includes(call.name)) {
    throw new ToolNotPermittedError(call.name);
  }
  const tool = TOOL_REGISTRY[call.name];
  if (!tool) {
    throw new UnknownToolError(call.name);
  }
  return tool.run(call.args, options.ctx ?? {});
}
