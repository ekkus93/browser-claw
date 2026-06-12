import { describe, expect, it } from 'vitest';
import chatReducer, {
  activeConversationSet,
  composerDraftSet,
  runStateSet,
  streamingMessageSet,
} from './chatSlice.ts';

describe('chatSlice', () => {
  it('starts idle with no active conversation', () => {
    const state = chatReducer(undefined, { type: '@@INIT' });
    expect(state).toEqual({
      activeConversationId: null,
      composerDraft: '',
      runState: 'idle',
      streamingMessageId: null,
    });
  });

  it('clears the draft when switching conversation', () => {
    let state = chatReducer(undefined, composerDraftSet('half-typed'));
    expect(state.composerDraft).toBe('half-typed');
    state = chatReducer(state, activeConversationSet('conv-1'));
    expect(state.activeConversationId).toBe('conv-1');
    expect(state.composerDraft).toBe('');
  });

  it('tracks run state and the streaming message', () => {
    let state = chatReducer(undefined, runStateSet('streaming'));
    expect(state.runState).toBe('streaming');
    state = chatReducer(state, streamingMessageSet('msg-9'));
    expect(state.streamingMessageId).toBe('msg-9');
  });
});
