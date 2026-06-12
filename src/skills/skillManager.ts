import type { BrowserClawDB } from '../db/db.ts';
import type { AppDispatch } from '../store/store.ts';
import type { SkillSource } from '../db/types.ts';
import { auditAppended } from '../store/slices/auditSlice.ts';
import { SkillFs } from './skillFs.ts';
import { emptyPermissions, type ParsedSkill } from './skillTypes.ts';

const PERMISSIONS_KEY = '__permissions__';

export interface SkillManagerDeps {
  db: BrowserClawDB;
  dispatch: AppDispatch;
  now?: () => number;
}

function audit(deps: SkillManagerDeps, type: string, summary: string): void {
  const now = deps.now ?? Date.now;
  deps.dispatch(
    auditAppended({
      id: crypto.randomUUID(),
      type,
      summary,
      risk: 'info',
      at: now(),
    }),
  );
}

/**
 * Install/enable/disable/uninstall skills over the Dexie skill stores, emitting
 * audit events. Returns a SkillFs scoped to a skill's approved namespaces.
 */
export function createSkillManager(deps: SkillManagerDeps) {
  const { db } = deps;

  return {
    async install(parsed: ParsedSkill, source: SkillSource): Promise<string> {
      const id = parsed.manifest.name;
      const now = deps.now ?? Date.now;
      await db.skills.put({
        id,
        name: parsed.manifest.name,
        version: parsed.manifest.version,
        source,
        enabled: false,
        installedAt: now(),
      });
      const files = Object.entries(parsed.files).map(([path, content]) => ({
        skillId: id,
        path,
        content,
      }));
      if (files.length > 0) await db.skill_files.bulkPut(files);
      // Persist declared permissions in private skill state.
      await db.skill_state.put({
        skillId: id,
        key: PERMISSIONS_KEY,
        value: parsed.manifest.permissions,
      });
      audit(deps, 'skill_installed', `Installed skill ${id}`);
      return id;
    },

    async setEnabled(id: string, enabled: boolean): Promise<void> {
      await db.skills.update(id, { enabled });
      audit(
        deps,
        enabled ? 'skill_enabled' : 'skill_disabled',
        `${enabled ? 'Enabled' : 'Disabled'} skill ${id}`,
      );
    },

    async uninstall(id: string): Promise<void> {
      await db.skills.delete(id);
      await db.skill_files.where('skillId').equals(id).delete();
      await db.skill_state.where('skillId').equals(id).delete();
      audit(deps, 'skill_uninstalled', `Uninstalled skill ${id}`);
    },

    async fsFor(id: string): Promise<SkillFs> {
      const row = await db.skill_state.get([id, PERMISSIONS_KEY]);
      const permissions =
        (row?.value as ReturnType<typeof emptyPermissions> | undefined) ??
        emptyPermissions();
      return new SkillFs(db, id, permissions);
    },
  };
}

export type SkillManager = ReturnType<typeof createSkillManager>;
