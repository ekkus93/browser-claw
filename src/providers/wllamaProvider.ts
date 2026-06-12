import type { LlmProvider } from './types.ts';
import type { WllamaEngine } from '../wllama/engine.ts';

/**
 * LLM provider backed by a browser-local wllama model. Reports `unconfigured`
 * until a model is loaded.
 */
export function createWllamaProvider(engine: WllamaEngine): LlmProvider {
  return {
    id: 'wllama',
    async complete(request) {
      return { text: await engine.complete(request.messages) };
    },
    checkHealth() {
      return Promise.resolve(
        engine.loadedModelId() !== null ? 'connected' : 'unconfigured',
      );
    },
  };
}
