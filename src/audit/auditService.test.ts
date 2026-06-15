import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { BrowserClawDB } from '../db/db.ts';
import {
  appendAuditEvent,
  queryAuditEvents,
  getAuditEvent,
  auditEventsToCsv,
  buildAuditRow,
  redactDetails,
  backfillAuditDefaults,
  exportAuditCsv,
} from './auditService.ts';

function freshDb(): BrowserClawDB {
  // A distinct in-memory DB per test keeps audit rows isolated.
  const db = new BrowserClawDB();
  return db;
}

describe('buildAuditRow', () => {
  it('applies defaults and derives an ISO timestamp from `at`', () => {
    const row = buildAuditRow({
      type: 'runtime.loaded',
      summary: 'Runtime loaded',
      source: 'runtime',
      at: 1_700_000_000_000,
    });
    expect(row.risk).toBe('info');
    expect(row.status).toBe('success');
    expect(row.timestamp).toBe(new Date(1_700_000_000_000).toISOString());
    expect(row.id).toBeTruthy();
  });

  it('omits optional fields that were not provided', () => {
    const row = buildAuditRow({
      type: 't',
      summary: 's',
      source: 'system',
    });
    expect('conversationId' in row).toBe(false);
    expect('details' in row).toBe(false);
  });
});

describe('redactDetails', () => {
  it('strips credential-looking keys at any depth', () => {
    const redacted = redactDetails({
      providerId: 'openai',
      apiKey: 'sk-secret',
      nested: { authorization: 'Bearer x', model: 'gpt' },
      list: [{ token: 't' }],
    }) as Record<string, unknown>;
    expect(redacted.providerId).toBe('openai');
    expect(redacted.apiKey).toBe('[redacted]');
    expect((redacted.nested as Record<string, unknown>).authorization).toBe(
      '[redacted]',
    );
    expect((redacted.nested as Record<string, unknown>).model).toBe('gpt');
    expect((redacted.list as Record<string, unknown>[])[0]?.token).toBe(
      '[redacted]',
    );
  });
});

describe('summary redaction (A2.9)', () => {
  it('scrubs a credential leaked into the summary text', () => {
    const row = buildAuditRow({
      type: 'provider.request_failed',
      summary: 'Request failed: bad key sk-ant-abcdef0123456789abcdef rejected',
      source: 'provider',
    });
    expect(row.summary).not.toContain('sk-ant-');
    expect(row.summary).toContain('[redacted]');
  });

  it('scrubs an Authorization header from the summary', () => {
    const row = buildAuditRow({
      type: 'web.fetch_blocked',
      summary:
        'Blocked fetch with Authorization: Bearer sk-abcdefghijklmnop1234',
      source: 'skill',
    });
    expect(row.summary).not.toMatch(/Bearer\s+sk-/i);
    expect(row.summary).not.toContain('sk-abcdefghijklmnop1234');
  });

  it('leaves an ordinary summary untouched', () => {
    const row = buildAuditRow({
      type: 'skill_installed',
      summary: 'Installed skill task-manager v1.2.0',
      source: 'skill',
    });
    expect(row.summary).toBe('Installed skill task-manager v1.2.0');
  });
});

describe('backfillAuditDefaults', () => {
  it('fills missing source/status but keeps existing values', () => {
    const a: { source?: string; status?: string } = {};
    backfillAuditDefaults(a as never);
    expect(a).toEqual({ source: 'system', status: 'success' });

    const b = { source: 'provider', status: 'failure' } as never;
    backfillAuditDefaults(b);
    expect(b).toEqual({ source: 'provider', status: 'failure' });
  });
});

describe('audit service (durable)', () => {
  let db: BrowserClawDB;
  afterEach(async () => {
    await db.delete();
  });

  it('appends and retrieves a durable event, redacting details', async () => {
    db = freshDb();
    const stored = await appendAuditEvent(db, {
      type: 'provider.test',
      summary: 'tested',
      source: 'provider',
      providerId: 'openai',
      details: { apiKey: 'sk-leak', note: 'ok' },
    });
    const fetched = await getAuditEvent(db, stored.id);
    expect(fetched?.providerId).toBe('openai');
    expect((fetched?.details as Record<string, unknown>).apiKey).toBe(
      '[redacted]',
    );
    expect((fetched?.details as Record<string, unknown>).note).toBe('ok');
  });

  it('queries by type/risk/source/status, newest first, with a limit', async () => {
    db = freshDb();
    await appendAuditEvent(db, {
      type: 'a',
      summary: '1',
      source: 'runtime',
      risk: 'high',
      status: 'failure',
      at: 1,
    });
    await appendAuditEvent(db, {
      type: 'b',
      summary: '2',
      source: 'provider',
      risk: 'info',
      at: 2,
    });
    await appendAuditEvent(db, {
      type: 'a',
      summary: '3',
      source: 'runtime',
      risk: 'high',
      status: 'failure',
      at: 3,
    });

    const all = await queryAuditEvents(db);
    expect(all.map((e) => e.summary)).toEqual(['3', '2', '1']);

    expect((await queryAuditEvents(db, { type: 'a' })).length).toBe(2);
    expect((await queryAuditEvents(db, { risk: 'high' })).length).toBe(2);
    expect((await queryAuditEvents(db, { source: 'provider' })).length).toBe(1);
    expect((await queryAuditEvents(db, { status: 'failure' })).length).toBe(2);
    expect((await queryAuditEvents(db, { limit: 1 }))[0]?.summary).toBe('3');
  });

  it('exports durable events as CSV with escaping', async () => {
    db = freshDb();
    await appendAuditEvent(db, {
      type: 'note',
      summary: 'has, comma and "quote"',
      source: 'user',
      at: 10,
    });
    const csv = await exportAuditCsv(db);
    const [header, firstRow] = csv.split('\n');
    expect(header).toBe('at,timestamp,type,source,status,risk,summary');
    expect(firstRow).toContain('"has, comma and ""quote"""');
    expect(firstRow).not.toContain('apiKey');
  });

  it('auditEventsToCsv never includes details', () => {
    const csv = auditEventsToCsv([
      buildAuditRow({
        type: 't',
        summary: 's',
        source: 'system',
        details: { apiKey: 'x' },
        at: 1,
      }),
    ]);
    expect(csv).not.toContain('apiKey');
    expect(csv).not.toContain('redacted');
  });
});
