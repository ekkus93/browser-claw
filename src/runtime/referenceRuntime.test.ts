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

  it('stores an approved tool result and asks the model again', () => {
    const runtime = createReferenceRuntime();
    runtime.dispatch({
      type: 'submit_user_message',
      conversation_id: 'c1',
      text: 'search',
      skill_id: 'web-search',
    });
    runtime.dispatch({
      type: 'resolve_effect',
      id: 'eff-2',
      result: { tool_call: { name: 'Page Reader', args: {} } },
    });
    const effects = runtime.dispatch({
      type: 'resolve_effect',
      id: 'eff-3',
      result: { text: 'page contents' },
    });
    const put = effects.find((e) => e.type === 'storage_put');
    expect(put?.type).toBe('storage_put');
    if (put?.type === 'storage_put') {
      expect(put.value).toEqual({ role: 'tool', content: 'page contents' });
    }
    expect(effects.some((e) => e.type === 'llm_request')).toBe(true);
  });

  it('audits a stray resolve for an unknown effect id (A2.2)', () => {
    const runtime = createReferenceRuntime();
    const effects = runtime.dispatch({
      type: 'resolve_effect',
      id: 'never-emitted',
      result: { text: 'stray' },
    });
    expect(effects).toHaveLength(1);
    expect(effects[0]).toMatchObject({
      type: 'audit_append',
      event_type: 'runtime.resolve_unknown_effect',
      risk: 'medium',
    });
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

  // FIX1-C3: reference runtime routes plan/script/web payloads to correct effects.
  it('C3: emits script_plan_proposal when llm_request resolves with plan payload', () => {
    const runtime = createReferenceRuntime();
    runtime.dispatch(submit('make a plan'));
    const effects = runtime.dispatch({
      type: 'resolve_effect',
      id: 'eff-2',
      result: {
        ok: true,
        plan: {
          type: 'browserclaw_plan',
          version: 1,
          title: 'T',
          reason: 'R',
          steps: [],
        },
      },
    });
    expect(effects.some((e) => e.type === 'script_plan_proposal')).toBe(true);
    expect(effects.some((e) => e.type === 'storage_put')).toBe(false);
  });

  it('C3: emits sandbox_script_proposal when llm_request resolves with script_request payload', () => {
    const runtime = createReferenceRuntime();
    runtime.dispatch(submit('run a script'));
    const effects = runtime.dispatch({
      type: 'resolve_effect',
      id: 'eff-2',
      result: {
        ok: true,
        script_request: {
          type: 'browserclaw_script_request',
          version: 1,
          runtime: 'sandboxed_script',
          code: 'return 1;',
        },
      },
    });
    expect(effects.some((e) => e.type === 'sandbox_script_proposal')).toBe(
      true,
    );
    expect(effects.some((e) => e.type === 'storage_put')).toBe(false);
  });

  it('C3: emits web_search when llm_request resolves with search web_request', () => {
    const runtime = createReferenceRuntime();
    runtime.dispatch(submit('search'));
    const effects = runtime.dispatch({
      type: 'resolve_effect',
      id: 'eff-2',
      result: { ok: true, web_request: { op: 'search', query: 'AI news' } },
    });
    expect(effects.some((e) => e.type === 'web_search')).toBe(true);
  });

  it('C3: emits web_page_read when llm_request resolves with readPage web_request', () => {
    const runtime = createReferenceRuntime();
    runtime.dispatch(submit('read page'));
    const effects = runtime.dispatch({
      type: 'resolve_effect',
      id: 'eff-2',
      result: {
        ok: true,
        web_request: { op: 'readPage', url: 'https://example.com/' },
      },
    });
    expect(effects.some((e) => e.type === 'web_page_read')).toBe(true);
  });
});
