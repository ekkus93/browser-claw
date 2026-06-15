/**
 * BrowserClaw-side configuration for talking to the Chrome Web Research
 * Companion extension (Part E4). Origins and protocol version are shared with
 * the extension's service worker; the production origin is configured at release
 * time, never hard-coded as a fake domain.
 */

/** Message protocol version (must match the extension's service worker). */
export const EXTENSION_PROTOCOL_VERSION = 1;

/** Dev/test origins the extension is allowed to be messaged from. */
export const DEV_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
] as const;

/**
 * Placeholder for the production BrowserClaw origin. Replaced at release time
 * (a manifest build step + this constant). A clearly-marked placeholder, not a
 * fake domain.
 */
export const PROD_ORIGIN_PLACEHOLDER = '__BROWSERCLAW_PROD_ORIGIN__';

/** The origins the extension should accept messages from in a given build. */
export function allowedExternalOrigins(prodOrigin?: string): string[] {
  const origins: string[] = [...DEV_ORIGINS];
  if (prodOrigin && prodOrigin !== PROD_ORIGIN_PLACEHOLDER) {
    origins.push(prodOrigin);
  }
  return origins;
}

/**
 * A Chrome extension id is 32 lowercase letters a–p. Used to validate a
 * configured/discovered extension id before messaging it.
 */
export function isValidExtensionId(id: string): boolean {
  return /^[a-p]{32}$/.test(id);
}
