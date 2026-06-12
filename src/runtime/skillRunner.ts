import type { BrowserClawDB } from '../db/db.ts';
import type { AppDispatch } from '../store/store.ts';
import { recordAudit } from '../audit/auditSink.ts';
import type { Command, Effect } from './effectTypes.ts';
import type { SkillFs } from '../skills/skillFs.ts';

type SkillEffect = Extract<
  Effect,
  { type: 'skill_fs_read_text' | 'skill_state_get' | 'skill_state_put' }
>;

export interface SkillEffectDeps {
  db: BrowserClawDB;
  dispatch: AppDispatch;
  /** Build the permission-scoped filesystem for a skill (SkillManager.fsFor). */
  fsFor: (skillId: string) => Promise<SkillFs>;
  /** Feed a command back into the runtime (host.submit). */
  submit: (command: Command) => Promise<void>;
}

/**
 * Handles the runtime's skill filesystem/state effects. Every access is routed
 * through the skill's permission-scoped {@link SkillFs}, so namespace and
 * reserved-key rules are ENFORCED here in the data layer — never merely shown
 * in the UI. The skill must also be installed and enabled; a disabled or
 * unknown skill is denied. Denials are audited and resolved back into the
 * deterministic runtime as failures so it records what actually happened and
 * never proceeds as if the access succeeded.
 */
export function createSkillEffectHandler(deps: SkillEffectDeps) {
  async function deny(effect: SkillEffect, reason: string): Promise<void> {
    void recordAudit(deps.db, deps.dispatch, {
      type: 'skill.permission_denied',
      summary: `Skill ${effect.skill_id} denied: ${reason}`,
      source: 'skill',
      risk: 'medium',
      status: 'failure',
      skillId: effect.skill_id,
    });
    await deps.submit({
      type: 'resolve_effect',
      id: effect.id,
      result: { ok: false, error: { kind: 'permission_denied', message: reason } },
    });
  }

  return async (effect: SkillEffect): Promise<void> => {
    // Fail closed: only an installed, enabled skill may touch its files/state.
    const skill = await deps.db.skills.get(effect.skill_id);
    if (!skill) {
      await deny(effect, `unknown skill ${effect.skill_id}`);
      return;
    }
    if (!skill.enabled) {
      await deny(effect, `skill ${effect.skill_id} is disabled`);
      return;
    }

    const fs = await deps.fsFor(effect.skill_id);
    try {
      switch (effect.type) {
        case 'skill_fs_read_text': {
          const content = await fs.readText(effect.path);
          await deps.submit({
            type: 'resolve_effect',
            id: effect.id,
            result: { ok: true, content },
          });
          return;
        }
        case 'skill_state_get': {
          const value = await fs.getState(effect.key);
          await deps.submit({
            type: 'resolve_effect',
            id: effect.id,
            result: { ok: true, value },
          });
          return;
        }
        case 'skill_state_put': {
          await fs.setState(effect.key, effect.value);
          await deps.submit({
            type: 'resolve_effect',
            id: effect.id,
            result: { ok: true },
          });
          return;
        }
      }
    } catch (error) {
      // SkillFs throws on a permission violation (out-of-namespace path,
      // reserved state key). Treat it as a denial.
      const reason = error instanceof Error ? error.message : String(error);
      await deny(effect, reason);
    }
  };
}
