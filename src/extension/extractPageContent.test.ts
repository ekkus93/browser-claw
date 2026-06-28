/**
 * D1 — extractPageContent unit tests.
 *
 * The function runs in the injected-script context (uses global document +
 * location). jsdom provides both, so tests run in the default Vitest env.
 */
import { describe, expect, it, afterEach } from 'vitest';

// Stub chrome before importing the service-worker module to avoid module-level
// reference errors (the message-listener block is guarded by typeof chrome,
// but hasHostPermission / requestHostPermissionForUrl reference it directly).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).chrome = {
  permissions: { contains: async () => false, request: async () => false },
  tabs: {
    create: async () => ({ id: 1 }),
    onUpdated: {
      addListener: () => undefined,
      removeListener: () => undefined,
    },
    remove: async () => undefined,
  },
  scripting: { executeScript: async () => [] },
  runtime: { onMessageExternal: null },
};

// @ts-expect-error — plain-JS module, no declaration file
import { extractPageContent } from '../../extension/chrome-web-research/service-worker.js';

// Helper: replace document.documentElement with given HTML, call the function,
// then restore. location.href is read-only in jsdom but defaults to
// 'about:blank' which is fine for finalUrl checks.
function withHtml(
  html: string,
  maxChars = 10_000,
): ReturnType<typeof extractPageContent> {
  document.open();
  document.write(html);
  document.close();
  return extractPageContent({ maxChars }) as ReturnType<
    typeof extractPageContent
  >;
}

describe('D1 — extractPageContent', () => {
  afterEach(() => {
    // Reset the document to a clean state
    document.open();
    document.write('<html><head></head><body></body></html>');
    document.close();
  });

  it('D1: og:title preferred over <title> over <h1>', () => {
    const result = withHtml(
      `<html><head>
        <meta property="og:title" content="OG Title"/>
        <title>Title Tag</title>
      </head><body><h1>H1 Text</h1></body></html>`,
    );
    expect(result.ok).toBe(true);
    expect(result.title).toBe('OG Title');
  });

  it('D1: <title> used when no og:title', () => {
    const result = withHtml(
      `<html><head><title>Title Tag</title></head><body><h1>H1 Text</h1></body></html>`,
    );
    expect(result.ok).toBe(true);
    expect(result.title).toBe('Title Tag');
  });

  it('D1: <h1> used when no og:title and no <title>', () => {
    const result = withHtml(
      `<html><head></head><body><h1>H1 Text</h1></body></html>`,
    );
    expect(result.ok).toBe(true);
    expect(result.title).toBe('H1 Text');
  });

  it('D1: <script> and <style> content removed from extracted text', () => {
    const result = withHtml(
      `<html><head>
        <style>body { color: red; }</style>
      </head><body>
        <p>Hello World</p>
        <script>alert('injected')</script>
      </body></html>`,
    );
    expect(result.ok).toBe(true);
    expect(result.text).not.toContain('color: red');
    expect(result.text).not.toContain("alert('injected')");
    expect(result.text).toContain('Hello World');
  });

  it('D1: multiple whitespace/newlines collapsed to single space', () => {
    const result = withHtml(
      `<html><body><p>word1   word2\n\n\nword3</p></body></html>`,
    );
    expect(result.ok).toBe(true);
    expect(result.text).toMatch(/word1 word2 word3/);
    expect(result.text).not.toMatch(/ {2}/); // no double spaces
  });

  it('D1: output longer than maxChars truncated at maxChars', () => {
    const longText = 'x'.repeat(10_000);
    const result = withHtml(
      `<html><body><p>${longText}</p></body></html>`,
      100,
    );
    expect(result.ok).toBe(true);
    expect(result.length).toBeLessThanOrEqual(100);
    expect(result.text.length).toBeLessThanOrEqual(100);
  });

  it('D1: finalUrl returned (jsdom default is about:blank)', () => {
    const result = withHtml('<html><body>Hello</body></html>');
    expect(result.ok).toBe(true);
    expect(typeof result.finalUrl).toBe('string');
    expect(result.finalUrl.length).toBeGreaterThan(0);
  });

  it('D1: empty <body> returns ok without throwing', () => {
    const result = withHtml('<html><head></head><body></body></html>');
    expect(result.ok).toBe(true);
    expect(typeof result.text).toBe('string');
  });

  it('D1: <noscript> contents excluded from text', () => {
    const result = withHtml(
      `<html><body>
        <noscript>No JS fallback text</noscript>
        <p>Main content</p>
      </body></html>`,
    );
    expect(result.ok).toBe(true);
    expect(result.text).not.toContain('No JS fallback text');
    expect(result.text).toContain('Main content');
  });

  it('D1: hostile DOM (querySelectorAll overridden) returns degraded result without throwing', () => {
    const origQSA = document.querySelectorAll.bind(document);
    // Override to throw for 'STRIP' selectors, return empty NodeList for others
    document.querySelectorAll = (sel: string) => {
      if (sel.includes('script')) throw new Error('hostile querySelectorAll');
      return origQSA(sel);
    };
    try {
      const result = extractPageContent({ maxChars: 10_000 }) as {
        ok: boolean;
        error?: string;
        text?: string;
      };
      // Must not throw; result is either ok or degraded error
      expect(typeof result).toBe('object');
    } finally {
      document.querySelectorAll = origQSA;
    }
  });
});
