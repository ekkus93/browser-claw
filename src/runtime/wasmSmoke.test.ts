/**
 * A3 — WASM runtime smoke test.
 *
 * Proves the rebuilt WASM binary handles the same LLM result shapes as the
 * Rust unit tests and the TypeScript reference runtime.  Loads the real binary
 * via Node's fs + initSync (no fetch, no Vite transforms needed).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initSync, ClawRuntime } from './wasm/claw_wasm.js';

const wasmBinary = readFileSync(
  resolvePath(
    dirname(fileURLToPath(import.meta.url)),
    './wasm/claw_wasm_bg.wasm',
  ),
);
// initSync is idempotent — safe even if another test file also calls it.
initSync({ module: wasmBinary });

type AnyEffect = { type: string; [k: string]: unknown };

function dispatchResolve(
  rt: ClawRuntime,
  effectId: string,
  result: unknown,
): AnyEffect[] {
  return JSON.parse(
    rt.dispatch(JSON.stringify({ type: 'resolve_effect', id: effectId, result })),
  ) as AnyEffect[];
}

function submitAndGetLlmId(rt: ClawRuntime, text: string): string {
  rt.dispatch(
    JSON.stringify({
      type: 'submit_user_message',
      conversation_id: 'c1',
      text,
      skill_id: '',
    }),
  );
  return 'eff-2';
}

describe('A3: WASM runtime smoke — plan/script/web result shapes', () => {
  it('A3: plan result emits script_plan_proposal (not empty message)', () => {
    const rt = new ClawRuntime();
    const llmId = submitAndGetLlmId(rt, 'make a plan');
    const effects = dispatchResolve(rt, llmId, { plan: { steps: [] } });
    expect(effects.some((e) => e.type === 'script_plan_proposal')).toBe(true);
    expect(effects.some((e) => e.type === 'storage_put')).toBe(false);
  });

  it('A3: script_request result emits sandbox_script_proposal (not empty message)', () => {
    const rt = new ClawRuntime();
    const llmId = submitAndGetLlmId(rt, 'run a script');
    const effects = dispatchResolve(rt, llmId, {
      script_request: { type: 'browserclaw_script_request', version: 1 },
    });
    expect(effects.some((e) => e.type === 'sandbox_script_proposal')).toBe(true);
    expect(effects.some((e) => e.type === 'storage_put')).toBe(false);
  });

  it('A3: web_request search emits web_search with correct query', () => {
    const rt = new ClawRuntime();
    const llmId = submitAndGetLlmId(rt, 'search');
    const effects = dispatchResolve(rt, llmId, {
      web_request: { op: 'search', query: 'rust lang' },
    });
    const ws = effects.find((e) => e.type === 'web_search');
    expect(ws).toBeDefined();
    expect((ws as { query?: string }).query).toBe('rust lang');
  });

  it('A3: web_request readPage emits web_page_read (not empty message)', () => {
    const rt = new ClawRuntime();
    const llmId = submitAndGetLlmId(rt, 'read page');
    const effects = dispatchResolve(rt, llmId, {
      web_request: { op: 'readPage', url: 'https://example.com' },
    });
    const wr = effects.find((e) => e.type === 'web_page_read');
    expect(wr).toBeDefined();
    expect((wr as { url?: string }).url).toBe('https://example.com');
    expect(effects.some((e) => e.type === 'storage_put')).toBe(false);
  });

  it('A3: web_request readCurrentTab emits extension_request{op:read_current_tab}', () => {
    const rt = new ClawRuntime();
    const llmId = submitAndGetLlmId(rt, 'read current tab');
    const effects = dispatchResolve(rt, llmId, {
      web_request: { op: 'readCurrentTab' },
    });
    const er = effects.find((e) => e.type === 'extension_request');
    expect(er).toBeDefined();
    expect(
      (er as { request?: { op?: string } }).request?.op,
    ).toBe('read_current_tab');
    expect(effects.some((e) => e.type === 'storage_put')).toBe(false);
  });

  it('A3: unknown LLM result shape emits protocol error, not empty assistant message', () => {
    const rt = new ClawRuntime();
    const llmId = submitAndGetLlmId(rt, 'hi');
    const effects = dispatchResolve(rt, llmId, { unexpected_field: 'value' });
    expect(effects).toHaveLength(1);
    const e = effects[0];
    expect(e?.type).toBe('audit_append');
    expect((e as { event_type?: string }).event_type).toBe(
      'runtime.unknown_llm_result_shape',
    );
    expect(effects.some((f) => f.type === 'storage_put')).toBe(false);
  });
});
