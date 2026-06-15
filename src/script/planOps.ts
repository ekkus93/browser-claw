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
import { runToolCall, type ToolContext } from '../tools/tools.ts';
import { WorkspaceFs } from '../workspace/workspaceFs.ts';

export interface PlanOpContext {
  fs: WorkspaceFs;
  db: BrowserClawDB;
  dispatch: AppDispatch;
  /** Tools the (approved) plan is allowed to call via `tool.call`. */
  allowedTools?: readonly string[];
  toolCtx?: ToolContext;
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
    case 'fs.grep':
      return ctx.fs.grep({
        pattern: str(args, 'pattern'),
        ...(typeof args.path === 'string' ? { path: args.path } : {}),
        ...(typeof args.isRegex === 'boolean' ? { isRegex: args.isRegex } : {}),
        ...(typeof args.ignoreCase === 'boolean'
          ? { ignoreCase: args.ignoreCase }
          : {}),
      });
    case 'memory.create':
      return createMemory(ctx, args);
    case 'memory.search':
      return searchMemory(ctx, args);
    case 'tool.call':
      return callTool(ctx, args);
    case 'web.search':
    case 'web.readPage':
    case 'web.readPages':
      throw new PlanOpError(
        `web operations are not available until the web-research providers land (Part E): ${op}`,
      );
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
  if (!query) return all;
  return all.filter(
    (m) =>
      m.title.toLowerCase().includes(query) ||
      m.text.toLowerCase().includes(query),
  );
}

function callTool(ctx: PlanOpContext, args: Args): Promise<string> {
  const name = str(args, 'tool');
  const toolArgs =
    typeof args.args === 'object' &&
    args.args !== null &&
    !Array.isArray(args.args)
      ? (args.args as Args)
      : {};
  return runToolCall(
    { name, args: toolArgs },
    {
      allowedTools: ctx.allowedTools ?? [],
      ctx: { db: ctx.db, dispatch: ctx.dispatch, ...(ctx.toolCtx ?? {}) },
    },
  );
}
