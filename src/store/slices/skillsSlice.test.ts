import { describe, expect, it } from 'vitest';
import skillsReducer, {
  selectedSkillSet,
  skillEnabled,
  skillDisabled,
} from './skillsSlice.ts';

describe('skillsSlice', () => {
  it('starts with nothing selected or enabled', () => {
    const state = skillsReducer(undefined, { type: '@@INIT' });
    expect(state).toEqual({ selectedSkillId: null, enabledIds: [] });
  });

  it('enables a skill once and disables it', () => {
    let state = skillsReducer(undefined, skillEnabled('web-search'));
    state = skillsReducer(state, skillEnabled('web-search'));
    expect(state.enabledIds).toEqual(['web-search']);
    state = skillsReducer(state, skillDisabled('web-search'));
    expect(state.enabledIds).toEqual([]);
  });

  it('selects a skill', () => {
    const state = skillsReducer(undefined, selectedSkillSet('web-search'));
    expect(state.selectedSkillId).toBe('web-search');
  });
});
