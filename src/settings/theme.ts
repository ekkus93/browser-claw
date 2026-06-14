/**
 * Color theme application. The theme is a durable user preference (persisted via
 * appSettings) applied by toggling `data-theme` on the root <html> element. The
 * dark token overrides live in index.css under `[data-theme='dark']`; every
 * Tailwind utility reads the color tokens through `var(--color-*)`, so flipping
 * the attribute re-themes the whole app with no per-component work.
 */
export type Theme = 'light' | 'dark';

export const THEMES: readonly Theme[] = ['light', 'dark'];

/** Narrow an arbitrary stored value to a valid Theme, defaulting to light. */
export function normalizeTheme(value: unknown): Theme {
  return value === 'dark' ? 'dark' : 'light';
}

/** Apply a theme to the document root. No-op when there is no DOM (SSR/tests). */
export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
}
