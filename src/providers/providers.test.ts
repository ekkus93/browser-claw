import { describe, expect, it, vi } from 'vitest';
import { createMockProvider } from './mockProvider.ts';
import { createOpenAICompatibleProvider } from './openAiCompatible.ts';
import { createOpenAIProvider } from './presets.ts';
import { createAnthropicProvider } from './anthropic.ts';
import {
  resolveProvider,
  isProviderConfigured,
  defaultActiveProviderId,
} from './registry.ts';
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

describe('Anthropic provider', () => {
  it('posts to /v1/messages, hoists system, and parses content blocks', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        jsonResponse({ content: [{ type: 'text', text: 'claude says hi' }] }),
      ),
    ) as unknown as typeof fetch;
    const provider = createAnthropicProvider({ fetchImpl });
    const result = await provider.complete(
      {
        messages: [
          { role: 'system', content: 'be brief' },
          { role: 'user', content: 'hi' },
        ],
      },
      { apiKey: 'sk-ant' },
    );
    expect(result.text).toBe('claude says hi');

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(url).toContain('/v1/messages');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe(
      'sk-ant',
    );
    const body = JSON.parse(init.body as string) as { system?: string };
    expect(body.system).toBe('be brief');
  });
});

describe('registry — fails closed', () => {
  const mockOff = { isMockProviderAllowed: false };
  const mockOn = { isMockProviderAllowed: true };

  it('resolves real presets by id', () => {
    const anthropic = resolveProvider('anthropic', mockOff);
    expect(anthropic.ok && anthropic.provider.id).toBe('anthropic');
    const openai = resolveProvider('openai', mockOff);
    expect(openai.ok && openai.provider.id).toBe('openai');
    const ollama = resolveProvider('ollama', mockOff);
    expect(ollama.ok && ollama.provider.id).toBe('ollama');
  });

  it('does NOT fall back to mock for null or unknown ids', () => {
    expect(resolveProvider(null, mockOff)).toEqual({
      ok: false,
      reason: 'not_configured',
    });
    expect(resolveProvider('unknown', mockOff)).toEqual({
      ok: false,
      reason: 'unknown_provider',
    });
  });

  it('resolves the mock only when explicitly allowed', () => {
    expect(resolveProvider('mock', mockOff)).toEqual({
      ok: false,
      reason: 'not_configured',
    });
    const allowed = resolveProvider('mock', mockOn);
    expect(allowed.ok && allowed.provider.id).toBe('mock');
  });

  it('applies persisted base URL/model overrides to the resolved provider', async () => {
    // The Models screen passes the saved profile values through; a health check
    // must hit exactly that base URL — proving the test uses persisted values.
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        jsonResponse({ choices: [{ message: { content: 'ok' } }] }),
      ),
    );
    vi.stubGlobal('fetch', fetchImpl);
    try {
      const resolved = resolveProvider('compatible', mockOff, {
        baseUrl: 'https://saved.example/v1',
        model: 'saved-model',
      });
      expect(resolved.ok).toBe(true);
      if (!resolved.ok) return;
      expect(await resolved.provider.checkHealth()).toBe('connected');
      const [url] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe('https://saved.example/v1/chat/completions');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('provider configuration helpers', () => {
  it('isProviderConfigured gates the mock behind the flag', () => {
    expect(isProviderConfigured(null, false)).toBe(false);
    expect(isProviderConfigured('unknown', true)).toBe(false);
    expect(isProviderConfigured('openai', false)).toBe(true);
    expect(isProviderConfigured('mock', false)).toBe(false);
    expect(isProviderConfigured('mock', true)).toBe(true);
  });

  it('defaultActiveProviderId fails closed unless the mock is allowed', () => {
    expect(
      defaultActiveProviderId({ isMockProviderAllowed: false }),
    ).toBeNull();
    expect(defaultActiveProviderId({ isMockProviderAllowed: true })).toBe(
      'mock',
    );
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
