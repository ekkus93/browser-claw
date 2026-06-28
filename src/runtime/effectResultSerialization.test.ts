/**
 * B1/B3 — toolContentFromEffectResult tests.
 *
 * Verifies that structured effect results become non-empty tool content and
 * that empty/unrecognized success results fail visibly (never store "").
 */

import { describe, expect, it } from 'vitest';
import { toolContentFromEffectResult } from './effectResultSerialization.ts';

describe('B1 — toolContentFromEffectResult', () => {
  // --- plain text ---

  it('B1: { text } → content = text', () => {
    const r = toolContentFromEffectResult({ text: 'Hello world' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.content).toBe('Hello world');
  });

  it('B1: { text: "" } → empty_effect_result', () => {
    const r = toolContentFromEffectResult({ text: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('empty_effect_result');
  });

  it('B1: { text: "   " } (whitespace-only) → empty_effect_result', () => {
    const r = toolContentFromEffectResult({ text: '   ' });
    expect(r.ok).toBe(false);
  });

  // --- web search results ---

  it('B1: { results } → non-empty web_search_results JSON', () => {
    const results = [{ title: 'A', url: 'https://a.com', rank: 1 }];
    const r = toolContentFromEffectResult({ ok: true, results });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const parsed = JSON.parse(r.content) as Record<string, unknown>;
      expect(parsed.type).toBe('web_search_results');
      expect(Array.isArray(parsed.results)).toBe(true);
    }
  });

  it('B1: { results: [] } → non-empty content (empty array is still valid)', () => {
    const r = toolContentFromEffectResult({ ok: true, results: [] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.content.length).toBeGreaterThan(0);
    }
  });

  // --- page content ---

  it('B1: { content: {...} } → non-empty web_page_content JSON', () => {
    const content = { url: 'https://x.com', text: 'body text', length: 9 };
    const r = toolContentFromEffectResult({ ok: true, content });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const parsed = JSON.parse(r.content) as Record<string, unknown>;
      expect(parsed.type).toBe('web_page_content');
    }
  });

  // --- multi-page contents ---

  it('B1: { contents: [...] } → non-empty web_pages_content JSON', () => {
    const contents = [
      { url: 'https://a.com', text: 'a' },
      { url: 'https://b.com', text: 'b' },
    ];
    const r = toolContentFromEffectResult({ ok: true, contents });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const parsed = JSON.parse(r.content) as Record<string, unknown>;
      expect(parsed.type).toBe('web_pages_content');
    }
  });

  // --- research bundle ---

  it('B1: { bundle: {...} } → non-empty web_research_bundle JSON', () => {
    const bundle = { pages: [], failures: [], query: 'test' };
    const r = toolContentFromEffectResult({ ok: true, bundle });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const parsed = JSON.parse(r.content) as Record<string, unknown>;
      expect(parsed.type).toBe('web_research_bundle');
    }
  });

  // --- extension response ---

  it('B1: { response: {...} } → non-empty extension_response JSON', () => {
    const response = { ok: true, status: 'connected', version: '1.0.0' };
    const r = toolContentFromEffectResult({ ok: true, response });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const parsed = JSON.parse(r.content) as Record<string, unknown>;
      expect(parsed.type).toBe('extension_response');
    }
  });

  // --- plan outputs ---

  it('B1: { outputs: [...] } → non-empty plan_outputs JSON', () => {
    const outputs = [{ step: 'search', result: 'done' }];
    const r = toolContentFromEffectResult({ ok: true, outputs });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const parsed = JSON.parse(r.content) as Record<string, unknown>;
      expect(parsed.type).toBe('plan_outputs');
    }
  });

  // --- script result value ---

  it('B1: { value: "hello" } → non-empty script_result JSON', () => {
    const r = toolContentFromEffectResult({ ok: true, value: 'hello' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const parsed = JSON.parse(r.content) as Record<string, unknown>;
      expect(parsed.type).toBe('script_result');
    }
  });

  it('B1: { value: null } → non-empty script_result JSON', () => {
    const r = toolContentFromEffectResult({ ok: true, value: null });
    expect(r.ok).toBe(true);
  });

  // --- empty/unrecognized ---

  it('B1: { ok: true } (no content field) → empty_effect_result', () => {
    const r = toolContentFromEffectResult({ ok: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('empty_effect_result');
  });

  it('B1: null → unsupported_effect_result', () => {
    const r = toolContentFromEffectResult(null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('unsupported_effect_result');
  });

  it('B1: array → unsupported_effect_result', () => {
    const r = toolContentFromEffectResult([1, 2, 3]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('unsupported_effect_result');
  });

  it('B1: string → unsupported_effect_result', () => {
    const r = toolContentFromEffectResult('text');
    expect(r.ok).toBe(false);
  });
});

describe('B3 — no empty tool message regression (via referenceRuntime)', () => {
  // These tests use referenceRuntime directly to ensure the integration is correct.
  // A resolved web effect with structured result must produce non-empty tool content.

  it('B3: web_search { results } effect resolution stores non-empty tool content', async () => {
    const { createReferenceRuntime } = await import('./referenceRuntime.ts');
    const rt = createReferenceRuntime();

    // Submit a user message to get an llm_request effect
    const effects1 = rt.dispatch({
      type: 'submit_user_message',
      text: 'search for something',
      conversation_id: 'c1',
    });
    const llmEff = effects1.find((e) => e.type === 'llm_request');
    expect(llmEff).toBeDefined();

    // LLM returns a web_request with op=search
    const effects2 = rt.dispatch({
      type: 'resolve_effect',
      id: llmEff!.id,
      result: { web_request: { op: 'search', query: 'test query' } },
    });
    const webSearchEff = effects2.find((e) => e.type === 'web_search');
    expect(webSearchEff).toBeDefined();

    // Host resolves the web_search with structured results
    const effects3 = rt.dispatch({
      type: 'resolve_effect',
      id: webSearchEff!.id,
      result: {
        ok: true,
        results: [{ title: 'A', url: 'https://a.com', rank: 1 }],
      },
    });
    const storagePut = effects3.find((e) => e.type === 'storage_put');
    expect(storagePut).toBeDefined();
    const put = storagePut as {
      type: 'storage_put';
      value: { content: string };
    };
    expect(put.value.content.length).toBeGreaterThan(0);
    expect(put.value.content).toContain('web_search_results');
  });

  it('B3: web_page_read { content } effect resolution stores non-empty tool content', async () => {
    const { createReferenceRuntime } = await import('./referenceRuntime.ts');
    const rt = createReferenceRuntime();

    const effects1 = rt.dispatch({
      type: 'submit_user_message',
      text: 'read a page',
      conversation_id: 'c1',
    });
    const llmEff = effects1.find((e) => e.type === 'llm_request');

    const effects2 = rt.dispatch({
      type: 'resolve_effect',
      id: llmEff!.id,
      result: { web_request: { op: 'readPage', url: 'https://example.com/' } },
    });
    const pageReadEff = effects2.find((e) => e.type === 'web_page_read');
    expect(pageReadEff).toBeDefined();

    const effects3 = rt.dispatch({
      type: 'resolve_effect',
      id: pageReadEff!.id,
      result: {
        ok: true,
        content: { url: 'https://example.com/', text: 'Page body', length: 9 },
      },
    });
    const storagePut = effects3.find((e) => e.type === 'storage_put');
    expect(storagePut).toBeDefined();
    const put = storagePut as {
      type: 'storage_put';
      value: { content: string };
    };
    expect(put.value.content.length).toBeGreaterThan(0);
    expect(put.value.content).toContain('web_page_content');
  });

  it('B3: empty success result { ok: true } audits empty_effect_result — no storage_put', async () => {
    const { createReferenceRuntime } = await import('./referenceRuntime.ts');
    const rt = createReferenceRuntime();

    const effects1 = rt.dispatch({
      type: 'submit_user_message',
      text: 'search',
      conversation_id: 'c1',
    });
    const llmEff = effects1.find((e) => e.type === 'llm_request');

    const effects2 = rt.dispatch({
      type: 'resolve_effect',
      id: llmEff!.id,
      result: { web_request: { op: 'search', query: 'q' } },
    });
    const webSearchEff = effects2.find((e) => e.type === 'web_search');

    // Resolve with empty success — no recognized content field
    const effects3 = rt.dispatch({
      type: 'resolve_effect',
      id: webSearchEff!.id,
      result: { ok: true },
    });
    // Must NOT produce a storage_put (would store empty content)
    expect(effects3.find((e) => e.type === 'storage_put')).toBeUndefined();
    // Must produce an audit event
    const audit = effects3.find((e) => e.type === 'audit_append');
    expect(audit).toBeDefined();
    const auditEff = audit as { type: 'audit_append'; event_type: string };
    expect(auditEff.event_type).toBe('runtime.empty_effect_result');
  });

  it('B3: no follow-up llm_request issued when result serialization fails', async () => {
    const { createReferenceRuntime } = await import('./referenceRuntime.ts');
    const rt = createReferenceRuntime();

    const effects1 = rt.dispatch({
      type: 'submit_user_message',
      text: 'research',
      conversation_id: 'c1',
    });
    const llmEff = effects1.find((e) => e.type === 'llm_request');

    const effects2 = rt.dispatch({
      type: 'resolve_effect',
      id: llmEff!.id,
      result: { web_request: { op: 'search', query: 'q' } },
    });
    const webEff = effects2.find((e) => e.type === 'web_search');

    const effects3 = rt.dispatch({
      type: 'resolve_effect',
      id: webEff!.id,
      result: { ok: true }, // empty success
    });
    // No llm_request should follow an empty result
    expect(effects3.find((e) => e.type === 'llm_request')).toBeUndefined();
  });
});
