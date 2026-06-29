/**
 * Plan DSL operation implementations (Part C2). Each handler takes a context and
 * the step's already-resolved arguments (the executor in C3 resolves `*From`
 * references first) and performs one known operation against the real subsystems
 * — workspace (WorkspaceFs), memory (Dexie), or a permission-checked tool call.
 *
 * web.* operations are intentionally NOT implemented here yet: they require the
 * web-research providers from Part E and must not be faked with a browser fetch.
 * They throw an explicit "not available" error until E wires them in.
 */

import type { BrowserClawDB } from '../db/db.ts';
import type { AppDispatch } from '../store/store.ts';
import type { MemoryRow } from '../db/types.ts';
import {
  filterMemoriesForAutomatedAccess,
  shapeMemoryForAutomatedAccess,
} from '../memories/retrieveMemories.ts';
import { runToolCall, type ToolContext } from '../tools/tools.ts';
import { WorkspaceFs } from '../workspace/workspaceFs.ts';
import {
  DEFAULT_AGENT_GREP_POLICY,
  validateGrepRequest,
} from '../workspace/types.ts';
import type { WebResearchService } from '../webresearch/types.ts';

export interface PlanOpContext {
  fs: WorkspaceFs;
  db: BrowserClawDB;
  dispatch: AppDispatch;
  /** Tools the (approved) plan is allowed to call via `tool.call`. */
  allowedTools?: readonly string[];
  toolCtx?: ToolContext;
  /** Web research service for `web.*` ops (Part E10). Absent until configured. */
  web?: WebResearchService;
  now?: () => number;
  newId?: () => string;
}

export class PlanOpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanOpError';
  }
}

type Args = Record<string, unknown>;

function str(args: Args, key: string): string {
  const value = args[key];
  if (typeof value !== 'string') {
    throw new PlanOpError(`step is missing required string "${key}"`);
  }
  return value;
}

function num(args: Args, key: string): number {
  const value = args[key];
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new PlanOpError(`step is missing required number "${key}"`);
  }
  return value;
}

/** Perform one resolved plan op and return its output value. */
export async function executePlanOp(
  ctx: PlanOpContext,
  op: string,
  args: Args,
): Promise<unknown> {
  switch (op) {
    case 'fs.readText':
      return ctx.fs.readText(str(args, 'path'));
    case 'fs.readTextRange':
      return ctx.fs.readTextRange(
        str(args, 'path'),
        num(args, 'start'),
        num(args, 'length'),
      );
    case 'fs.readLines':
      return ctx.fs.readLines(
        str(args, 'path'),
        num(args, 'startLine'),
        num(args, 'lineCount'),
      );
    case 'fs.writeText':
      return ctx.fs.createFile(str(args, 'path'), str(args, 'content'), {
        overwrite: true,
        actor: 'script',
      });
    case 'fs.updateText':
      return ctx.fs.updateFile(
        str(args, 'path'),
        str(args, 'content'),
        'script',
      );
    case 'fs.appendText':
      return ctx.fs.appendFile(
        str(args, 'path'),
        str(args, 'content'),
        'script',
      );
    case 'fs.delete':
      await ctx.fs.deleteFile(str(args, 'path'));
      return { deleted: str(args, 'path') };
    case 'fs.move':
      return ctx.fs.moveFile(str(args, 'from'), str(args, 'to'));
    case 'fs.copy':
      return ctx.fs.copyFile(str(args, 'from'), str(args, 'to'));
    case 'fs.list':
      return ctx.fs.listDir(str(args, 'path'));
    case 'fs.search':
      return ctx.fs.search({
        ...(typeof args.pathContains === 'string'
          ? { pathContains: args.pathContains }
          : {}),
        ...(typeof args.textContains === 'string'
          ? { textContains: args.textContains }
          : {}),
        ...(typeof args.extension === 'string'
          ? { extension: args.extension }
          : {}),
      });
    case 'fs.grep': {
      const grepQuery = {
        pattern: str(args, 'pattern'),
        ...(typeof args.path === 'string' ? { path: args.path } : {}),
        ...(typeof args.isRegex === 'boolean' ? { isRegex: args.isRegex } : {}),
        ...(typeof args.ignoreCase === 'boolean'
          ? { ignoreCase: args.ignoreCase }
          : {}),
      };
      // FIX1-H2: enforce grep policy for plan-originated grep requests.
      validateGrepRequest(grepQuery, DEFAULT_AGENT_GREP_POLICY);
      return ctx.fs.grep(grepQuery);
    }
    case 'memory.create':
      return createMemory(ctx, args);
    case 'memory.search':
      return searchMemory(ctx, args);
    case 'tool.call':
      return callTool(ctx, args);
    case 'web.search':
    case 'web.readPage':
    case 'web.readPages':
      return webOp(ctx, op, args);
    default:
      throw new PlanOpError(`unknown plan op: ${op}`);
  }
}

async function createMemory(ctx: PlanOpContext, args: Args): Promise<string> {
  const now = ctx.now ?? Date.now;
  const id = (ctx.newId ?? (() => crypto.randomUUID()))();
  const memory: MemoryRow = {
    id,
    title: str(args, 'title'),
    text: str(args, 'text'),
    tags: Array.isArray(args.tags)
      ? args.tags.filter((t): t is string => typeof t === 'string')
      : [],
    source: 'script',
    createdBy: 'assistant',
    createdAt: now(),
    pinned: false,
    sensitivity: 'normal',
  };
  await ctx.db.memories.put(memory);
  return id;
}

async function searchMemory(
  ctx: PlanOpContext,
  args: Args,
): Promise<MemoryRow[]> {
  const tag = typeof args.tag === 'string' ? args.tag : undefined;
  const query =
    typeof args.query === 'string' ? args.query.toLowerCase() : undefined;
  const all = tag
    ? await ctx.db.memories.where('tags').equals(tag).toArray()
    : await ctx.db.memories.toArray();
  const visible = filterMemoriesForAutomatedAccess(all);
  const matched = query
    ? visible.filter(
        (m) =>
          m.title.toLowerCase().includes(query) ||
          m.text.toLowerCase().includes(query),
      )
    : visible;
  // H2 (FIX4): cap snippet text to prevent unbounded context growth.
  return matched.map((m) => shapeMemoryForAutomatedAccess(m));
}

async function webOp(
  ctx: PlanOpContext,
  op: string,
  args: Args,
): Promise<unknown> {
  if (!ctx.web) {
    throw new PlanOpError(
      `web operations require a configured web-research service: ${op}`,
    );
  }
  if (op === 'web.search') {
    return ctx.web.search(str(args, 'query'), {
      ...(typeof args.maxResults === 'number'
        ? { maxResults: args.maxResults }
        : {}),
    });
  }
  if (op === 'web.readPage') {
    return ctx.web.readPage(str(args, 'url'), {
      url: str(args, 'url'),
      ...(typeof args.maxChars === 'number' ? { maxChars: args.maxChars } : {}),
    });
  }
  // web.readPages
  const urls = Array.isArray(args.urls)
    ? args.urls.filter((u): u is string => typeof u === 'string')
    : [];
  const maxPages =
    typeof args.maxPages === 'number' ? args.maxPages : urls.length;
  const pages = [];
  for (const url of urls.slice(0, maxPages)) {
    pages.push(await ctx.web.readPage(url, { url }));
  }
  return pages;
}

function callTool(ctx: PlanOpContext, args: Args): Promise<string> {
  const name = str(args, 'tool');
  if (
    args.args !== undefined &&
    (typeof args.args !== 'object' ||
      args.args === null ||
      Array.isArray(args.args))
  ) {
    throw new PlanOpError(
      `tool.call '${name}': args must be a JSON object, not ${Array.isArray(args.args) ? 'array' : typeof args.args}`,
    );
  }
  const toolArgs = args.args !== undefined ? (args.args as Args) : {};
  return runToolCall(
    { name, args: toolArgs },
    {
      allowedTools: ctx.allowedTools ?? [],
      ctx: { db: ctx.db, dispatch: ctx.dispatch, ...(ctx.toolCtx ?? {}) },
    },
  );
}
