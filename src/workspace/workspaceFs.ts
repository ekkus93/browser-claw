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
  WorkspaceActor,
  WorkspaceFileMeta,
  WorkspaceFileSource,
} from './types.ts';

export type FileStat = WorkspaceFileMeta;

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
