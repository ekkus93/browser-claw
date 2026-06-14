// @vitest-environment node
// Node's Response/Headers behave like the browser's; jsdom's are flakier for
// header round-trips.
import { describe, expect, it, vi } from 'vitest';
import { fetchHfModelMetadata } from './hfMetadata.ts';

const ref = { repo: 'owner/name', file: 'model.gguf' };

function fetchStub(
  handler: (url: string, init?: RequestInit) => Promise<Response>,
): typeof fetch {
  return vi.fn(handler) as unknown as typeof fetch;
}

describe('fetchHfModelMetadata', () => {
  it('discovers size (Content-Length) and license (model card)', async () => {
    const fetchImpl = fetchStub((url, init) => {
      if (init?.method === 'HEAD') {
        return Promise.resolve(
          new Response(null, { headers: { 'content-length': '2048' } }),
        );
      }
      expect(url).toBe('https://huggingface.co/api/models/owner/name');
      return Promise.resolve(
        new Response(JSON.stringify({ cardData: { license: 'apache-2.0' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });

    const result = await fetchHfModelMetadata(ref, fetchImpl);
    expect(result).toEqual({
      ok: true,
      metadata: { sizeBytes: 2048, license: 'apache-2.0' },
    });
  });

  it('returns partial metadata when only one lookup succeeds', async () => {
    const fetchImpl = fetchStub((_url, init) =>
      init?.method === 'HEAD'
        ? Promise.resolve(
            new Response(null, { headers: { 'content-length': '4096' } }),
          )
        : Promise.resolve(new Response('not found', { status: 404 })),
    );

    const result = await fetchHfModelMetadata(ref, fetchImpl);
    expect(result).toEqual({ ok: true, metadata: { sizeBytes: 4096 } });
  });

  it('reports failure when no metadata can be fetched', async () => {
    const fetchImpl = fetchStub(() =>
      Promise.reject(new TypeError('network down')),
    );
    const result = await fetchHfModelMetadata(ref, fetchImpl);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/could not fetch/i);
  });
});
