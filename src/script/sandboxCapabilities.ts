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
import { runToolCall, type ToolContext } from '../tools/tools.ts';
import { normalizeWorkspacePath } from '../workspace/path.ts';
import { WorkspaceFs } from '../workspace/workspaceFs.ts';
import type { GrepResult, WorkspaceSearchResult } from '../workspace/types.ts';
import type { WebResearchService } from '../webresearch/types.ts';
import type { SandboxHostApi } from './sandbox.ts';
import type { ScriptCapabilities } from './scriptPolicy.ts';

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
        const text = await ctx.fs.readText(path);
        audit({ capability: 'fs.readText', target: path, allowed: true });
        return text;
      },
      writeText: async (rawPath, content) => {
        const path = safePath('fs.writeText', rawPath);
        if (!matchesAnyScope(path, capabilities.fsWrite)) {
          return deny('fs.writeText', path, 'path not in write scope');
        }
        await ctx.fs.createFile(path, str(content, 'content'), {
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
        const hits = await ctx.fs.grep({
          pattern: str(query.pattern, 'pattern'),
          ...(typeof query.path === 'string' ? { path: query.path } : {}),
          ...(typeof query.isRegex === 'boolean'
            ? { isRegex: query.isRegex }
            : {}),
          ...(typeof query.ignoreCase === 'boolean'
            ? { ignoreCase: query.ignoreCase }
            : {}),
        });
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
        const matched = text
          ? all.filter(
              (m: MemoryRow) =>
                m.title.toLowerCase().includes(text) ||
                m.text.toLowerCase().includes(text),
            )
          : all;
        audit({ capability: 'memory.search', allowed: true });
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
        const toolArgs =
          typeof rawArgs === 'object' &&
          rawArgs !== null &&
          !Array.isArray(rawArgs)
            ? (rawArgs as Record<string, unknown>)
            : {};
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

  return host;
}
