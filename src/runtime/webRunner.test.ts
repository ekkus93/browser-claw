import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserClawDB } from '../db/db.ts';
import type { WebResearchService } from '../webresearch/types.ts';
import {
  createWebEffectHandler,
  runApprovedBulkResearch,
  runApprovedWebPageRead,
  type WebEffectDeps,
} from './webRunner.ts';

const db = new BrowserClawDB();
const submit = vi.fn().mockResolvedValue(undefined);
const dispatch = vi.fn();

function makeWeb(over: Partial<WebResearchService> = {}): WebResearchService {
  const bundle = {
    query: 'q',
    results: [{ title: 'A', url: 'https://example.com/a' }],
    pages: [
      {
        url: 'https://example.com/a',
        finalUrl: 'https://example.com/a',
        text: 'body',
        length: 4,
      },
    ],
    failures: [],
  };
  return {
    search: vi.fn(() =>
      Promise.resolve([{ title: 'A', url: 'https://example.com/a' }]),
    ),
    readPage: vi.fn(() =>
      Promise.resolve({
        url: 'https://example.com/a',
        finalUrl: 'https://example.com/a',
        text: 'body',
        length: 4,
      }),
    ),
    readPages: vi.fn(() => Promise.resolve(bundle)),
    research: vi.fn(() => Promise.resolve(bundle)),
    ...over,
  };
}

function deps(web = makeWeb()): WebEffectDeps {
  return { web, db, dispatch, submit };
}

beforeEach(async () => {
  await db.open();
  await db.audit_events.clear();
  submit.mockClear();
  dispatch.mockClear();
});

afterEach(async () => {
  await db.audit_events.clear();
});

async function auditTypes(): Promise<string[]> {
  return (await db.audit_events.toArray()).map((e) => e.type);
}

describe('createWebEffectHandler (F3)', () => {
  it('runs a search directly and resolves with results', async () => {
    const handle = createWebEffectHandler(deps());
    await handle({ type: 'web_search', id: 's1', query: 'opfs' });
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'approvals/approvalRequested' }),
    );
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 's1',
        result: expect.objectContaining({ ok: true }),
      }),
    );
    expect(await auditTypes()).toContain('web.search_completed');
  });

  it('D1: web_search effect resolves ok:false when search provider missing', async () => {
    const web = makeWeb({
      search: vi.fn().mockRejectedValue(
        Object.assign(new Error('No search provider is configured.'), {
          kind: 'search_unavailable',
        }),
      ),
    });
    const handle = createWebEffectHandler(deps(web));
    await handle({ type: 'web_search', id: 's2', query: 'missing' });
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 's2',
        result: expect.objectContaining({ ok: false }),
      }),
    );
    expect(await auditTypes()).toContain('web.search_failed');
  });

  it('queues a page read for approval, fetching nothing yet', async () => {
    const web = makeWeb();
    const handle = createWebEffectHandler(deps(web));
    await handle({
      type: 'web_page_read',
      id: 'p1',
      url: 'https://example.com/a',
    });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'approvals/approvalRequested',
        payload: expect.objectContaining({ id: 'p1', kind: 'web_page_read' }),
      }),
    );
    expect(web.readPage).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it('rejects a disallowed page-read URL outright', async () => {
    const handle = createWebEffectHandler(deps());
    await handle({
      type: 'web_page_read',
      id: 'p2',
      url: 'http://localhost/admin',
    });
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({ ok: false }),
      }),
    );
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('gates a bulk research run behind approval (reads nothing yet)', async () => {
    const web = makeWeb();
    const handle = createWebEffectHandler(deps(web));
    await handle({
      type: 'web_research',
      id: 'r1',
      mode: 'query',
      query: 'opfs',
      options: { maxPages: 3 },
    });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'approvals/approvalRequested',
        payload: expect.objectContaining({ id: 'r1', kind: 'bulk_research' }),
      }),
    );
    expect(web.research).not.toHaveBeenCalled();
  });
});

describe('runApprovedWebPageRead (F3)', () => {
  it('reads an approved page and resolves with the content', async () => {
    const web = makeWeb();
    await runApprovedWebPageRead(deps(web), {
      id: 'p3',
      status: 'approved',
      payloadPreview: JSON.stringify({ url: 'https://example.com/a' }),
    });
    expect(web.readPage).toHaveBeenCalled();
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'p3',
        result: expect.objectContaining({ ok: true }),
      }),
    );
    expect(await auditTypes()).toContain('web.page_read_completed');
  });

  it('declines a rejected page read and audits it', async () => {
    const web = makeWeb();
    await runApprovedWebPageRead(deps(web), {
      id: 'p4',
      status: 'rejected',
      payloadPreview: JSON.stringify({ url: 'https://example.com/a' }),
    });
    expect(web.readPage).not.toHaveBeenCalled();
    expect(submit).toHaveBeenCalledWith({
      type: 'resolve_effect',
      id: 'p4',
      result: { ok: false, error: { kind: 'user_rejected' } },
    });
    expect(await auditTypes()).toContain('web.page_read_rejected');
  });

  it('surfaces a reader failure as an error result', async () => {
    const web = makeWeb({
      readPage: vi.fn(() => Promise.reject(new Error('navigation_failed'))),
    });
    await runApprovedWebPageRead(deps(web), {
      id: 'p5',
      status: 'approved',
      payloadPreview: JSON.stringify({ url: 'https://example.com/a' }),
    });
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({ ok: false }),
      }),
    );
    expect(await auditTypes()).toContain('web.page_read_failed');
  });

  // G1 (FIX3): strict payload parsing — fail-closed on malformed/missing URL.
  it('G1: malformed JSON payload does not call readPage', async () => {
    const web = makeWeb();
    await runApprovedWebPageRead(deps(web), {
      id: 'g1-bad-json',
      status: 'approved',
      payloadPreview: 'not-valid-json{{{',
    });
    expect(web.readPage).not.toHaveBeenCalled();
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({
          ok: false,
          error: expect.objectContaining({ kind: 'approval_payload_invalid' }),
        }),
      }),
    );
    expect(await auditTypes()).toContain('web.page_read_payload_invalid');
  });

  it('G1: missing url field does not call readPage', async () => {
    const web = makeWeb();
    await runApprovedWebPageRead(deps(web), {
      id: 'g1-no-url',
      status: 'approved',
      payloadPreview: JSON.stringify({ options: {} }),
    });
    expect(web.readPage).not.toHaveBeenCalled();
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({ ok: false }),
      }),
    );
    expect(await auditTypes()).toContain('web.page_read_payload_invalid');
  });

  it('G1: empty url string does not call readPage', async () => {
    const web = makeWeb();
    await runApprovedWebPageRead(deps(web), {
      id: 'g1-empty-url',
      status: 'approved',
      payloadPreview: JSON.stringify({ url: '' }),
    });
    expect(web.readPage).not.toHaveBeenCalled();
    expect(await auditTypes()).toContain('web.page_read_payload_invalid');
  });

  it('G1: audit on payload invalid does not include url value in summary', async () => {
    const web = makeWeb();
    await runApprovedWebPageRead(deps(web), {
      id: 'g1-no-secret',
      status: 'approved',
      // Missing url field so requireStringField throws; summary must not echo payload.
      payloadPreview: JSON.stringify({ notAUrl: 'SECRET_VALUE' }),
    });
    const rows = await db.audit_events.toArray();
    const invalidAudit = rows.find(
      (a) => a.type === 'web.page_read_payload_invalid',
    );
    expect(invalidAudit).toBeDefined();
    expect(invalidAudit?.summary).not.toContain('SECRET_VALUE');
  });
});

describe('runApprovedBulkResearch (F3)', () => {
  it('runs the research bundle on approval', async () => {
    const web = makeWeb();
    await runApprovedBulkResearch(deps(web), {
      id: 'r2',
      status: 'approved',
      payloadPreview: JSON.stringify({
        query: 'opfs',
        options: { maxPages: 2 },
      }),
    });
    expect(web.research).toHaveBeenCalled();
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'r2',
        result: expect.objectContaining({ ok: true }),
      }),
    );
    expect(await auditTypes()).toContain('web.research_completed');
  });

  it('declines a rejected research run', async () => {
    const web = makeWeb();
    await runApprovedBulkResearch(deps(web), {
      id: 'r3',
      status: 'rejected',
      payloadPreview: JSON.stringify({ query: 'opfs' }),
    });
    expect(web.research).not.toHaveBeenCalled();
    expect(await auditTypes()).toContain('web.research_rejected');
  });

  it('F2: malformed payload does not call research and audits invalid', async () => {
    const web = makeWeb();
    await runApprovedBulkResearch(deps(web), {
      id: 'f2-a',
      status: 'approved',
      payloadPreview: '{not json}',
    });
    expect(web.research).not.toHaveBeenCalled();
    expect(await auditTypes()).toContain('web.bulk_research_payload_invalid');
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'f2-a',
        result: expect.objectContaining({ ok: false }),
      }),
    );
  });

  it('F2: missing payload does not call research and audits invalid', async () => {
    const web = makeWeb();
    await runApprovedBulkResearch(deps(web), {
      id: 'f2-b',
      status: 'approved',
    });
    expect(web.research).not.toHaveBeenCalled();
    expect(await auditTypes()).toContain('web.bulk_research_payload_invalid');
  });

  it('F2: missing query does not call research and audits invalid', async () => {
    const web = makeWeb();
    await runApprovedBulkResearch(deps(web), {
      id: 'f2-c',
      status: 'approved',
      payloadPreview: JSON.stringify({ options: { maxPages: 2 } }),
    });
    expect(web.research).not.toHaveBeenCalled();
    expect(await auditTypes()).toContain('web.bulk_research_payload_invalid');
  });

  it('F2: empty query does not call research and audits invalid', async () => {
    const web = makeWeb();
    await runApprovedBulkResearch(deps(web), {
      id: 'f2-d',
      status: 'approved',
      payloadPreview: JSON.stringify({ query: '   ' }),
    });
    expect(web.research).not.toHaveBeenCalled();
    expect(await auditTypes()).toContain('web.bulk_research_payload_invalid');
  });
});

// ---------------------------------------------------------------------------
// B1 (FIX4): host webRunner fail-closed effect payload validation
// ---------------------------------------------------------------------------

describe('B1 — web_search effect payload validation', () => {
  it('B1: empty query does not call search and audits web.effect_payload_invalid', async () => {
    const web = makeWeb();
    const handle = createWebEffectHandler(deps(web));
    await handle({ type: 'web_search', id: 'b1-empty', query: '' });
    expect(web.search).not.toHaveBeenCalled();
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({ ok: false }),
      }),
    );
    expect(await auditTypes()).toContain('web.effect_payload_invalid');
  });

  it('B1: whitespace-only query does not call search', async () => {
    const web = makeWeb();
    const handle = createWebEffectHandler(deps(web));
    await handle({ type: 'web_search', id: 'b1-ws', query: '   ' });
    expect(web.search).not.toHaveBeenCalled();
    expect(await auditTypes()).toContain('web.effect_payload_invalid');
  });
});

describe('B1 — web_research effect payload validation', () => {
  it('B1: empty query mode does not dispatch bulk_research approval and audits invalid', async () => {
    const web = makeWeb();
    const handle = createWebEffectHandler(deps(web));
    await handle({
      type: 'web_research',
      id: 'b1-rq',
      mode: 'query',
      query: '',
      urls: undefined,
    } as unknown as Parameters<typeof handle>[0]);
    // dispatch may be called by recordAudit internally; check no approvalRequested
    const approvalCalls = (
      dispatch as ReturnType<typeof vi.fn>
    ).mock.calls.filter(
      (c: unknown[]) =>
        typeof c[0] === 'object' &&
        c[0] !== null &&
        (c[0] as Record<string, unknown>).type ===
          'approvals/approvalRequested',
    );
    expect(approvalCalls).toHaveLength(0);
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({ ok: false }),
      }),
    );
    expect(await auditTypes()).toContain('web.effect_payload_invalid');
  });

  it('B1: empty urls array does not dispatch bulk_research approval and audits invalid', async () => {
    const web = makeWeb();
    const handle = createWebEffectHandler(deps(web));
    await handle({
      type: 'web_research',
      id: 'b1-ru-empty',
      mode: 'urls',
      urls: [],
      query: undefined,
    } as unknown as Parameters<typeof handle>[0]);
    const approvalCalls = (
      dispatch as ReturnType<typeof vi.fn>
    ).mock.calls.filter(
      (c: unknown[]) =>
        typeof c[0] === 'object' &&
        c[0] !== null &&
        (c[0] as Record<string, unknown>).type ===
          'approvals/approvalRequested',
    );
    expect(approvalCalls).toHaveLength(0);
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({ ok: false }),
      }),
    );
    expect(await auditTypes()).toContain('web.effect_payload_invalid');
  });

  it('B1: urls array with empty-string slot does not dispatch approval', async () => {
    const web = makeWeb();
    const handle = createWebEffectHandler(deps(web));
    await handle({
      type: 'web_research',
      id: 'b1-ru-slot',
      mode: 'urls',
      urls: ['https://ok.example', ''],
      query: undefined,
    } as unknown as Parameters<typeof handle>[0]);
    const approvalCalls = (
      dispatch as ReturnType<typeof vi.fn>
    ).mock.calls.filter(
      (c: unknown[]) =>
        typeof c[0] === 'object' &&
        c[0] !== null &&
        (c[0] as Record<string, unknown>).type ===
          'approvals/approvalRequested',
    );
    expect(approvalCalls).toHaveLength(0);
    expect(await auditTypes()).toContain('web.effect_payload_invalid');
  });
});
