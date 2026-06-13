import { describe, expect, it, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import secretsReducer from '../store/slices/secretsSlice.ts';
import auditReducer from '../store/slices/auditSlice.ts';
import { SecretVault } from './secretVault.ts';
import { InMemoryVaultStore, createReduxVaultObserver } from './vaultWiring.ts';
import { resolveApiKey, providerSecretId } from '../providers/providerKey.ts';
import type { ProviderProfileRow } from '../db/types.ts';

const RAW_KEY = 'sk-super-secret-DO-NOT-LEAK-9f8a7b6c';

const openaiProfile: ProviderProfileRow = {
  id: 'openai',
  kind: 'openai',
  label: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o',
  apiKeyMode: 'encrypted',
};

/**
 * Security regression (TODO 11.2): a decrypted API key may live only in the
 * in-memory vault — never in Redux state or audit payloads. This stores a key,
 * exercises the full lifecycle (upsert + retrieve), and asserts the raw bytes
 * never appear in the serialized Redux store or the audit log.
 */
describe('SecretVault — no plaintext leaks to Redux or audit', () => {
  it('keeps the raw key out of Redux state and audit events', async () => {
    const store = configureStore({
      reducer: { secrets: secretsReducer, audit: auditReducer },
    });
    const vault = new SecretVault({
      store: new InMemoryVaultStore(),
      observer: createReduxVaultObserver(store.dispatch),
      lockTimeoutMs: 0,
    });

    await vault.setup('correct horse battery staple');
    await vault.putEncryptedSecret(
      providerSecretId('openai'),
      'OpenAI',
      RAW_KEY,
    );

    // The key resolves back out of the vault (so it's really stored)...
    const resolved = await resolveApiKey(vault, openaiProfile);
    expect(resolved).toEqual({ ok: true, apiKey: RAW_KEY });

    // ...but the raw key is nowhere in the serialized Redux store.
    const serializedState = JSON.stringify(store.getState());
    expect(serializedState).not.toContain(RAW_KEY);

    // Redux holds metadata only — the secret exists, with no value field.
    const meta = store
      .getState()
      .secrets.secrets.find((s) => s.id === providerSecretId('openai'));
    expect(meta?.label).toBe('OpenAI');
    expect(meta).not.toHaveProperty('value');

    // No audit event carries the key text either.
    for (const event of store.getState().audit.recent) {
      expect(JSON.stringify(event)).not.toContain(RAW_KEY);
    }
  });

  it('never writes a decrypted key to web storage', async () => {
    // Storage.prototype.setItem backs both localStorage and sessionStorage, so
    // one spy covers any attempt to persist a secret outside the vault.
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    try {
      const vault = new SecretVault({
        store: new InMemoryVaultStore(),
        lockTimeoutMs: 0,
      });
      await vault.setup('correct horse battery staple');
      await vault.putEncryptedSecret(
        providerSecretId('openai'),
        'OpenAI',
        RAW_KEY,
      );

      // It really stored the key (resolves back out of the vault)...
      expect(await resolveApiKey(vault, openaiProfile)).toEqual({
        ok: true,
        apiKey: RAW_KEY,
      });

      // ...without ever touching web storage, and web storage holds nothing.
      expect(setItem).not.toHaveBeenCalled();
      expect(localStorage.length).toBe(0);
      expect(sessionStorage.length).toBe(0);
    } finally {
      setItem.mockRestore();
    }
  });
});
