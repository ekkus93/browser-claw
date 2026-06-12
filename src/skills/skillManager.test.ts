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
});
