import { describe, expect, it } from 'vitest';
import { runSandboxedScript } from './sandbox.ts';

// These run the REAL QuickJS interpreter. The host realm here is jsdom, which
// DOES have window/document/fetch/localStorage — so a passing escape test proves
// the VM genuinely cannot see the host's globals (isolation, not absence).

describe('runSandboxedScript — result marshalling (D3)', () => {
  it('returns a primitive result', async () => {
    const result = await runSandboxedScript('return 1 + 2;');
    expect(result).toEqual({ ok: true, value: 3 });
  });

  it('returns an object/array result', async () => {
    const result = await runSandboxedScript(
      'return { a: [1, 2], b: "x", c: true };',
    );
    expect(result).toEqual({ ok: true, value: { a: [1, 2], b: 'x', c: true } });
  });

  it('supports top-level await over a host function', async () => {
    const result = await runSandboxedScript('return await host.echo("hi");', {
      host: { host: { echo: (s) => `got:${String(s)}` } },
    });
    expect(result).toEqual({ ok: true, value: 'got:hi' });
  });
});

describe('runSandboxedScript — sandbox escape regression (D3, P0)', () => {
  const FORBIDDEN = [
    'window',
    'document',
    'localStorage',
    'sessionStorage',
    'indexedDB',
    'fetch',
    'XMLHttpRequest',
    'WebSocket',
    'EventSource',
    'chrome',
    'navigator',
    'importScripts',
    'WebAssembly',
  ];

  for (const name of FORBIDDEN) {
    it(`cannot access ${name}`, async () => {
      const result = await runSandboxedScript(
        `return typeof globalThis[${JSON.stringify(name)}];`,
      );
      expect(result).toEqual({ ok: true, value: 'undefined' });
    });
  }

  it('cannot read document.cookie', async () => {
    const result = await runSandboxedScript('return typeof document;');
    expect(result).toEqual({ ok: true, value: 'undefined' });
  });

  it('has no secrets or vault on the global', async () => {
    const result = await runSandboxedScript(
      'return typeof globalThis.SecretVault + "," + typeof globalThis.secrets;',
    );
    expect(result).toEqual({ ok: true, value: 'undefined,undefined' });
  });

  it('writing a sandbox global does not leak into the host realm', async () => {
    const marker = '__browserclaw_escape_probe__';
    await runSandboxedScript(`globalThis[${JSON.stringify(marker)}] = 42;`);
    expect((globalThis as Record<string, unknown>)[marker]).toBeUndefined();
  });

  it('only exposes mediated host functions, nothing else', async () => {
    const result = await runSandboxedScript(
      'return typeof fs + "," + typeof web + "," + typeof tool;',
      { host: { fs: { readText: () => '' } } },
    );
    // fs injected; web/tool absent -> still undefined.
    expect(result).toEqual({ ok: true, value: 'object,undefined,undefined' });
  });
});

describe('runSandboxedScript — errors and limits (D3)', () => {
  it('classifies a thrown script error', async () => {
    const result = await runSandboxedScript('throw new Error("boom");');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorKind).toBe('script_error');
      expect(result.error).toMatch(/boom/);
    }
  });

  it('propagates a host-function rejection into the script', async () => {
    const result = await runSandboxedScript(
      `try { await host.fail(); return "no-throw"; } catch (e) { return "caught:" + e.message; }`,
      {
        host: {
          host: {
            fail: () => {
              throw new Error('denied');
            },
          },
        },
      },
    );
    expect(result).toEqual({ ok: true, value: 'caught:denied' });
  });

  it('interrupts an infinite loop as a timeout', async () => {
    let t = 0;
    const now = () => {
      t += 10;
      return t;
    };
    const result = await runSandboxedScript('while (true) {}', {
      timeoutMs: 50,
      now,
    });
    expect(result).toEqual({
      ok: false,
      error: 'script timed out',
      errorKind: 'timeout',
    });
  });

  it('cancels via an aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runSandboxedScript('while (true) {}', {
      signal: controller.signal,
    });
    expect(result).toEqual({
      ok: false,
      error: 'script cancelled',
      errorKind: 'cancelled',
    });
  });
});
