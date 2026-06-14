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

/** A provider/runtime failure surfaced to the user as an error card. */
export interface ChatError {
  kind: string;
  message: string;
}

export interface ChatState {
  activeConversationId: string | null;
  composerDraft: string;
  runState: RunState;
  streamingMessageId: string | null;
  /** Set when the last turn failed; shown as an error card, never as a reply. */
  error: ChatError | null;
  /**
   * The skill active in this chat (null = none). Tool calls are attributed to
   * it and enforced against its declared tools; with no active skill, every
   * tool call is denied (fail closed).
   */
  activeSkillId: string | null;
}

const initialState: ChatState = {
  activeConversationId: null,
  composerDraft: '',
  runState: 'idle',
  streamingMessageId: null,
  error: null,
  activeSkillId: null,
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
    /** The turn failed: surface an error card instead of a fake reply. */
    chatErrored(state, action: PayloadAction<ChatError>) {
      state.runState = 'error';
      state.error = action.payload;
    },
    chatErrorCleared(state) {
      state.error = null;
      if (state.runState === 'error') state.runState = 'idle';
    },
    activeSkillSet(state, action: PayloadAction<string | null>) {
      state.activeSkillId = action.payload;
    },
    /** User sent a message — picked up by the runtime listener. */
    userMessageSubmitted(
      state,
      action: PayloadAction<{ conversationId: string; text: string }>,
    ) {
      state.activeConversationId = action.payload.conversationId;
      state.composerDraft = '';
      state.runState = 'thinking';
      state.error = null;
    },
  },
});

export const {
  activeConversationSet,
  composerDraftSet,
  runStateSet,
  streamingMessageSet,
  chatErrored,
  chatErrorCleared,
  activeSkillSet,
  userMessageSubmitted,
} = chatSlice.actions;
export default chatSlice.reducer;
