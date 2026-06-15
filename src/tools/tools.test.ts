// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  parseToolCall,
  runToolCall,
  pageReaderTool,
  browserFetchTool,
  ToolNotPermittedError,
  UnknownToolError,
} from './tools.ts';
import type { BrowserClawDB } from '../db/db.ts';

describe('parseToolCall', () => {
  it('parses a well-formed tool block', () => {
    const reply = [
      'Sure, let me look that up.',
      '```tool',
      '{ "tool": "Page Reader", "args": { "url": "https://example.com" } }',
      '```',
    ].join('\n');
    expect(parseToolCall(reply)).toEqual({
      kind: 'tool_call',
      call: { name: 'Page Reader', args: { url: 'https://example.com' } },
    });
  });

  it('defaults args to {} when omitted', () => {
    const reply = '```tool\n{ "tool": "Page Reader" }\n```';
    expect(parseToolCall(reply)).toEqual({
      kind: 'tool_call',
      call: { name: 'Page Reader', args: {} },
    });
  });

  it('reports kind "none" when there is no tool block', () => {
    expect(parseToolCall('just a normal reply')).toEqual({ kind: 'none' });
  });

  it('reports kind "malformed" for invalid JSON (not silent text)', () => {
    expect(parseToolCall('```tool\n{ not json }\n```').kind).toBe('malformed');
  });

  it('reports kind "malformed" for a missing tool name', () => {
    expect(parseToolCall('```tool\n{ "args": {} }\n```').kind).toBe(
      'malformed',
    );
  });

  it('reports kind "malformed" when args is not an object', () => {
    expect(
      parseToolCall('```tool\n{ "tool": "x", "args": [1] }\n```').kind,
    ).toBe('malformed');
  });
});

describe('runToolCall — permission enforcement', () => {
  it('refuses a tool the caller did not declare', async () => {
    await expect(
      runToolCall(
        { name: 'Page Reader', args: { url: 'https://example.com' } },
        { allowedTools: ['File Reader'] },
      ),
    ).rejects.toBeInstanceOf(ToolNotPermittedError);
  });

  it('refuses a declared-but-unknown tool', async () => {
    await expect(
      runToolCall(
        { name: 'Teleporter', args: {} },
        { allowedTools: ['Teleporter'] },
      ),
    ).rejects.toBeInstanceOf(UnknownToolError);
  });

  it('runs a declared, registered tool', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response('<p>hello <b>world</b></p>')),
    ) as unknown as typeof fetch;
    const result = await runToolCall(
      { name: 'Page Reader', args: { url: 'https://example.com' } },
      { allowedTools: ['Page Reader'], ctx: { fetchImpl } },
    );
    expect(result).toBe('hello world');
  });
});

describe('Page Reader tool', () => {
  it('fetches and reduces a page to readable text (scripts stripped)', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        new Response(
          '<html><head><style>x{}</style></head><body><script>alert(1)</script><h1>Title</h1><p>Body text.</p></body></html>',
        ),
      ),
    ) as unknown as typeof fetch;
    const text = await pageReaderTool.run(
      { url: 'https://example.com' },
      { fetchImpl },
    );
    expect(text).toBe('Title Body text.');
    expect(text).not.toContain('alert');
  });

  it('rejects a non-http(s) URL', async () => {
    await expect(
      pageReaderTool.run({ url: 'file:///etc/passwd' }, {}),
    ).rejects.toThrow(/http\(s\)/i);
  });

  it('rejects an invalid URL', async () => {
    await expect(pageReaderTool.run({ url: 'not a url' }, {})).rejects.toThrow(
      /valid URL/i,
    );
  });

  it('reports a non-ok response', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response('nope', { status: 404 })),
    ) as unknown as typeof fetch;
    await expect(
      pageReaderTool.run({ url: 'https://example.com' }, { fetchImpl }),
    ).rejects.toThrow(/404/);
  });

  it('blocks a private/loopback target and audits web.fetch_blocked (A1.4)', async () => {
    const dispatch = vi.fn();
    const put = vi.fn().mockResolvedValue(undefined);
    const db = { audit_events: { put } } as unknown as BrowserClawDB;
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    await expect(
      pageReaderTool.run(
        { url: 'http://127.0.0.1/' },
        { fetchImpl, db, dispatch },
      ),
    ).rejects.toThrow(/blocked host/i);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalled();
    expect(put).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'web.fetch_blocked', status: 'failure' }),
    );
  });

  it('blocks the cloud metadata IP', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(
      pageReaderTool.run({ url: 'http://169.254.169.254/' }, { fetchImpl }),
    ).rejects.toThrow(/blocked host/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('times out a slow fetch via AbortController', async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    ) as unknown as typeof fetch;
    await expect(
      pageReaderTool.run(
        { url: 'https://example.com' },
        { fetchImpl, timeoutMs: 5 },
      ),
    ).rejects.toThrow(/timed out/i);
  });

  it('rejects an oversized response before buffering it', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        new Response('x', { headers: { 'content-length': '5000000' } }),
      ),
    ) as unknown as typeof fetch;
    await expect(
      pageReaderTool.run({ url: 'https://example.com' }, { fetchImpl }),
    ).rejects.toThrow(/too large/i);
  });

  it('omits credentials on the fetch', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response('<p>ok</p>')),
    ) as unknown as typeof fetch;
    await pageReaderTool.run({ url: 'https://example.com' }, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://example.com/',
      expect.objectContaining({ credentials: 'omit' }),
    );
  });
});

describe('Browser Fetch tool (E3, CORS-limited)', () => {
  it('returns the raw body for a CORS-enabled response', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response('{"ok":true}')),
    ) as unknown as typeof fetch;
    const text = await browserFetchTool.run(
      { url: 'https://api.example.com/data' },
      { fetchImpl },
    );
    expect(text).toBe('{"ok":true}');
    // Raw body — NOT reduced to readable text like Page Reader.
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.com/data',
      expect.objectContaining({ credentials: 'omit' }),
    );
  });

  it('blocks a private/loopback target', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(
      browserFetchTool.run({ url: 'http://127.0.0.1/' }, { fetchImpl }),
    ).rejects.toThrow(/blocked host/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('surfaces a CORS/network failure visibly', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.reject(new TypeError('Failed to fetch')),
    ) as unknown as typeof fetch;
    await expect(
      browserFetchTool.run({ url: 'https://api.example.com/x' }, { fetchImpl }),
    ).rejects.toThrow(/network\/CORS/i);
  });

  it('enforces the byte cap', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        new Response('x', { headers: { 'content-length': '5000000' } }),
      ),
    ) as unknown as typeof fetch;
    await expect(
      browserFetchTool.run(
        { url: 'https://api.example.com/big' },
        { fetchImpl },
      ),
    ).rejects.toThrow(/too large/i);
  });

  it('times out via AbortController', async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    ) as unknown as typeof fetch;
    await expect(
      browserFetchTool.run(
        { url: 'https://api.example.com/slow' },
        { fetchImpl, timeoutMs: 5 },
      ),
    ).rejects.toThrow(/timed out/i);
  });
});
