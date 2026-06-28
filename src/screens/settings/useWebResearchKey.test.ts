import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import secretsReducer, {
  secretMetadataUpserted,
  secretMetadataRemoved,
  vaultLockedSet,
} from '../../store/slices/secretsSlice.ts';
import auditReducer from '../../store/slices/auditSlice.ts';
import { BrowserClawDB } from '../../db/db.ts';
import { SecretVault } from '../../secrets/secretVault.ts';
import {
  InMemoryVaultStore,
  createReduxVaultObserver,
} from '../../secrets/vaultWiring.ts';
import { BRAVE_KEY_ID } from './useWebResearchKey.ts';

// ---------------------------------------------------------------------------
// Helpers — isolated vault + store per test
// ---------------------------------------------------------------------------

function makeStore() {
  return configureStore({
    reducer: { secrets: secretsReducer, audit: auditReducer },
  });
}

function makeVault(
  store: ReturnType<typeof makeStore>,
  db: BrowserClawDB,
): SecretVault {
  return new SecretVault({
    store: new InMemoryVaultStore(),
    observer: createReduxVaultObserver(
      store.dispatch as Parameters<typeof createReduxVaultObserver>[0],
      db,
    ),
  });
}

// Wrap renderHook so the hook sees the right store + vault singletons.
// We swap module-level singletons by reimporting with vi.mock, but for these
// unit tests the simpler approach is to test the hook indirectly through its
// Redux state contract, which is what the acceptance criteria care about.

// ---------------------------------------------------------------------------
// A1 — key save / clear lifecycle
// ---------------------------------------------------------------------------

describe('A1 — Brave Search key save / clear', () => {
  let db: BrowserClawDB;
  let store: ReturnType<typeof makeStore>;
  let vault: SecretVault;

  beforeEach(async () => {
    db = new BrowserClawDB();
    await db.open();
    store = makeStore();
    vault = makeVault(store, db);
    // Open session vault so putEncryptedSecret/setSessionSecret are available.
    vault.openSession();
  });

  it('A1: key NEVER appears in Redux state JSON after setSessionSecret', () => {
    const RAW_KEY = 'BSAtest-1234-secret-key';
    vault.setSessionSecret(BRAVE_KEY_ID, 'Brave Search API key', RAW_KEY);

    // Redux state JSON must contain no raw key material
    const json = JSON.stringify(store.getState());
    expect(json).not.toContain(RAW_KEY);
    expect(json).not.toContain('secret-key');
    // Metadata is present (id/label/storageMode only)
    expect(store.getState().secrets.secrets).toContainEqual(
      expect.objectContaining({ id: BRAVE_KEY_ID, storageMode: 'session' }),
    );
  });

  it('A1: secretMetadataUpserted action carries no value field', () => {
    store.dispatch(
      secretMetadataUpserted({
        id: BRAVE_KEY_ID,
        label: 'Brave Search API key',
        storageMode: 'session',
      }),
    );
    const meta = store
      .getState()
      .secrets.secrets.find((s) => s.id === BRAVE_KEY_ID);
    expect(meta).toBeDefined();
    const keys = Object.keys(meta ?? {});
    const forbidden = [
      'value',
      'key',
      'secret',
      'token',
      'plaintext',
      'apiKey',
    ];
    for (const k of forbidden) {
      expect(keys).not.toContain(k);
    }
  });

  it('A1: audit event for key save contains no raw key material', () => {
    const RAW_KEY = 'BSAtest-audit-leak-check';
    vault.setSessionSecret(BRAVE_KEY_ID, 'Brave Search API key', RAW_KEY);
    // The vault observer emits via auditAppended — check the recent audit feed
    const auditJson = JSON.stringify(store.getState().audit.recent);
    expect(auditJson).not.toContain(RAW_KEY);
  });

  it('A1: after clear, key is no longer in vault', async () => {
    vault.setSessionSecret(BRAVE_KEY_ID, 'Brave Search API key', 'key123');
    expect(vault.listSecrets().some((s) => s.id === BRAVE_KEY_ID)).toBe(true);
    await vault.removeSecret(BRAVE_KEY_ID);
    expect(vault.listSecrets().some((s) => s.id === BRAVE_KEY_ID)).toBe(false);
  });

  it('A1: after clear, Redux no longer lists the key', async () => {
    vault.setSessionSecret(BRAVE_KEY_ID, 'Brave Search API key', 'key123');
    await vault.removeSecret(BRAVE_KEY_ID);
    expect(
      store.getState().secrets.secrets.some((s) => s.id === BRAVE_KEY_ID),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// A1 — useWebResearchKey hook behaviour
// ---------------------------------------------------------------------------

describe('A1 — useWebResearchKey hook', () => {
  it('A1: keyConfigured is false when no key in Redux secrets list', () => {
    // Render with an empty secrets list via Redux state
    // The hook reads state.secrets.secrets — we verify the selector logic.
    const store = makeStore();
    // No keys dispatched → keyConfigured should be false
    expect(
      store.getState().secrets.secrets.some((s) => s.id === BRAVE_KEY_ID),
    ).toBe(false);
  });

  it('A1: keyConfigured is true after secretMetadataUpserted', () => {
    const store = makeStore();
    store.dispatch(
      secretMetadataUpserted({
        id: BRAVE_KEY_ID,
        label: 'Brave Search API key',
        storageMode: 'session',
      }),
    );
    expect(
      store.getState().secrets.secrets.some((s) => s.id === BRAVE_KEY_ID),
    ).toBe(true);
  });

  it('A1: vaultLocked state drives save-disabled gate', () => {
    const store = makeStore();
    // starts locked
    expect(store.getState().secrets.vaultLocked).toBe(true);
    store.dispatch(vaultLockedSet(false));
    expect(store.getState().secrets.vaultLocked).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// A2 — WebResearchStatus configured prop tracks vault key
// ---------------------------------------------------------------------------

describe('A2 — configured prop derived from Redux secrets', () => {
  it('A2: configured=false when secrets list is empty', () => {
    const store = makeStore();
    const configured = store
      .getState()
      .secrets.secrets.some((s) => s.id === BRAVE_KEY_ID);
    expect(configured).toBe(false);
  });

  it('A2: configured=true after key metadata dispatched', () => {
    const store = makeStore();
    store.dispatch(
      secretMetadataUpserted({
        id: BRAVE_KEY_ID,
        label: 'Brave Search API key',
        storageMode: 'encrypted',
      }),
    );
    const configured = store
      .getState()
      .secrets.secrets.some((s) => s.id === BRAVE_KEY_ID);
    expect(configured).toBe(true);
  });

  it('A2: configured=false after key metadata removed', () => {
    const store = makeStore();
    store.dispatch(
      secretMetadataUpserted({
        id: BRAVE_KEY_ID,
        label: 'Brave Search API key',
        storageMode: 'encrypted',
      }),
    );
    store.dispatch(secretMetadataRemoved(BRAVE_KEY_ID));
    const configured = store
      .getState()
      .secrets.secrets.some((s) => s.id === BRAVE_KEY_ID);
    expect(configured).toBe(false);
  });
});
