import { describe, expect, it } from 'vitest';
import providersReducer, {
  activeProviderSet,
  providerHealthSet,
} from './providersSlice.ts';

describe('providersSlice', () => {
  it('starts with no active provider and empty health', () => {
    const state = providersReducer(undefined, { type: '@@INIT' });
    expect(state).toEqual({
      activeProviderId: null,
      activeProviderLabel: null,
      activeProviderModel: null,
      activeProviderBaseUrl: null,
      health: {},
    });
  });

  it('sets and clears the active provider, including model/base URL', () => {
    let state = providersReducer(
      undefined,
      activeProviderSet({
        id: 'anthropic',
        label: 'Anthropic',
        model: 'claude-opus-4-8',
        baseUrl: 'https://api.anthropic.com',
      }),
    );
    expect(state.activeProviderId).toBe('anthropic');
    expect(state.activeProviderLabel).toBe('Anthropic');
    expect(state.activeProviderModel).toBe('claude-opus-4-8');
    expect(state.activeProviderBaseUrl).toBe('https://api.anthropic.com');

    state = providersReducer(state, activeProviderSet(null));
    expect(state.activeProviderId).toBeNull();
    expect(state.activeProviderLabel).toBeNull();
    expect(state.activeProviderModel).toBeNull();
    expect(state.activeProviderBaseUrl).toBeNull();
  });

  it('records per-provider health', () => {
    const state = providersReducer(
      undefined,
      providerHealthSet({ providerId: 'ollama', health: 'unreachable' }),
    );
    expect(state.health.ollama).toBe('unreachable');
  });
});
