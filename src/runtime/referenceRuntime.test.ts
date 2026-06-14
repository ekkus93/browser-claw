import { describe, expect, it } from 'vitest';
import { createReferenceRuntime } from './referenceRuntime.ts';
import type { Command } from './effectTypes.ts';

const submit = (text: string): Command => ({
  type: 'submit_user_message',
  conversation_id: 'c1',
  text,
});

describe('referenceRuntime', () => {
  it('emits audit then llm_request on submit', () => {
    const runtime = createReferenceRuntime();
    const effects = runtime.dispatch(submit('hello'));
    expect(effects[0]?.type).toBe('audit_append');
    expect(effects[1]).toMatchObject({
      type: 'llm_request',
      id: 'eff-2',
      prompt: 'hello',
    });
  });

  it('stores the assistant message when the llm_request resolves', () => {
    const runtime = createReferenceRuntime();
    runtime.dispatch(submit('hi'));
    const effects = runtime.dispatch({
      type: 'resolve_effect',
      id: 'eff-2',
      result: { text: 'hello there' },
    });
    const put = effects[0];
    expect(put?.type).toBe('storage_put');
    if (put?.type === 'storage_put') {
      expect(put.store).toBe('messages');
      expect(put.value).toEqual({ role: 'assistant', content: 'hello there' });
      // The stored message stays scoped to the originating conversation.
      expect(put.conversation_id).toBe('c1');
    }
  });

  it('proposes a tool call (attributed to the active skill) when the model asks', () => {
    const runtime = createReferenceRuntime();
    runtime.dispatch({
      type: 'submit_user_message',
      conversation_id: 'c1',
      text: 'search the web',
      skill_id: 'web-search',
    });
    const effects = runtime.dispatch({
      type: 'resolve_effect',
      id: 'eff-2',
      result: {
        tool_call: {
          name: 'Page Reader',
          args: { url: 'https://example.com' },
        },
      },
    });
    expect(effects).toHaveLength(1);
    const proposal = effects[0];
    expect(proposal?.type).toBe('tool_call_proposal');
    if (proposal?.type === 'tool_call_proposal') {
      expect(proposal.skill_id).toBe('web-search');
      expect(proposal.name).toBe('Page Reader');
      expect(proposal.args).toEqual({ url: 'https://example.com' });
    }
  });

  it('stores no message and audits a failure when the llm_request fails', () => {
    const runtime = createReferenceRuntime();
    runtime.dispatch(submit('hi'));
    const effects = runtime.dispatch({
      type: 'resolve_effect',
      id: 'eff-2',
      result: { ok: false, error: { kind: 'auth' } },
    });
    expect(effects).toHaveLength(1);
    expect(effects[0]).toMatchObject({
      type: 'audit_append',
      event_type: 'llm_request_failed',
      risk: 'medium',
    });
    expect(effects.some((e) => e.type === 'storage_put')).toBe(false);
  });

  it('restores from a snapshot and stays deterministic', () => {
    const a = createReferenceRuntime();
    a.dispatch(submit('one'));
    const b = createReferenceRuntime(a.snapshot());
    expect(b.dispatch(submit('two'))).toEqual(a.dispatch(submit('two')));
  });
});
