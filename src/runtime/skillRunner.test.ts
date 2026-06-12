import 'fake-indexeddb/auto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import auditReducer from '../store/slices/auditSlice.ts';
import { BrowserClawDB } from '../db/db.ts';
import { createSkillManager } from '../skills/skillManager.ts';
import { parseSkillMd } from '../skills/parseSkill.ts';
import { createSkillEffectHandler } from './skillRunner.ts';
import type { Command } from './effectTypes.ts';

const db = new BrowserClawDB();

afterAll(() => {
  db.close();
});

const SKILL_MD = [
  '---',
  'name: notes',
  'version: 1.0.0',
  'description: keeps notes',
  'read: skills/notes/data/**',
  'write: skills/notes/out/**',
  '---',
  'Take notes.',
].join('\n');

async function setup() {
  await db.open();
  const store = configureStore({ reducer: { audit: auditReducer } });
  const manager = createSkillManager({ db, dispatch: store.dispatch });
  const submitted: Command[] = [];
  const handler = createSkillEffectHandler({
    db,
    dispatch: store.dispatch,
    fsFor: (id) => manager.fsFor(id),
    submit: async (command) => {
      submitted.push(command);
    },
  });
  return { store, manager, submitted, handler };
}

function lastResult(submitted: Command[]): unknown {
  const cmd = submitted.at(-1);
  return cmd && cmd.type === 'resolve_effect' ? cmd.result : undefined;
}

describe('createSkillEffectHandler', () => {
  beforeEach(async () => {
    await db.open();
    await db.skills.clear();
    await db.skill_files.clear();
    await db.skill_state.clear();
  });

  it('serves an in-namespace read and resolves the effect', async () => {
    const { manager, submitted, handler } = await setup();
    await manager.install(parseSkillMd(SKILL_MD), 'skill_md');
    await manager.setEnabled('notes', true);
    // Seed a file inside the declared read namespace (data/**) directly.
    await db.skill_files.put({
      skillId: 'notes',
      path: 'skills/notes/data/in.txt',
      content: 'hello',
    });

    await handler({
      type: 'skill_fs_read_text',
      id: 'e1',
      skill_id: 'notes',
      path: 'skills/notes/data/in.txt',
    });
    expect(lastResult(submitted)).toMatchObject({ ok: true, content: 'hello' });
  });

  it('denies a read outside the declared namespace and audits it', async () => {
    const { store, manager, submitted, handler } = await setup();
    await manager.install(parseSkillMd(SKILL_MD), 'skill_md');
    await manager.setEnabled('notes', true);

    await handler({
      type: 'skill_fs_read_text',
      id: 'e2',
      skill_id: 'notes',
      path: 'skills/other/secret.txt',
    });

    expect(lastResult(submitted)).toMatchObject({
      ok: false,
      error: { kind: 'permission_denied' },
    });
    expect(store.getState().audit.recent.map((e) => e.type)).toContain(
      'skill.permission_denied',
    );
  });

  it('denies writing a reserved state key and audits it', async () => {
    const { store, manager, submitted, handler } = await setup();
    await manager.install(parseSkillMd(SKILL_MD), 'skill_md');
    await manager.setEnabled('notes', true);

    await handler({
      type: 'skill_state_put',
      id: 'e3',
      skill_id: 'notes',
      key: '__permissions__',
      value: { network: true },
    });

    expect(lastResult(submitted)).toMatchObject({ ok: false });
    expect(store.getState().audit.recent.map((e) => e.type)).toContain(
      'skill.permission_denied',
    );
    // The real permissions row must be untouched by the rejected write.
    const row = await db.skill_state.get(['notes', '__permissions__']);
    expect(row?.value).toMatchObject({ network: false });
  });

  it('round-trips ordinary skill state', async () => {
    const { manager, submitted, handler } = await setup();
    await manager.install(parseSkillMd(SKILL_MD), 'skill_md');
    await manager.setEnabled('notes', true);

    await handler({
      type: 'skill_state_put',
      id: 'e4',
      skill_id: 'notes',
      key: 'count',
      value: 5,
    });
    expect(lastResult(submitted)).toMatchObject({ ok: true });

    await handler({
      type: 'skill_state_get',
      id: 'e5',
      skill_id: 'notes',
      key: 'count',
    });
    expect(lastResult(submitted)).toMatchObject({ ok: true, value: 5 });
  });

  it('denies effects for a disabled skill', async () => {
    const { store, manager, submitted, handler } = await setup();
    await manager.install(parseSkillMd(SKILL_MD), 'skill_md');
    // not enabled

    await handler({
      type: 'skill_state_get',
      id: 'e6',
      skill_id: 'notes',
      key: 'count',
    });
    expect(lastResult(submitted)).toMatchObject({ ok: false });
    expect(store.getState().audit.recent.map((e) => e.type)).toContain(
      'skill.permission_denied',
    );
  });

  it('denies effects for an unknown skill', async () => {
    const { submitted, handler } = await setup();

    await handler({
      type: 'skill_fs_read_text',
      id: 'e7',
      skill_id: 'ghost',
      path: 'skills/ghost/x.txt',
    });
    expect(lastResult(submitted)).toMatchObject({
      ok: false,
      error: { kind: 'permission_denied' },
    });
  });
});
