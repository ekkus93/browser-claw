import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BrowserClawDB, DB_NAME } from './db.ts';

/**
 * v5 migration (hardening A1.2): skill permissions move out of the mutable
 * `skill_state['__permissions__']` row into the protected `skill_permissions`
 * table. A valid blob is copied and the old row removed; a malformed blob is
 * dropped (fail closed) and the failure audited.
 *
 * Each test seeds a LEGACY database at v4 (the pre-migration schema) with a raw
 * Dexie instance, closes it, then opens the real BrowserClawDB so Dexie runs the
 * v5 upgrade.
 */

/** The pre-v5 schema, replayed so we can write a real v4 database to migrate. */
function openLegacyV4(): Dexie {
  const legacy = new Dexie(DB_NAME);
  legacy.version(1).stores({
    app_settings: 'key',
    provider_profiles: 'id, kind',
    encrypted_secrets: 'id',
    conversations: 'id, updatedAt, createdAt',
    messages: 'id, conversationId, [conversationId+createdAt], createdAt',
    memories: 'id, *tags, source, createdAt',
    todos: 'id, status, createdAt',
    rules: 'id',
    schedules: 'id, nextRunAt',
    skills: 'id, source',
    skill_files: '[skillId+path], skillId',
    skill_state: '[skillId+key], skillId',
    audit_events: 'id, type, risk, at',
    runtime_snapshots: 'id, createdAt',
    model_catalog: 'id, provider',
    model_cache_index: 'id, modelId',
    backup_history: 'id, createdAt',
  });
  legacy.version(2).stores({ model_blobs: 'modelId, cachedAt' });
  legacy.version(3).stores({
    audit_events: 'id, type, risk, at, source, status',
  });
  legacy.version(4);
  return legacy;
}

const GOOD_PERMS = {
  tools: ['Remember'],
  read: ['a/**'],
  write: [],
  network: false,
};

beforeEach(async () => {
  await Dexie.delete(DB_NAME);
});

afterEach(async () => {
  await Dexie.delete(DB_NAME);
});

describe('v5 skill_permissions migration', () => {
  it('moves a valid __permissions__ row into the protected store and removes the old row', async () => {
    const legacy = openLegacyV4();
    await legacy.open();
    await legacy.table('skills').put({
      id: 'notes',
      name: 'notes',
      version: '1.0.0',
      description: '',
      source: 'skill_md',
      enabled: true,
      installedAt: 1,
    });
    await legacy
      .table('skill_state')
      .put({ skillId: 'notes', key: '__permissions__', value: GOOD_PERMS });
    legacy.close();

    const db = new BrowserClawDB();
    await db.open();
    try {
      const moved = await db.skill_permissions.get('notes');
      expect(moved?.value).toEqual(GOOD_PERMS);
      // The legacy row is gone — permissions no longer live in skill_state.
      const old = await db.skill_state.get(['notes', '__permissions__']);
      expect(old).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it('drops a malformed __permissions__ blob (fail closed) and audits the failure', async () => {
    const legacy = openLegacyV4();
    await legacy.open();
    await legacy.table('skill_state').put({
      skillId: 'evil',
      key: '__permissions__',
      value: { tools: 'all' },
    });
    legacy.close();

    const db = new BrowserClawDB();
    await db.open();
    try {
      // Nothing copied — a malformed blob must never become permissions.
      expect(await db.skill_permissions.get('evil')).toBeUndefined();
      // The old row is still removed so it can't be read as state either.
      expect(
        await db.skill_state.get(['evil', '__permissions__']),
      ).toBeUndefined();
      const audited = await db.audit_events
        .where('type')
        .equals('skill.permissions_migration_failed')
        .toArray();
      expect(audited[0]?.status).toBe('failure');
      expect(audited[0]?.skillId).toBe('evil');
    } finally {
      db.close();
    }
  });

  it('preserves ordinary (non-permissions) skill_state across the upgrade', async () => {
    const legacy = openLegacyV4();
    await legacy.open();
    await legacy
      .table('skill_state')
      .put({ skillId: 'notes', key: 'draft', value: 'hello' });
    legacy.close();

    const db = new BrowserClawDB();
    await db.open();
    try {
      const kept = await db.skill_state.get(['notes', 'draft']);
      expect(kept?.value).toBe('hello');
    } finally {
      db.close();
    }
  });
});
