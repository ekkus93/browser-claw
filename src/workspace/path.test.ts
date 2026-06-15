import { describe, expect, it } from 'vitest';
import {
  isValidWorkspacePath,
  normalizeWorkspacePath,
  validateWorkspacePath,
} from './path.ts';

describe('validateWorkspacePath — rejects unsafe paths (B2)', () => {
  const rejected: Array<[string, string]> = [
    ['empty', ''],
    ['relative outside workspace', '../../secret'],
    ['parent traversal', '/workspace/../secret'],
    ['encoded traversal (%2e%2e)', '/workspace/%2e%2e/secret'],
    ['encoded traversal (%2e%2e%2f)', '/workspace/%2e%2e%2fsecret'],
    ['OS absolute path', '/home/phil/file'],
    ['windows path with backslashes', 'C:\\Users\\Phil\\file'],
    ['backslash traversal', '/workspace/foo\\..\\bar'],
    ['null byte', '/workspace/a\u0000b'],
    ['encoded null byte', '/workspace/%00/x'],
    ['control character', '/workspace/a\u0001b'],
    ['malformed percent-encoding', '/workspace/%zz'],
    ['outside root (sibling)', '/workspaces/x'],
    ['hidden/reserved segment', '/workspace/.secrets/x'],
    ['relative (no leading slash)', 'workspace/notes/a.md'],
  ];

  it.each(rejected)('rejects %s', (_label, path) => {
    expect(validateWorkspacePath(path).ok).toBe(false);
    expect(isValidWorkspacePath(path)).toBe(false);
    expect(() => normalizeWorkspacePath(path)).toThrow(
      /invalid workspace path/i,
    );
  });
});

describe('validateWorkspacePath — accepts and normalizes valid paths (B2)', () => {
  const accepted: Array<[string, string]> = [
    ['/workspace', '/workspace'],
    ['/workspace/', '/workspace'],
    ['/workspace/research/opfs.md', '/workspace/research/opfs.md'],
    [
      '/workspace/scripts/parse-report.bcplan.json',
      '/workspace/scripts/parse-report.bcplan.json',
    ],
    ['/workspace//artifacts///summary.md', '/workspace/artifacts/summary.md'],
  ];

  it.each(accepted)('accepts %s -> %s', (input, expected) => {
    const result = validateWorkspacePath(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.path).toBe(expected);
    expect(normalizeWorkspacePath(input)).toBe(expected);
  });
});
