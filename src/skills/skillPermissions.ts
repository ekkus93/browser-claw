import type { BrowserClawDB } from '../db/db.ts';
import {
  emptyPermissions,
  isSkillPermissions,
  type SkillPermissions,
} from './skillTypes.ts';

export type SkillToolAuthz = { ok: true } | { ok: false; reason: string };

/**
 * Read a skill's declared permissions from the PROTECTED `skill_permissions`
 * store (hardening A1.2 — they no longer live in the mutable `skill_state`
 * table a skill could influence). This is the single read path for permissions;
 * a malformed/absent blob fails closed to no permissions.
 */
export async function loadSkillPermissions(
  db: BrowserClawDB,
  skillId: string,
): Promise<SkillPermissions> {
  const row = await db.skill_permissions.get(skillId);
  return isSkillPermissions(row?.value) ? row.value : emptyPermissions();
}

/**
 * Authorize a tool call against the skill that requested it, reading the
 * skill's PROTECTED declared permissions. Fail-closed: the skill must exist, be
 * enabled, and have declared the tool.
 *
 * This is the single source of truth for tool authorization. It is called at
 * BOTH proposal time (before queueing an approval) AND approved-execution time
 * (defense in depth, hardening A1.1): an approval can sit in the queue while the
 * skill is disabled or has the tool revoked, so the execution path must never
 * trust the approval/Redux state alone.
 */
export async function authorizeSkillTool(
  db: BrowserClawDB,
  skillId: string,
  toolName: string,
): Promise<SkillToolAuthz> {
  if (!skillId) return { ok: false, reason: 'no active skill' };
  const skill = await db.skills.get(skillId);
  if (!skill) return { ok: false, reason: `unknown skill ${skillId}` };
  if (!skill.enabled) {
    return { ok: false, reason: `skill ${skillId} is disabled` };
  }
  const { tools } = await loadSkillPermissions(db, skillId);
  if (!tools.includes(toolName)) {
    return {
      ok: false,
      reason: `skill ${skillId} did not declare tool '${toolName}'`,
    };
  }
  return { ok: true };
}
