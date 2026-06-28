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
/** Query for workspace metadata/path/content search (spec §2.7). */
export interface WorkspaceSearchQuery {
  /** Case-insensitive substring the path must contain. */
  pathContains?: string;
  /** Case-insensitive substring the file's text must contain. */
  textContains?: string;
  /** Restrict to files carrying this tag. */
  tag?: string;
  /** Restrict to a file extension, e.g. `md` (no dot). */
  extension?: string;
  /** Cap the number of results. */
  limit?: number;
}

export interface WorkspaceSearchResult {
  path: string;
  meta: WorkspaceFileMeta;
  /** First matching text snippet, when a `textContains` matched. */
  snippet?: string;
}

/** Query for grep within one file or across the workspace (spec §2.7). */
export interface GrepQuery {
  /** The needle. Treated as a literal unless `isRegex` is set. */
  pattern: string;
  /** Restrict to a single file or a directory subtree (path prefix). */
  path?: string;
  isRegex?: boolean;
  ignoreCase?: boolean;
  /** Lines of surrounding context to include with each match. */
  contextLines?: number;
  /** Cap the total number of matches returned. */
  limit?: number;
}

// ---------------------------------------------------------------------------
// H1 — Grep policy for agent-originated requests
// ---------------------------------------------------------------------------

/** Controls whether agent-originated grep can use regex and the max pattern length. */
export interface GrepPolicy {
  /** Regex mode is allowed (default false for agent-originated grepping). */
  allowRegex: boolean;
  /** Maximum pattern length in characters (default 200). */
  maxPatternChars: number;
}

/** Default agent-originated grep policy: literal only, max 200 chars. */
export const DEFAULT_AGENT_GREP_POLICY: GrepPolicy = {
  allowRegex: false,
  maxPatternChars: 200,
};

/** Thrown when a grep request violates the active policy. */
export class GrepPolicyError extends Error {
  readonly kind: 'grep_pattern_too_large' | 'regex_not_allowed';
  constructor(kind: GrepPolicyError['kind'], message: string) {
    super(message);
    this.name = 'GrepPolicyError';
    this.kind = kind;
  }
}

/**
 * Validate a grep request against the active policy. Throws {@link GrepPolicyError}
 * for policy violations. Call before passing to WorkspaceFs.grep().
 */
export function validateGrepRequest(query: GrepQuery, policy: GrepPolicy): void {
  if (query.pattern.length > policy.maxPatternChars) {
    throw new GrepPolicyError(
      'grep_pattern_too_large',
      `Grep pattern is too large (${query.pattern.length} chars; max ${policy.maxPatternChars}).`,
    );
  }
  if (query.isRegex && !policy.allowRegex) {
    throw new GrepPolicyError(
      'regex_not_allowed',
      'Regex grep requires explicit approval/capability.',
    );
  }
}

export interface GrepResult {
  path: string;
  /** 1-based line number of the match. */
  line: number;
  text: string;
  /** Surrounding lines when `contextLines` > 0 (includes the match line). */
  context?: string[];
}

/** A line-numbered text excerpt returned by readLines (spec §2.3/§2.7). */
export interface TextSnippet {
  path: string;
  /** 1-based line number of the first returned line. */
  startLine: number;
  /** 1-based line number of the last returned line. */
  endLine: number;
  lines: string[];
  text: string;
}

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
