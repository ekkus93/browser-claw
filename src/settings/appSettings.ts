import type { BrowserClawDB } from '../db/db.ts';
import { normalizeTheme, type Theme } from './theme.ts';

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

/** UI color theme; applied to <html data-theme> and restored on every boot. */
export const THEME_KEY = 'theme';

export async function getTheme(db: BrowserClawDB): Promise<Theme> {
  return normalizeTheme(await getSetting<Theme>(db, THEME_KEY));
}

export async function setTheme(db: BrowserClawDB, theme: Theme): Promise<void> {
  await setSetting(db, THEME_KEY, theme);
}

/**
 * Inline-approval policy. Default `require_all` is fail-closed: every proposed
 * side effect waits for the user's approval card (the CLAUDE.md guarantee that
 * "no meaningful side effect happens silently"). The opt-in `auto_low_medium`
 * relaxation auto-runs only low- and medium-risk calls — HIGH risk ALWAYS
 * prompts, and auto-approved calls are still fully audited, so nothing is truly
 * silent. There is no mode that can auto-approve high-risk effects.
 */
export type ApprovalPolicy = 'require_all' | 'auto_low_medium';
export const APPROVAL_POLICY_KEY = 'approvalPolicy';

export async function getApprovalPolicy(
  db: BrowserClawDB,
): Promise<ApprovalPolicy> {
  const value = await getSetting<ApprovalPolicy>(db, APPROVAL_POLICY_KEY);
  return value === 'auto_low_medium' ? 'auto_low_medium' : 'require_all';
}

export async function setApprovalPolicy(
  db: BrowserClawDB,
  policy: ApprovalPolicy,
): Promise<void> {
  await setSetting(db, APPROVAL_POLICY_KEY, policy);
}

/**
 * Optional fallback provider id. When set, an LLM request whose primary call
 * fails with a reachability/transient error retries once on this provider (see
 * llmRunner). null = no fallback (default). Stored as the provider id, reusing
 * the same provider-profile ids as the active provider.
 */
export const FALLBACK_PROVIDER_KEY = 'fallbackProviderId';

export async function getFallbackProviderId(
  db: BrowserClawDB,
): Promise<string | null> {
  const value = await getSetting<string>(db, FALLBACK_PROVIDER_KEY);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export async function setFallbackProviderId(
  db: BrowserClawDB,
  id: string | null,
): Promise<void> {
  await setSetting(db, FALLBACK_PROVIDER_KEY, id);
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

/**
 * In-progress onboarding so a mid-setup reload resumes at the right step with
 * the user's choices intact, instead of restarting at step 0 (TODO Phase 9.1).
 * Cleared once onboarding finishes.
 */
export interface OnboardingProgress {
  step: number;
  mode: 'wllama' | 'local' | 'remote';
  endpoint: string;
  provider: string;
}

export const ONBOARDING_PROGRESS_KEY = 'onboardingProgress';

export async function getOnboardingProgress(
  db: BrowserClawDB,
): Promise<OnboardingProgress | undefined> {
  return getSetting<OnboardingProgress>(db, ONBOARDING_PROGRESS_KEY);
}

export async function setOnboardingProgress(
  db: BrowserClawDB,
  value: OnboardingProgress,
): Promise<void> {
  await setSetting(db, ONBOARDING_PROGRESS_KEY, value);
}

export async function clearOnboardingProgress(
  db: BrowserClawDB,
): Promise<void> {
  await db.app_settings.delete(ONBOARDING_PROGRESS_KEY);
}
