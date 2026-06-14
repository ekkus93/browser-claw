/**
 * Agent tools: the registry, the parser for tool calls the model emits, and a
 * permission-enforcing runner. This is the foundation of the tool-execution
 * loop (TODO 7.x). A tool call is only ever performed after inline approval
 * (wired in a later pass); this module is the parse + permission-check +
 * execute core, with no UI or runtime coupling so it's fully unit-testable.
 *
 * Protocol: the model requests a tool by emitting a fenced block in its reply:
 *
 *   ```tool
 *   { "tool": "Page Reader", "args": { "url": "https://example.com" } }
 *   ```
 */

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ToolContext {
  /** Injectable fetch so network tools are testable. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
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
 * Page Reader: fetch an http(s) page and return its readable text. The URL is
 * validated (http/https only) and the fetched HTML is reduced to plain text —
 * scripts/styles are stripped, so nothing from the page can execute.
 */
export const pageReaderTool: Tool = {
  name: 'Page Reader',
  description: 'Fetch a web page and return its readable text.',
  async run(args, ctx) {
    const raw = typeof args.url === 'string' ? args.url.trim() : '';
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error('Page Reader needs a valid URL.');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('Page Reader only fetches http(s) URLs.');
    }
    const fetchImpl = ctx.fetchImpl ?? fetch;
    const response = await fetchImpl(url.href);
    if (!response.ok) {
      throw new Error(`Page Reader failed to fetch (${response.status}).`);
    }
    const html = await response.text();
    return htmlToText(html).slice(0, MAX_PAGE_TEXT);
  },
};

export const TOOL_REGISTRY: Record<string, Tool> = {
  [pageReaderTool.name]: pageReaderTool,
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
