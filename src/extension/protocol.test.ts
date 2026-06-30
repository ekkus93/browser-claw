import { describe, expect, it } from 'vitest';
import {
  isAllowedSenderUrl,
  isExtensionResponse,
  newRequestId,
  parseExtensionRequest,
} from './protocol.ts';

describe('parseExtensionRequest (E6)', () => {
  it('accepts well-formed requests', () => {
    expect(parseExtensionRequest({ type: 'ping', requestId: 'r1' }).ok).toBe(
      true,
    );
    expect(
      parseExtensionRequest({
        type: 'read_page',
        requestId: 'r1',
        url: 'https://example.com/a',
      }).ok,
    ).toBe(true);
    expect(
      parseExtensionRequest({
        type: 'read_pages',
        requestId: 'r1',
        urls: ['https://a/1', 'https://a/2'],
      }).ok,
    ).toBe(true);
  });

  it('rejects unknown types, missing requestId, and malformed payloads', () => {
    expect(parseExtensionRequest(null).ok).toBe(false);
    expect(parseExtensionRequest({ type: 'ping' }).ok).toBe(false); // no requestId
    expect(parseExtensionRequest({ type: 'wat', requestId: 'r1' }).ok).toBe(
      false,
    );
    expect(
      parseExtensionRequest({ type: 'read_page', requestId: 'r1' }).ok,
    ).toBe(false); // no url
    expect(
      parseExtensionRequest({ type: 'read_pages', requestId: 'r1', urls: [] })
        .ok,
    ).toBe(false); // empty
    expect(
      parseExtensionRequest({
        type: 'request_host_permission',
        requestId: 'r1',
      }).ok,
    ).toBe(false); // no origin
  });
});

describe('isExtensionResponse (E6)', () => {
  it('validates success and error responses', () => {
    expect(isExtensionResponse({ ok: true, requestId: 'r1' })).toBe(true);
    expect(
      isExtensionResponse({
        ok: false,
        requestId: 'r1',
        error: { kind: 'timeout', message: 'too slow' },
      }),
    ).toBe(true);
  });

  it('rejects malformed responses', () => {
    expect(isExtensionResponse({ requestId: 'r1' })).toBe(false);
    expect(isExtensionResponse({ ok: false, requestId: 'r1' })).toBe(false); // no error
    expect(isExtensionResponse(null)).toBe(false);
  });
});

describe('isAllowedSenderUrl (E6)', () => {
  const origins = ['http://localhost:5173', 'https://app.browserclaw.example'];
  it('accepts only allowed BrowserClaw origins', () => {
    expect(isAllowedSenderUrl('http://localhost:5173/chat', origins)).toBe(
      true,
    );
    expect(
      isAllowedSenderUrl('https://app.browserclaw.example/x', origins),
    ).toBe(true);
    expect(isAllowedSenderUrl('https://evil.example/x', origins)).toBe(false);
    expect(isAllowedSenderUrl(undefined, origins)).toBe(false);
    // A look-alike prefix must not pass (needs the trailing slash boundary).
    expect(
      isAllowedSenderUrl('http://localhost:5173.evil.com/x', origins),
    ).toBe(false);
  });
});

describe('newRequestId', () => {
  it('produces unique ids', () => {
    expect(newRequestId()).not.toBe(newRequestId());
  });
});

// FIX1-A2: canonical error kinds accepted by isExtensionResponse
describe('isExtensionResponse A2 error kinds', () => {
  const a2Kinds = [
    'unsupported_message_type',
    'invalid_request',
    'origin_not_allowed',
    'host_permission_missing',
    'url_blocked',
    'tab_create_failed',
    'page_load_timeout',
    'script_injection_failed',
    'output_too_large',
  ] as const;

  it('accepts all A2 error kinds in error responses', () => {
    for (const kind of a2Kinds) {
      expect(
        isExtensionResponse({
          ok: false,
          requestId: 'r1',
          error: { kind, message: 'test' },
        }),
      ).toBe(true);
    }
  });

  it('A2: valid read_page request accepted', () => {
    expect(
      parseExtensionRequest({
        type: 'read_page',
        requestId: 'r1',
        url: 'https://example.com/article',
      }).ok,
    ).toBe(true);
  });

  it('A2: invalid URL (missing) in read_page rejected', () => {
    expect(
      parseExtensionRequest({ type: 'read_page', requestId: 'r1' }).ok,
    ).toBe(false);
  });

  it('A2: missing requestId rejected', () => {
    expect(parseExtensionRequest({ type: 'ping' }).ok).toBe(false);
    expect(parseExtensionRequest({ type: 'get_status' }).ok).toBe(false);
  });

  it('A2: unknown type rejected', () => {
    expect(
      parseExtensionRequest({ type: 'unknown_type', requestId: 'r1' }).ok,
    ).toBe(false);
  });

  it('A2: unknown origin rejected by isAllowedSenderUrl', () => {
    expect(
      isAllowedSenderUrl('https://attacker.example/x', [
        'http://localhost:5173',
      ]),
    ).toBe(false);
  });

  it('G2: web_search with valid query accepted', () => {
    expect(
      parseExtensionRequest({
        type: 'web_search',
        requestId: 'r1',
        query: 'openai',
      }).ok,
    ).toBe(true);
  });

  it('G2: web_search with empty query rejected', () => {
    expect(
      parseExtensionRequest({ type: 'web_search', requestId: 'r1', query: '' })
        .ok,
    ).toBe(false);
  });

  it('G2: web_search missing query rejected', () => {
    expect(
      parseExtensionRequest({ type: 'web_search', requestId: 'r1' }).ok,
    ).toBe(false);
  });

  it('G2: web_search with invalid maxResults rejected', () => {
    expect(
      parseExtensionRequest({
        type: 'web_search',
        requestId: 'r1',
        query: 'q',
        maxResults: -1,
      }).ok,
    ).toBe(false);
    expect(
      parseExtensionRequest({
        type: 'web_search',
        requestId: 'r1',
        query: 'q',
        maxResults: 1.5,
      }).ok,
    ).toBe(false);
  });

  it('G2: web_search with valid maxResults accepted', () => {
    expect(
      parseExtensionRequest({
        type: 'web_search',
        requestId: 'r1',
        query: 'q',
        maxResults: 5,
      }).ok,
    ).toBe(true);
  });
});

describe('D1/D2 (FIX11) — maxChars validation in read_page and read_pages', () => {
  it('D1: read_page with maxChars 0 rejected', () => {
    expect(
      parseExtensionRequest({
        type: 'read_page',
        requestId: 'r1',
        url: 'https://x/a',
        maxChars: 0,
      }).ok,
    ).toBe(false);
  });

  it('D1: read_page with maxChars -1 rejected', () => {
    expect(
      parseExtensionRequest({
        type: 'read_page',
        requestId: 'r1',
        url: 'https://x/a',
        maxChars: -1,
      }).ok,
    ).toBe(false);
  });

  it('D1: read_page with maxChars 1.5 rejected', () => {
    expect(
      parseExtensionRequest({
        type: 'read_page',
        requestId: 'r1',
        url: 'https://x/a',
        maxChars: 1.5,
      }).ok,
    ).toBe(false);
  });

  it('D1: read_page with maxChars above cap (50001) rejected', () => {
    expect(
      parseExtensionRequest({
        type: 'read_page',
        requestId: 'r1',
        url: 'https://x/a',
        maxChars: 50_001,
      }).ok,
    ).toBe(false);
  });

  it('D1: read_page with valid maxChars accepted', () => {
    expect(
      parseExtensionRequest({
        type: 'read_page',
        requestId: 'r1',
        url: 'https://x/a',
        maxChars: 10_000,
      }).ok,
    ).toBe(true);
  });

  it('D1: read_page without maxChars accepted', () => {
    expect(
      parseExtensionRequest({
        type: 'read_page',
        requestId: 'r1',
        url: 'https://x/a',
      }).ok,
    ).toBe(true);
  });

  it('D2: read_pages with maxChars 0 rejected', () => {
    expect(
      parseExtensionRequest({
        type: 'read_pages',
        requestId: 'r1',
        urls: ['https://x/a'],
        maxChars: 0,
      }).ok,
    ).toBe(false);
  });

  it('D2: read_pages with maxChars -1 rejected', () => {
    expect(
      parseExtensionRequest({
        type: 'read_pages',
        requestId: 'r1',
        urls: ['https://x/a'],
        maxChars: -1,
      }).ok,
    ).toBe(false);
  });

  it('D2: read_pages with maxChars above cap (50001) rejected', () => {
    expect(
      parseExtensionRequest({
        type: 'read_pages',
        requestId: 'r1',
        urls: ['https://x/a'],
        maxChars: 50_001,
      }).ok,
    ).toBe(false);
  });

  it('D2: read_pages with valid maxChars accepted', () => {
    expect(
      parseExtensionRequest({
        type: 'read_pages',
        requestId: 'r1',
        urls: ['https://x/a'],
        maxChars: 20_000,
      }).ok,
    ).toBe(true);
  });

  it('D2: read_pages without maxChars accepted', () => {
    expect(
      parseExtensionRequest({
        type: 'read_pages',
        requestId: 'r1',
        urls: ['https://x/a'],
      }).ok,
    ).toBe(true);
  });
});
