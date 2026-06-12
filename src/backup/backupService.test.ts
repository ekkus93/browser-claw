import 'fake-indexeddb/auto';
import { afterAll, describe, expect, it } from 'vitest';
import { BrowserClawDB } from '../db/db.ts';
import {
  exportBackup,
  serializeBackup,
  validateBackup,
  importBackup,
  recordBackupHistory,
} from './backupService.ts';

const db = new BrowserClawDB();

afterAll(() => {
  db.close();
});

describe('backupService', () => {
  it('exports, validates, and round-trips data back into the db', async () => {
    await db.open();
    await db.conversations.put({
      id: 'c1',
      title: 'Hello',
      createdAt: 1,
      updatedAt: 1,
    });
    await db.memories.put({
      id: 'm1',
      title: 'Note',
      text: 'remember',
      tags: ['x'],
      source: 'chat',
      createdBy: 'user',
      createdAt: 1,
      pinned: false,
      sensitivity: 'normal',
    });

    const backup = await exportBackup(db, { now: () => 42 });
    expect(backup.manifest.format).toBe('clawbackup');
    expect(backup.manifest.includesSecrets).toBe(false);

    const validation = validateBackup(JSON.parse(serializeBackup(backup)));
    expect(validation.valid).toBe(true);
    expect(validation.summary?.conversations).toBe(1);
    expect(validation.summary?.memories).toBe(1);

    // wipe, then restore from the validated backup
    await db.conversations.clear();
    await db.memories.clear();
    expect(await db.conversations.count()).toBe(0);

    await importBackup(db, validation.backup!);
    expect(await db.conversations.get('c1')).toMatchObject({ title: 'Hello' });
    expect(await db.memories.get('m1')).toMatchObject({ title: 'Note' });
  });

  it('excludes secrets unless requested', async () => {
    await db.open();
    const without = await exportBackup(db);
    expect('encrypted_secrets' in without.collections).toBe(false);
    const withSecrets = await exportBackup(db, { includeSecrets: true });
    expect('encrypted_secrets' in withSecrets.collections).toBe(true);
    expect(withSecrets.manifest.includesSecrets).toBe(true);
  });

  it('rejects non-backup data', () => {
    expect(validateBackup(null).valid).toBe(false);
    expect(validateBackup({ manifest: { format: 'nope' } }).valid).toBe(false);
  });

  it('records backup history', async () => {
    await db.open();
    const backup = await exportBackup(db, { now: () => 7 });
    await recordBackupHistory(db, backup, 2048);
    const history = await db.backup_history.toArray();
    expect(history.at(-1)?.sizeBytes).toBe(2048);
  });
});
