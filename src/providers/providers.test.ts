import { describe, expect, it, vi } from 'vitest';
import { createMockProvider } from './mockProvider.ts';
import { createOpenAICompatibleProvider } from './openAiCompatible.ts';
import { createOpenAIProvider } from './presets.ts';
import { createAnthropicProvider } from './anthropic.ts';
import { resolveProvider } from './registry.ts';
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

describe('registry', () => {
  it('defaults to mock and resolves presets by id', () => {
    expect(resolveProvider(null).id).toBe('mock');
    expect(resolveProvider('unknown').id).toBe('mock');
    expect(resolveProvider('anthropic').id).toBe('anthropic');
    expect(resolveProvider('openai').id).toBe('openai');
    expect(resolveProvider('ollama').id).toBe('ollama');
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
