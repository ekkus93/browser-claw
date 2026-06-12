import type { AppConfig } from '../config/appConfig.ts';
import type { LlmProvider } from './types.ts';
import { createMockProvider } from './mockProvider.ts';
import {
  createOpenAIProvider,
  createOllamaProvider,
  createLlamaServerProvider,
  type PresetOptions,
} from './presets.ts';
import { createAnthropicProvider } from './anthropic.ts';
import { createOpenAICompatibleProvider } from './openAiCompatible.ts';
import { createWllamaProvider } from './wllamaProvider.ts';
import { getWllamaEngine } from '../wllama/engine.ts';

/** Provider ids that talk to a real backend (no safety gate needed). */
const REAL_PROVIDER_IDS = new Set([
  'openai',
  'anthropic',
  'compatible',
  'ollama',
  'llama-server',
  'wllama',
]);

/**
 * Persisted profile values (base URL, model) used to configure the resolved
 * provider, so provider tests and the runtime hit exactly what the user saved.
 */
export interface ProviderOverrides {
  baseUrl?: string;
  model?: string;
}

/** Build preset options from a profile, ignoring blank fields (use defaults). */
function presetOptions(overrides?: ProviderOverrides): PresetOptions {
  return {
    ...(overrides?.baseUrl ? { baseUrl: overrides.baseUrl } : {}),
    ...(overrides?.model ? { model: overrides.model } : {}),
  };
}

export type ResolvedProvider =
  | { ok: true; provider: LlmProvider }
  | { ok: false; reason: 'not_configured' | 'unknown_provider' };

/**
 * Cheap, side-effect-free check of whether the active provider id can be used
 * — without instantiating a provider (resolving 'wllama' would spin up an
 * engine). The UI uses this to decide whether to block chat. The mock provider
 * counts as configured only when it is explicitly allowed.
 */
export function isProviderConfigured(
  activeProviderId: string | null,
  isMockProviderAllowed: boolean,
): boolean {
  if (activeProviderId === null) return false;
  if (activeProviderId === 'mock') return isMockProviderAllowed;
  return REAL_PROVIDER_IDS.has(activeProviderId);
}

/**
 * The provider selected by default at boot. Fails closed: no provider unless
 * the mock is explicitly allowed (demo/dev), in which case the mock is
 * pre-selected so the console is usable behind the safety banner.
 */
export function defaultActiveProviderId(
  config: Pick<AppConfig, 'isMockProviderAllowed'>,
): string | null {
  return config.isMockProviderAllowed ? 'mock' : null;
}

/**
 * Resolve a provider instance from the active provider id (providers slice).
 *
 * Fails closed: an unknown or unconfigured provider id does NOT silently become
 * the mock provider. The mock answers only when explicitly selected AND
 * permitted by the safety policy (`isMockProviderAllowed`). See
 * HARDENING_NOTES.md.
 */
export function resolveProvider(
  activeProviderId: string | null,
  config: Pick<AppConfig, 'isMockProviderAllowed'>,
  overrides?: ProviderOverrides,
): ResolvedProvider {
  switch (activeProviderId) {
    case 'openai':
      return { ok: true, provider: createOpenAIProvider(presetOptions(overrides)) };
    case 'anthropic':
      return {
        ok: true,
        provider: createAnthropicProvider(presetOptions(overrides)),
      };
    case 'compatible':
      return {
        ok: true,
        provider: createOpenAICompatibleProvider({
          id: 'compatible',
          baseUrl: overrides?.baseUrl ?? '',
          model: overrides?.model ?? '',
        }),
      };
    case 'ollama':
      return {
        ok: true,
        provider: createOllamaProvider(presetOptions(overrides)),
      };
    case 'llama-server':
      return {
        ok: true,
        provider: createLlamaServerProvider(presetOptions(overrides)),
      };
    case 'wllama':
      return { ok: true, provider: createWllamaProvider(getWllamaEngine()) };
    case 'mock':
      return config.isMockProviderAllowed
        ? { ok: true, provider: createMockProvider() }
        : { ok: false, reason: 'not_configured' };
    case null:
      return { ok: false, reason: 'not_configured' };
    default:
      return { ok: false, reason: 'unknown_provider' };
  }
}
