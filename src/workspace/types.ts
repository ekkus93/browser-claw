/**
 * Workspace filesystem types (Part B). The workspace is an app-private virtual
 * filesystem: metadata rows live in Dexie (`workspace_files`), file BYTES live
 * in a {@link ContentStore} backed by OPFS — never in Redux, never in
 * localStorage. It is NOT the user's OS filesystem.
 */

/** The single virtual root all workspace paths live under. */
export const WORKSPACE_ROOT = '/workspace';

/** Conventional top-level directories seeded/used under the root (spec §2.1). */
export const WORKSPACE_DIRS = [
  '/workspace/notes',
  '/workspace/research',
  '/workspace/artifacts',
  '/workspace/scripts',
  '/workspace/imports',
  '/workspace/tmp',
] as const;

export type WorkspaceActor = 'user' | 'agent' | 'import' | 'script' | 'system';

/** Where a workspace file came from (research bundle, import, etc.). */
export interface WorkspaceFileSource {
  kind: 'user' | 'agent' | 'import' | 'script' | 'web' | 'system';
  /** Optional origin detail, e.g. a source URL or importing skill id. */
  ref?: string;
}

/**
 * Durable metadata for one workspace entry. The file's bytes are addressed by
 * `id` in the ContentStore (a directory has no content). See spec §2.5.
 */
export interface WorkspaceFileMeta {
  id: string;
  path: string;
  kind: 'file' | 'directory';
  mimeType?: string;
  sizeBytes: number;
  createdAt: number;
  updatedAt: number;
  createdBy: WorkspaceActor;
  updatedBy?: WorkspaceActor;
  source?: WorkspaceFileSource;
  tags?: string[];
  checksum?: string;
  indexedAt?: number;
}
