import { describe, expect, it } from 'vitest';
import appReducer, {
  hydrated,
  onboardingCompleted,
  activeWorkspaceSet,
} from './appSlice.ts';

describe('appSlice', () => {
  it('starts un-hydrated with onboarding incomplete', () => {
    const state = appReducer(undefined, { type: '@@INIT' });
    expect(state).toEqual({
      hydrated: false,
      onboardingComplete: false,
      activeWorkspaceId: null,
    });
  });

  it('marks hydration and onboarding completion', () => {
    let state = appReducer(undefined, hydrated());
    expect(state.hydrated).toBe(true);
    state = appReducer(state, onboardingCompleted());
    expect(state.onboardingComplete).toBe(true);
  });

  it('sets the active workspace', () => {
    const state = appReducer(undefined, activeWorkspaceSet('ws-1'));
    expect(state.activeWorkspaceId).toBe('ws-1');
  });
});
