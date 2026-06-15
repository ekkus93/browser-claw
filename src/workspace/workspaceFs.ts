/**
 * WorkspaceFs (Part B3): the app-private virtual filesystem API. Metadata rows
 * live in `db.workspace_files`; file BYTES live in the injected {@link ContentStore}
 * (OPFS in production). Every path is validated/normalized first
 * (see path.ts), so no operation can escape the workspace namespace.
 *
 * Write ordering is chosen so a failure never leaves corrupt metadata: content
 * bytes are written BEFORE the metadata row, so a failed content write leaves no
 * dangling metadata. (A failed metadata write can orphan content bytes, which is
 * harmless and reclaimable — the spec accepts this "where possible".)
 */

import type { BrowserClawDB } from '../db/db.ts';
import type { ContentStore } from './contentStore.ts';
import { WorkspaceContentMissingError } from './contentStore.ts';
import { normalizeWorkspacePath } from './path.ts';
import type {
  GrepQuery,
  GrepResult,
  TextSnippet,
  WorkspaceActor,
  WorkspaceFileMeta,
  WorkspaceFileSource,
  WorkspaceSearchQuery,
  WorkspaceSearchResult,
} from './types.ts';

export type FileStat = WorkspaceFileMeta;

/** Max characters returnable from readTextRange in one call (B4). */
export const MAX_RANGE_CHARS = 100_000;
/** Max lines returnable from readLines in one call (B4). */
export const MAX_SNIPPET_LINES = 5_000;
/** Max serialized bytes a snippet may return (B4). */
export const MAX_SNIPPET_BYTES = 256_000;
/** Files larger than this are skipped by content search/grep (B5). */
export const MAX_SEARCH_FILE_BYTES = 2_000_000;
/** Default cap on search/grep results (B5). */
export const DEFAULT_SEARCH_LIMIT = 100;

/** Escape a string for use as a literal inside a RegExp. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Heuristic: treat bytes with a NUL in the first 8KB as binary (skip them). */
function isProbablyText(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.byteLength, 8192);
  for (let i = 0; i < limit; i++) {
    if (bytes[i] === 0) return false;
  }
  return true;
}

export class WorkspacePathConflictError extends Error {
  constructor(path: string) {
    super(`Workspace path already exists: ${path}`);
    this.name = 'WorkspacePathConflictError';
  }
}

export class WorkspaceNotFoundError extends Error {
  constructor(path: string) {
    super(`Workspace path not found: ${path}`);
    this.name = 'WorkspaceNotFoundError';
  }
}

export class WorkspaceNotAFileError extends Error {
  constructor(path: string) {
    super(`Workspace path is not a file: ${path}`);
    this.name = 'WorkspaceNotAFileError';
  }
}

export interface CreateFileOptions {
  actor?: WorkspaceActor;
  mimeType?: string;
  tags?: string[];
  source?: WorkspaceFileSource;
  /** Overwrite an existing file instead of throwing on conflict. */
  overwrite?: boolean;
}

export interface WorkspaceFsDeps {
  db: BrowserClawDB;
  content: ContentStore;
  now?: () => number;
  newId?: () => string;
}

function toBytes(content: Uint8Array | string): Uint8Array {
  return typeof content === 'string'
    ? new TextEncoder().encode(content)
    : content;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice());
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export class WorkspaceFs {
  readonly #db: BrowserClawDB;
  readonly #content: ContentStore;
  readonly #now: () => number;
  readonly #newId: () => string;

  constructor(deps: WorkspaceFsDeps) {
    this.#db = deps.db;
    this.#content = deps.content;
    this.#now = deps.now ?? Date.now;
    this.#newId = deps.newId ?? (() => crypto.randomUUID());
  }

  #metaByPath(path: string): Promise<WorkspaceFileMeta | undefined> {
    return this.#db.workspace_files.where('path').equals(path).first();
  }

  async stat(path: string): Promise<FileStat> {
    const p = normalizeWorkspacePath(path);
    const meta = await this.#metaByPath(p);
    if (!meta) throw new WorkspaceNotFoundError(p);
    return meta;
  }

  async exists(path: string): Promise<boolean> {
    return (await this.#metaByPath(normalizeWorkspacePath(path))) !== undefined;
  }

  async createFile(
    path: string,
    content: Uint8Array | string,
    options: CreateFileOptions = {},
  ): Promise<FileStat> {
    const p = normalizeWorkspacePath(path);
    const existing = await this.#metaByPath(p);
    if (existing && !options.overwrite) {
      throw new WorkspacePathConflictError(p);
    }
    if (existing && existing.kind === 'directory') {
      throw new WorkspacePathConflictError(p);
    }
    const bytes = toBytes(content);
    const now = this.#now();
    const id = existing?.id ?? this.#newId();
    // Content first, then metadata (so a failed write leaves no dangling row).
    await this.#content.write(id, bytes);
    const meta: WorkspaceFileMeta = {
      id,
      path: p,
      kind: 'file',
      sizeBytes: bytes.byteLength,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      createdBy: existing?.createdBy ?? options.actor ?? 'agent',
      updatedBy: options.actor ?? 'agent',
      checksum: await sha256Hex(bytes),
      ...(options.mimeType !== undefined ? { mimeType: options.mimeType } : {}),
      ...(options.tags !== undefined ? { tags: options.tags } : {}),
      ...(options.source !== undefined ? { source: options.source } : {}),
    };
    await this.#db.workspace_files.put(meta);
    return meta;
  }

  async #requireFile(path: string): Promise<WorkspaceFileMeta> {
    const meta = await this.#metaByPath(path);
    if (!meta) throw new WorkspaceNotFoundError(path);
    if (meta.kind !== 'file') throw new WorkspaceNotAFileError(path);
    return meta;
  }

  async readFile(path: string): Promise<Uint8Array> {
    const p = normalizeWorkspacePath(path);
    const meta = await this.#requireFile(p);
    return this.#content.read(meta.id);
  }

  async readText(path: string): Promise<string> {
    return new TextDecoder().decode(await this.readFile(path));
  }

  /**
   * Read a character range of a text file (B4). `start`/`length` count Unicode
   * code points, and slicing is done on code points (via spread), so a multibyte
   * character / surrogate pair is never split. `length` is capped at
   * {@link MAX_RANGE_CHARS}.
   */
  async readTextRange(
    path: string,
    start: number,
    length: number,
  ): Promise<string> {
    if (!Number.isInteger(start) || start < 0) {
      throw new RangeError(
        'readTextRange: start must be a non-negative integer',
      );
    }
    if (!Number.isInteger(length) || length < 0) {
      throw new RangeError(
        'readTextRange: length must be a non-negative integer',
      );
    }
    if (length > MAX_RANGE_CHARS) {
      throw new RangeError(
        `readTextRange: length ${length} exceeds the ${MAX_RANGE_CHARS} limit`,
      );
    }
    const codePoints = [...(await this.readText(path))];
    return codePoints.slice(start, start + length).join('');
  }

  /**
   * Read a 1-based line range of a text file as a {@link TextSnippet} (B4).
   * `lineCount` is capped at {@link MAX_SNIPPET_LINES} and the serialized output
   * at {@link MAX_SNIPPET_BYTES}.
   */
  async readLines(
    path: string,
    startLine: number,
    lineCount: number,
  ): Promise<TextSnippet> {
    if (!Number.isInteger(startLine) || startLine < 1) {
      throw new RangeError('readLines: startLine is 1-based and must be >= 1');
    }
    if (!Number.isInteger(lineCount) || lineCount < 0) {
      throw new RangeError(
        'readLines: lineCount must be a non-negative integer',
      );
    }
    if (lineCount > MAX_SNIPPET_LINES) {
      throw new RangeError(
        `readLines: lineCount ${lineCount} exceeds the ${MAX_SNIPPET_LINES} limit`,
      );
    }
    const p = normalizeWorkspacePath(path);
    const from = startLine - 1;
    const lines = (await this.readText(p))
      .split('\n')
      .slice(from, from + lineCount);
    const text = lines.join('\n');
    if (new TextEncoder().encode(text).byteLength > MAX_SNIPPET_BYTES) {
      throw new RangeError('readLines: snippet exceeds the output size limit');
    }
    return { path: p, startLine, endLine: from + lines.length, lines, text };
  }

  async updateFile(
    path: string,
    content: Uint8Array | string,
    actor: WorkspaceActor = 'agent',
  ): Promise<FileStat> {
    const p = normalizeWorkspacePath(path);
    await this.#requireFile(p);
    return this.createFile(p, content, { actor, overwrite: true });
  }

  async appendFile(
    path: string,
    content: Uint8Array | string,
    actor: WorkspaceActor = 'agent',
  ): Promise<FileStat> {
    const p = normalizeWorkspacePath(path);
    const existing = await this.#metaByPath(p);
    if (!existing) return this.createFile(p, content, { actor });
    if (existing.kind !== 'file') throw new WorkspaceNotAFileError(p);
    const current = await this.#content.read(existing.id);
    const addition = toBytes(content);
    const merged = new Uint8Array(current.byteLength + addition.byteLength);
    merged.set(current, 0);
    merged.set(addition, current.byteLength);
    return this.createFile(p, merged, { actor, overwrite: true });
  }

  async deleteFile(path: string): Promise<void> {
    const p = normalizeWorkspacePath(path);
    const meta = await this.#metaByPath(p);
    if (!meta) throw new WorkspaceNotFoundError(p);
    if (meta.kind === 'file') await this.#content.delete(meta.id);
    await this.#db.workspace_files.delete(meta.id);
  }

  async mkdir(path: string): Promise<void> {
    const p = normalizeWorkspacePath(path);
    const existing = await this.#metaByPath(p);
    if (existing) {
      if (existing.kind === 'directory') return; // idempotent
      throw new WorkspacePathConflictError(p);
    }
    const now = this.#now();
    await this.#db.workspace_files.put({
      id: this.#newId(),
      path: p,
      kind: 'directory',
      sizeBytes: 0,
      createdAt: now,
      updatedAt: now,
      createdBy: 'agent',
    });
  }

  async listDir(path: string): Promise<FileStat[]> {
    const dir = normalizeWorkspacePath(path);
    const prefix = dir === '/workspace' ? '/workspace/' : `${dir}/`;
    const all = await this.#db.workspace_files.toArray();
    return all
      .filter(
        (m) =>
          m.path.startsWith(prefix) &&
          !m.path.slice(prefix.length).includes('/'),
      )
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  /**
   * Read a file's bytes as text only when it is a non-binary, not-too-large
   * file — otherwise return null so search/grep skip it safely (B5).
   */
  async #readTextForScan(meta: WorkspaceFileMeta): Promise<string | null> {
    if (meta.kind !== 'file') return null;
    if (meta.sizeBytes > MAX_SEARCH_FILE_BYTES) return null;
    const bytes = await this.#content.read(meta.id);
    if (!isProbablyText(bytes)) return null;
    return new TextDecoder().decode(bytes);
  }

  /**
   * Search workspace files by path, tag, extension, and/or text content (B5).
   * Content matching is an on-demand scan over the metadata table (no separate
   * FTS index in v0.1), so it always reflects the current files — an updated
   * file matches its new content, a deleted file is simply gone from the table.
   */
  async search(query: WorkspaceSearchQuery): Promise<WorkspaceSearchResult[]> {
    const limit = query.limit ?? DEFAULT_SEARCH_LIMIT;
    const pathNeedle = query.pathContains?.toLowerCase();
    const textNeedle = query.textContains?.toLowerCase();
    const ext = query.extension?.replace(/^\./, '').toLowerCase();
    const all = (await this.#db.workspace_files.toArray()).sort((a, b) =>
      a.path.localeCompare(b.path),
    );
    const results: WorkspaceSearchResult[] = [];
    for (const meta of all) {
      if (results.length >= limit) break;
      if (pathNeedle && !meta.path.toLowerCase().includes(pathNeedle)) continue;
      if (query.tag && !(meta.tags ?? []).includes(query.tag)) continue;
      if (ext && !meta.path.toLowerCase().endsWith(`.${ext}`)) continue;
      if (!textNeedle) {
        results.push({ path: meta.path, meta });
        continue;
      }
      const text = await this.#readTextForScan(meta);
      if (text === null) continue;
      const idx = text.toLowerCase().indexOf(textNeedle);
      if (idx === -1) continue;
      const start = Math.max(0, idx - 40);
      results.push({
        path: meta.path,
        meta,
        snippet: text.slice(start, idx + textNeedle.length + 40),
      });
    }
    return results;
  }

  /**
   * Grep for a pattern within one file or across a subtree (B5). The pattern is
   * a literal unless `isRegex` is set (literal default avoids ReDoS). Binary and
   * oversized files are skipped. Results are capped.
   */
  async grep(query: GrepQuery): Promise<GrepResult[]> {
    const limit = query.limit ?? DEFAULT_SEARCH_LIMIT;
    const context = Math.max(0, query.contextLines ?? 0);
    const flags = query.ignoreCase ? 'i' : '';
    const source = query.isRegex ? query.pattern : escapeRegExp(query.pattern);
    let regex: RegExp;
    try {
      regex = new RegExp(source, flags);
    } catch {
      throw new Error(`grep: invalid pattern: ${query.pattern}`);
    }

    const all = (await this.#db.workspace_files.toArray()).sort((a, b) =>
      a.path.localeCompare(b.path),
    );
    let scope = all;
    if (query.path !== undefined) {
      const target = normalizeWorkspacePath(query.path);
      scope = all.filter(
        (m) => m.path === target || m.path.startsWith(`${target}/`),
      );
    }

    const results: GrepResult[] = [];
    for (const meta of scope) {
      if (results.length >= limit) break;
      const text = await this.#readTextForScan(meta);
      if (text === null) continue;
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (results.length >= limit) break;
        if (!regex.test(lines[i] ?? '')) continue;
        const result: GrepResult = {
          path: meta.path,
          line: i + 1,
          text: lines[i] ?? '',
        };
        if (context > 0) {
          result.context = lines.slice(
            Math.max(0, i - context),
            i + context + 1,
          );
        }
        results.push(result);
      }
    }
    return results;
  }

  async moveFile(from: string, to: string): Promise<FileStat> {
    const src = normalizeWorkspacePath(from);
    const dest = normalizeWorkspacePath(to);
    const meta = await this.#requireFile(src);
    if (await this.#metaByPath(dest))
      throw new WorkspacePathConflictError(dest);
    // Bytes stay under the same content id; only the path/metadata changes.
    const moved: WorkspaceFileMeta = {
      ...meta,
      path: dest,
      updatedAt: this.#now(),
      updatedBy: 'agent',
    };
    await this.#db.workspace_files.put(moved);
    return moved;
  }

  async copyFile(from: string, to: string): Promise<FileStat> {
    const src = normalizeWorkspacePath(from);
    const dest = normalizeWorkspacePath(to);
    const meta = await this.#requireFile(src);
    if (await this.#metaByPath(dest))
      throw new WorkspacePathConflictError(dest);
    const bytes = await this.#content.read(meta.id);
    const now = this.#now();
    const id = this.#newId();
    await this.#content.write(id, bytes);
    const copy: WorkspaceFileMeta = {
      ...meta,
      id,
      path: dest,
      createdAt: now,
      updatedAt: now,
      updatedBy: 'agent',
    };
    await this.#db.workspace_files.put(copy);
    return copy;
  }
}

export { WorkspaceContentMissingError };
