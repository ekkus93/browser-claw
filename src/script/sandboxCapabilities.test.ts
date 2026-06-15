import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserClawDB } from '../db/db.ts';
import { MemoryContentStore } from '../workspace/contentStore.ts';
import { WorkspaceFs } from '../workspace/workspaceFs.ts';
import { runSandboxedScript } from './sandbox.ts';
import {
  buildSandboxHost,
  type CapabilityAudit,
  type SandboxCapabilityContext,
} from './sandboxCapabilities.ts';
import type { ScriptCapabilities } from './scriptPolicy.ts';

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

  it('routes tool.call through the permission model', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response('<p>hi</p>')),
    ) as unknown as typeof fetch;
    const result = await runSandboxedScript(
      'return await tool.call("Page Reader", { url: "https://example.com" });',
      {
        host: buildSandboxHost(
          { ...ctx, toolCtx: { fetchImpl } },
          { tools: ['Page Reader'] },
        ),
      },
    );
    expect(result).toEqual({ ok: true, value: 'hi' });
  });
});
