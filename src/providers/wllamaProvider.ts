import type { LlmProvider } from './types.ts';
import { ProviderError } from './errors.ts';
import type { WllamaEngine } from '../wllama/engine.ts';

/**
 * LLM provider backed by a browser-local wllama model. Reports `unconfigured`
 * until a model is loaded.
 */
export function createWllamaProvider(engine: WllamaEngine): LlmProvider {
  return {
    id: 'wllama',
    async complete(request) {
      const text = await engine.complete(request.messages);
      // An empty generation is an error, not an empty assistant turn (A2.8).
      if (typeof text !== 'string' || text.length === 0) {
        throw new ProviderError(
          'invalid_response',
          'The local model produced no output.',
        );
      }
      return { text };
    },
    checkHealth() {
      return Promise.resolve(
        engine.loadedModelId() !== null ? 'connected' : 'unconfigured',
      );
    },
  };
}
