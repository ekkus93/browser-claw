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
