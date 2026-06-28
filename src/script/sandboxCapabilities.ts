/**
 * Sandbox capability proxy (Part D4, spec §4.4).
 *
 * The D3 sandbox exposes nothing by default. This module builds the ONLY bridge
 * out of the VM: a set of namespaced host functions (`fs`, `web`, `memory`,
 * `tool`) backed by the real subsystems, where every call is checked against the
 * approved capability manifest before it touches anything. A call outside the
 * granted scope throws an explicit error (which surfaces inside the script as a
 * rejected promise), and every call — allowed or denied — is summarized to the
 * audit sink.
 *
 * A namespace is only present when the manifest grants something in it, and even
 * then each call re-checks the specific path/URL/tool. Secrets are never
 * exposed; there is no raw network — only the mediated `web` capability.
 */

import type { BrowserClawDB } from '../db/db.ts';
import type { AppDispatch } from '../store/store.ts';
import type { MemoryRow } from '../db/types.ts';
import { filterMemoriesForAutomatedAccess } from '../memories/retrieveMemories.ts';
import {
  runToolCall,
  TOOL_CAPABILITY_DESCRIPTORS,
  type ToolContext,
} from '../tools/tools.ts';
import { normalizeWorkspacePath } from '../workspace/path.ts';
import { WorkspaceFs } from '../workspace/workspaceFs.ts';
import {
  DEFAULT_AGENT_GREP_POLICY,
  validateGrepRequest,
  type GrepResult,
  type WorkspaceSearchResult,
} from '../workspace/types.ts';
import type { WebResearchService } from '../webresearch/types.ts';
import {
  runSandboxedScript,
  type SandboxHostApi,
  type SandboxResult,
} from './sandbox.ts';
import type { ScriptCapabilities } from './scriptPolicy.ts';
import type { ScriptLimits } from './scriptRequest.ts';

/** A summarized capability call for the audit log. */
export interface CapabilityAudit {
  capability: string;
  target?: string;
  allowed: boolean;
  reason?: string;
}

export interface SandboxCapabilityContext {
  fs: WorkspaceFs;
  db: BrowserClawDB;
  dispatch: AppDispatch;
  web?: WebResearchService;
  toolCtx?: ToolContext;
  /** Receives a summary of each capability call (allowed or denied). */
  onAudit?: (entry: CapabilityAudit) => void;
}

/** Thrown when a script calls a capability outside its granted scope. */
export class SandboxCapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxCapabilityError';
  }
}

/** Thrown when a script exceeds one of its declared resource limits (D5). */
export class SandboxLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxLimitError';
  }
}

/**
 * Counts a running script's resource usage against its declared limits (Part
 * D5). Each accessor increments a counter and throws {@link SandboxLimitError}
 * when a ceiling is crossed; `tripped` records which one, so the runner can
 * classify the failure even after the error has crossed the VM boundary.
 */
export class LimitTracker {
  tripped: string | null = null;
  readonly logs: string[] = [];
  private fileReads = 0;
  private fileWrites = 0;
  private bytesRead = 0;
  private bytesWritten = 0;
  private webRequests = 0;
  private pagesRead = 0;
  private toolCalls = 0;
  private logBytes = 0;
  private readonly limits: ScriptLimits;

  constructor(limits: ScriptLimits) {
    this.limits = limits;
  }

  private trip(message: string): never {
    this.tripped = message;
    throw new SandboxLimitError(message);
  }

  /** Count a file read (call BEFORE reading), then its bytes (call after). */
  beginFileRead(): void {
    this.fileReads += 1;
    if (this.fileReads > this.limits.maxFileReads) {
      this.trip(`maxFileReads (${this.limits.maxFileReads}) exceeded`);
    }
  }

  addBytesRead(bytes: number): void {
    this.bytesRead += bytes;
    const max = this.limits.maxTotalBytesRead;
    if (max !== undefined && this.bytesRead > max) {
      this.trip(`maxTotalBytesRead (${max}) exceeded`);
    }
  }

  beginFileWrite(bytes: number): void {
    this.fileWrites += 1;
    if (this.fileWrites > this.limits.maxFileWrites) {
      this.trip(`maxFileWrites (${this.limits.maxFileWrites}) exceeded`);
    }
    this.bytesWritten += bytes;
    const max = this.limits.maxTotalBytesWritten;
    if (max !== undefined && this.bytesWritten > max) {
      this.trip(`maxTotalBytesWritten (${max}) exceeded`);
    }
  }

  countWebRequest(): void {
    this.webRequests += 1;
    const max = this.limits.maxWebRequests;
    if (max !== undefined && this.webRequests > max) {
      this.trip(`maxWebRequests (${max}) exceeded`);
    }
  }

  countPageRead(): void {
    this.pagesRead += 1;
    const max = this.limits.maxPagesRead;
    if (max !== undefined && this.pagesRead > max) {
      this.trip(`maxPagesRead (${max}) exceeded`);
    }
  }

  appendLog(text: string): void {
    this.logBytes += text.length;
    const max = this.limits.maxLogBytes;
    if (max !== undefined && this.logBytes > max) {
      this.trip(`maxLogBytes (${max}) exceeded`);
    }
    this.logs.push(text);
  }

  /** FIX1-D3: count every attempted tool.call (including denied ones). */
  countToolCall(): void {
    this.toolCalls += 1;
    const max = this.limits.maxToolCalls;
    if (max !== undefined && this.toolCalls > max) {
      this.trip(`maxToolCalls (${max}) exceeded`);
    }
  }
}

/**
 * FIX1-D2: Enforce cross-capability requirements before a sandbox tool.call.
 * Checks that the capability manifest grants the capabilities a tool requires
 * (beyond the base `capabilities.tools` permission enforced by runToolCall).
 * Throws {@link SandboxCapabilityError} with a descriptive message on any
 * violation; the deny callback also emits an audit entry.
 */
function assertSandboxToolAllowed(
  name: string,
  capabilities: ScriptCapabilities,
  deny: (capability: string, target: string, reason: string) => never,
): void {
  const descriptor = TOOL_CAPABILITY_DESCRIPTORS[name];
  // H1: every sandbox-callable tool must have a descriptor. Missing descriptor
  // is a deny, not a silent pass-through — it prevents unreviewed tools from
  // becoming callable without declaring their effect categories.
  if (!descriptor) {
    deny(
      'tool.call',
      name,
      `${name} is not callable from sandbox: no capability descriptor registered`,
    );
  }

  if (
    descriptor.requires.mediatedNetwork &&
    capabilities.network !== 'mediated'
  ) {
    deny('tool.call', name, `${name} requires capabilities.network "mediated"`);
  }
  if (
    descriptor.requires.webRead &&
    (capabilities.webRead?.length ?? 0) === 0
  ) {
    deny('tool.call', name, `${name} requires capabilities.webRead`);
  }
  if (descriptor.requires.webSearch && capabilities.webSearch !== true) {
    deny('tool.call', name, `${name} requires capabilities.webSearch`);
  }
  if (
    descriptor.requires.fsWrite &&
    (capabilities.fsWrite?.length ?? 0) === 0
  ) {
    deny('tool.call', name, `${name} requires capabilities.fsWrite`);
  }
  if (descriptor.requires.memoryRead && capabilities.memoryRead !== true) {
    deny('tool.call', name, `${name} requires capabilities.memoryRead`);
  }
}

/** Translate a workspace glob (`/workspace/docs/**`) into an anchored RegExp. */
function globToRegExp(glob: string): RegExp {
  let pattern = '';
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i] as string;
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        pattern += '.*'; // ** — match across path separators
        i += 1;
      } else {
        pattern += '[^/]*'; // * — match within a single segment
      }
    } else if ('\\^$.|?+()[]{}'.includes(ch)) {
      pattern += `\\${ch}`;
    } else {
      pattern += ch;
    }
  }
  return new RegExp(`^${pattern}$`);
}

function matchesAnyScope(
  path: string,
  scopes: readonly string[] | undefined,
): boolean {
  if (!scopes || scopes.length === 0) return false;
  return scopes.some((scope) => globToRegExp(scope).test(path));
}

function str(value: unknown, name: string): string {
  if (typeof value !== 'string') {
    throw new SandboxCapabilityError(`${name} must be a string`);
  }
  return value;
}

/**
 * Build the mediated host API for an approved script. Only the namespaces the
 * manifest grants are present; each call is scope-checked and audited.
 */
export function buildSandboxHost(
  ctx: SandboxCapabilityContext,
  capabilities: ScriptCapabilities,
  tracker?: LimitTracker,
): SandboxHostApi {
  const host: SandboxHostApi = {};
  const audit = (entry: CapabilityAudit): void => ctx.onAudit?.(entry);

  /** Audit + throw for a denied call. */
  const deny = (capability: string, target: string, reason: string): never => {
    audit({ capability, target, allowed: false, reason });
    throw new SandboxCapabilityError(`${capability} denied: ${reason}`);
  };

  /** Normalize a path, treating an invalid path as a denial. */
  const safePath = (capability: string, raw: unknown): string => {
    const value = str(raw, 'path');
    try {
      return normalizeWorkspacePath(value);
    } catch {
      return deny(capability, value, 'invalid workspace path');
    }
  };

  const fsGranted =
    (capabilities.fsRead?.length ?? 0) > 0 ||
    (capabilities.fsWrite?.length ?? 0) > 0;
  if (fsGranted) {
    host.fs = {
      readText: async (rawPath) => {
        const path = safePath('fs.readText', rawPath);
        if (!matchesAnyScope(path, capabilities.fsRead)) {
          return deny('fs.readText', path, 'path not in read scope');
        }
        tracker?.beginFileRead();
        const text = await ctx.fs.readText(path);
        tracker?.addBytesRead(text.length);
        audit({ capability: 'fs.readText', target: path, allowed: true });
        return text;
      },
      writeText: async (rawPath, content) => {
        const path = safePath('fs.writeText', rawPath);
        if (!matchesAnyScope(path, capabilities.fsWrite)) {
          return deny('fs.writeText', path, 'path not in write scope');
        }
        const body = str(content, 'content');
        tracker?.beginFileWrite(body.length);
        await ctx.fs.createFile(path, body, {
          overwrite: true,
          actor: 'script',
        });
        audit({ capability: 'fs.writeText', target: path, allowed: true });
      },
      search: async (rawQuery) => {
        if ((capabilities.fsRead?.length ?? 0) === 0) {
          return deny('fs.search', '*', 'no read capability');
        }
        const query = (rawQuery ?? {}) as Record<string, unknown>;
        const results = await ctx.fs.search({
          ...(typeof query.pathContains === 'string'
            ? { pathContains: query.pathContains }
            : {}),
          ...(typeof query.textContains === 'string'
            ? { textContains: query.textContains }
            : {}),
          ...(typeof query.extension === 'string'
            ? { extension: query.extension }
            : {}),
        });
        const scoped = results.filter((r: WorkspaceSearchResult) =>
          matchesAnyScope(r.path, capabilities.fsRead),
        );
        audit({ capability: 'fs.search', allowed: true });
        return scoped.map((r) => ({ path: r.path }));
      },
      grep: async (rawQuery) => {
        if ((capabilities.fsRead?.length ?? 0) === 0) {
          return deny('fs.grep', '*', 'no read capability');
        }
        const query = (rawQuery ?? {}) as Record<string, unknown>;
        const grepQuery = {
          pattern: str(query.pattern, 'pattern'),
          ...(typeof query.path === 'string' ? { path: query.path } : {}),
          ...(typeof query.isRegex === 'boolean'
            ? { isRegex: query.isRegex }
            : {}),
          ...(typeof query.ignoreCase === 'boolean'
            ? { ignoreCase: query.ignoreCase }
            : {}),
        };
        // FIX1-H1: enforce grep policy (literal only, max pattern length).
        try {
          validateGrepRequest(grepQuery, DEFAULT_AGENT_GREP_POLICY);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return deny('fs.grep', grepQuery.pattern, message);
        }
        const hits = await ctx.fs.grep(grepQuery);
        const scoped = hits.filter((h: GrepResult) =>
          matchesAnyScope(h.path, capabilities.fsRead),
        );
        audit({ capability: 'fs.grep', allowed: true });
        return scoped.map((h) => ({
          path: h.path,
          line: h.line,
          text: h.text,
        }));
      },
    };
  }

  const webGranted =
    capabilities.webSearch === true || (capabilities.webRead?.length ?? 0) > 0;
  if (webGranted) {
    host.web = {
      search: async (rawQuery, rawOpts) => {
        if (capabilities.webSearch !== true) {
          return deny('web.search', '*', 'no web search capability');
        }
        if (!ctx.web) {
          return deny('web.search', '*', 'web research service unavailable');
        }
        tracker?.countWebRequest();
        const opts = (rawOpts ?? {}) as Record<string, unknown>;
        const out = await ctx.web.search(str(rawQuery, 'query'), {
          ...(typeof opts.maxResults === 'number'
            ? { maxResults: opts.maxResults }
            : {}),
        });
        audit({ capability: 'web.search', allowed: true });
        return out;
      },
      readPage: async (rawUrl, rawOpts) => {
        const url = str(rawUrl, 'url');
        if (!matchesAnyScope(url, capabilities.webRead)) {
          return deny('web.readPage', url, 'url not in web read scope');
        }
        if (!ctx.web) {
          return deny('web.readPage', url, 'web research service unavailable');
        }
        tracker?.countWebRequest();
        tracker?.countPageRead();
        const opts = (rawOpts ?? {}) as Record<string, unknown>;
        const out = await ctx.web.readPage(url, {
          url,
          ...(typeof opts.maxChars === 'number'
            ? { maxChars: opts.maxChars }
            : {}),
        });
        audit({ capability: 'web.readPage', target: url, allowed: true });
        return out as unknown as Record<string, unknown>;
      },
    };
  }

  if (capabilities.memoryRead === true) {
    host.memory = {
      search: async (rawQuery) => {
        const query = (rawQuery ?? {}) as Record<string, unknown>;
        const tag = typeof query.tag === 'string' ? query.tag : undefined;
        const text =
          typeof query.query === 'string'
            ? query.query.toLowerCase()
            : undefined;
        const all = tag
          ? await ctx.db.memories.where('tags').equals(tag).toArray()
          : await ctx.db.memories.toArray();
        // G1: exclude sensitive memories via shared policy (never appear in
        // sandbox output, errors, or audit entries).
        const visible = filterMemoriesForAutomatedAccess(all);
        const matched = text
          ? visible.filter(
              (m: MemoryRow) =>
                m.title.toLowerCase().includes(text) ||
                m.text.toLowerCase().includes(text),
            )
          : visible;
        // Audit contains only count/ids — never full text (E1).
        audit({
          capability: 'memory.search',
          allowed: true,
          target: matched.map((m: MemoryRow) => m.id).join(','),
        });
        return matched.map((m) => ({
          id: m.id,
          title: m.title,
          text: m.text,
          tags: m.tags,
        }));
      },
    };
  }

  if ((capabilities.tools?.length ?? 0) > 0) {
    host.tool = {
      call: async (rawName, rawArgs) => {
        const name = str(rawName, 'tool');
        // FIX1-D3: count every tool.call attempt (including denied) toward limit.
        tracker?.countToolCall();
        if (
          rawArgs !== undefined &&
          (typeof rawArgs !== 'object' ||
            rawArgs === null ||
            Array.isArray(rawArgs))
        ) {
          deny(
            'tool.call',
            name,
            `args must be a JSON object, not ${Array.isArray(rawArgs) ? 'array' : typeof rawArgs}`,
          );
        }
        const toolArgs =
          typeof rawArgs === 'object' && rawArgs !== null && !Array.isArray(rawArgs)
            ? (rawArgs as Record<string, unknown>)
            : {};
        // FIX1-D2: enforce cross-capability requirements declared in the descriptor.
        assertSandboxToolAllowed(name, capabilities, deny);
        // runToolCall enforces the permission model against allowedTools.
        const output = await runToolCall(
          { name, args: toolArgs },
          {
            allowedTools: capabilities.tools ?? [],
            ctx: { db: ctx.db, dispatch: ctx.dispatch, ...(ctx.toolCtx ?? {}) },
          },
        );
        audit({ capability: 'tool.call', target: name, allowed: true });
        return output;
      },
    };
  }

  // A benign log sink (stdout) — always available, but byte-capped by maxLogBytes
  // through the tracker. Collected logs are returned by runSandboxWithLimits.
  if (tracker) {
    host.console = {
      log: (...parts) => {
        tracker.appendLog(parts.map((p) => String(p)).join(' '));
      },
    };
  }

  return host;
}

/** Approximate the serialized byte size of a script's return value. */
function outputSize(value: unknown): number {
  if (value === undefined) return 0;
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
}

export interface LimitedRunOptions {
  capabilities: ScriptCapabilities;
  limits: ScriptLimits;
  signal?: AbortSignal;
  now?: () => number;
}

export type LimitedSandboxResult = SandboxResult & { logs?: string[] };

/**
 * Run an approved script with its declared limits enforced (Part D5). Wires the
 * runtime timeout/cancellation (D3) to `limits.timeoutMs`/`signal`, threads a
 * {@link LimitTracker} through the capability proxy (D4) for read/write/web/log
 * ceilings, and rejects an over-budget return value. Limit failures are
 * reclassified to the `limit_exceeded` error kind.
 */
export async function runSandboxWithLimits(
  ctx: SandboxCapabilityContext,
  code: string,
  options: LimitedRunOptions,
): Promise<LimitedSandboxResult> {
  const tracker = new LimitTracker(options.limits);
  const host = buildSandboxHost(ctx, options.capabilities, tracker);
  const result = await runSandboxedScript(code, {
    host,
    timeoutMs: options.limits.timeoutMs,
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.now ? { now: options.now } : {}),
  });

  // A tripped limit fails the run even if the script swallowed the error or the
  // trip came from a fire-and-forget capability (e.g. an over-budget log).
  if (tracker.tripped) {
    return {
      ok: false,
      error: tracker.tripped,
      errorKind: 'limit_exceeded',
      logs: tracker.logs,
    };
  }
  if (!result.ok) {
    return { ...result, logs: tracker.logs };
  }

  const size = outputSize(result.value);
  if (size > options.limits.maxOutputBytes) {
    return {
      ok: false,
      error: `output exceeds maxOutputBytes (${options.limits.maxOutputBytes})`,
      errorKind: 'limit_exceeded',
      logs: tracker.logs,
    };
  }
  return { ...result, logs: tracker.logs };
}
