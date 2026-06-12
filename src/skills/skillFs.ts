import type { BrowserClawDB } from '../db/db.ts';
import type { SkillPermissions } from './skillTypes.ts';

/**
 * Safe, path-scoped filesystem for skills. Reads/writes are only allowed inside
 * the skill's approved namespaces — never arbitrary paths, no `..` traversal,
 * no raw IndexedDB/OPFS access. Skill state is private key/value storage.
 */

function namespacePrefix(namespace: string): string {
  const stripped = namespace.replace(/\*+/g, '').replace(/\/+$/, '');
  return stripped;
}

export function isPathAllowed(path: string, namespaces: string[]): boolean {
  if (!path || path.includes('..')) return false;
  const normalized = path.replace(/^\/+/, '');
  return namespaces.some((namespace) => {
    const prefix = namespacePrefix(namespace);
    if (prefix.length === 0) return false;
    return normalized === prefix || normalized.startsWith(`${prefix}/`);
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
    const row = await this.#db.skill_files.get([this.#skillId, path]);
    return row?.content ?? null;
  }

  async writeText(path: string, content: string): Promise<void> {
    if (!isPathAllowed(path, this.#permissions.write)) {
      throw new Error(`Skill write denied: ${path}`);
    }
    await this.#db.skill_files.put({ skillId: this.#skillId, path, content });
  }

  async getState(key: string): Promise<unknown> {
    const row = await this.#db.skill_state.get([this.#skillId, key]);
    return row?.value;
  }

  async setState(key: string, value: unknown): Promise<void> {
    await this.#db.skill_state.put({ skillId: this.#skillId, key, value });
  }
}
