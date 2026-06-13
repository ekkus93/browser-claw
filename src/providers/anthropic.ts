import type {
  LlmProvider,
  CompletionRequest,
  ProviderCallOptions,
} from './types.ts';
import type { ProviderHealth } from '../store/slices/providersSlice.ts';
import {
  ProviderError,
  fetchOrThrow,
  httpStatusToKind,
  kindToHealth,
} from './errors.ts';

export interface AnthropicConfig {
  baseUrl?: string;
  model?: string;
  version?: string;
  fetchImpl?: typeof fetch;
}

interface AnthropicResponse {
  content?: { type: string; text?: string }[];
}

/**
 * Anthropic Messages API adapter (/v1/messages). System messages are hoisted
 * into the `system` field, and the browser-direct-access header is sent so the
 * call works from a browser origin.
 */
export function createAnthropicProvider(
  config: AnthropicConfig = {},
): LlmProvider {
  const baseUrl = config.baseUrl ?? 'https://api.anthropic.com';
  const model = config.model ?? 'claude-opus-4-8';
  const version = config.version ?? '2023-06-01';
  const doFetch = config.fetchImpl ?? fetch;

  async function complete(
    request: CompletionRequest,
    options?: ProviderCallOptions,
  ) {
    const system = request.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n');
    const messages = request.messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({ role: message.role, content: message.content }));

    const url = `${baseUrl}/v1/messages`;
    const response = await fetchOrThrow(url, () =>
      doFetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'anthropic-version': version,
          'anthropic-dangerous-direct-browser-access': 'true',
          ...(options?.apiKey ? { 'x-api-key': options.apiKey } : {}),
        },
        body: JSON.stringify({
          model: request.model ?? model,
          max_tokens: 1024,
          ...(system ? { system } : {}),
          messages,
        }),
        ...(options?.signal ? { signal: options.signal } : {}),
      }),
    );

    if (!response.ok) {
      throw new ProviderError(
        httpStatusToKind(response.status),
        `Request failed with status ${response.status}`,
      );
    }

    const data = (await response.json()) as AnthropicResponse;
    const text =
      data.content?.find((block) => block.type === 'text')?.text ?? '';
    return { text };
  }

  async function checkHealth(
    options?: ProviderCallOptions,
  ): Promise<ProviderHealth> {
    try {
      await complete(
        { messages: [{ role: 'user', content: 'ping' }] },
        options,
      );
      return 'connected';
    } catch (error) {
      if (error instanceof ProviderError) return kindToHealth(error.kind);
      return 'unreachable';
    }
  }

  return { id: 'anthropic', complete, checkHealth };
}
