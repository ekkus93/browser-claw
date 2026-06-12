import { describe, expect, it, vi } from 'vitest';
import { createMockProvider } from './mockProvider.ts';
import { createOpenAICompatibleProvider } from './openAiCompatible.ts';
import { createOpenAIProvider } from './presets.ts';
import { ProviderError, httpStatusToKind, kindToHealth } from './errors.ts';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('mock provider', () => {
  it('echoes the last user message', async () => {
    const provider = createMockProvider();
    const result = await provider.complete({
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(result.text).toContain('hello');
    expect(await provider.checkHealth()).toBe('connected');
  });
});

describe('OpenAI-compatible provider', () => {
  it('posts to /chat/completions and parses the reply', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        jsonResponse({ choices: [{ message: { content: 'hi there' } }] }),
      ),
    ) as unknown as typeof fetch;

    const provider = createOpenAICompatibleProvider({
      id: 'test',
      baseUrl: 'https://api.example.com/v1',
      model: 'm',
      fetchImpl,
    });
    const result = await provider.complete(
      { messages: [{ role: 'user', content: 'hi' }] },
      { apiKey: 'sk-test' },
    );
    expect(result.text).toBe('hi there');

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe(
      'Bearer sk-test',
    );
  });

  it('maps a 401 to an auth error', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse({}, 401)),
    ) as unknown as typeof fetch;
    const provider = createOpenAIProvider({ fetchImpl });
    await expect(
      provider.complete({ messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toMatchObject({ kind: 'auth' });
    expect(await provider.checkHealth()).toBe('auth_failed');
  });

  it('maps a network failure to unreachable', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.reject(new TypeError('Failed to fetch')),
    ) as unknown as typeof fetch;
    const provider = createOpenAIProvider({ fetchImpl });
    await expect(
      provider.complete({ messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toBeInstanceOf(ProviderError);
    expect(await provider.checkHealth()).toBe('unreachable');
  });
});

describe('error mapping', () => {
  it('maps status codes and kinds', () => {
    expect(httpStatusToKind(401)).toBe('auth');
    expect(httpStatusToKind(404)).toBe('model_not_found');
    expect(httpStatusToKind(500)).toBe('unknown');
    expect(kindToHealth('cors')).toBe('cors_error');
    expect(kindToHealth('model_not_found')).toBe('model_not_found');
  });
});
