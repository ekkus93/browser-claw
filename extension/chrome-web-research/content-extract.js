/**
 * Content extraction script (FIX1-A3 / E7).
 *
 * This file is loaded by service-worker.js via chrome.scripting.executeScript
 * `files:` mode when needed. The equivalent inline function (`extractPageContent`)
 * is also embedded directly in service-worker.js for `func:` mode.
 *
 * Read-only — it never clicks, fills forms, reads cookies, touches
 * localStorage/sessionStorage, or executes page scripts. It clones and strips
 * the DOM, extracting only readable text/metadata.
 */

(function () {
  const STRIP = 'script,style,noscript,template,iframe,svg,canvas,object,embed';
  try {
    const clone = document.documentElement.cloneNode(true);
    clone.querySelectorAll(STRIP).forEach((el) => el.remove());

    const ogTitle = document.querySelector('meta[property="og:title"]');
    const titleEl = document.querySelector('title');
    const h1El = document.querySelector('h1');
    const title =
      (ogTitle && ogTitle.getAttribute('content')) ||
      (titleEl && titleEl.textContent && titleEl.textContent.trim()) ||
      (h1El && h1El.textContent && h1El.textContent.trim()) ||
      '';

    const ogSite = document.querySelector('meta[property="og:site_name"]');
    const siteName = (ogSite && ogSite.getAttribute('content')) || '';

    const MAX_CHARS = 50000;
    const raw = (clone.textContent || '').replace(/\s+/g, ' ').trim();
    const text = raw.slice(0, MAX_CHARS);

    return {
      ok: true,
      finalUrl: location.href,
      title,
      ...(siteName ? { siteName } : {}),
      text,
      markdown: text,
      excerpt: text.slice(0, 280),
      length: text.length,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
})();
