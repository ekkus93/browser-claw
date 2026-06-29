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

  // A2: parity with Rust — all result shapes and error paths match.

  it('A2: emits extension_request for readCurrentTab (not web_page_read with empty url)', () => {
    const runtime = createReferenceRuntime();
    runtime.dispatch(submit('read current tab'));
    const effects = runtime.dispatch({
      type: 'resolve_effect',
      id: 'eff-2',
      result: { web_request: { op: 'readCurrentTab' } },
    });
    expect(effects).toHaveLength(1);
    const e = effects[0];
    expect(e?.type).toBe('extension_request');
    if (e?.type === 'extension_request') {
      expect((e.request as { op: string }).op).toBe('read_current_tab');
    }
  });

  it('A2: emits web_research for readPages web_request', () => {
    const runtime = createReferenceRuntime();
    runtime.dispatch(submit('read pages'));
    const effects = runtime.dispatch({
      type: 'resolve_effect',
      id: 'eff-2',
      result: {
        web_request: {
          op: 'readPages',
          urls: ['https://example.com/a', 'https://example.com/b'],
        },
      },
    });
    expect(effects).toHaveLength(1);
    expect(effects[0]?.type).toBe('web_research');
    const eff = effects[0] as { type: string; mode: string; urls: string[] };
    expect(eff.mode).toBe('urls');
    expect(eff.urls).toHaveLength(2);
  });

  it('A2: emits web_research for research web_request', () => {
    const runtime = createReferenceRuntime();
    runtime.dispatch(submit('do research'));
    const effects = runtime.dispatch({
      type: 'resolve_effect',
      id: 'eff-2',
      result: { web_request: { op: 'research', query: 'AI trends' } },
    });
    expect(effects[0]?.type).toBe('web_research');
  });

  it('A2: unknown web_request op emits protocol error, not storage_put', () => {
    const runtime = createReferenceRuntime();
    runtime.dispatch(submit('do something'));
    const effects = runtime.dispatch({
      type: 'resolve_effect',
      id: 'eff-2',
      result: { web_request: { op: 'unknownOp' } },
    });
    expect(effects).toHaveLength(1);
    expect(effects[0]).toMatchObject({
      type: 'audit_append',
      event_type: 'runtime.unknown_web_request',
      risk: 'medium',
    });
    expect(effects.some((e) => e.type === 'storage_put')).toBe(false);
  });

  it('E2: web_request missing op emits protocol error', () => {
    const runtime = createReferenceRuntime();
    runtime.dispatch(submit('do something'));
    const effects = runtime.dispatch({
      type: 'resolve_effect',
      id: 'eff-2',
      result: { web_request: { query: 'hello' } },
    });
    expect(effects[0]).toMatchObject({
      type: 'audit_append',
      event_type: 'runtime.invalid_web_request',
      risk: 'medium',
    });
    expect(effects.some((e) => e.type === 'web_search')).toBe(false);
  });

  it('E2: web_request search with missing query emits protocol error', () => {
    const runtime = createReferenceRuntime();
    runtime.dispatch(submit('search something'));
    const effects = runtime.dispatch({
      type: 'resolve_effect',
      id: 'eff-2',
      result: { web_request: { op: 'search' } },
    });
    expect(effects[0]).toMatchObject({
      type: 'audit_append',
      event_type: 'runtime.invalid_web_request',
      risk: 'medium',
    });
    expect(effects.some((e) => e.type === 'web_search')).toBe(false);
  });

  it('E2: web_request readPage with missing url emits protocol error', () => {
    const runtime = createReferenceRuntime();
    runtime.dispatch(submit('read a page'));
    const effects = runtime.dispatch({
      type: 'resolve_effect',
      id: 'eff-2',
      result: { web_request: { op: 'readPage' } },
    });
    expect(effects[0]).toMatchObject({
      type: 'audit_append',
      event_type: 'runtime.invalid_web_request',
      risk: 'medium',
    });
    expect(effects.some((e) => e.type === 'web_page_read')).toBe(false);
  });

  it('E2: web_request search with empty query emits protocol error', () => {
    const runtime = createReferenceRuntime();
    runtime.dispatch(submit('search'));
    const effects = runtime.dispatch({
      type: 'resolve_effect',
      id: 'eff-2',
      result: { web_request: { op: 'search', query: '   ' } },
    });
    expect(effects[0]).toMatchObject({
      type: 'audit_append',
      event_type: 'runtime.invalid_web_request',
      risk: 'medium',
    });
  });

  it('A2: empty text result emits protocol error, not empty assistant message', () => {
    const runtime = createReferenceRuntime();
    runtime.dispatch(submit('hi'));
    const effects = runtime.dispatch({
      type: 'resolve_effect',
      id: 'eff-2',
      result: { text: '' },
    });
    expect(effects).toHaveLength(1);
    expect(effects[0]).toMatchObject({
      type: 'audit_append',
      event_type: 'runtime.invalid_empty_llm_result',
      risk: 'medium',
    });
    expect(effects.some((e) => e.type === 'storage_put')).toBe(false);
  });

  it('A2: unknown LLM result shape emits protocol error, not empty assistant message', () => {
    const runtime = createReferenceRuntime();
    runtime.dispatch(submit('hi'));
    const effects = runtime.dispatch({
      type: 'resolve_effect',
      id: 'eff-2',
      result: { unexpected_field: 'something' },
    });
    expect(effects).toHaveLength(1);
    expect(effects[0]).toMatchObject({
      type: 'audit_append',
      event_type: 'runtime.unknown_llm_result_shape',
      risk: 'high',
    });
    expect(effects.some((e) => e.type === 'storage_put')).toBe(false);
  });

  it('A2: web_search resolution stores result and continues with LLM request', () => {
    const runtime = createReferenceRuntime();
    runtime.dispatch(submit('search'));
    runtime.dispatch({
      type: 'resolve_effect',
      id: 'eff-2',
      result: { web_request: { op: 'search', query: 'rust async' } },
    });
    // Resolve the web_search effect
    const effects = runtime.dispatch({
      type: 'resolve_effect',
      id: 'eff-3',
      result: { text: 'search results here' },
    });
    expect(effects.some((e) => e.type === 'storage_put')).toBe(true);
    expect(effects.some((e) => e.type === 'llm_request')).toBe(true);
  });

  it('A2: plan/sandbox/web effect failure stores error note, no LLM continue', () => {
    const runtime = createReferenceRuntime();
    runtime.dispatch(submit('search'));
    runtime.dispatch({
      type: 'resolve_effect',
      id: 'eff-2',
      result: { web_request: { op: 'search', query: 'test' } },
    });
    const effects = runtime.dispatch({
      type: 'resolve_effect',
      id: 'eff-3',
      result: { ok: false, error: { kind: 'search_unavailable' } },
    });
    const put = effects.find((e) => e.type === 'storage_put');
    expect(put?.type).toBe('storage_put');
    if (put?.type === 'storage_put') {
      expect(put.value).toMatchObject({ role: 'tool' });
    }
    expect(effects.some((e) => e.type === 'llm_request')).toBe(false);
  });

  // G2 (FIX5): structured failure content in runtime follow-up path.
  it('G2: web_page_read host permission failure stores structured JSON content', () => {
    const runtime = createReferenceRuntime();
    runtime.dispatch(submit('read a page'));
    // LLM resolves with a web_page_read web_request
    runtime.dispatch({
      type: 'resolve_effect',
      id: 'eff-2',
      result: { web_request: { op: 'readPage', url: 'https://example.com' } },
    });
    // Effect resolves as a host_permission failure
    const effects = runtime.dispatch({
      type: 'resolve_effect',
      id: 'eff-3',
      result: {
        ok: false,
        error: {
          kind: 'host_permission_missing',
          message:
            'Page read could not run because host permission is missing.',
        },
      },
    });
    const put = effects.find((e) => e.type === 'storage_put');
    expect(put?.type).toBe('storage_put');
    if (put?.type === 'storage_put') {
      const val = put.value as { role: string; content: string };
      const parsed = JSON.parse(val.content) as Record<string, unknown>;
      expect(parsed.type).toBe('effect_failure');
      expect(parsed.kind).toBe('host_permission_missing');
      expect(typeof parsed.message).toBe('string');
    }
  });

  it('G2: web search missing key failure stores structured JSON content', () => {
    const runtime = createReferenceRuntime();
    runtime.dispatch(submit('search the web'));
    runtime.dispatch({
      type: 'resolve_effect',
      id: 'eff-2',
      result: { web_request: { op: 'search', query: 'test' } },
    });
    const effects = runtime.dispatch({
      type: 'resolve_effect',
      id: 'eff-3',
      result: {
        ok: false,
        error: { kind: 'search_unavailable', message: 'No search key set.' },
      },
    });
    const put = effects.find((e) => e.type === 'storage_put');
    expect(put?.type).toBe('storage_put');
    if (put?.type === 'storage_put') {
      const val = put.value as { role: string; content: string };
      const parsed = JSON.parse(val.content) as Record<string, unknown>;
      expect(parsed.type).toBe('effect_failure');
      expect(parsed.kind).toBe('search_unavailable');
    }
  });

  it('G2: failure content does not contain raw API key or stack trace', () => {
    const runtime = createReferenceRuntime();
    runtime.dispatch(submit('do something'));
    runtime.dispatch({
      type: 'resolve_effect',
      id: 'eff-2',
      result: { web_request: { op: 'search', query: 'q' } },
    });
    const effects = runtime.dispatch({
      type: 'resolve_effect',
      id: 'eff-3',
      result: {
        ok: false,
        error: {
          kind: 'auth_failed',
          message: 'Failed with key sk-abc123DEFghijklmno at line 42',
        },
      },
    });
    const put = effects.find((e) => e.type === 'storage_put');
    expect(put?.type).toBe('storage_put');
    if (put?.type === 'storage_put') {
      const val = put.value as { role: string; content: string };
      expect(val.content).not.toContain('sk-abc123DEFghijklmno');
      expect(val.content).not.toContain('at Object.');
    }
  });

  // B1 (FIX6): strict per-slot readPages validation in referenceRuntime

  it('B1: readPages with empty urls array emits invalid_web_request', () => {
    const runtime = createReferenceRuntime();
    runtime.dispatch(submit('readPages empty'));
    const effects = runtime.dispatch({
      type: 'resolve_effect',
      id: 'eff-2',
      result: { web_request: { op: 'readPages', urls: [] } },
    });
    expect(effects[0]?.type).toBe('audit_append');
    if (effects[0]?.type === 'audit_append') {
      expect(effects[0].event_type).toBe('runtime.invalid_web_request');
    }
  });

  it('B1: readPages with non-string slot emits invalid_web_request', () => {
    const runtime = createReferenceRuntime();
    runtime.dispatch(submit('readPages non-string'));
    const effects = runtime.dispatch({
      type: 'resolve_effect',
      id: 'eff-2',
      result: {
        web_request: { op: 'readPages', urls: ['https://ok.example', 42] },
      },
    });
    expect(effects[0]?.type).toBe('audit_append');
    if (effects[0]?.type === 'audit_append') {
      expect(effects[0].event_type).toBe('runtime.invalid_web_request');
      expect(effects[0].summary).toContain('urls[1]');
    }
  });

  it('B1: readPages with empty string slot emits invalid_web_request', () => {
    const runtime = createReferenceRuntime();
    runtime.dispatch(submit('readPages empty-slot'));
    const effects = runtime.dispatch({
      type: 'resolve_effect',
      id: 'eff-2',
      result: { web_request: { op: 'readPages', urls: [''] } },
    });
    expect(effects[0]?.type).toBe('audit_append');
    if (effects[0]?.type === 'audit_append') {
      expect(effects[0].event_type).toBe('runtime.invalid_web_request');
      expect(effects[0].summary).toContain('urls[0]');
    }
  });

  it('B1: readPages with localhost URL emits invalid_web_request', () => {
    const runtime = createReferenceRuntime();
    runtime.dispatch(submit('readPages unsafe'));
    const effects = runtime.dispatch({
      type: 'resolve_effect',
      id: 'eff-2',
      result: {
        web_request: { op: 'readPages', urls: ['http://localhost/secret'] },
      },
    });
    expect(effects[0]?.type).toBe('audit_append');
    if (effects[0]?.type === 'audit_append') {
      expect(effects[0].event_type).toBe('runtime.invalid_web_request');
    }
  });

  it('B1: readPages with valid public HTTPS URLs emits web_research', () => {
    const runtime = createReferenceRuntime();
    runtime.dispatch(submit('readPages valid'));
    const effects = runtime.dispatch({
      type: 'resolve_effect',
      id: 'eff-2',
      result: {
        web_request: {
          op: 'readPages',
          urls: ['https://a.example/', 'https://b.example/'],
        },
      },
    });
    expect(effects[0]?.type).toBe('web_research');
    if (effects[0]?.type === 'web_research') {
      const e = effects[0] as { type: string; mode: string; urls: string[] };
      expect(e.mode).toBe('urls');
      expect(e.urls).toHaveLength(2);
    }
  });

  // B3 (FIX7): invalid maxPages in web_request options.

  it('B3: readPages with maxPages 0 emits invalid_web_request', () => {
    const runtime = createReferenceRuntime();
    runtime.dispatch(submit('readPages maxPages 0'));
    const effects = runtime.dispatch({
      type: 'resolve_effect',
      id: 'eff-2',
      result: {
        web_request: {
          op: 'readPages',
          urls: ['https://a.example/'],
          options: { maxPages: 0 },
        },
      },
    });
    expect(effects[0]?.type).toBe('audit_append');
    if (effects[0]?.type === 'audit_append') {
      expect(effects[0].event_type).toBe('runtime.invalid_web_request');
    }
  });

  it('B3: readPages with maxPages -1 emits invalid_web_request', () => {
    const runtime = createReferenceRuntime();
    runtime.dispatch(submit('readPages maxPages -1'));
    const effects = runtime.dispatch({
      type: 'resolve_effect',
      id: 'eff-2',
      result: {
        web_request: {
          op: 'readPages',
          urls: ['https://a.example/'],
          options: { maxPages: -1 },
        },
      },
    });
    expect(effects[0]?.type).toBe('audit_append');
    if (effects[0]?.type === 'audit_append') {
      expect(effects[0].event_type).toBe('runtime.invalid_web_request');
    }
  });

  it('B3: readPages with valid maxPages 2 emits web_research', () => {
    const runtime = createReferenceRuntime();
    runtime.dispatch(submit('readPages maxPages 2'));
    const effects = runtime.dispatch({
      type: 'resolve_effect',
      id: 'eff-2',
      result: {
        web_request: {
          op: 'readPages',
          urls: ['https://a.example/', 'https://b.example/'],
          options: { maxPages: 2 },
        },
      },
    });
    expect(effects[0]?.type).toBe('web_research');
  });
});
