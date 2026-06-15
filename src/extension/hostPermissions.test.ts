import { describe, expect, it } from 'vitest';
import { originPattern, originPatternsFor } from './hostPermissions.ts';

describe('host permission patterns (E5)', () => {
  it('builds a per-origin match pattern for a safe URL', () => {
    expect(originPattern('https://example.com/some/article?x=1')).toBe(
      'https://example.com/*',
    );
    expect(originPattern('http://news.example.org:8080/a')).toBe(
      'http://news.example.org:8080/*',
    );
  });

  it('refuses to build a pattern for an unsafe/private target', () => {
    expect(() => originPattern('http://127.0.0.1/')).toThrow(
      /host permission/i,
    );
    expect(() => originPattern('http://169.254.169.254/')).toThrow();
    expect(() => originPattern('file:///etc/passwd')).toThrow();
  });

  it('dedupes origins across many URLs and skips unsafe ones', () => {
    expect(
      originPatternsFor([
        'https://a.com/1',
        'https://a.com/2',
        'https://b.com/x',
        'http://localhost/secret',
      ]),
    ).toEqual(['https://a.com/*', 'https://b.com/*']);
  });
});
