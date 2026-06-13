import type { BrowserClawDB } from '../db/db.ts';

/**
 * Durable key/value app settings backed by the IndexedDB `app_settings` table.
 * This is the shared read/write layer for first-run/onboarding and Settings
 * persistence (TODO Phase 9) so those flags survive reloads instead of living
 * only in Redux. Secrets must never be stored here — use the SecretVault.
 */
export async function getSetting<T>(
  db: BrowserClawDB,
  key: string,
): Promise<T | undefined> {
  const row = await db.app_settings.get(key);
  return row === undefined ? undefined : (row.value as T);
}

export async function setSetting(
  db: BrowserClawDB,
  key: string,
  value: unknown,
): Promise<void> {
  await db.app_settings.put({ key, value });
}

/** Whether first-run onboarding has been completed (gates the index route). */
export const ONBOARDING_COMPLETE_KEY = 'onboardingComplete';

export async function getOnboardingComplete(
  db: BrowserClawDB,
): Promise<boolean> {
  return (await getSetting<boolean>(db, ONBOARDING_COMPLETE_KEY)) === true;
}

export async function setOnboardingComplete(
  db: BrowserClawDB,
  value: boolean,
): Promise<void> {
  await setSetting(db, ONBOARDING_COMPLETE_KEY, value);
}

/** SecretVault auto-lock idle timeout, in minutes (drives a real lock timer). */
export const LOCK_TIMEOUT_MINUTES_KEY = 'lockTimeoutMinutes';
const DEFAULT_LOCK_TIMEOUT_MINUTES = 15;

export async function getLockTimeoutMinutes(
  db: BrowserClawDB,
): Promise<number> {
  const value = await getSetting<number>(db, LOCK_TIMEOUT_MINUTES_KEY);
  return typeof value === 'number' ? value : DEFAULT_LOCK_TIMEOUT_MINUTES;
}

export async function setLockTimeoutMinutes(
  db: BrowserClawDB,
  minutes: number,
): Promise<void> {
  await setSetting(db, LOCK_TIMEOUT_MINUTES_KEY, minutes);
}

/**
 * Explicit user consent to fetch the wllama runtime WASM from the CDN. Defaults
 * to false so the app fails closed: browser-local models never silently pull
 * remote code from a CDN until the user opts in (TODO Phase 8.1).
 */
export const WLLAMA_CDN_CONSENT_KEY = 'wllamaCdnConsent';

export async function getWllamaCdnConsent(db: BrowserClawDB): Promise<boolean> {
  return (await getSetting<boolean>(db, WLLAMA_CDN_CONSENT_KEY)) === true;
}

export async function setWllamaCdnConsent(
  db: BrowserClawDB,
  value: boolean,
): Promise<void> {
  await setSetting(db, WLLAMA_CDN_CONSENT_KEY, value);
}
