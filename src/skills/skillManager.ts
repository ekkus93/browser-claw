import type { BrowserClawDB } from '../db/db.ts';
import type { AppDispatch } from '../store/store.ts';
import type { AuditRiskLevel, AuditStatus, SkillSource } from '../db/types.ts';
import { recordAudit } from '../audit/auditSink.ts';
import { SkillFs } from './skillFs.ts';
import { type ParsedSkill } from './skillTypes.ts';
import { loadSkillPermissions } from './skillPermissions.ts';
import { validateSkillImport } from './validateSkill.ts';

export interface SkillManagerDeps {
  db: BrowserClawDB;
  dispatch: AppDispatch;
  now?: () => number;
}

/** Options for (re)installing a skill. */
export interface InstallOptions {
  /**
   * On reinstall, clear the skill's persisted state instead of preserving it.
   * Defaults to preserving so a version bump keeps the user's accumulated data.
   * Either way the protected permissions record is refreshed from the new
   * manifest.
   */
  clearState?: boolean;
}

function audit(
  deps: SkillManagerDeps,
  type: string,
  summary: string,
  opts: { risk?: AuditRiskLevel; status?: AuditStatus; skillId?: string } = {},
): void {
  const now = deps.now ?? Date.now;
  // Durable + live tail. Redux dispatch is synchronous inside recordAudit, so
  // the durable write can be fire-and-forget here.
  void recordAudit(deps.db, deps.dispatch, {
    type,
    summary,
    source: 'skill',
    risk: opts.risk ?? 'info',
    status: opts.status ?? 'success',
    at: now(),
    ...(opts.skillId !== undefined ? { skillId: opts.skillId } : {}),
  });
}

/**
 * Install/enable/disable/uninstall skills over the Dexie skill stores, emitting
 * audit events. Returns a SkillFs scoped to a skill's approved namespaces.
 */
export function createSkillManager(deps: SkillManagerDeps) {
  const { db } = deps;

  return {
    async install(
      parsed: ParsedSkill,
      source: SkillSource,
      options: InstallOptions = {},
    ): Promise<string> {
      // Strict gate: reject before persisting anything. Imported skills also
      // start disabled (below) until the user enables them.
      const validation = validateSkillImport(parsed);
      if (!validation.ok) {
        const reason = validation.errors.join(' ');
        const now = deps.now ?? Date.now;
        void recordAudit(deps.db, deps.dispatch, {
          type: 'skill_import_failed',
          summary: `Rejected skill import: ${reason}`,
          source: 'skill',
          risk: 'medium',
          status: 'failure',
          at: now(),
        });
        throw new Error(`Invalid skill: ${reason}`);
      }
      const id = parsed.manifest.name;
      const now = deps.now ?? Date.now;
      const existing = await db.skills.get(id);
      const isReinstall = existing !== undefined;
      await db.skills.put({
        id,
        name: parsed.manifest.name,
        version: parsed.manifest.version,
        description: parsed.manifest.description,
        source,
        // A reinstall keeps the prior enabled state; a fresh install starts
        // disabled until the user enables it.
        enabled: existing?.enabled ?? false,
        installedAt: now(),
      });
      // On reinstall, remove stale package files so a file dropped from the new
      // package can't linger and be read by the skill.
      if (isReinstall) {
        await db.skill_files.where('skillId').equals(id).delete();
        if (options.clearState) {
          await db.skill_state.where('skillId').equals(id).delete();
          await db.skill_outputs.where('skillId').equals(id).delete();
        }
      }
      const files = Object.entries(parsed.files).map(([path, content]) => ({
        skillId: id,
        path,
        content,
      }));
      if (files.length > 0) await db.skill_files.bulkPut(files);
      // Persist declared permissions in the PROTECTED store (hardening A1.2),
      // always refreshed from the new manifest even when other state is
      // preserved. Install/reinstall is the ONLY writer of this store.
      await db.skill_permissions.put({
        skillId: id,
        value: parsed.manifest.permissions,
      });
      audit(
        deps,
        isReinstall ? 'skill_reinstalled' : 'skill_installed',
        `${isReinstall ? 'Reinstalled' : 'Installed'} skill ${id}`,
        { skillId: id },
      );
      return id;
    },

    async setEnabled(id: string, enabled: boolean): Promise<void> {
      // Enable/disable must act on a real skill. `db.skills.update` silently
      // no-ops on a missing id, which would let a stale UI claim a phantom
      // skill was toggled — fail closed and audit the failure instead.
      const updated = await db.skills.update(id, { enabled });
      if (updated === 0) {
        audit(
          deps,
          enabled ? 'skill_enable_failed' : 'skill_disable_failed',
          `Cannot ${enabled ? 'enable' : 'disable'} unknown skill ${id}`,
          { risk: 'medium', status: 'failure', skillId: id },
        );
        throw new Error(
          `Cannot ${enabled ? 'enable' : 'disable'} skill: ${id} is not installed`,
        );
      }
      audit(
        deps,
        enabled ? 'skill_enabled' : 'skill_disabled',
        `${enabled ? 'Enabled' : 'Disabled'} skill ${id}`,
        { skillId: id },
      );
    },

    async uninstall(id: string): Promise<void> {
      await db.skills.delete(id);
      await db.skill_files.where('skillId').equals(id).delete();
      await db.skill_outputs.where('skillId').equals(id).delete();
      await db.skill_state.where('skillId').equals(id).delete();
      await db.skill_permissions.delete(id);
      audit(deps, 'skill_uninstalled', `Uninstalled skill ${id}`, {
        skillId: id,
      });
    },

    async fsFor(id: string): Promise<SkillFs> {
      const permissions = await loadSkillPermissions(db, id);
      return new SkillFs(db, id, permissions);
    },
  };
}

export type SkillManager = ReturnType<typeof createSkillManager>;
