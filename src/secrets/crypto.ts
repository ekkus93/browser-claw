/**
 * Web Crypto primitives for secret encryption: a PBKDF2 passphrase-derived
 * AES-GCM key, plus authenticated string encrypt/decrypt. Keys are derived as
 * non-extractable CryptoKeys and never leave this layer. Ciphertext + IV are
 * base64 for storage in Dexie's `encrypted_secrets`.
 */

const PBKDF2_ITERATIONS = 250_000;
const AES_KEY_LENGTH = 256;
const IV_BYTES = 12;
const SALT_BYTES = 16;

function subtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c?.subtle) {
    throw new Error('Web Crypto SubtleCrypto is not available');
  }
  return c.subtle;
}

export function toBase64(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** UTF-8 encode into a guaranteed ArrayBuffer-backed view (Web Crypto needs it). */
function encodeUtf8(value: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new TextEncoder().encode(value));
}

export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

/** Base64 random salt for passphrase derivation; persist alongside the vault. */
export function generateSalt(): string {
  return toBase64(randomBytes(SALT_BYTES));
}

export async function deriveKey(
  passphrase: string,
  saltBase64: string,
): Promise<CryptoKey> {
  const baseKey = await subtle().importKey(
    'raw',
    encodeUtf8(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return subtle().deriveKey(
    {
      name: 'PBKDF2',
      salt: fromBase64(saltBase64),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: AES_KEY_LENGTH },
    false,
    ['encrypt', 'decrypt'],
  );
}

export interface Ciphertext {
  ciphertext: string;
  iv: string;
}

export async function encryptString(
  key: CryptoKey,
  plaintext: string,
): Promise<Ciphertext> {
  const iv = randomBytes(IV_BYTES);
  const encoded = encodeUtf8(plaintext);
  const buffer = await subtle().encrypt({ name: 'AES-GCM', iv }, key, encoded);
  return { ciphertext: toBase64(buffer), iv: toBase64(iv) };
}

export async function decryptString(
  key: CryptoKey,
  payload: Ciphertext,
): Promise<string> {
  const buffer = await subtle().decrypt(
    { name: 'AES-GCM', iv: fromBase64(payload.iv) },
    key,
    fromBase64(payload.ciphertext),
  );
  return new TextDecoder().decode(buffer);
}
