import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

/**
 * Session view of skills. Installed skill packages, their files, and per-skill
 * state are durable (Dexie, Phase 3 / functionality in Phase 10); this slice
 * owns the transient enabled set and the selected-skill pointer for the manager.
 */
export interface SkillsState {
  selectedSkillId: string | null;
  enabledIds: string[];
}

const initialState: SkillsState = {
  selectedSkillId: null,
  enabledIds: [],
};

const skillsSlice = createSlice({
  name: 'skills',
  initialState,
  reducers: {
    selectedSkillSet(state, action: PayloadAction<string | null>) {
      state.selectedSkillId = action.payload;
    },
    skillEnabled(state, action: PayloadAction<string>) {
      if (!state.enabledIds.includes(action.payload)) {
        state.enabledIds.push(action.payload);
      }
    },
    skillDisabled(state, action: PayloadAction<string>) {
      state.enabledIds = state.enabledIds.filter((id) => id !== action.payload);
    },
  },
});

export const { selectedSkillSet, skillEnabled, skillDisabled } =
  skillsSlice.actions;
export default skillsSlice.reducer;
