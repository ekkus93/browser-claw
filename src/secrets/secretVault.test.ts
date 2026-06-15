import { describe, expect, it, vi } from 'vitest';
import {
  SecretVault,
  type VaultObserver,
  type VaultAuditEvent,
  type SecretRecord,
} from './secretVault.ts';
import { InMemoryVaultStore } from './vaultWiring.ts';

function capturing() {
  const audits: VaultAuditEvent[] = [];
  const upserts: SecretRecord[] = [];
  const removes: string[] = [];
  const lockStates: boolean[] = [];
  const observer: VaultObserver = {
    lockStateChanged: (locked) => lockStates.push(locked),
    secretUpserted: (record) => upserts.push(record),
    secretRemoved: (id) => removes.push(id),
    audit: (event) => audits.push(event),
  };
  return { observer, audits, upserts, removes, lockStates };
}

describe('SecretVault', () => {
  it('sets up, stores an encrypted secret, and reads it back', async () => {
    const vault = new SecretVault({
      store: new InMemoryVaultStore(),
      lockTimeoutMs: 0,
    });
    await vault.setup('hunter2');
    expect(vault.isUnlocked()).toBe(true);

    await vault.putEncryptedSecret('anthropic', 'Anthropic', 'sk-ant-xyz');
    expect(await vault.getSecret('anthropic')).toBe('sk-ant-xyz');
    expect(vault.listSecrets()).toEqual([
      { id: 'anthropic', label: 'Anthropic', storageMode: 'encrypted' },
    ]);
  });

  it('reports isConfigured only after a passphrase vault is set up', async () => {
    const store = new InMemoryVaultStore();
    const vault = new SecretVault({ store, lockTimeoutMs: 0 });
    expect(await vault.isConfigured()).toBe(false);
    // A session-only vault persists nothing, so it is still not "configured".
    vault.openSession();
    expect(await vault.isConfigured()).toBe(false);
    await vault.setup('hunter2');
    expect(await vault.isConfigured()).toBe(true);
    // Locking does not erase the persisted salt — it stays configured.
    vault.lock();
    expect(await vault.isConfigured()).toBe(true);
  });

  it('persists ciphertext so a fresh vault instance can decrypt', async () => {
    const store = new InMemoryVaultStore();
    const first = new SecretVault({ store, lockTimeoutMs: 0 });
    await first.setup('pass');
    await first.putEncryptedSecret('openai', 'OpenAI', 'sk-openai');
    first.lock();

    const second = new SecretVault({ store, lockTimeoutMs: 0 });
    expect(await second.unlock('pass')).toBe(true);
    expect(await second.getSecret('openai')).toBe('sk-openai');
  });

  it('rejects an incorrect passphrase', async () => {
    const store = new InMemoryVaultStore();
    await new SecretVault({ store, lockTimeoutMs: 0 }).setup('right');

    const vault = new SecretVault({ store, lockTimeoutMs: 0 });
    expect(await vault.unlock('wrong')).toBe(false);
    expect(vault.isUnlocked()).toBe(false);
  });

  it('throws when accessed while locked', async () => {
    const vault = new SecretVault({
      store: new InMemoryVaultStore(),
      lockTimeoutMs: 0,
    });
    await expect(vault.getSecret('x')).rejects.toThrow(/locked/i);
  });

  it('supports session-only secrets without persisting them', async () => {
    const store = new InMemoryVaultStore();
    const vault = new SecretVault({ store, lockTimeoutMs: 0 });
    vault.openSession();
    vault.setSessionSecret('tmp', 'Temp', 'sk-session');

    expect(await vault.getSecret('tmp')).toBe('sk-session');
    expect(await store.getCiphertext('tmp')).toBeNull();
    await expect(vault.putEncryptedSecret('e', 'E', 'v')).rejects.toThrow(
      /passphrase/i,
    );
  });

  it('clears plaintext on lock', async () => {
    const vault = new SecretVault({
      store: new InMemoryVaultStore(),
      lockTimeoutMs: 0,
    });
    await vault.setup('p');
    vault.setSessionSecret('s', 'S', 'val');
    vault.lock();
    expect(vault.isUnlocked()).toBe(false);
    await expect(vault.getSecret('s')).rejects.toThrow(/locked/i);
  });

  it('auto-locks after the lock timeout', async () => {
    vi.useFakeTimers();
    try {
      const vault = new SecretVault({
        store: new InMemoryVaultStore(),
        lockTimeoutMs: 1000,
      });
      await vault.setup('p');
      expect(vault.isUnlocked()).toBe(true);
      vi.advanceTimersByTime(1000);
      expect(vault.isUnlocked()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-arms the timer when the lock timeout is shortened while unlocked', async () => {
    vi.useFakeTimers();
    try {
      const vault = new SecretVault({
        store: new InMemoryVaultStore(),
        lockTimeoutMs: 60_000,
      });
      await vault.setup('p');
      // Shortening the timeout mid-session must take effect immediately.
      vault.setLockTimeout(1000);
      vi.advanceTimersByTime(1000);
      expect(vault.isUnlocked()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('honours a lock timeout configured before the vault is unlocked', async () => {
    vi.useFakeTimers();
    try {
      const vault = new SecretVault({
        store: new InMemoryVaultStore(),
        lockTimeoutMs: 0,
      });
      // Set while locked: no live timer to re-arm, applies on next unlock.
      vault.setLockTimeout(500);
      await vault.setup('p');
      vi.advanceTimersByTime(500);
      expect(vault.isUnlocked()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('emits lock/unlock audit events and lock-state changes', async () => {
    const cap = capturing();
    const vault = new SecretVault({
      store: new InMemoryVaultStore(),
      observer: cap.observer,
      lockTimeoutMs: 0,
    });
    await vault.setup('p');
    vault.lock();
    expect(cap.audits.map((a) => a.type)).toEqual([
      'secret_unlocked',
      'secret_locked',
    ]);
    expect(cap.lockStates).toEqual([false, true]);
  });

  it('emits a secret_deleted audit (with the label, never the plaintext) on removeSecret', async () => {
    const cap = capturing();
    const vault = new SecretVault({
      store: new InMemoryVaultStore(),
      observer: cap.observer,
      lockTimeoutMs: 0,
    });
    await vault.setup('p');
    await vault.putEncryptedSecret('anthropic', 'Anthropic', 'sk-ant-secret');

    await vault.removeSecret('anthropic');

    const deleted = cap.audits.find((a) => a.type === 'secret_deleted');
    expect(deleted).toBeDefined();
    expect(deleted?.summary).toBe('Secret deleted: Anthropic');
    // The plaintext is never in the audit payload.
    expect(deleted?.summary).not.toContain('sk-ant-secret');
    // The secret is gone from metadata and the store.
    expect(cap.removes).toContain('anthropic');
    expect(vault.listSecrets()).toHaveLength(0);
  });
});
