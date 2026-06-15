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
  containsLikelyRawSecret,
  summarizeConflicts,
  summarizeModelReferences,
  encryptBackup,
  decryptBackup,
  isEncryptedBackup,
  workspaceBackupSizeBytes,
  type ClawBackup,
} from './backupService.ts';
import { MemoryContentStore } from '../workspace/contentStore.ts';
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

describe('importBackup (transactional)', () => {
  function backup(collections: Record<string, unknown[]>): ClawBackup {
    return {
      manifest: {
        format: 'clawbackup',
        schemaVersion: 1,
        appVersion: 'test',
        createdAt: 0,
        includesSecrets: false,
      },
      collections,
    };
  }

  it('self-validates: rejects an unknown collection regardless of caller (A2.5)', async () => {
    await db.open();
    await expect(
      importBackup(db, backup({ not_a_real_table: [{ id: 'x' }] })),
    ).rejects.toThrow(/invalid backup/i);
  });

  it('self-validates: rejects a malformed row (A2.5)', async () => {
    await db.open();
    await expect(
      importBackup(db, backup({ memories: [{ id: '' }] })),
    ).rejects.toThrow(/invalid backup/i);
  });

  it('self-validates: rejects a row carrying a raw secret (A2.5)', async () => {
    await db.open();
    await expect(
      importBackup(
        db,
        backup({
          memories: [
            {
              id: 'leak',
              title: 'x',
              text: 'my key is sk-ant-abcdef0123456789abcdef',
              tags: [],
              source: 'chat',
              createdBy: 'user',
              createdAt: 1,
              pinned: false,
              sensitivity: 'normal',
            },
          ],
        }),
      ),
    ).rejects.toThrow(/invalid backup|raw decrypted secret/i);
  });

  it('rolls back entirely if any collection fails to import', async () => {
    await db.open();
    await db.memories.clear();

    // memories imports first, then a skill_state row missing its compound key
    // ([skillId+key]) makes bulkPut reject -> the whole transaction rolls back.
    await expect(
      importBackup(
        db,
        backup({
          memories: [
            {
              id: 'keep',
              title: 'x',
              text: 'x',
              tags: [],
              source: 'chat',
              createdBy: 'user',
              createdAt: 1,
              pinned: false,
              sensitivity: 'normal',
            },
          ],
          skill_state: [{ bogus: true }],
        }),
      ),
    ).rejects.toThrow();

    // The earlier memories write must NOT have survived the failed import.
    expect(await db.memories.get('keep')).toBeUndefined();
  });

  it('merge preserves non-conflicting existing records', async () => {
    await db.open();
    await db.memories.clear();
    await db.memories.put({
      id: 'existing',
      title: 'old',
      text: 'old',
      tags: [],
      source: 'chat',
      createdBy: 'user',
      createdAt: 1,
      pinned: false,
      sensitivity: 'normal',
    });

    await importBackup(
      db,
      backup({
        memories: [
          {
            id: 'fresh',
            title: 'new',
            text: 'new',
            tags: [],
            source: 'chat',
            createdBy: 'user',
            createdAt: 2,
            pinned: false,
            sensitivity: 'normal',
          },
        ],
      }),
      'merge',
    );

    expect(await db.memories.get('existing')).toBeTruthy();
    expect(await db.memories.get('fresh')).toBeTruthy();
  });

  it('replace clears only the collections present in the backup', async () => {
    await db.open();
    await db.memories.clear();
    await db.conversations.clear();
    await db.memories.put({
      id: 'old',
      title: 'old',
      text: 'old',
      tags: [],
      source: 'chat',
      createdBy: 'user',
      createdAt: 1,
      pinned: false,
      sensitivity: 'normal',
    });
    await db.conversations.put({
      id: 'c-keep',
      title: 'keep me',
      createdAt: 1,
      updatedAt: 1,
    });

    await importBackup(
      db,
      backup({
        memories: [
          {
            id: 'new',
            title: 'new',
            text: 'new',
            tags: [],
            source: 'chat',
            createdBy: 'user',
            createdAt: 2,
            pinned: false,
            sensitivity: 'normal',
          },
        ],
      }),
      'replace',
    );

    // memories was in the backup -> cleared then replaced.
    expect(await db.memories.get('old')).toBeUndefined();
    expect(await db.memories.get('new')).toBeTruthy();
    // conversations was NOT in the backup -> left untouched.
    expect(await db.conversations.get('c-keep')).toBeTruthy();
  });
});

describe('summarizeConflicts', () => {
  function memory(id: string) {
    return {
      id,
      title: id,
      text: id,
      tags: [],
      source: 'chat',
      createdBy: 'user',
      createdAt: 1,
      pinned: false,
      sensitivity: 'normal' as const,
    };
  }

  function backup(collections: Record<string, unknown[]>): ClawBackup {
    return {
      manifest: {
        format: 'clawbackup',
        schemaVersion: 1,
        appVersion: 'test',
        createdAt: 0,
        includesSecrets: false,
      },
      collections,
    };
  }

  it('counts only rows whose key already exists, by collection', async () => {
    await db.open();
    await db.memories.clear();
    await db.skill_state.clear();
    await db.memories.bulkPut([memory('a'), memory('b')]);
    await db.skill_state.put({
      skillId: 's1',
      key: 'k1',
      value: { x: 1 },
    });

    const conflicts = await summarizeConflicts(
      db,
      backup({
        // 'a' exists (conflict), 'c' is new (no conflict) -> 1
        memories: [memory('a'), memory('c')],
        // composite key [skillId,key]: s1/k1 exists, s1/k2 new -> 1
        skill_state: [
          { skillId: 's1', key: 'k1', value: { x: 2 } },
          { skillId: 's1', key: 'k2', value: { x: 3 } },
        ],
      }),
    );

    expect(conflicts.memories).toBe(1);
    expect(conflicts.skill_state).toBe(1);
  });

  it('omits collections with no conflicts', async () => {
    await db.open();
    await db.memories.clear();

    const conflicts = await summarizeConflicts(
      db,
      backup({ memories: [memory('brand-new')] }),
    );

    expect(conflicts.memories).toBeUndefined();
    expect(Object.keys(conflicts)).toHaveLength(0);
  });
});

describe('summarizeModelReferences', () => {
  it('sums model_catalog + model_cache_index counts', () => {
    expect(
      summarizeModelReferences({ model_catalog: 2, model_cache_index: 3 }),
    ).toBe(5);
  });

  it('ignores non-model collections and missing counts', () => {
    expect(summarizeModelReferences({ memories: 9, messages: 4 })).toBe(0);
    expect(summarizeModelReferences({})).toBe(0);
  });
});

describe('encrypted backup (encryptBackup/decryptBackup/isEncryptedBackup)', () => {
  const serialized = '{"manifest":{"format":"clawbackup"}}\n';

  it('round-trips a serialized backup through a passphrase', async () => {
    const file = await encryptBackup(serialized, 'correct horse battery');
    // The plaintext is gone from the on-disk file.
    expect(file).not.toContain('clawbackup"');
    expect(isEncryptedBackup(file)).toBe(true);
    const back = await decryptBackup(file, 'correct horse battery');
    expect(back).toBe(serialized);
  });

  it('fails to decrypt with the wrong passphrase', async () => {
    const file = await encryptBackup(serialized, 'right-pass');
    await expect(decryptBackup(file, 'wrong-pass')).rejects.toThrow();
  });

  it('uses a fresh salt + iv per export (no deterministic output)', async () => {
    const a = JSON.parse(await encryptBackup(serialized, 'p'));
    const b = JSON.parse(await encryptBackup(serialized, 'p'));
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('round-trips a REAL exported backup: encrypt -> decrypt -> parse -> validate', async () => {
    await db.open();
    await db.memories.clear();
    await db.memories.bulkPut([
      {
        id: 'rt',
        title: 't',
        text: 'x',
        tags: [],
        source: 'chat',
        createdBy: 'user',
        createdAt: 1,
        pinned: false,
        sensitivity: 'normal',
      },
    ]);
    const file = await encryptBackup(
      serializeBackup(await exportBackup(db)),
      'pp-12345678',
    );
    const decrypted = await decryptBackup(file, 'pp-12345678');
    const result = validateBackup(parseBackup(decrypted));
    expect(result.valid).toBe(true);
    expect(result.summary?.memories).toBe(1);
  });

  it('isEncryptedBackup is false for a plaintext backup', () => {
    expect(isEncryptedBackup(serialized)).toBe(false);
    expect(isEncryptedBackup('not json at all')).toBe(false);
  });

  it('decryptBackup rejects a non-encrypted file', async () => {
    await expect(decryptBackup(serialized, 'p')).rejects.toThrow();
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

  it('writes an encrypted file when a passphrase is given (decryptable back to a backup)', async () => {
    await db.open();
    await db.backup_history.clear();
    const store = configureStore({ reducer: { audit: auditReducer } });
    let written = '';
    let writtenName = '';

    const result = await runBackupExport({
      db,
      dispatch: store.dispatch as unknown as AppDispatch,
      passphrase: 'export-passphrase',
      download: (filename, json) => {
        writtenName = filename;
        written = json;
      },
      now: () => 100,
    });

    expect(result.ok).toBe(true);
    expect(writtenName).toBe('browserclaw-backup.encrypted.clawbackup');
    // The downloaded file is ciphertext and decrypts back to a valid backup.
    expect(isEncryptedBackup(written)).toBe(true);
    const serialized = await decryptBackup(written, 'export-passphrase');
    expect(parseBackup(serialized).manifest.format).toBe('clawbackup');
    // Audited as encrypted, not plaintext.
    const exported = store
      .getState()
      .audit.recent.find((e) => e.type === 'backup.exported');
    expect(exported?.summary).toMatch(/passphrase-encrypted/);
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

describe('per-collection row validators (A2.6)', () => {
  const bad: Array<[string, Record<string, unknown>, RegExp]> = [
    [
      'messages',
      {
        id: 'x',
        conversationId: 'c',
        role: 'wizard',
        content: 'hi',
        createdAt: 1,
      },
      /invalid message role/i,
    ],
    [
      'audit_events',
      {
        id: 'a',
        type: 't',
        summary: 's',
        risk: 'spicy',
        status: 'success',
        source: 'runtime',
        at: 1,
      },
      /invalid risk/i,
    ],
    [
      'audit_events',
      {
        id: 'a',
        type: 't',
        summary: 's',
        risk: 'low',
        status: 'maybe',
        source: 'runtime',
        at: 1,
      },
      /invalid status/i,
    ],
    [
      'provider_profiles',
      { id: 'p', kind: 'skynet', label: 'X', apiKeyMode: 'none' },
      /invalid provider kind/i,
    ],
    [
      'provider_profiles',
      { id: 'p', kind: 'openai', label: 'X', apiKeyMode: 'plaintext' },
      /invalid apiKeyMode/i,
    ],
    [
      'memories',
      {
        id: 'm',
        title: 't',
        text: 'x',
        tags: [],
        source: 'chat',
        createdBy: 'user',
        createdAt: 1,
        sensitivity: 'topsecret',
      },
      /invalid sensitivity/i,
    ],
    [
      'skills',
      { id: 's', name: 'S', version: '1', enabled: 'yes', source: 'skill_md' },
      /non-boolean enabled/i,
    ],
    [
      'skill_permissions',
      { skillId: 's', value: { tools: 'all' } },
      /malformed permissions/i,
    ],
  ];

  it.each(bad)('rejects a bad %s row', (name, row, re) => {
    const result = validateBackup(backupOf({ [name]: [row] }));
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(re);
  });

  it('accepts well-formed rows across collections', () => {
    const result = validateBackup(
      backupOf({
        messages: [
          {
            id: 'm1',
            conversationId: 'c1',
            role: 'assistant',
            content: 'hi',
            createdAt: 1,
          },
        ],
        audit_events: [
          {
            id: 'a1',
            type: 't',
            summary: 's',
            risk: 'info',
            status: 'success',
            source: 'runtime',
            at: 1,
          },
        ],
        skill_permissions: [
          {
            skillId: 's',
            value: { tools: ['Remember'], read: [], write: [], network: false },
          },
        ],
      }),
    );
    expect(result.valid).toBe(true);
  });
});

describe('containsLikelyRawSecret — credential-shape detection', () => {
  // Each entry is a live-looking credential that must be detected by VALUE
  // shape alone (placed under an innocuous field name), so a foreign/tampered
  // backup can't smuggle a plaintext token through a non-obvious field.
  const credentials: Record<string, string> = {
    anthropic: 'sk-ant-' + 'A'.repeat(20),
    openai: 'sk-' + 'A'.repeat(24),
    slack: 'xoxb-' + 'A'.repeat(12),
    aws: 'AKIA' + 'ABCDEFGHIJKLMNOP',
    github: 'ghp_' + 'a'.repeat(24),
    google: 'ya29.' + 'A'.repeat(24),
    jwt: 'eyJ' + 'A'.repeat(8) + '.' + 'B'.repeat(8) + '.' + 'C'.repeat(8),
  };

  for (const [name, value] of Object.entries(credentials)) {
    it(`detects a ${name} credential by value shape`, () => {
      expect(containsLikelyRawSecret({ note: value })).toBe(true);
    });
  }

  it('detects a reserved field name after normalization (e.g. "API-Key")', () => {
    expect(containsLikelyRawSecret({ 'API-Key': 'hunter2' })).toBe(true);
    expect(containsLikelyRawSecret({ Access_Token: 'whatever' })).toBe(true);
  });

  it('does not flag secret-free metadata', () => {
    expect(
      containsLikelyRawSecret({
        id: 'openai',
        label: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o',
        apiKeyMode: 'encrypted',
        encryptedSecretId: 'provider:openai',
      }),
    ).toBe(false);
  });

  it('does not flag a reserved field name holding an empty string', () => {
    expect(containsLikelyRawSecret({ apiKey: '   ' })).toBe(false);
  });

  it('enforces the recursion depth limit', () => {
    const nest = (levels: number, leaf: unknown): unknown => {
      let value: unknown = leaf;
      for (let i = 0; i < levels; i += 1) value = { a: value };
      return value;
    };
    const key = 'sk-' + 'A'.repeat(24);
    // Reachable within the depth budget -> detected.
    expect(containsLikelyRawSecret(nest(7, key))).toBe(true);
    // Buried past the budget -> not descended (a bounded scan, documented).
    expect(containsLikelyRawSecret(nest(8, key))).toBe(false);
  });
});

describe('workspace backup/restore (B8)', () => {
  it('excludes workspace files unless includeWorkspace is set', async () => {
    await db.open();
    await db.workspace_files.clear();
    await db.workspace_files.put({
      id: 'w1',
      path: '/workspace/a.txt',
      kind: 'file',
      sizeBytes: 2,
      createdAt: 1,
      updatedAt: 1,
      createdBy: 'agent',
    });
    const plain = await exportBackup(db);
    expect('workspace_files' in plain.collections).toBe(false);

    const content = new MemoryContentStore();
    await content.write('w1', new TextEncoder().encode('hi'));
    const withWs = await exportBackup(db, {
      includeWorkspace: true,
      contentStore: content,
    });
    expect(withWs.manifest.includesWorkspace).toBe(true);
    expect(withWs.collections.workspace_files).toHaveLength(1);
    expect(withWs.collections.workspace_content).toHaveLength(1);
  });

  it('round-trips workspace metadata + content through the content store', async () => {
    await db.open();
    await db.workspace_files.clear();
    await db.workspace_files.put({
      id: 'w1',
      path: '/workspace/a.txt',
      kind: 'file',
      sizeBytes: 5,
      createdAt: 1,
      updatedAt: 1,
      createdBy: 'agent',
    });
    const src = new MemoryContentStore();
    await src.write('w1', new TextEncoder().encode('hello'));
    const backup = await exportBackup(db, {
      includeWorkspace: true,
      contentStore: src,
    });

    await db.workspace_files.clear();
    const dest = new MemoryContentStore();
    await importBackup(db, backup, 'merge', {}, dest);

    expect((await db.workspace_files.get('w1'))?.path).toBe('/workspace/a.txt');
    expect(new TextDecoder().decode(await dest.read('w1'))).toBe('hello');
  });

  it('refuses to restore content without a content store', async () => {
    const backup: ClawBackup = {
      manifest: {
        format: 'clawbackup',
        schemaVersion: 1,
        appVersion: 't',
        createdAt: 0,
        includesSecrets: false,
        includesWorkspace: true,
      },
      collections: { workspace_content: [{ id: 'w1', data: 'aGk=' }] },
    };
    await db.open();
    await expect(importBackup(db, backup)).rejects.toThrow(/content store/i);
  });

  it('rejects a workspace_files row with an unsafe path', async () => {
    const backup: ClawBackup = {
      manifest: {
        format: 'clawbackup',
        schemaVersion: 1,
        appVersion: 't',
        createdAt: 0,
        includesSecrets: false,
      },
      collections: {
        workspace_files: [
          {
            id: 'bad',
            path: '/workspace/../escape',
            kind: 'file',
            sizeBytes: 0,
            createdAt: 1,
            updatedAt: 1,
            createdBy: 'agent',
          },
        ],
      },
    };
    const result = validateBackup(backup);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/invalid workspace path/i);
  });

  it('estimates workspace content size for a size warning', () => {
    const backup: ClawBackup = {
      manifest: {
        format: 'clawbackup',
        schemaVersion: 1,
        appVersion: 't',
        createdAt: 0,
        includesSecrets: false,
      },
      collections: {
        workspace_content: [{ id: 'w1', data: 'AAAA'.repeat(100) }],
      },
    };
    expect(workspaceBackupSizeBytes(backup)).toBeGreaterThan(0);
    expect(workspaceBackupSizeBytes({ ...backup, collections: {} })).toBe(0);
  });
});
