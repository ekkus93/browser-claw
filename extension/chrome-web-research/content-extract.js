/**
 * Content extraction script (injected into a page by the service worker in E7).
 *
 * v0.1 stub: returns the page's readable text/metadata using the shared
 * extraction logic. Read-only — it never clicks, fills forms, reads cookies, or
 * touches localStorage/sessionStorage. The real injection + Readability-style
 * extraction is wired in E7/E8; this stub keeps the file present for the
 * manifest/build and documents the contract.
 */

function extract() {
  const title = document.title || '';
  const text = (document.body && document.body.innerText) || '';
  return {
    finalUrl: location.href,
    title,
    text,
    length: text.length,
  };
}

// When injected via chrome.scripting.executeScript, the function result is
// returned to the service worker.
extract();
