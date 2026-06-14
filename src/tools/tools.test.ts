// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  parseToolCall,
  runToolCall,
  pageReaderTool,
  ToolNotPermittedError,
  UnknownToolError,
} from './tools.ts';

describe('parseToolCall', () => {
  it('parses a well-formed tool block', () => {
    const reply = [
      'Sure, let me look that up.',
      '```tool',
      '{ "tool": "Page Reader", "args": { "url": "https://example.com" } }',
      '```',
    ].join('\n');
    expect(parseToolCall(reply)).toEqual({
      name: 'Page Reader',
      args: { url: 'https://example.com' },
    });
  });

  it('defaults args to {} when omitted', () => {
    const reply = '```tool\n{ "tool": "Page Reader" }\n```';
    expect(parseToolCall(reply)).toEqual({ name: 'Page Reader', args: {} });
  });

  it('returns null when there is no tool block', () => {
    expect(parseToolCall('just a normal reply')).toBeNull();
  });

  it('returns null for malformed JSON or a missing tool name', () => {
    expect(parseToolCall('```tool\n{ not json }\n```')).toBeNull();
    expect(parseToolCall('```tool\n{ "args": {} }\n```')).toBeNull();
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
});
