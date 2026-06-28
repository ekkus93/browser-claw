import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserClawDB } from '../db/db.ts';
import { MemoryContentStore } from '../workspace/contentStore.ts';
import { WorkspaceFs } from '../workspace/workspaceFs.ts';
import { runSandboxedScript } from './sandbox.ts';
import {
  buildSandboxHost,
  LimitTracker,
  type CapabilityAudit,
  type SandboxCapabilityContext,
} from './sandboxCapabilities.ts';
import type { ScriptCapabilities } from './scriptPolicy.ts';
import { TOOL_CAPABILITY_DESCRIPTORS, TOOL_REGISTRY } from '../tools/tools.ts';
import type { ToolCategory } from '../tools/tools.ts';

const db = new BrowserClawDB();
const dispatch = vi.fn();
let fs: WorkspaceFs;
let audits: CapabilityAudit[];
let ctx: SandboxCapabilityContext;

beforeEach(async () => {
  await db.open();
  await db.workspace_files.clear();
  await db.memories.clear();
  fs = new WorkspaceFs({ db, content: new MemoryContentStore() });
  audits = [];
  ctx = { fs, db, dispatch, onAudit: (e) => audits.push(e) };
});

afterEach(async () => {
  await db.workspace_files.clear();
  await db.memories.clear();
});

async function run(code: string, capabilities: ScriptCapabilities) {
  return runSandboxedScript(code, {
    host: buildSandboxHost(ctx, capabilities),
  });
}

describe('sandbox capability proxy — fs (D4)', () => {
  it('allows a file read within the read scope', async () => {
    await fs.createFile('/workspace/docs/a.md', 'hello', { actor: 'user' });
    const result = await run(
      'return await fs.readText("/workspace/docs/a.md");',
      {
        fsRead: ['/workspace/docs/**'],
      },
    );
    expect(result).toEqual({ ok: true, value: 'hello' });
    expect(audits).toContainEqual({
      capability: 'fs.readText',
      target: '/workspace/docs/a.md',
      allowed: true,
    });
  });

  it('denies a file read outside the read scope and audits it', async () => {
    await fs.createFile('/workspace/secret.md', 'top', { actor: 'user' });
    const result = await run(
      `try { await fs.readText("/workspace/secret.md"); return "leaked"; }
       catch (e) { return "denied:" + e.message; }`,
      { fsRead: ['/workspace/docs/**'] },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(String(result.value)).toMatch(/denied:/);
    expect(audits).toContainEqual({
      capability: 'fs.readText',
      target: '/workspace/secret.md',
      allowed: false,
      reason: 'path not in read scope',
    });
  });

  it('allows a write within the write scope and persists it', async () => {
    const result = await run(
      'await fs.writeText("/workspace/reports/out.md", "body"); return "ok";',
      { fsWrite: ['/workspace/reports/**'] },
    );
    expect(result).toEqual({ ok: true, value: 'ok' });
    expect(await fs.readText('/workspace/reports/out.md')).toBe('body');
  });

  it('denies a write outside the write scope', async () => {
    const result = await run(
      `try { await fs.writeText("/workspace/other.md", "x"); return "wrote"; }
       catch (e) { return "denied"; }`,
      { fsWrite: ['/workspace/reports/**'] },
    );
    expect(result).toEqual({ ok: true, value: 'denied' });
    expect(audits.some((a) => !a.allowed)).toBe(true);
  });

  it('does not expose the fs namespace without any fs capability', async () => {
    const result = await run('return typeof fs;', { webSearch: true });
    expect(result).toEqual({ ok: true, value: 'undefined' });
  });
});

describe('sandbox capability proxy — web (D4)', () => {
  const web = {
    search: vi.fn(() => Promise.resolve([{ title: 'A', url: 'https://x/a' }])),
    readPage: vi.fn(() =>
      Promise.resolve({
        url: 'https://x/a',
        finalUrl: 'https://x/a',
        text: 'body',
        length: 4,
      }),
    ),
    readPages: vi.fn(() =>
      Promise.resolve({
        query: '',
        results: [],
        pages: [],
        failures: [],
      }),
    ),
    research: vi.fn(),
  };

  it('allows a web read within the web read scope', async () => {
    const result = await runSandboxedScript(
      'const p = await web.readPage("https://x/a"); return p.text;',
      {
        host: buildSandboxHost({ ...ctx, web }, { webRead: ['https://x/**'] }),
      },
    );
    expect(result).toEqual({ ok: true, value: 'body' });
  });

  it('denies a web read outside the web read scope', async () => {
    const result = await runSandboxedScript(
      `try { await web.readPage("https://evil/a"); return "leaked"; }
       catch (e) { return "denied"; }`,
      {
        host: buildSandboxHost({ ...ctx, web }, { webRead: ['https://x/**'] }),
      },
    );
    expect(result).toEqual({ ok: true, value: 'denied' });
  });

  it('denies web.search without the webSearch capability', async () => {
    const result = await runSandboxedScript(
      `try { await web.search("q"); return "leaked"; } catch (e) { return "denied"; }`,
      // web namespace present (webRead granted) but webSearch is not.
      {
        host: buildSandboxHost({ ...ctx, web }, { webRead: ['https://x/**'] }),
      },
    );
    expect(result).toEqual({ ok: true, value: 'denied' });
  });
});

describe('sandbox capability proxy — memory + tool (D4)', () => {
  it('exposes memory.search only with the memoryRead capability', async () => {
    await db.memories.put({
      id: 'm1',
      title: 'Rust',
      text: 'ownership',
      tags: ['rust'],
      source: 'user',
      createdBy: 'user',
      createdAt: 1,
      pinned: false,
      sensitivity: 'normal',
    });
    const granted = await run(
      'const r = await memory.search({ query: "owner" }); return r.length;',
      { memoryRead: true },
    );
    expect(granted).toEqual({ ok: true, value: 1 });

    const ungranted = await run('return typeof memory;', {
      fsRead: ['/workspace/**'],
    });
    expect(ungranted).toEqual({ ok: true, value: 'undefined' });
  });

  it('routes tool.call through the permission model (requires webRead + mediated network — D2)', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response('<p>hi</p>')),
    ) as unknown as typeof fetch;
    // D2: Page Reader is a network tool and requires both webRead capability and
    // network: 'mediated'. The script must declare both alongside tools.
    const result = await runSandboxedScript(
      'return await tool.call("Page Reader", { url: "https://example.com" });',
      {
        host: buildSandboxHost(
          { ...ctx, toolCtx: { fetchImpl } },
          {
            tools: ['Page Reader'],
            network: 'mediated',
            webRead: ['https://example.com'],
          },
        ),
      },
    );
    expect(result).toEqual({ ok: true, value: 'hi' });
  });
});

// ---------------------------------------------------------------------------
// D1 — descriptor tests (in tools.ts, tested here for convenience)
// ---------------------------------------------------------------------------

const VALID_CATEGORIES: ToolCategory[] = [
  'pure',
  'network',
  'workspace_read',
  'workspace_write',
  'memory_read',
  'memory_write',
];

describe('D1 — ToolCapabilityDescriptor', () => {
  it('every registered tool has a descriptor', () => {
    const toolNames = Object.keys(TOOL_REGISTRY);
    expect(toolNames.length).toBeGreaterThan(0);
    for (const name of toolNames) {
      expect(TOOL_CAPABILITY_DESCRIPTORS[name]).toBeDefined();
    }
  });

  it('descriptor categories are all from the valid set', () => {
    for (const [, desc] of Object.entries(TOOL_CAPABILITY_DESCRIPTORS)) {
      for (const cat of desc.categories) {
        expect(VALID_CATEGORIES).toContain(cat);
      }
    }
  });

  it('network tools are in the network category and require webRead + mediatedNetwork', () => {
    for (const [, desc] of Object.entries(TOOL_CAPABILITY_DESCRIPTORS)) {
      if (desc.categories.includes('network')) {
        expect(desc.requires.mediatedNetwork).toBe(true);
        expect(desc.requires.webRead).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// D2 — cross-capability enforcement tests
// ---------------------------------------------------------------------------

describe('D2 — cross-capability enforcement in tool.call', () => {
  let d2Audits: CapabilityAudit[];
  let d2Ctx: SandboxCapabilityContext;

  beforeEach(async () => {
    const db2 = new BrowserClawDB();
    await db2.open();
    const fs2 = new WorkspaceFs({ db: db2, content: new MemoryContentStore() });
    d2Audits = [];
    d2Ctx = {
      fs: fs2,
      db: db2,
      dispatch: vi.fn(),
      onAudit: (e) => d2Audits.push(e),
    };
  });

  async function call(caps: ScriptCapabilities, toolName: string) {
    return runSandboxedScript(
      `return await tool.call(${JSON.stringify(toolName)}, {});`,
      { host: buildSandboxHost(d2Ctx, caps) },
    );
  }

  it('D2: Page Reader denied with only tools capability (no web)', async () => {
    const result = await call({ tools: ['Page Reader'] }, 'Page Reader');
    expect(result.ok).toBe(false);
    expect(d2Audits.some((a) => !a.allowed && a.target === 'Page Reader')).toBe(
      true,
    );
  });

  it('D2: Page Reader allowed with tools + network:mediated + webRead', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response('<p>ok</p>')),
    ) as unknown as typeof fetch;
    const result = await runSandboxedScript(
      'return await tool.call("Page Reader", { url: "https://example.com" });',
      {
        host: buildSandboxHost(
          { ...d2Ctx, toolCtx: { fetchImpl } },
          {
            tools: ['Page Reader'],
            network: 'mediated',
            webRead: ['https://example.com'],
          },
        ),
      },
    );
    expect(result).toEqual({ ok: true, value: 'ok' });
  });

  it('D2: pure tool (Remember) allowed with only tools capability', async () => {
    const result = await call({ tools: ['Remember'] }, 'Remember');
    // Remember needs db and title+text args to succeed, but it should pass the capability check.
    // The tool itself will fail (missing args), but not from a capability denial.
    expect(result.ok).toBe(false);
    const denied = d2Audits.some(
      (a) => !a.allowed && a.capability === 'tool.call',
    );
    expect(denied).toBe(false);
  });

  it('D2: denial is audited', async () => {
    await call({ tools: ['Page Reader'] }, 'Page Reader');
    expect(
      d2Audits.some((a) => a.capability === 'tool.call' && !a.allowed),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// D3 — maxToolCalls limit
// ---------------------------------------------------------------------------

describe('D3 — maxToolCalls limit', () => {
  it('D3: rejects tool.call when maxToolCalls is exceeded', () => {
    const tracker = new LimitTracker({
      timeoutMs: 5000,
      maxOutputBytes: 1024,
      maxFileReads: 10,
      maxFileWrites: 10,
      maxToolCalls: 1,
    });
    tracker.countToolCall(); // call 1 — allowed
    expect(() => tracker.countToolCall()).toThrow(/maxToolCalls/);
    expect(tracker.tripped).toMatch(/maxToolCalls/);
  });

  it('D3: maxToolCalls undefined means unlimited', () => {
    const tracker = new LimitTracker({
      timeoutMs: 5000,
      maxOutputBytes: 1024,
      maxFileReads: 10,
      maxFileWrites: 10,
    });
    for (let i = 0; i < 100; i++) tracker.countToolCall();
    expect(tracker.tripped).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// F3 — sandbox tool.call fail-closed args validation
// ---------------------------------------------------------------------------

describe('F3 — sandbox tool.call fail-closed args validation', () => {
  let f3Audits: CapabilityAudit[];
  let f3Ctx: SandboxCapabilityContext;

  beforeEach(async () => {
    const db3 = new BrowserClawDB();
    await db3.open();
    const fs3 = new WorkspaceFs({ db: db3, content: new MemoryContentStore() });
    f3Audits = [];
    f3Ctx = {
      fs: fs3,
      db: db3,
      dispatch: vi.fn(),
      onAudit: (e) => f3Audits.push(e),
    };
  });

  it('F3: sandbox tool.call with array args is denied and audited', async () => {
    const result = await runSandboxedScript(
      'return await tool.call("Remember", [1, 2, 3]);',
      { host: buildSandboxHost(f3Ctx, { tools: ['Remember'] }) },
    );
    expect(result.ok).toBe(false);
    const denied = f3Audits.some(
      (a) => !a.allowed && a.capability === 'tool.call',
    );
    expect(denied).toBe(true);
  });

  it('F3: sandbox tool.call with string args is denied and audited', async () => {
    const result = await runSandboxedScript(
      'return await tool.call("Remember", "bad args");',
      { host: buildSandboxHost(f3Ctx, { tools: ['Remember'] }) },
    );
    expect(result.ok).toBe(false);
    const denied = f3Audits.some(
      (a) => !a.allowed && a.capability === 'tool.call',
    );
    expect(denied).toBe(true);
  });

  it('F3: sandbox tool.call with undefined args is allowed (no-arg tool path)', async () => {
    const result = await runSandboxedScript(
      'return await tool.call("Remember", undefined);',
      { host: buildSandboxHost(f3Ctx, { tools: ['Remember'] }) },
    );
    // Tool itself may fail (missing required args), but no capability denial
    const capDenied = f3Audits.some(
      (a) => !a.allowed && a.capability === 'tool.call',
    );
    expect(capDenied).toBe(false);
    // result is ok:false because Remember needs title+text — but not from a denied args check
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// E1 — sensitive memory filtering in sandbox memory.search
// ---------------------------------------------------------------------------

describe('E1 — sensitive memory filtering', () => {
  async function searchMemories(query: string) {
    const audits: CapabilityAudit[] = [];
    const results = await runSandboxedScript(
      `const r = await memory.search({ query: ${JSON.stringify(query)} }); return r;`,
      {
        host: buildSandboxHost(
          { ...ctx, onAudit: (e) => audits.push(e) },
          { memoryRead: true },
        ),
      },
    );
    return { results, audits };
  }

  beforeEach(async () => {
    await db.memories.clear();
  });

  it('E1: normal memory is returned', async () => {
    await db.memories.put({
      id: 'e1n',
      title: 'Note',
      text: 'visible content',
      tags: [],
      source: 'user',
      createdBy: 'user',
      createdAt: 1,
      pinned: false,
      sensitivity: 'normal',
    });
    const { results } = await searchMemories('visible');
    expect(results.ok).toBe(true);
    if (results.ok) expect((results.value as unknown[]).length).toBe(1);
  });

  it('E1: pinned non-sensitive memory is returned', async () => {
    await db.memories.put({
      id: 'e1p',
      title: 'Pinned',
      text: 'pinned data',
      tags: [],
      source: 'user',
      createdBy: 'user',
      createdAt: 1,
      pinned: true,
      sensitivity: 'normal',
    });
    const { results } = await searchMemories('pinned');
    expect(results.ok).toBe(true);
    if (results.ok) expect((results.value as unknown[]).length).toBe(1);
  });

  it('E1: sensitive memory is excluded', async () => {
    await db.memories.put({
      id: 'e1s',
      title: 'Secret',
      text: 'my api key is abc123',
      tags: [],
      source: 'user',
      createdBy: 'user',
      createdAt: 1,
      pinned: false,
      sensitivity: 'sensitive',
    });
    const { results } = await searchMemories('api key');
    expect(results.ok).toBe(true);
    if (results.ok) expect((results.value as unknown[]).length).toBe(0);
  });

  it('E1: audit target contains ids only — no memory text', async () => {
    await db.memories.put({
      id: 'e1a',
      title: 'Audit Test',
      text: 'audit-check content',
      tags: [],
      source: 'user',
      createdBy: 'user',
      createdAt: 1,
      pinned: false,
      sensitivity: 'normal',
    });
    const { audits } = await searchMemories('audit-check');
    const memAudit = audits.find((a) => a.capability === 'memory.search');
    expect(memAudit).toBeDefined();
    // target should contain the id but not the memory text
    expect(memAudit?.target).toContain('e1a');
    expect(memAudit?.target).not.toContain('audit-check content');
  });
});

// ---------------------------------------------------------------------------
// H1 — Grep policy enforcement in sandbox fs.grep
// ---------------------------------------------------------------------------

describe('H1 — grep policy in sandbox fs.grep', () => {
  beforeEach(async () => {
    await ctx.fs.createFile('/workspace/h1.ts', 'const a = 1;\nconst b = 2;', {
      overwrite: true,
      actor: 'user',
    });
  });

  async function sandboxGrep(query: Record<string, unknown>) {
    return runSandboxedScript(
      `return await fs.grep(${JSON.stringify(query)});`,
      { host: buildSandboxHost(ctx, { fsRead: ['/workspace/**'] }) },
    );
  }

  it('H1: literal grep works by default', async () => {
    const result = await sandboxGrep({ pattern: 'const' });
    expect(result.ok).toBe(true);
    if (result.ok)
      expect((result.value as unknown[]).length).toBeGreaterThan(0);
  });

  it('H1: regex grep denied without capability', async () => {
    const result = await sandboxGrep({ pattern: '(const|let)', isRegex: true });
    expect(result.ok).toBe(false);
  });

  it('H1: excessive pattern length rejected', async () => {
    const result = await sandboxGrep({ pattern: 'x'.repeat(201) });
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// H1 (descriptor deny-by-default) — tool without descriptor cannot be called
// ---------------------------------------------------------------------------

describe('H1 — tool without descriptor is denied from sandbox', () => {
  it('H1: tool listed in allowedTools but missing descriptor is denied', async () => {
    const h1Audits: CapabilityAudit[] = [];
    const h1Ctx: SandboxCapabilityContext = {
      ...ctx,
      onAudit: (e) => h1Audits.push(e),
    };
    const result = await runSandboxedScript(
      'return await tool.call("UnregisteredTool", {});',
      {
        host: buildSandboxHost(h1Ctx, { tools: ['UnregisteredTool'] }),
      },
    );
    expect(result.ok).toBe(false);
    const denied = h1Audits.some(
      (a) =>
        !a.allowed &&
        a.capability === 'tool.call' &&
        a.target === 'UnregisteredTool',
    );
    expect(denied).toBe(true);
  });
});
