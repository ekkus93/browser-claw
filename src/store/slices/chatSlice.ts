import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

/**
 * Active chat/workbench session state. Conversations and messages are durable
 * (Dexie, Phase 3); this slice owns the transient run state, the active
 * conversation pointer, and the composer draft.
 */
export type RunState =
  | 'idle'
  | 'thinking'
  | 'streaming'
  | 'awaiting_approval'
  | 'error';

export interface ChatState {
  activeConversationId: string | null;
  composerDraft: string;
  runState: RunState;
  streamingMessageId: string | null;
}

const initialState: ChatState = {
  activeConversationId: null,
  composerDraft: '',
  runState: 'idle',
  streamingMessageId: null,
};

const chatSlice = createSlice({
  name: 'chat',
  initialState,
  reducers: {
    activeConversationSet(state, action: PayloadAction<string | null>) {
      state.activeConversationId = action.payload;
      state.composerDraft = '';
    },
    composerDraftSet(state, action: PayloadAction<string>) {
      state.composerDraft = action.payload;
    },
    runStateSet(state, action: PayloadAction<RunState>) {
      state.runState = action.payload;
    },
    streamingMessageSet(state, action: PayloadAction<string | null>) {
      state.streamingMessageId = action.payload;
    },
  },
});

export const {
  activeConversationSet,
  composerDraftSet,
  runStateSet,
  streamingMessageSet,
} = chatSlice.actions;
export default chatSlice.reducer;
