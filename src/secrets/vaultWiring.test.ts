import 'fake-indexeddb/auto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import secretsReducer from '../store/slices/secretsSlice.ts';
import auditReducer from '../store/slices/auditSlice.ts';
import { SecretVault } from './secretVault.ts';
import {
  InMemoryVaultStore,
  createReduxVaultObserver,
  createDexieVaultStore,
} from './vaultWiring.ts';
import { BrowserClawDB } from '../db/db.ts';

function makeStore() {
  return configureStore({
    reducer: { secrets: secretsReducer, audit: auditReducer },
  });
}

describe('createReduxVaultObserver', () => {
  it('NEVER lets decrypted secrets reach Redux state', async () => {
    const store = makeStore();
    const vault = new SecretVault({
      store: new InMemoryVaultStore(),
      observer: createReduxVaultObserver(store.dispatch),
      lockTimeoutMs: 0,
    });

    const ENCRYPTED_PLAINTEXT = 'sk-super-secret-DO-NOT-LEAK';
    const SESSION_PLAINTEXT = 'sk-session-DO-NOT-LEAK';
    await vault.setup('passphrase');
    await vault.putEncryptedSecret(
      'anthropic',
      'Anthropic key',
      ENCRYPTED_PLAINTEXT,
    );
    vault.setSessionSecret('openai', 'OpenAI key', SESSION_PLAINTEXT);

    const serialized = JSON.stringify(store.getState());
    expect(serialized).not.toContain(ENCRYPTED_PLAINTEXT);
    expect(serialized).not.toContain(SESSION_PLAINTEXT);

    // metadata IS present (id/label/mode), just never the value
    const ids = store.getState().secrets.secrets.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(['anthropic', 'openai']));
    expect(store.getState().secrets.vaultLocked).toBe(false);
    expect(store.getState().audit.recent.length).toBeGreaterThan(0);
  });

  it('reflects metadata removal and lock state', async () => {
    const store = makeStore();
    const vault = new SecretVault({
      store: new InMemoryVaultStore(),
      observer: createReduxVaultObserver(store.dispatch),
      lockTimeoutMs: 0,
    });
    await vault.setup('p');
    await vault.putEncryptedSecret('id1', 'L', 'v');
    await vault.removeSecret('id1');
    expect(store.getState().secrets.secrets).toHaveLength(0);
    vault.lock();
    expect(store.getState().secrets.vaultLocked).toBe(true);
  });

  it('persists vault audit events durably when given a db (real secret_deleted)', async () => {
    const db = new BrowserClawDB();
    await db.open();
    await db.audit_events.clear();
    const store = makeStore();
    const vault = new SecretVault({
      store: new InMemoryVaultStore(),
      observer: createReduxVaultObserver(store.dispatch, db),
      lockTimeoutMs: 0,
    });
    await vault.setup('p');
    await vault.putEncryptedSecret('id1', 'My Key', 'v');
    await vault.removeSecret('id1');

    // The delete lands in the DURABLE audit log (recordAudit), not just the
    // live Redux tail — the audit is real, not a fixture.
    await vi.waitFor(async () => {
      const events = await db.audit_events
        .where('type')
        .equals('secret_deleted')
        .toArray();
      expect(events[0]?.summary).toBe('Secret deleted: My Key');
      expect(events[0]?.status).toBe('success');
    });
    db.close();
  });
});

describe('createDexieVaultStore', () => {
  const db = new BrowserClawDB();

  afterAll(() => {
    db.close();
  });

  it('persists ciphertext only and round-trips across vault instances', async () => {
    await db.open();
    const store = createDexieVaultStore(db);

    const first = new SecretVault({ store, lockTimeoutMs: 0 });
    await first.setup('passphrase');
    await first.putEncryptedSecret(
      'anthropic',
      'Anthropic',
      'sk-PLAINTEXT-XYZ',
    );

    const row = await db.encrypted_secrets.get('anthropic');
    expect(row?.ciphertext).toBeTruthy();
    expect(JSON.stringify(row)).not.toContain('sk-PLAINTEXT-XYZ');

    const second = new SecretVault({ store, lockTimeoutMs: 0 });
    expect(await second.unlock('passphrase')).toBe(true);
    expect(await second.getSecret('anthropic')).toBe('sk-PLAINTEXT-XYZ');
  });
});
