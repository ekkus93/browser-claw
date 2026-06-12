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
    }
  });

  it('restores from a snapshot and stays deterministic', () => {
    const a = createReferenceRuntime();
    a.dispatch(submit('one'));
    const b = createReferenceRuntime(a.snapshot());
    expect(b.dispatch(submit('two'))).toEqual(a.dispatch(submit('two')));
  });
});
