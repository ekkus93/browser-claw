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
    research: vi.fn(() =>
      Promise.resolve({
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
      }),
    ),
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
});
