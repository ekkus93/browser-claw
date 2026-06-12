import 'fake-indexeddb/auto';
import { afterAll, describe, expect, it } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import auditReducer from '../store/slices/auditSlice.ts';
import { BrowserClawDB } from '../db/db.ts';
import { createSkillManager } from './skillManager.ts';
import { parseSkillMd } from './parseSkill.ts';

const db = new BrowserClawDB();

afterAll(() => {
  db.close();
});

const SKILL_MD = [
  '---',
  'name: summarize-pdf',
  'version: 1.0.0',
  'description: Summarizes PDFs',
  'read: skills/summarize-pdf/data/**',
  'write: skills/summarize-pdf/out/**',
  '---',
  'Summarize the document.',
].join('\n');

describe('createSkillManager', () => {
  it('installs a skill, audits it, and enforces SkillFs namespaces', async () => {
    await db.open();
    const store = configureStore({ reducer: { audit: auditReducer } });
    const manager = createSkillManager({ db, dispatch: store.dispatch });

    const id = await manager.install(parseSkillMd(SKILL_MD), 'skill_md');
    expect(id).toBe('summarize-pdf');
    expect(await db.skills.get(id)).toMatchObject({ enabled: false });
    expect(store.getState().audit.recent[0]?.type).toBe('skill_installed');

    const fs = await manager.fsFor(id);
    // SKILL.md is outside the read namespace -> denied
    await expect(fs.readText('SKILL.md')).rejects.toThrow(/denied/);
    // writing inside the write namespace is allowed, then readable via state
    await fs.writeText('skills/summarize-pdf/out/note.txt', 'hi');
    await expect(
      fs.writeText('skills/summarize-pdf/data/x.txt', 'nope'),
    ).rejects.toThrow(/denied/);
    await fs.setState('count', 3);
    expect(await fs.getState('count')).toBe(3);
  });

  it('rejects an invalid skill at install and persists nothing', async () => {
    await db.open();
    const store = configureStore({ reducer: { audit: auditReducer } });
    const manager = createSkillManager({ db, dispatch: store.dispatch });

    // Missing name + description (only instructions present).
    const bad = parseSkillMd('just instructions');
    await expect(manager.install(bad, 'skill_md')).rejects.toThrow(/Invalid/);

    expect(await db.skills.get('')).toBeUndefined();
    expect(store.getState().audit.recent.map((e) => e.type)).toContain(
      'skill_import_failed',
    );
  });

  it('enables, disables, and uninstalls with audit + cleanup', async () => {
    await db.open();
    const store = configureStore({ reducer: { audit: auditReducer } });
    const manager = createSkillManager({ db, dispatch: store.dispatch });
    await manager.install(parseSkillMd(SKILL_MD), 'skill_md');

    await manager.setEnabled('summarize-pdf', true);
    expect(await db.skills.get('summarize-pdf')).toMatchObject({
      enabled: true,
    });

    await manager.uninstall('summarize-pdf');
    expect(await db.skills.get('summarize-pdf')).toBeUndefined();
    expect(
      await db.skill_files.where('skillId').equals('summarize-pdf').count(),
    ).toBe(0);
    expect(store.getState().audit.recent.map((e) => e.type)).toContain(
      'skill_uninstalled',
    );
  });

  it('removes stale package files on reinstall', async () => {
    await db.open();
    const store = configureStore({ reducer: { audit: auditReducer } });
    const manager = createSkillManager({ db, dispatch: store.dispatch });

    const v1 = [
      '---',
      'name: stale-files',
      'version: 1.0.0',
      'description: v1',
      '---',
      'v1',
    ].join('\n');
    const id = await manager.install(
      {
        ...parseSkillMd(v1),
        files: { 'old.txt': 'gone', 'keep.txt': 'a' },
      },
      'skill_md',
    );
    expect(await db.skill_files.where('skillId').equals(id).count()).toBe(2);

    const v2 = [
      '---',
      'name: stale-files',
      'version: 2.0.0',
      'description: v2',
      '---',
      'v2',
    ].join('\n');
    await manager.install(
      {
        ...parseSkillMd(v2),
        files: { 'keep.txt': 'b' },
      },
      'skill_md',
    );

    const paths = (
      await db.skill_files.where('skillId').equals(id).toArray()
    ).map((f) => f.path);
    expect(paths).toEqual(['keep.txt']);
    expect((await db.skills.get(id))?.version).toBe('2.0.0');
    expect(store.getState().audit.recent.map((e) => e.type)).toContain(
      'skill_reinstalled',
    );
  });

  it('preserves skill state on reinstall by default, clears it on request', async () => {
    await db.open();
    const store = configureStore({ reducer: { audit: auditReducer } });
    const manager = createSkillManager({ db, dispatch: store.dispatch });

    const md = [
      '---',
      'name: stateful',
      'version: 1.0.0',
      'description: keeps state',
      '---',
      'go',
    ].join('\n');
    const id = await manager.install(parseSkillMd(md), 'skill_md');
    const fs = await manager.fsFor(id);
    await fs.setState('count', 7);

    // Default reinstall preserves user state.
    await manager.install(parseSkillMd(md), 'skill_md');
    expect(await (await manager.fsFor(id)).getState('count')).toBe(7);

    // Explicit clear wipes it.
    await manager.install(parseSkillMd(md), 'skill_md', { clearState: true });
    expect(await (await manager.fsFor(id)).getState('count')).toBeUndefined();
  });

  it('fails (and audits failure) when enabling a missing skill', async () => {
    await db.open();
    const store = configureStore({ reducer: { audit: auditReducer } });
    const manager = createSkillManager({ db, dispatch: store.dispatch });

    await expect(manager.setEnabled('ghost', true)).rejects.toThrow(
      /not installed/,
    );
    const types = store.getState().audit.recent.map((e) => e.type);
    expect(types).toContain('skill_enable_failed');
    expect(types).not.toContain('skill_enabled');
  });

  it('fails (and audits failure) when disabling a missing skill', async () => {
    await db.open();
    const store = configureStore({ reducer: { audit: auditReducer } });
    const manager = createSkillManager({ db, dispatch: store.dispatch });

    await expect(manager.setEnabled('ghost', false)).rejects.toThrow(
      /not installed/,
    );
    const types = store.getState().audit.recent.map((e) => e.type);
    expect(types).toContain('skill_disable_failed');
    expect(types).not.toContain('skill_disabled');
  });
});
