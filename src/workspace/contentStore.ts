/**
 * Byte storage for workspace files (Part B, hardening Q7 ContentStore).
 *
 * File bytes are addressed by a content id (the file's metadata id). The
 * production backend is OPFS; tests use an in-memory backend. When OPFS is
 * unavailable the store is the explicit {@link UnavailableContentStore} — every
 * operation throws {@link WorkspaceUnavailableError}. There is NO silent
 * localStorage/Redux fallback for file bodies: a failure is visible, never faked.
 */

/** Thrown when the workspace byte store is unavailable (e.g. no OPFS). */
export class WorkspaceUnavailableError extends Error {
  constructor(
    message = 'Workspace storage (OPFS) is unavailable in this browser.',
  ) {
    super(message);
    this.name = 'WorkspaceUnavailableError';
  }
}

/** Thrown when a content id has no stored bytes. */
export class WorkspaceContentMissingError extends Error {
  constructor(id: string) {
    super(`No workspace content for id ${id}.`);
    this.name = 'WorkspaceContentMissingError';
  }
}

export interface ContentStore {
  read(id: string): Promise<Uint8Array>;
  write(id: string, bytes: Uint8Array): Promise<void>;
  delete(id: string): Promise<void>;
  has(id: string): Promise<boolean>;
}

/** Feature detection: is the Origin Private File System usable here? */
export function isOpfsAvailable(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.storage?.getDirectory === 'function'
  );
}

/** In-memory backend — used by unit tests (jsdom has no OPFS). */
export class MemoryContentStore implements ContentStore {
  readonly #map = new Map<string, Uint8Array>();

  read(id: string): Promise<Uint8Array> {
    const bytes = this.#map.get(id);
    if (!bytes) return Promise.reject(new WorkspaceContentMissingError(id));
    return Promise.resolve(bytes);
  }
  write(id: string, bytes: Uint8Array): Promise<void> {
    this.#map.set(id, bytes);
    return Promise.resolve();
  }
  delete(id: string): Promise<void> {
    this.#map.delete(id);
    return Promise.resolve();
  }
  has(id: string): Promise<boolean> {
    return Promise.resolve(this.#map.has(id));
  }
}

/** Explicit error backend when OPFS is missing — fails closed and visibly. */
export class UnavailableContentStore implements ContentStore {
  read(): Promise<Uint8Array> {
    return Promise.reject(new WorkspaceUnavailableError());
  }
  write(): Promise<void> {
    return Promise.reject(new WorkspaceUnavailableError());
  }
  delete(): Promise<void> {
    return Promise.reject(new WorkspaceUnavailableError());
  }
  has(): Promise<boolean> {
    return Promise.reject(new WorkspaceUnavailableError());
  }
}

/** OPFS-backed byte store. Files are stored flat under a `content/` directory. */
export class OpfsContentStore implements ContentStore {
  readonly #dirName: string;

  constructor(dirName = 'workspace-content') {
    this.#dirName = dirName;
  }

  async #dir(): Promise<FileSystemDirectoryHandle> {
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle(this.#dirName, { create: true });
  }

  async read(id: string): Promise<Uint8Array> {
    let handle: FileSystemFileHandle;
    try {
      handle = await (await this.#dir()).getFileHandle(id);
    } catch {
      throw new WorkspaceContentMissingError(id);
    }
    const file = await handle.getFile();
    return new Uint8Array(await file.arrayBuffer());
  }

  async write(id: string, bytes: Uint8Array): Promise<void> {
    const handle = await (
      await this.#dir()
    ).getFileHandle(id, { create: true });
    const writable = await handle.createWritable();
    try {
      // .slice() yields an ArrayBuffer-backed view (satisfies the write type
      // under TS's strict ArrayBuffer/SharedArrayBuffer split).
      await writable.write(bytes.slice());
    } finally {
      await writable.close();
    }
  }

  async delete(id: string): Promise<void> {
    try {
      await (await this.#dir()).removeEntry(id);
    } catch {
      // Already gone — deleting absent content is a no-op, not an error.
    }
  }

  async has(id: string): Promise<boolean> {
    try {
      await (await this.#dir()).getFileHandle(id);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * The byte store for this environment: OPFS when available, otherwise the
 * explicit unavailable store (never a silent localStorage fallback).
 */
export function createContentStore(): ContentStore {
  return isOpfsAvailable()
    ? new OpfsContentStore()
    : new UnavailableContentStore();
}
