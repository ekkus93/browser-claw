import type { BrowserClawDB } from '../db/db.ts';
import type { SkillPermissions } from './skillTypes.ts';

/**
 * Safe, path-scoped filesystem for skills. Reads/writes are only allowed inside
 * the skill's approved namespaces — never arbitrary paths, no traversal, no raw
 * IndexedDB/OPFS access. Skill state is private key/value storage, and the
 * double-underscore "system" namespace is reserved for the host (a skill can't
 * read or write it), so a skill can never escalate by rewriting its own
 * permissions. See BROWSERCLAW hardening TODO 7.2.
 *
 * Installed package assets (`skill_files`) are READ-ONLY (hardening A1.3):
 * `writeText` writes to the separate `skill_outputs` store and never mutates a
 * package file. `readText` returns a generated output if present, otherwise the
 * package asset.
 */

/**
 * State keys reserved for the host. Skills cannot read or write any key in the
 * system namespace (`__…__`); these are the well-known members of it.
 */
export const RESERVED_STATE_KEYS = [
  '__permissions__',
  '__manifest__',
  '__system__',
  '__audit__',
  '__secrets__',
] as const;

/**
 * Any double-underscore-prefixed key is host-reserved. Using the prefix (not
 * just the explicit list) keeps future system keys safe by default.
 */
export function isReservedStateKey(key: string): boolean {
  return key.startsWith('__');
}

function namespacePrefix(namespace: string): string {
  return namespace.replace(/\*+/g, '').replace(/\/+$/, '');
}

/**
 * Strict path validation applied BEFORE any namespace match. Rejects anything
 * that could escape a skill's namespace: empty paths, null bytes, backslashes,
 * absolute paths, malformed/percent-encoded traversal, and any `.`/`..`
 * segment. Both the raw and the percent-decoded form must be clean, so encoded
 * traversal like `%2e%2e%2f` can't slip past the check.
 */
export function isPathSafe(path: string): boolean {
  if (!path) return false;
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return false; // malformed percent-encoding
  }
  for (const candidate of [path, decoded]) {
    if (candidate.includes('\0')) return false; // null byte
    if (candidate.includes('\\')) return false; // backslash traversal
    if (candidate.startsWith('/')) return false; // absolute path
    const segments = candidate.split('/');
    if (segments.some((seg) => seg === '..' || seg === '.')) return false;
  }
  return true;
}

export function isPathAllowed(path: string, namespaces: string[]): boolean {
  if (!isPathSafe(path)) return false;
  return namespaces.some((namespace) => {
    const prefix = namespacePrefix(namespace);
    if (prefix.length === 0) return false;
    return path === prefix || path.startsWith(`${prefix}/`);
  });
}

export class SkillFs {
  readonly #db: BrowserClawDB;
  readonly #skillId: string;
  readonly #permissions: SkillPermissions;

  constructor(
    db: BrowserClawDB,
    skillId: string,
    permissions: SkillPermissions,
  ) {
    this.#db = db;
    this.#skillId = skillId;
    this.#permissions = permissions;
  }

  async readText(path: string): Promise<string | null> {
    if (!isPathAllowed(path, this.#permissions.read)) {
      throw new Error(`Skill read denied: ${path}`);
    }
    // A generated output shadows a package asset at the same path; fall back to
    // the read-only installed package file.
    const output = await this.#db.skill_outputs.get([this.#skillId, path]);
    if (output) return output.content;
    const pkg = await this.#db.skill_files.get([this.#skillId, path]);
    return pkg?.content ?? null;
  }

  async writeText(path: string, content: string): Promise<void> {
    if (!isPathAllowed(path, this.#permissions.write)) {
      throw new Error(`Skill write denied: ${path}`);
    }
    // Writes go to the artifacts store — NEVER the read-only package assets.
    await this.#db.skill_outputs.put({ skillId: this.#skillId, path, content });
  }

  async getState(key: string): Promise<unknown> {
    if (isReservedStateKey(key)) {
      throw new Error(`Skill state key is reserved: ${key}`);
    }
    const row = await this.#db.skill_state.get([this.#skillId, key]);
    return row?.value;
  }

  async setState(key: string, value: unknown): Promise<void> {
    if (isReservedStateKey(key)) {
      throw new Error(`Skill state key is reserved: ${key}`);
    }
    await this.#db.skill_state.put({ skillId: this.#skillId, key, value });
  }
}
