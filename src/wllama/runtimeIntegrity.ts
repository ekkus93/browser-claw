/**
 * Integrity verification for the wllama WASM runtime (hardening A2.7).
 *
 * The runtime is fetched from a pinned, versioned CDN URL. Before it is handed
 * to wllama we verify the bytes hash to a known SHA-256 — so a tampered or
 * unexpectedly-changed asset is rejected (fail closed) instead of executed.
 * This is real verification, not a consent gate alone.
 *
 * The hash is for `@wllama/wllama@3.4.1/esm/wasm/wllama.wasm` (7308965 bytes).
 * It MUST be updated in lockstep with the pinned version in `engine.ts`.
 */

export const WLLAMA_WASM_SHA256 =
  'a3e827b9fc3536fd1b061eee8b130e46f6366d25b062438a791d8b17b2a72a30';

/** Thrown when fetched runtime bytes don't match the expected hash. */
export class WllamaIntegrityError extends Error {
  readonly actual: string;
  readonly expected: string;
  constructor(actual: string, expected: string) {
    super(
      `wllama runtime failed integrity check (expected ${expected.slice(0, 12)}…, got ${actual.slice(0, 12)}…)`,
    );
    this.name = 'WllamaIntegrityError';
    this.actual = actual;
    this.expected = expected;
  }
}

/** Lowercase hex SHA-256 of the given bytes, via Web Crypto. */
export async function sha256Hex(
  bytes: ArrayBuffer | Uint8Array,
): Promise<string> {
  // Copy into a fresh ArrayBuffer-backed view so the type satisfies
  // BufferSource under TS's strict ArrayBuffer/SharedArrayBuffer split.
  const view =
    bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes);
  const digest = await crypto.subtle.digest('SHA-256', view);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** True iff the bytes hash to `expected` (defaults to the pinned runtime hash). */
export async function verifyRuntimeBytes(
  bytes: ArrayBuffer | Uint8Array,
  expected: string = WLLAMA_WASM_SHA256,
): Promise<boolean> {
  return (await sha256Hex(bytes)) === expected;
}

/**
 * Fetch the runtime from `url`, verify its SHA-256, and return an
 * `application/wasm` blob URL for the VERIFIED bytes (so wllama loads exactly
 * what we checked — no re-fetch / time-of-check-to-use gap). Throws
 * {@link WllamaIntegrityError} on mismatch, or a plain error on a failed fetch.
 */
export async function fetchVerifiedRuntimeUrl(
  url: string,
  expected: string = WLLAMA_WASM_SHA256,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`wllama runtime fetch failed (${response.status}).`);
  }
  const bytes = await response.arrayBuffer();
  const actual = await sha256Hex(bytes);
  if (actual !== expected) {
    throw new WllamaIntegrityError(actual, expected);
  }
  return URL.createObjectURL(new Blob([bytes], { type: 'application/wasm' }));
}
