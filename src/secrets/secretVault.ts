import {
  deriveKey,
  generateSalt,
  encryptString,
  decryptString,
  type Ciphertext,
} from './crypto.ts';

/**
 * In-memory SecretVault — the ONLY place decrypted secrets live.
 *
 * Plaintext secrets are held in a private Map and never serialized: not to
 * Redux, localStorage, audit payloads, logs, or screenshots. Persistence
 * (ciphertext only) and side-channels (Redux metadata, audit) are reached
 * through injected ports so nothing in this class can leak plaintext and so
 * the vault is unit-testable without a browser/DB.
 */

export type AuditRiskLevel = 'info' | 'low' | 'medium' | 'high';

export interface VaultAuditEvent {
  type: string;
  summary: string;
  risk: AuditRiskLevel;
}

export type SecretStorageMode = 'session' | 'encrypted';

export interface SecretRecord {
  id: string;
  label: string;
  storageMode: SecretStorageMode;
}

/** Persistence port. Only ciphertext + vault config ever cross this boundary. */
export interface VaultStore {
  getSalt(): Promise<string | null>;
  setSalt(salt: string): Promise<void>;
  getVerifier(): Promise<Ciphertext | null>;
  setVerifier(verifier: Ciphertext): Promise<void>;
  getCiphertext(id: string): Promise<Ciphertext | null>;
  putCiphertext(id: string, label: string, value: Ciphertext): Promise<void>;
  deleteCiphertext(id: string): Promise<void>;
  listEncryptedMeta(): Promise<SecretRecord[]>;
}

/** Observer port. Receives metadata + audit only — NEVER plaintext. */
export interface VaultObserver {
  lockStateChanged(locked: boolean): void;
  secretUpserted(record: SecretRecord): void;
  secretRemoved(id: string): void;
  audit(event: VaultAuditEvent): void;
}

export interface VaultOptions {
  store: VaultStore;
  observer?: VaultObserver;
  /** Auto-lock after this idle period. 0 disables. Default 15 min. */
  lockTimeoutMs?: number;
}

const VERIFIER_PLAINTEXT = 'browserclaw-vault-ok';
const DEFAULT_LOCK_TIMEOUT_MS = 15 * 60 * 1000;

export class SecretVault {
  readonly #store: VaultStore;
  readonly #observer: VaultObserver | undefined;
  readonly #lockTimeoutMs: number;

  #key: CryptoKey | null = null;
  #unlocked = false;
  readonly #plaintext = new Map<string, string>();
  readonly #records = new Map<string, SecretRecord>();
  #lockTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: VaultOptions) {
    this.#store = options.store;
    this.#observer = options.observer;
    this.#lockTimeoutMs = options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  }

  isUnlocked(): boolean {
    return this.#unlocked;
  }

  /** Whether the vault can persist encrypted secrets (passphrase set). */
  canStoreEncrypted(): boolean {
    return this.#key !== null;
  }

  /**
   * Whether a passphrase-protected vault already exists in storage (a salt has
   * been persisted). Lets the UI choose between a first-run setup flow and an
   * unlock flow. Reads only the presence of the salt — never any plaintext.
   */
  async isConfigured(): Promise<boolean> {
    return (await this.#store.getSalt()) !== null;
  }

  /** Create a passphrase-protected vault and unlock it. */
  async setup(passphrase: string): Promise<void> {
    const salt = generateSalt();
    const key = await deriveKey(passphrase, salt);
    const verifier = await encryptString(key, VERIFIER_PLAINTEXT);
    await this.#store.setSalt(salt);
    await this.#store.setVerifier(verifier);
    this.#key = key;
    this.#open('Vault created and unlocked');
  }

  /** Unlock an existing passphrase-protected vault. Returns false if wrong. */
  async unlock(passphrase: string): Promise<boolean> {
    const salt = await this.#store.getSalt();
    const verifier = await this.#store.getVerifier();
    if (salt === null || verifier === null) {
      throw new Error('Vault has not been set up');
    }
    const key = await deriveKey(passphrase, salt);
    try {
      const check = await decryptString(key, verifier);
      if (check !== VERIFIER_PLAINTEXT) return false;
    } catch {
      this.#observer?.audit({
        type: 'secret_unlock_failed',
        summary: 'Vault unlock failed (wrong passphrase)',
        risk: 'medium',
      });
      return false;
    }
    this.#key = key;
    for (const record of await this.#store.listEncryptedMeta()) {
      this.#records.set(record.id, record);
      this.#observer?.secretUpserted(record);
    }
    this.#open('Vault unlocked');
    return true;
  }

  /** Open a session-only vault (no passphrase, nothing persisted). */
  openSession(): void {
    this.#key = null;
    this.#open('Session vault opened');
  }

  lock(): void {
    this.#key = null;
    this.#unlocked = false;
    this.#plaintext.clear();
    if (this.#lockTimer !== null) {
      clearTimeout(this.#lockTimer);
      this.#lockTimer = null;
    }
    this.#observer?.lockStateChanged(true);
    this.#observer?.audit({
      type: 'secret_locked',
      summary: 'Vault locked',
      risk: 'info',
    });
  }

  /** Hold a secret for this session only — never persisted. */
  setSessionSecret(id: string, label: string, value: string): void {
    this.#assertUnlocked();
    this.#plaintext.set(id, value);
    const record: SecretRecord = { id, label, storageMode: 'session' };
    this.#records.set(id, record);
    this.#observer?.secretUpserted(record);
    this.#touch();
  }

  /** Encrypt and persist a secret as ciphertext; keep plaintext in memory. */
  async putEncryptedSecret(
    id: string,
    label: string,
    value: string,
  ): Promise<void> {
    const key = this.#requireKey();
    const encrypted = await encryptString(key, value);
    await this.#store.putCiphertext(id, label, encrypted);
    this.#plaintext.set(id, value);
    const record: SecretRecord = { id, label, storageMode: 'encrypted' };
    this.#records.set(id, record);
    this.#observer?.secretUpserted(record);
    this.#touch();
  }

  /** Return decrypted plaintext (in-memory or lazily decrypted from store). */
  async getSecret(id: string): Promise<string | undefined> {
    this.#assertUnlocked();
    this.#touch();
    const cached = this.#plaintext.get(id);
    if (cached !== undefined) return cached;
    const stored = await this.#store.getCiphertext(id);
    if (stored === null) return undefined;
    const value = await decryptString(this.#requireKey(), stored);
    this.#plaintext.set(id, value);
    return value;
  }

  async removeSecret(id: string): Promise<void> {
    this.#assertUnlocked();
    this.#plaintext.delete(id);
    this.#records.delete(id);
    await this.#store.deleteCiphertext(id);
    this.#observer?.secretRemoved(id);
    this.#touch();
  }

  /** Secret metadata (no plaintext). */
  listSecrets(): SecretRecord[] {
    return [...this.#records.values()];
  }

  #open(summary: string): void {
    this.#unlocked = true;
    this.#armLockTimer();
    this.#observer?.lockStateChanged(false);
    this.#observer?.audit({ type: 'secret_unlocked', summary, risk: 'info' });
  }

  #requireKey(): CryptoKey {
    if (this.#key === null) {
      throw new Error(
        'Encrypted storage requires a passphrase-protected vault',
      );
    }
    return this.#key;
  }

  #assertUnlocked(): void {
    if (!this.#unlocked) {
      throw new Error('Vault is locked');
    }
  }

  #touch(): void {
    this.#armLockTimer();
  }

  #armLockTimer(): void {
    if (this.#lockTimer !== null) clearTimeout(this.#lockTimer);
    if (this.#lockTimeoutMs > 0) {
      this.#lockTimer = setTimeout(() => this.lock(), this.#lockTimeoutMs);
    }
  }
}
