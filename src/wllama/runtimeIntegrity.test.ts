import { describe, expect, it, vi } from 'vitest';
import {
  WLLAMA_WASM_SHA256,
  WllamaIntegrityError,
  fetchVerifiedRuntimeUrl,
  sha256Hex,
  verifyRuntimeBytes,
} from './runtimeIntegrity.ts';

const enc = (s: string) => new TextEncoder().encode(s);

describe('runtime integrity (A2.7)', () => {
  it('sha256Hex matches a known test vector', async () => {
    // SHA-256("abc")
    expect(await sha256Hex(enc('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('verifyRuntimeBytes accepts matching bytes and rejects a mismatch', async () => {
    const bytes = enc('runtime');
    const hash = await sha256Hex(bytes);
    expect(await verifyRuntimeBytes(bytes, hash)).toBe(true);
    expect(await verifyRuntimeBytes(bytes, 'deadbeef')).toBe(false);
  });

  it('pins a 64-hex-char runtime hash', () => {
    expect(WLLAMA_WASM_SHA256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('fetchVerifiedRuntimeUrl returns a blob URL when the hash matches', async () => {
    const bytes = enc('verified-runtime');
    const expected = await sha256Hex(bytes);
    const createObjectURL = vi.fn(() => 'blob:ok');
    vi.stubGlobal('URL', { ...URL, createObjectURL });
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response(bytes)),
    ) as unknown as typeof fetch;

    const url = await fetchVerifiedRuntimeUrl(
      'https://cdn/wllama.wasm',
      expected,
      fetchImpl,
    );
    expect(url).toBe('blob:ok');
    expect(createObjectURL).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('fetchVerifiedRuntimeUrl throws WllamaIntegrityError on a hash mismatch', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response(enc('tampered'))),
    ) as unknown as typeof fetch;
    await expect(
      fetchVerifiedRuntimeUrl(
        'https://cdn/wllama.wasm',
        WLLAMA_WASM_SHA256,
        fetchImpl,
      ),
    ).rejects.toBeInstanceOf(WllamaIntegrityError);
  });

  it('fetchVerifiedRuntimeUrl throws on a failed fetch', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response('no', { status: 502 })),
    ) as unknown as typeof fetch;
    await expect(
      fetchVerifiedRuntimeUrl('https://cdn/wllama.wasm', undefined, fetchImpl),
    ).rejects.toThrow(/fetch failed/i);
  });
});
