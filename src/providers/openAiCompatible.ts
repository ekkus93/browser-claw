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

export interface OpenAICompatibleConfig {
  id: string;
  baseUrl: string;
  model: string;
  /** Injected for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Extra headers (e.g. Anthropic version) merged into every request. */
  headers?: Record<string, string>;
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
}

/**
 * Provider for any OpenAI-compatible /chat/completions endpoint (OpenAI,
 * llama-server, Ollama's OpenAI shim, and custom gateways).
 */
export function createOpenAICompatibleProvider(
  config: OpenAICompatibleConfig,
): LlmProvider {
  const doFetch = config.fetchImpl ?? fetch;

  async function complete(
    request: CompletionRequest,
    options?: ProviderCallOptions,
  ) {
    const url = `${config.baseUrl}/chat/completions`;
    const response = await fetchOrThrow(url, () =>
      doFetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(options?.apiKey
            ? { authorization: `Bearer ${options.apiKey}` }
            : {}),
          ...config.headers,
        },
        body: JSON.stringify({
          model: request.model ?? config.model,
          messages: request.messages,
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

    const data = (await response.json()) as ChatCompletionResponse;
    return { text: data.choices?.[0]?.message?.content ?? '' };
  }

  async function checkHealth(
    options?: ProviderCallOptions,
  ): Promise<ProviderHealth> {
    try {
      await complete(
        { messages: [{ role: 'user', content: 'ping' }], model: config.model },
        options,
      );
      return 'connected';
    } catch (error) {
      if (error instanceof ProviderError) return kindToHealth(error.kind);
      return 'unreachable';
    }
  }

  return { id: config.id, complete, checkHealth };
}
