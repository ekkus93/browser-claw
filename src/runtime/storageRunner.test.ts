import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import auditReducer from '../store/slices/auditSlice.ts';
import { BrowserClawDB } from '../db/db.ts';
import { createStorageEffectHandler } from './storageRunner.ts';

const db = new BrowserClawDB();

function makeHandler() {
  const store = configureStore({ reducer: { audit: auditReducer } });
  const handler = createStorageEffectHandler({
    db,
    dispatch: store.dispatch,
    now: () => 1234,
  });
  return { store, handler };
}

afterEach(async () => {
  await db.open();
  await db.messages.clear();
  await db.audit_events.clear();
});

describe('createStorageEffectHandler', () => {
  it('persists a conversation-scoped message for storage_put', async () => {
    await db.open();
    const { handler } = makeHandler();
    await handler({
      type: 'storage_put',
      id: 'p1',
      conversation_id: 'conv-1',
      store: 'messages',
      key: 'm1',
      value: { role: 'assistant', content: 'hello there' },
    });

    const rows = await db.messages
      .where('conversationId')
      .equals('conv-1')
      .toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      conversationId: 'conv-1',
      role: 'assistant',
      content: 'hello there',
      createdAt: 1234,
    });
  });

  it('rejects and audits an unknown store', async () => {
    await db.open();
    const { store, handler } = makeHandler();
    await expect(
      handler({
        type: 'storage_put',
        id: 'p2',
        conversation_id: 'c',
        store: 'secrets',
        key: 'k',
        value: { role: 'assistant', content: 'x' },
      }),
    ).rejects.toThrow(/unknown store/);

    expect(
      store
        .getState()
        .audit.recent.some((e) => e.type === 'storage.effect_failed'),
    ).toBe(true);
    expect(await db.messages.count()).toBe(0);
  });

  it('rejects and audits a malformed message record', async () => {
    await db.open();
    const { handler } = makeHandler();
    await expect(
      handler({
        type: 'storage_put',
        id: 'p3',
        conversation_id: 'c',
        store: 'messages',
        key: 'k',
        value: { role: 'bogus', content: 123 },
      }),
    ).rejects.toThrow(/invalid message record/);
    expect(await db.messages.count()).toBe(0);

    const durable = await db.audit_events
      .where('type')
      .equals('storage.effect_failed')
      .toArray();
    expect(durable.some((e) => e.status === 'failure')).toBe(true);
  });

  it('fails closed on an unsupported storage op (get/search)', async () => {
    await db.open();
    const { handler } = makeHandler();
    await expect(
      handler({
        type: 'storage_get',
        id: 'g1',
        store: 'messages',
        key: 'm1',
      }),
    ).rejects.toThrow(/not supported/);
  });
});
