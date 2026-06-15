/** Declared permissions a skill requests at install time. */
export interface SkillPermissions {
  /** Tools the skill may invoke (each still goes through approval). */
  tools: string[];
  /** Path namespaces the skill may read (e.g. skills/x/data/**). */
  read: string[];
  /** Path namespaces the skill may write (e.g. skills/x/out/**). */
  write: string[];
  network: boolean;
}

export interface SkillManifest {
  name: string;
  version: string;
  description: string;
  permissions: SkillPermissions;
}

export interface ParsedSkill {
  manifest: SkillManifest;
  instructions: string;
  /** Read-only package files, keyed by virtual path. */
  files: Record<string, string>;
}

export function emptyPermissions(): SkillPermissions {
  return { tools: [], read: [], write: [], network: false };
}

/**
 * Structural guard for a persisted `SkillPermissions`. Used when reading the
 * protected permission store and when migrating/validating backup rows — a
 * malformed permissions blob must be rejected, never coerced into something
 * permissive.
 */
export function isSkillPermissions(value: unknown): value is SkillPermissions {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const isStringArray = (x: unknown): x is string[] =>
    Array.isArray(x) && x.every((s) => typeof s === 'string');
  return (
    isStringArray(v.tools) &&
    isStringArray(v.read) &&
    isStringArray(v.write) &&
    typeof v.network === 'boolean'
  );
}
