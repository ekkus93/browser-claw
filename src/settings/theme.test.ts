import { afterEach, describe, expect, it } from 'vitest';
import { applyTheme, normalizeTheme } from './theme.ts';

describe('normalizeTheme', () => {
  it('accepts a valid dark/light value and defaults everything else to light', () => {
    expect(normalizeTheme('dark')).toBe('dark');
    expect(normalizeTheme('light')).toBe('light');
    expect(normalizeTheme(undefined)).toBe('light');
    expect(normalizeTheme('nonsense')).toBe('light');
  });
});

describe('applyTheme', () => {
  afterEach(() => {
    delete document.documentElement.dataset.theme;
  });

  it('sets data-theme on the document root', () => {
    applyTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    applyTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
