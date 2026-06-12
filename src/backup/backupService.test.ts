import 'fake-indexeddb/auto';
import { afterAll, describe, expect, it } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import auditReducer from '../store/slices/auditSlice.ts';
import { BrowserClawDB } from '../db/db.ts';
import {
  exportBackup,
  serializeBackup,
  parseBackup,
  validateBackup,
  importBackup,
  recordBackupHistory,
  runBackupExport,
} from './backupService.ts';
import type { AppDispatch } from '../store/store.ts';

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

    // JSONL: first line is the manifest, then one record per line.
    const serialized = serializeBackup(backup);
    const lines = serialized.trim().split('\n');
    expect(JSON.parse(lines[0]!)).toHaveProperty('manifest');
    expect(lines.length).toBeGreaterThan(1);

    const validation = validateBackup(parseBackup(serialized));
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

  it('parseBackup round-trips JSONL and accepts legacy JSON', async () => {
    await db.open();
    const backup = await exportBackup(db, { now: () => 9 });

    // JSONL round-trip
    const fromJsonl = parseBackup(serializeBackup(backup));
    expect(fromJsonl.manifest.format).toBe('clawbackup');

    // legacy single-document JSON still parses
    const fromLegacy = parseBackup(JSON.stringify(backup));
    expect(fromLegacy.manifest.format).toBe('clawbackup');

    // unreadable input throws (the UI catches this)
    expect(() => parseBackup('not a backup')).toThrow();
    // valid JSONL lines without a manifest throw the manifest error
    expect(() => parseBackup('{"collection":"x","row":{}}')).toThrow(
      /manifest/i,
    );
  });

  it('records backup history', async () => {
    await db.open();
    const backup = await exportBackup(db, { now: () => 7 });
    await recordBackupHistory(db, backup, 2048);
    const history = await db.backup_history.toArray();
    expect(history.at(-1)?.sizeBytes).toBe(2048);
  });
});

describe('runBackupExport', () => {
  it('records history + a success audit only after the download succeeds', async () => {
    await db.open();
    await db.backup_history.clear();
    const store = configureStore({ reducer: { audit: auditReducer } });
    const downloaded: string[] = [];

    const result = await runBackupExport({
      db,
      dispatch: store.dispatch as unknown as AppDispatch,
      download: (filename) => {
        downloaded.push(filename);
      },
      now: () => 100,
    });

    expect(result.ok).toBe(true);
    expect(downloaded).toEqual(['browserclaw-backup.clawbackup']);
    expect(await db.backup_history.count()).toBe(1);
    expect(store.getState().audit.recent.map((e) => e.type)).toContain(
      'backup.exported',
    );
  });

  it('does NOT record history or success when the download fails', async () => {
    await db.open();
    await db.backup_history.clear();
    const store = configureStore({ reducer: { audit: auditReducer } });

    const result = await runBackupExport({
      db,
      dispatch: store.dispatch as unknown as AppDispatch,
      download: () => {
        throw new Error('Downloads are not supported in this browser.');
      },
      now: () => 100,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not supported/i);
    expect(await db.backup_history.count()).toBe(0);
    const types = store.getState().audit.recent.map((e) => e.type);
    expect(types).toContain('backup.export_failed');
    expect(types).not.toContain('backup.exported');
  });
});

function backupOf(
  collections: Record<string, unknown[]>,
  schemaVersion = 1,
): unknown {
  return {
    manifest: {
      format: 'clawbackup',
      schemaVersion,
      appVersion: 'test',
      createdAt: 0,
      includesSecrets: false,
    },
    collections,
  };
}

describe('validateBackup hardening', () => {
  it('rejects an unknown collection', () => {
    const result = validateBackup(backupOf({ rootkit: [{ id: 'x' }] }));
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/unknown backup collection/i);
  });

  it('rejects a collection that is not a list', () => {
    const result = validateBackup(backupOf({ memories: { id: 'x' } as never }));
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/not a list/i);
  });

  it('rejects a malformed row (missing key field)', () => {
    const result = validateBackup(backupOf({ memories: [{ title: 'no id' }] }));
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/key field/i);
  });

  it('rejects a non-object row', () => {
    const result = validateBackup(backupOf({ memories: ['nope'] }));
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/malformed/i);
  });

  it('rejects a backup from a newer schema version', () => {
    const result = validateBackup(backupOf({ memories: [] }, 9999));
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/newer than this app/i);
  });

  it('rejects a backup with no schema version', () => {
    const result = validateBackup({
      manifest: { format: 'clawbackup', appVersion: 'x', createdAt: 0 },
      collections: {},
    });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/schema version/i);
  });

  it('rejects a backup over the row-count limit', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const result = validateBackup(backupOf({ memories: rows }), {
      maxRowsPerCollection: 2,
    });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/over the 2 limit/i);
  });

  it('rejects a backup over the total-size limit', () => {
    const rows = [{ id: 'a', blob: 'x'.repeat(100) }];
    const result = validateBackup(backupOf({ memories: rows }), {
      maxTotalBytes: 10,
    });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/total size limit/i);
  });

  it('rejects a row that embeds a raw decrypted secret (by field name)', () => {
    const result = validateBackup(
      backupOf({ provider_profiles: [{ id: 'openai', apiKey: 'hunter2xyz' }] }),
    );
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/raw decrypted secret/i);
  });

  it('rejects a row that embeds a credential-shaped value anywhere', () => {
    const result = validateBackup(
      backupOf({
        memories: [{ id: 'm1', text: 'my key is sk-ant-abcdefghijklmnopqrst' }],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/raw decrypted secret/i);
  });

  it('accepts a legitimate provider profile (apiKeyMode / encryptedSecretId are not secrets)', () => {
    const result = validateBackup(
      backupOf({
        provider_profiles: [
          {
            id: 'openai',
            kind: 'openai',
            label: 'OpenAI',
            apiKeyMode: 'encrypted',
            encryptedSecretId: 'provider:openai',
          },
        ],
      }),
    );
    expect(result.valid).toBe(true);
  });

  it('accepts ciphertext-only encrypted_secrets rows', () => {
    const result = validateBackup(
      backupOf({
        encrypted_secrets: [
          {
            id: 'provider:openai',
            label: 'OpenAI',
            storageMode: 'encrypted',
            ciphertext: 'YmFzZTY0Y2lwaGVydGV4dA==',
            iv: 'YmFzZTY0aXY=',
          },
        ],
      }),
    );
    expect(result.valid).toBe(true);
  });
});
