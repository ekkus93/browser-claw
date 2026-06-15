/**
 * Host-permission helpers for the extension page reader (Part E5).
 *
 * The extension ships with NO broad host permission. Before reading a page on a
 * new origin it requests an OPTIONAL host permission for just that origin. These
 * pure helpers compute the per-origin match pattern and are shared by the
 * service worker's request flow (real `chrome.permissions.*` calls are
 * browser-only and covered by the Docker E2E / manual QA).
 */

import { classifyFetchUrl } from '../net/urlSafety.ts';

/**
 * The optional-host-permission match pattern for a URL's origin, e.g.
 * `https://example.com/*`. Throws for a non-http(s) or unsafe URL (the same SSRF
 * validator the page reader uses), so we never request a permission for a
 * private/loopback/metadata target.
 */
export function originPattern(rawUrl: string): string {
  const safety = classifyFetchUrl(rawUrl);
  if (!safety.ok) {
    throw new Error(`Cannot request host permission: ${safety.message}`);
  }
  return `${safety.url.protocol}//${safety.url.host}/*`;
}

/** The distinct origin patterns needed to read a set of URLs (deduped). */
export function originPatternsFor(urls: string[]): string[] {
  const patterns = new Set<string>();
  for (const url of urls) {
    const safety = classifyFetchUrl(url);
    if (safety.ok) patterns.add(`${safety.url.protocol}//${safety.url.host}/*`);
  }
  return [...patterns].sort();
}
