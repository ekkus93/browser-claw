/**
 * B1 — read_pages batch handler unit tests.
 *
 * Imports the plain-JS service worker and stubs Chrome APIs
 * so the handler runs without a real browser.
 */
import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

// Stub Chrome APIs before importing the module.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).chrome = {
  permissions: {
    contains: async () => true,
    request: async () => true,
  },
  tabs: {
    create: async ({ url }: { url: string }) => ({ id: 42, url }),
    onUpdated: {
      addListener: (cb: AnyFn) => {
        // immediately signal 'complete' so waitForTabComplete resolves
        setTimeout(() => cb(42, { status: 'complete' }), 0);
      },
      removeListener: () => undefined,
    },
    remove: async () => undefined,
  },
  scripting: {
    executeScript: async ({ args }: { args: [{ maxChars: number }] }) => [
      {
        result: {
          ok: true,
          finalUrl: 'https://example.com/',
          title: 'Example',
          text: 'x'.repeat(Math.min(args[0].maxChars, 10)),
          markdown: 'body',
          excerpt: 'body',
          length: 10,
        },
      },
    ],
  },
  runtime: { onMessageExternal: null },
};

import {
  handle,
  handleReadPage,
  handleReadPages,
  handleGetStatus,
  handleRequestHostPermission,
  handleReadCurrentTab,
  handlers,
} from '../../extension/chrome-web-research/service-worker.js';

const BLOCKED = 'http://localhost/page';
const URL1 = 'https://example.com/page1';
const URL2 = 'https://example.com/page2';
const URL3 = 'https://example.com/page3';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function rp(msg: Record<string, any>) {
  return handleReadPages(msg) as Promise<Record<string, unknown>>;
}

describe('B1 — handleReadPages (batch)', () => {
  it('B1: single URL batch returns ok:true with one result', async () => {
    const res = await rp({ requestId: 'r1', urls: [URL1] });
    expect(res['ok']).toBe(true);
    const results = res['results'] as unknown[];
    expect(Array.isArray(results)).toBe(true);
    expect(results).toHaveLength(1);
  });

  it('B1: blocked URL yields ok:false in its slot without aborting batch', async () => {
    const res = await rp({ requestId: 'r2', urls: [BLOCKED, URL1] });
    expect(res['ok']).toBe(true);
    const results = res['results'] as Record<string, unknown>[];
    expect(results[0]!['ok']).toBe(false);
    expect((results[0]!['error'] as Record<string, unknown>)['kind']).toBe(
      'url_blocked',
    );
    expect(results[1]!['ok']).toBe(true);
    expect(results).toHaveLength(2);
  });

  it('B1: respects maxPages — only fetches first N URLs', async () => {
    const res = await rp({
      requestId: 'r3',
      urls: [URL1, URL2, URL3],
      maxPages: 2,
    });
    expect(res['ok']).toBe(true);
    expect((res['results'] as unknown[]).length).toBe(2);
  });

  it('B1: empty urls array returns invalid_request error', async () => {
    const res = await rp({ requestId: 'r4', urls: [] });
    expect(res['ok']).toBe(false);
    expect((res['error'] as Record<string, unknown>)['kind']).toBe(
      'invalid_request',
    );
  });

  it('B1: non-array urls returns invalid_request error', async () => {
    const res = await rp({ requestId: 'r5', urls: 'not-an-array' });
    expect(res['ok']).toBe(false);
    expect((res['error'] as Record<string, unknown>)['kind']).toBe(
      'invalid_request',
    );
  });

  it('B1: maxPages capped at 10 even if message requests more', async () => {
    const manyUrls = Array.from(
      { length: 15 },
      (_, i) => `https://example.com/p${String(i)}`,
    );
    const res = await rp({ requestId: 'r6', urls: manyUrls, maxPages: 15 });
    expect(res['ok']).toBe(true);
    expect((res['results'] as unknown[]).length).toBe(10);
  });

  it('B1: non-string URL slot returns invalid_request for that slot', async () => {
    const res = await rp({ requestId: 'r7', urls: [URL1, 42] });
    expect(res['ok']).toBe(true);
    const results = res['results'] as Record<string, unknown>[];
    expect(results[0]!['ok']).toBe(true);
    expect(results[1]!['ok']).toBe(false);
    expect((results[1]!['error'] as Record<string, unknown>)['kind']).toBe(
      'invalid_request',
    );
  });

  it('B1: requestId echoed in top-level response', async () => {
    const res = await rp({ requestId: 'echo-me', urls: [URL1] });
    expect(res['requestId']).toBe('echo-me');
  });
});

describe('C1 — handleGetStatus structured capabilities', () => {
  type Status = Record<string, unknown>;
  type Caps = {
    readPage?: {
      supported?: boolean;
      requiresHostPermission?: boolean;
      permissionRequestSupported?: boolean;
    };
    readCurrentTab?: { supported?: boolean; requiresActiveTab?: boolean };
    webSearch?: { supported?: boolean };
  };

  function status(): Status {
    return handleGetStatus({ requestId: 'r' }) as Status;
  }

  it('C1: capabilities.readPage.supported matches handlers.read_page registration', () => {
    const s = status();
    const caps = s['capabilities'] as Caps;
    expect(caps['readPage']?.['supported']).toBe(
      typeof (handlers as Record<string, unknown>)['read_page'] === 'function',
    );
  });

  it('C1: capabilities.readPage.requiresHostPermission is always true for MV3', () => {
    const s = status();
    const caps = s['capabilities'] as Caps;
    expect(caps['readPage']?.['requiresHostPermission']).toBe(true);
  });

  it('C1/C2: capabilities.readPage.permissionRequestSupported matches request_host_permission handler', () => {
    const s = status();
    const caps = s['capabilities'] as Caps;
    expect(caps['readPage']?.['permissionRequestSupported']).toBe(
      typeof (handlers as Record<string, unknown>)[
        'request_host_permission'
      ] === 'function',
    );
  });

  it('C1/C2: pageReadingAvailable reflects both readPage handler and permissionRequestSupported', () => {
    const s = status();
    const caps = s['capabilities'] as Caps;
    const expected =
      caps['readPage']?.['supported'] === true &&
      caps['readPage']?.['permissionRequestSupported'] === true;
    expect(s['pageReadingAvailable']).toBe(expected);
  });

  it('C1/C3: capabilities.readCurrentTab.supported is false (C3: unavailable in v0.1)', () => {
    // C3 overrides the derived value: handler is registered but not available
    // because activeTab cannot be granted via externally_connectable.
    const s = status();
    const caps = s['capabilities'] as Caps;
    expect(caps['readCurrentTab']?.['supported']).toBe(false);
  });

  it('C1: status does not lie — currentTabReadingAvailable matches readCurrentTab.supported', () => {
    const s = status();
    const caps = s['capabilities'] as Caps;
    expect(s['currentTabReadingAvailable']).toBe(
      caps['readCurrentTab']?.['supported'],
    );
  });
});

describe('C2 — handleReadPage does not request permission opportunistically', () => {
  afterEach(() => {
    // Restore default stubs.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).chrome.permissions.contains = async () => true;
  });

  it('C2: returns host_permission_missing when permission is absent (no request attempted)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).chrome.permissions.contains = async () => false;
    const requestAttempted = { value: false };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).chrome.permissions.request = async () => {
      requestAttempted.value = true;
      return true;
    };
    const res = await (
      handleReadPage as (
        m: Record<string, unknown>,
      ) => Promise<Record<string, unknown>>
    )({
      requestId: 'r',
      url: 'https://example.com/',
    });
    expect(res['ok']).toBe(false);
    expect((res['error'] as Record<string, unknown>)['kind']).toBe(
      'host_permission_missing',
    );
    expect(requestAttempted.value).toBe(false);
  });

  it('C2: succeeds when host permission is already present', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).chrome.permissions.contains = async () => true;
    const res = await (
      handleReadPage as (
        m: Record<string, unknown>,
      ) => Promise<Record<string, unknown>>
    )({
      requestId: 'r',
      url: 'https://example.com/',
    });
    expect(res['ok']).toBe(true);
  });
});

describe('C2 — handleRequestHostPermission', () => {
  afterEach(() => {
    // Restore default stubs.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).chrome.permissions.request = async () => true;
  });

  it('C2: returns ok:true when permission is granted', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).chrome.permissions.request = async () => true;
    const res = await (
      handleRequestHostPermission as (
        m: Record<string, unknown>,
      ) => Promise<Record<string, unknown>>
    )({
      requestId: 'r',
      origin: 'https://example.com/',
    });
    expect(res['ok']).toBe(true);
  });

  it('C2: returns permission_denied when user denies', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).chrome.permissions.request = async () => false;
    const res = await (
      handleRequestHostPermission as (
        m: Record<string, unknown>,
      ) => Promise<Record<string, unknown>>
    )({
      requestId: 'r',
      origin: 'https://example.com/',
    });
    expect(res['ok']).toBe(false);
    expect((res['error'] as Record<string, unknown>)['kind']).toBe(
      'permission_denied',
    );
  });

  it('C2: returns permission_flow_required when Chrome throws (requires user gesture)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).chrome.permissions.request = async () => {
      throw new Error('requires user gesture');
    };
    const res = await (
      handleRequestHostPermission as (
        m: Record<string, unknown>,
      ) => Promise<Record<string, unknown>>
    )({
      requestId: 'r',
      origin: 'https://example.com/',
    });
    expect(res['ok']).toBe(false);
    expect((res['error'] as Record<string, unknown>)['kind']).toBe(
      'permission_flow_required',
    );
  });

  it('C2: returns invalid_request for empty origin', async () => {
    const res = await (
      handleRequestHostPermission as (
        m: Record<string, unknown>,
      ) => Promise<Record<string, unknown>>
    )({
      requestId: 'r',
      origin: '',
    });
    expect(res['ok']).toBe(false);
    expect((res['error'] as Record<string, unknown>)['kind']).toBe(
      'invalid_request',
    );
  });

  it('C2: get_status now reports request_host_permission as supported (pageReadingAvailable:true)', () => {
    const s = (
      handleGetStatus as (m: Record<string, unknown>) => Record<string, unknown>
    )({ requestId: 'r' });
    expect(s['pageReadingAvailable']).toBe(true);
  });
});

describe('C4 — handleReadPage tab lifecycle', () => {
  const removedTabIds: number[] = [];

  beforeEach(() => {
    removedTabIds.length = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).chrome.permissions.contains = async () => true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).chrome.tabs.remove = async (id: number) => {
      removedTabIds.push(id);
    };
  });

  afterEach(() => {
    // Restore defaults.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).chrome.tabs.remove = async () => undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).chrome.scripting.executeScript = async ({
      args,
    }: {
      args: [{ maxChars: number }];
    }) => [
      {
        result: {
          ok: true,
          finalUrl: 'https://example.com/',
          title: 'Example',
          text: 'x'.repeat(Math.min(args[0].maxChars, 10)),
          markdown: 'body',
          excerpt: 'body',
          length: 10,
        },
      },
    ];
  });

  it('C4: tab is closed after successful read', async () => {
    await (
      handleReadPage as (
        m: Record<string, unknown>,
      ) => Promise<Record<string, unknown>>
    )({
      requestId: 'r',
      url: 'https://example.com/',
    });
    expect(removedTabIds).toHaveLength(1);
    expect(removedTabIds[0]).toBe(42);
  });

  it('C4: tab is closed after failed extraction', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).chrome.scripting.executeScript = async () => [
      { result: { ok: false, error: 'no readable content' } },
    ];
    const res = await (
      handleReadPage as (
        m: Record<string, unknown>,
      ) => Promise<Record<string, unknown>>
    )({
      requestId: 'r',
      url: 'https://example.com/',
    });
    expect(res['ok']).toBe(false);
    expect((res['error'] as Record<string, unknown>)['kind']).toBe(
      'extraction_failed',
    );
    expect(removedTabIds).toHaveLength(1);
  });
});

describe('D1 (FIX3) — central handle() validates all requests including async', () => {
  it('D1: missing requestId rejected before handler logic (read_page)', async () => {
    const res = (await handle({
      type: 'read_page',
      url: 'https://example.com/',
      // no requestId
    })) as Record<string, unknown>;
    expect(res['ok']).toBe(false);
    expect((res['error'] as Record<string, unknown>)['kind']).toBe(
      'invalid_request',
    );
  });

  it('D1: missing requestId rejected before handler logic (web_search)', async () => {
    const res = (await handle({
      type: 'web_search',
      query: 'test',
      apiKey: 'key',
      // no requestId
    })) as Record<string, unknown>;
    expect(res['ok']).toBe(false);
    expect((res['error'] as Record<string, unknown>)['kind']).toBe(
      'invalid_request',
    );
  });

  it('D1: unknown async-looking type returns unsupported_message_type', async () => {
    const res = (await handle({
      type: 'do_evil_thing',
      requestId: 'd1-unknown',
    })) as Record<string, unknown>;
    expect(res['ok']).toBe(false);
    expect((res['error'] as Record<string, unknown>)['kind']).toBe(
      'unsupported_message_type',
    );
  });

  it('D1: handler throw returns structured internal_error', async () => {
    const saved = handlers['ping'];
    handlers['ping'] = () => {
      throw new Error('boom from test');
    };
    try {
      const res = (await handle({
        type: 'ping',
        requestId: 'd1-throw',
      })) as Record<string, unknown>;
      expect(res['ok']).toBe(false);
      expect((res['error'] as Record<string, unknown>)['kind']).toBe(
        'internal_error',
      );
      expect((res['error'] as Record<string, unknown>)['message']).toContain(
        'boom from test',
      );
    } finally {
      handlers['ping'] = saved;
    }
  });

  it('D1: valid async request (read_page) still resolves correctly', async () => {
    const res = (await handle({
      type: 'read_page',
      requestId: 'd1-valid',
      url: URL1,
    })) as Record<string, unknown>;
    expect(res['ok']).toBe(true);
    expect(typeof res['text']).toBe('string');
  });
});

describe('C3 — read_current_tab unavailable in v0.1', () => {
  it('C3: read_current_tab returns current_tab_read_unavailable', () => {
    const res = handleReadCurrentTab({ requestId: 'c3-unavail' }) as Record<
      string,
      unknown
    >;
    expect(res['ok']).toBe(false);
    expect((res['error'] as Record<string, unknown>)['kind']).toBe(
      'current_tab_read_unavailable',
    );
  });

  it('C3: get_status reports readCurrentTab.supported = false', () => {
    const s = handleGetStatus({ requestId: 'c3-status' }) as Record<
      string,
      unknown
    >;
    const caps = s['capabilities'] as Record<string, unknown>;
    const rct = caps['readCurrentTab'] as Record<string, unknown>;
    expect(rct['supported']).toBe(false);
    expect(s['currentTabReadingAvailable']).toBe(false);
  });
});
