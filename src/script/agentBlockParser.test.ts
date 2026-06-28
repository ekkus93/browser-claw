import { describe, expect, it } from 'vitest';
import { parseAgentActionBlock } from './agentBlockParser.ts';

const VALID_PLAN = JSON.stringify({
  type: 'browserclaw_plan',
  version: 1,
  title: 'Read a file',
  reason: 'The user asked to read a file',
  steps: [{ id: 's1', op: 'fs.readText', path: '/workspace/a.md' }],
});

const VALID_SCRIPT = JSON.stringify({
  type: 'browserclaw_script_request',
  version: 1,
  runtime: 'sandboxed_script',
  title: 'Compute sum',
  reason: 'User asked to compute a sum',
  code: 'return 42;',
  capabilities: {},
  limits: {
    timeoutMs: 5000,
    maxOutputBytes: 1024,
    maxFileReads: 10,
    maxFileWrites: 1,
  },
});

const VALID_WEB_READ = JSON.stringify({
  type: 'browserclaw_web_request',
  version: 1,
  op: 'readPage',
  url: 'https://example.com/article',
});

const VALID_WEB_SEARCH = JSON.stringify({
  type: 'browserclaw_web_request',
  version: 1,
  op: 'search',
  query: 'latest AI news',
});

function block(lang: string, body: string): string {
  return `\`\`\`${lang}\n${body}\n\`\`\``;
}

describe('parseAgentActionBlock (FIX1-C1/C2)', () => {
  it('no block → kind:none', () => {
    const r = parseAgentActionBlock('Hello, world!');
    expect(r.kind).toBe('none');
    if (r.kind === 'none') expect(r.text).toBe('Hello, world!');
  });

  it('valid tool block → kind:tool_call', () => {
    const reply = block(
      'tool',
      JSON.stringify({ tool: 'fs_read', args: { path: '/a' } }),
    );
    const r = parseAgentActionBlock(reply);
    expect(r.kind).toBe('tool_call');
    if (r.kind === 'tool_call') expect(r.call.name).toBe('fs_read');
  });

  it('valid plan block → kind:plan', () => {
    const r = parseAgentActionBlock(block('browserclaw-plan', VALID_PLAN));
    expect(r.kind).toBe('plan');
    if (r.kind === 'plan') {
      expect(r.plan.type).toBe('browserclaw_plan');
      expect(r.plan.steps).toHaveLength(1);
    }
  });

  it('valid script block → kind:script_request', () => {
    const r = parseAgentActionBlock(block('browserclaw-script', VALID_SCRIPT));
    expect(r.kind).toBe('script_request');
    if (r.kind === 'script_request') {
      expect(r.request.type).toBe('browserclaw_script_request');
    }
  });

  it('valid web readPage block → kind:web_request', () => {
    const r = parseAgentActionBlock(block('browserclaw-web', VALID_WEB_READ));
    expect(r.kind).toBe('web_request');
    if (r.kind === 'web_request') {
      expect(r.request.op).toBe('readPage');
      expect(r.request.url).toBe('https://example.com/article');
    }
  });

  it('valid web search block → kind:web_request', () => {
    const r = parseAgentActionBlock(block('browserclaw-web', VALID_WEB_SEARCH));
    expect(r.kind).toBe('web_request');
    if (r.kind === 'web_request') {
      expect(r.request.op).toBe('search');
      expect(r.request.query).toBe('latest AI news');
    }
  });

  it('invalid JSON in a plan block → kind:malformed', () => {
    const r = parseAgentActionBlock(block('browserclaw-plan', '{ not json }'));
    expect(r.kind).toBe('malformed');
    if (r.kind === 'malformed') {
      expect(r.blockType).toBe('browserclaw-plan');
      expect(r.message).toMatch(/not valid JSON/);
    }
  });

  it('valid JSON but invalid schema in plan block → kind:malformed', () => {
    const r = parseAgentActionBlock(
      block(
        'browserclaw-plan',
        JSON.stringify({
          type: 'browserclaw_plan',
          version: 1,
          steps: 'not-array',
        }),
      ),
    );
    expect(r.kind).toBe('malformed');
    if (r.kind === 'malformed') expect(r.blockType).toBe('browserclaw-plan');
  });

  it('multiple actionable blocks → kind:malformed', () => {
    const text =
      block('browserclaw-plan', VALID_PLAN) +
      '\n' +
      block('browserclaw-script', VALID_SCRIPT);
    const r = parseAgentActionBlock(text);
    expect(r.kind).toBe('malformed');
    if (r.kind === 'malformed') {
      expect(r.blockType).toBe('multiple');
      expect(r.message).toMatch(/exactly one/);
    }
  });

  it('unknown browserclaw-* block type → kind:malformed', () => {
    const r = parseAgentActionBlock(
      block('browserclaw-unknown', '{"hello": true}'),
    );
    expect(r.kind).toBe('malformed');
    if (r.kind === 'malformed') {
      expect(r.blockType).toBe('browserclaw-unknown');
      expect(r.message).toMatch(/Unsupported/);
    }
  });

  it('web readPage with blocked URL → kind:malformed', () => {
    const blocked = JSON.stringify({
      type: 'browserclaw_web_request',
      version: 1,
      op: 'readPage',
      url: 'http://localhost/admin',
    });
    const r = parseAgentActionBlock(block('browserclaw-web', blocked));
    expect(r.kind).toBe('malformed');
    if (r.kind === 'malformed') expect(r.message).toMatch(/blocked/);
  });
});
