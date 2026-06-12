import { describe, expect, it } from 'vitest';
import { isPathAllowed } from './skillFs.ts';

describe('isPathAllowed', () => {
  const namespaces = ['skills/x/data/**', 'skills/x/out/**'];

  it('allows paths inside approved namespaces', () => {
    expect(isPathAllowed('skills/x/data/file.txt', namespaces)).toBe(true);
    expect(isPathAllowed('skills/x/out/result.json', namespaces)).toBe(true);
  });

  it('denies paths outside namespaces, traversal, and absolute escapes', () => {
    expect(isPathAllowed('skills/y/data/file.txt', namespaces)).toBe(false);
    expect(isPathAllowed('skills/x/data/../../etc', namespaces)).toBe(false);
    expect(isPathAllowed('', namespaces)).toBe(false);
    expect(isPathAllowed('skills/x/data/file', [])).toBe(false);
  });
});
