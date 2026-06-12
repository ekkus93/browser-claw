import type { ProviderHealth } from '../store/slices/providersSlice.ts';

/**
 * Normalized LLM provider interface. Every provider (mock, OpenAI-compatible,
 * Anthropic, Ollama, llama-server, wllama) implements this so the runtime can
 * call any of them the same way. API keys are passed per-call from the
 * SecretVault — never stored on the provider.
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionRequest {
  messages: ChatMessage[];
  model?: string;
}

export interface CompletionResult {
  text: string;
}

export interface ProviderCallOptions {
  apiKey?: string;
  signal?: AbortSignal;
}

export interface LlmProvider {
  readonly id: string;
  complete(
    request: CompletionRequest,
    options?: ProviderCallOptions,
  ): Promise<CompletionResult>;
  checkHealth(options?: ProviderCallOptions): Promise<ProviderHealth>;
}
