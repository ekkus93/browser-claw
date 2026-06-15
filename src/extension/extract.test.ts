import { describe, expect, it } from 'vitest';
import { extractReadablePage } from './extract.ts';

const ARTICLE = `
<html>
  <head>
    <title>OPFS Guide</title>
    <meta property="og:site_name" content="Example Docs" />
    <meta name="author" content="Jane Dev" />
    <style>.x { color: red }</style>
    <script>document.cookie = 'stolen'; alert(1);</script>
  </head>
  <body>
    <h1>OPFS</h1>
    <p>OPFS is a private filesystem.</p>
    <ul><li>fast</li><li>origin-scoped</li></ul>
    <iframe src="https://ads.example"></iframe>
  </body>
</html>`;

describe('extractReadablePage (E7/E8)', () => {
  it('extracts title, byline, site name, and readable text', () => {
    const page = extractReadablePage(ARTICLE);
    expect(page.title).toBe('OPFS Guide');
    expect(page.byline).toBe('Jane Dev');
    expect(page.siteName).toBe('Example Docs');
    expect(page.text).toContain('OPFS is a private filesystem.');
    expect(page.text).toContain('origin-scoped');
    expect(page.length).toBe(page.text.length);
    expect(page.excerpt.length).toBeLessThanOrEqual(280);
  });

  it('strips scripts/styles/iframes (no executable or ad content leaks)', () => {
    const page = extractReadablePage(ARTICLE);
    expect(page.text).not.toContain('alert');
    expect(page.text).not.toContain('document.cookie');
    expect(page.text).not.toContain('color: red');
    expect(page.markdown).not.toContain('alert');
  });

  it('renders headings and list items in markdown', () => {
    const page = extractReadablePage(ARTICLE);
    expect(page.markdown).toContain('# OPFS');
    expect(page.markdown).toContain('- fast');
  });

  it('caps output at maxChars', () => {
    const big = `<body><p>${'x'.repeat(5000)}</p></body>`;
    const page = extractReadablePage(big, { maxChars: 100 });
    expect(page.text.length).toBe(100);
    expect(page.markdown.length).toBeLessThanOrEqual(100);
  });
});
