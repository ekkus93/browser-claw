import type { BrowserClawDB } from '../db/db.ts';
import type { SkillPermissions } from './skillTypes.ts';

/**
 * Where a skill's declared permissions currently live in its private state.
 *
 * NOTE (hardening A1.2): permissions living in the mutable `skill_state` table
 * is itself a known issue — they will be relocated to a protected store. This
 * module is the single read path for tool authorization, so that move only has
 * to change here.
 */
const PERMISSIONS_KEY = '__permissions__';

export type SkillToolAuthz = { ok: true } | { ok: false; reason: string };

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
  const permRow = await db.skill_state.get([skillId, PERMISSIONS_KEY]);
  const tools = (permRow?.value as SkillPermissions | undefined)?.tools ?? [];
  if (!tools.includes(toolName)) {
    return {
      ok: false,
      reason: `skill ${skillId} did not declare tool '${toolName}'`,
    };
  }
  return { ok: true };
}
