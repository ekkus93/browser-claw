import type { LlmProvider } from './types.ts';
import { createMockProvider } from './mockProvider.ts';
import {
  createOpenAIProvider,
  createOllamaProvider,
  createLlamaServerProvider,
} from './presets.ts';
import { createAnthropicProvider } from './anthropic.ts';

/**
 * Resolve a provider instance from the active provider id (providers slice).
 * Falls back to the offline mock provider so chat works out of the box before
 * any provider is configured.
 */
export function resolveProvider(activeProviderId: string | null): LlmProvider {
  switch (activeProviderId) {
    case 'openai':
      return createOpenAIProvider();
    case 'anthropic':
      return createAnthropicProvider();
    case 'ollama':
      return createOllamaProvider();
    case 'llama-server':
      return createLlamaServerProvider();
    default:
      return createMockProvider();
  }
}
