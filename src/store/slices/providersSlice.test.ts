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
      health: {},
    });
  });

  it('sets and clears the active provider', () => {
    let state = providersReducer(
      undefined,
      activeProviderSet({ id: 'anthropic', label: 'Anthropic' }),
    );
    expect(state.activeProviderId).toBe('anthropic');
    expect(state.activeProviderLabel).toBe('Anthropic');

    state = providersReducer(state, activeProviderSet(null));
    expect(state.activeProviderId).toBeNull();
    expect(state.activeProviderLabel).toBeNull();
  });

  it('records per-provider health', () => {
    const state = providersReducer(
      undefined,
      providerHealthSet({ providerId: 'ollama', health: 'unreachable' }),
    );
    expect(state.health.ollama).toBe('unreachable');
  });
});
