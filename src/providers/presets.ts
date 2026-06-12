import type { LlmProvider } from './types.ts';
import { createOpenAICompatibleProvider } from './openAiCompatible.ts';

export interface PresetOptions {
  baseUrl?: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

export function createOpenAIProvider(options: PresetOptions = {}): LlmProvider {
  return createOpenAICompatibleProvider({
    id: 'openai',
    baseUrl: options.baseUrl ?? 'https://api.openai.com/v1',
    model: options.model ?? 'gpt-4o',
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
}

export function createOllamaProvider(options: PresetOptions = {}): LlmProvider {
  return createOpenAICompatibleProvider({
    id: 'ollama',
    baseUrl: options.baseUrl ?? 'http://localhost:11434/v1',
    model: options.model ?? 'llama3',
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
}

export function createLlamaServerProvider(
  options: PresetOptions = {},
): LlmProvider {
  return createOpenAICompatibleProvider({
    id: 'llama-server',
    baseUrl: options.baseUrl ?? 'http://localhost:8080/v1',
    model: options.model ?? 'local-model',
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
}
