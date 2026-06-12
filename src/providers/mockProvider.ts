import type { LlmProvider } from './types.ts';

/**
 * Deterministic in-memory provider. Used as the default until a real provider
 * is configured, and in tests. Never touches the network.
 */
export function createMockProvider(id = 'mock'): LlmProvider {
  return {
    id,
    complete(request) {
      const lastUser = [...request.messages]
        .reverse()
        .find((message) => message.role === 'user');
      return Promise.resolve({
        text: `Mock response to: ${lastUser?.content ?? '(no prompt)'}`,
      });
    },
    checkHealth() {
      return Promise.resolve('connected');
    },
  };
}
