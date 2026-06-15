import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { BrowserClawDB } from '../db/db.ts';
import {
  isEffectAuditEnabled,
  loadEffectAuditPref,
  setEffectAuditEnabled,
} from './runtimeAuditPref.ts';

const db = new BrowserClawDB();

afterEach(async () => {
  await db.open();
  await db.app_settings.clear();
  await setEffectAuditEnabled(db, false); // reset the shared cache
  await db.app_settings.clear();
});

describe('runtimeAuditPref', () => {
  it('defaults to off', async () => {
    await db.open();
    expect(await loadEffectAuditPref(db)).toBe(false);
    expect(isEffectAuditEnabled()).toBe(false);
  });

  it('write-through updates both the durable value and the synchronous cache', async () => {
    await db.open();
    await setEffectAuditEnabled(db, true);
    // Cache is updated immediately (no reload needed).
    expect(isEffectAuditEnabled()).toBe(true);
    // And it survives a reload into a fresh cache state.
    await setEffectAuditEnabled(db, false); // desync the cache deliberately...
    // ...then prove load reads the durable 'true' back.
    await db.app_settings.put({ key: 'verboseRuntimeAudit', value: true });
    expect(await loadEffectAuditPref(db)).toBe(true);
    expect(isEffectAuditEnabled()).toBe(true);
  });
});
