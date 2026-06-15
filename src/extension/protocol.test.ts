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
