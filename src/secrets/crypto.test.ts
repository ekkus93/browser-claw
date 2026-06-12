import { describe, expect, it } from 'vitest';
import {
  deriveKey,
  generateSalt,
  encryptString,
  decryptString,
  randomBytes,
} from './crypto.ts';

describe('crypto', () => {
  it('round-trips a string through AES-GCM with a derived key', async () => {
    const salt = generateSalt();
    const key = await deriveKey('correct horse battery staple', salt);
    const encrypted = await encryptString(key, 'sk-secret-123');

    // ciphertext must not leak the plaintext
    expect(encrypted.ciphertext).not.toContain('sk-secret-123');

    const decrypted = await decryptString(key, encrypted);
    expect(decrypted).toBe('sk-secret-123');
  });

  it('cannot decrypt with a key derived from the wrong passphrase', async () => {
    const salt = generateSalt();
    const rightKey = await deriveKey('right-passphrase', salt);
    const encrypted = await encryptString(rightKey, 'value');

    const wrongKey = await deriveKey('wrong-passphrase', salt);
    await expect(decryptString(wrongKey, encrypted)).rejects.toThrow();
  });

  it('uses a fresh IV per encryption (no deterministic output)', async () => {
    const key = await deriveKey('p', generateSalt());
    const a = await encryptString(key, 'same plaintext');
    const b = await encryptString(key, 'same plaintext');
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('generates distinct random salts and bytes', () => {
    expect(generateSalt()).not.toBe(generateSalt());
    expect(randomBytes(16)).toHaveLength(16);
  });
});
