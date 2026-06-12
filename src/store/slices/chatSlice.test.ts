import { describe, expect, it } from 'vitest';
import chatReducer, {
  activeConversationSet,
  composerDraftSet,
  runStateSet,
  streamingMessageSet,
  chatErrored,
  chatErrorCleared,
  userMessageSubmitted,
} from './chatSlice.ts';

describe('chatSlice', () => {
  it('starts idle with no active conversation', () => {
    const state = chatReducer(undefined, { type: '@@INIT' });
    expect(state).toEqual({
      activeConversationId: null,
      composerDraft: '',
      runState: 'idle',
      streamingMessageId: null,
      error: null,
    });
  });

  it('records a chat error and clears it on the next submit', () => {
    let state = chatReducer(
      undefined,
      chatErrored({ kind: 'auth', message: 'bad key' }),
    );
    expect(state.runState).toBe('error');
    expect(state.error).toEqual({ kind: 'auth', message: 'bad key' });

    state = chatReducer(
      state,
      userMessageSubmitted({ conversationId: 'c1', text: 'retry' }),
    );
    expect(state.error).toBeNull();
    expect(state.runState).toBe('thinking');
  });

  it('clears the error explicitly and returns to idle', () => {
    let state = chatReducer(
      undefined,
      chatErrored({ kind: 'unreachable', message: 'down' }),
    );
    state = chatReducer(state, chatErrorCleared());
    expect(state.error).toBeNull();
    expect(state.runState).toBe('idle');
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
