/**
 * Readable-page extraction (Part E7 content extraction + E8 safety). A PURE
 * function over an HTML string: it strips scripts/styles/embeds, pulls the title
 * and readable text, produces a light markdown rendering, and caps the output.
 *
 * Read-only by construction — it parses an inert HTML string and never executes
 * page scripts, reads cookies/localStorage, clicks, or fills forms. The service
 * worker (real browser, E7) injects a content script that hands its HTML here.
 */

/** Default cap on extracted characters (the worker can pass a smaller maxChars). */
export const DEFAULT_EXTRACT_CHARS = 50_000;

export interface ExtractOptions {
  maxChars?: number;
}

export interface ExtractedPage {
  title: string;
  byline?: string;
  siteName?: string;
  text: string;
  markdown: string;
  excerpt: string;
  length: number;
}

const STRIP_SELECTOR =
  'script, style, noscript, template, iframe, svg, canvas, object, embed';

function normalizeWhitespace(text: string): string {
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function meta(doc: Document, name: string): string | undefined {
  const el =
    doc.querySelector(`meta[property="${name}"]`) ??
    doc.querySelector(`meta[name="${name}"]`);
  const content = el?.getAttribute('content')?.trim();
  return content && content.length > 0 ? content : undefined;
}

/** Render a small subset of block elements to markdown (headings, paragraphs, lists). */
function toMarkdown(root: Element): string {
  const out: string[] = [];
  const walk = (node: Node): void => {
    if (node.nodeType === 3) {
      const t = (node.textContent ?? '').replace(/\s+/g, ' ');
      if (t.trim()) out.push(t);
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    const heading = /^h([1-6])$/.exec(tag);
    if (heading) {
      out.push(
        `\n${'#'.repeat(Number(heading[1]))} ${el.textContent?.trim() ?? ''}\n`,
      );
      return;
    }
    if (tag === 'li') {
      out.push(`\n- ${el.textContent?.trim() ?? ''}`);
      return;
    }
    if (tag === 'p' || tag === 'br') {
      for (const child of Array.from(el.childNodes)) walk(child);
      out.push('\n\n');
      return;
    }
    for (const child of Array.from(el.childNodes)) walk(child);
  };
  walk(root);
  return normalizeWhitespace(out.join(' '));
}

export function extractReadablePage(
  html: string,
  options: ExtractOptions = {},
): ExtractedPage {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll(STRIP_SELECTOR).forEach((el) => el.remove());

  const title =
    doc.querySelector('title')?.textContent?.trim() ??
    doc.querySelector('h1')?.textContent?.trim() ??
    '';
  const byline = meta(doc, 'author') ?? meta(doc, 'article:author');
  const siteName = meta(doc, 'og:site_name');

  const root = doc.body ?? doc.documentElement;
  const max = options.maxChars ?? DEFAULT_EXTRACT_CHARS;
  const text = normalizeWhitespace(root.textContent ?? '').slice(0, max);
  const markdown = toMarkdown(root).slice(0, max);

  return {
    title,
    ...(byline ? { byline } : {}),
    ...(siteName ? { siteName } : {}),
    text,
    markdown,
    excerpt: text.slice(0, 280),
    length: text.length,
  };
}
