/**
 * Join conditional class names. Falsy values are dropped. Kept intentionally
 * tiny — we don't need tailwind-merge for this design system.
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
