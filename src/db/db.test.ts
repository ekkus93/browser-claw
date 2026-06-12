import 'fake-indexeddb/auto';
import { afterAll, describe, expect, it } from 'vitest';
import { db, DB_NAME, DB_VERSION } from './db.ts';

afterAll(() => {
  db.close();
});

describe('BrowserClawDB', () => {
  it('uses the browserclaw database name', () => {
    expect(db.name).toBe(DB_NAME);
  });

  it('opens with all 17 durable stores', async () => {
    await db.open();
    const tableNames = db.tables.map((t) => t.name).sort();
    expect(tableNames).toHaveLength(17);
    expect(tableNames).toEqual([
      'app_settings',
      'audit_events',
      'backup_history',
      'conversations',
      'encrypted_secrets',
      'memories',
      'messages',
      'model_cache_index',
      'model_catalog',
      'provider_profiles',
      'rules',
      'runtime_snapshots',
      'schedules',
      'skill_files',
      'skill_state',
      'skills',
      'todos',
    ]);
  });

  it('seeds the schema version on first creation', async () => {
    await db.open();
    const setting = await db.app_settings.get('schemaVersion');
    expect(setting?.value).toBe(DB_VERSION);
  });

  it('round-trips a conversation and its messages', async () => {
    await db.open();
    await db.conversations.put({
      id: 'c1',
      title: 'First chat',
      createdAt: 1,
      updatedAt: 1,
    });
    await db.messages.bulkPut([
      {
        id: 'm1',
        conversationId: 'c1',
        role: 'user',
        content: 'hi',
        createdAt: 1,
      },
      {
        id: 'm2',
        conversationId: 'c1',
        role: 'assistant',
        content: 'hello',
        createdAt: 2,
      },
    ]);

    const convo = await db.conversations.get('c1');
    expect(convo?.title).toBe('First chat');

    const msgs = await db.messages
      .where('conversationId')
      .equals('c1')
      .sortBy('createdAt');
    expect(msgs.map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  it('queries memories by multi-entry tag index', async () => {
    await db.open();
    await db.memories.put({
      id: 'mem1',
      text: 'remember the api base url',
      tags: ['work', 'config'],
      source: 'chat',
      createdBy: 'user',
      createdAt: 1,
      pinned: false,
      sensitivity: 'normal',
    });
    const tagged = await db.memories.where('tags').equals('config').toArray();
    expect(tagged.map((m) => m.id)).toEqual(['mem1']);
  });
});
