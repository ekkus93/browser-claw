import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { db } from '../db/db.ts';
import {
  getSetting,
  setSetting,
  getOnboardingComplete,
  setOnboardingComplete,
  ONBOARDING_COMPLETE_KEY,
  getLockTimeoutMinutes,
  setLockTimeoutMinutes,
  getWllamaCdnConsent,
  setWllamaCdnConsent,
  WLLAMA_CDN_CONSENT_KEY,
  getOnboardingProgress,
  setOnboardingProgress,
  clearOnboardingProgress,
} from './appSettings.ts';

describe('appSettings', () => {
  afterEach(async () => {
    await db.app_settings.clear();
  });

  it('round-trips an arbitrary value through IndexedDB', async () => {
    expect(await getSetting(db, 'theme')).toBeUndefined();
    await setSetting(db, 'theme', 'dark');
    expect(await getSetting<string>(db, 'theme')).toBe('dark');
  });

  it('defaults onboarding completion to false when unset', async () => {
    expect(await getOnboardingComplete(db)).toBe(false);
  });

  it('persists onboarding completion durably', async () => {
    await setOnboardingComplete(db, true);
    expect(await getOnboardingComplete(db)).toBe(true);
    // Stored under the documented key so other readers agree.
    const row = await db.app_settings.get(ONBOARDING_COMPLETE_KEY);
    expect(row?.value).toBe(true);
  });

  it('defaults the lock timeout to 15 minutes when unset', async () => {
    expect(await getLockTimeoutMinutes(db)).toBe(15);
  });

  it('persists the lock timeout durably', async () => {
    await setLockTimeoutMinutes(db, 60);
    expect(await getLockTimeoutMinutes(db)).toBe(60);
  });

  it('defaults wllama CDN consent to false (fails closed) when unset', async () => {
    expect(await getWllamaCdnConsent(db)).toBe(false);
  });

  it('persists wllama CDN consent durably', async () => {
    await setWllamaCdnConsent(db, true);
    expect(await getWllamaCdnConsent(db)).toBe(true);
    const row = await db.app_settings.get(WLLAMA_CDN_CONSENT_KEY);
    expect(row?.value).toBe(true);
  });

  it('round-trips and clears onboarding progress', async () => {
    expect(await getOnboardingProgress(db)).toBeUndefined();
    await setOnboardingProgress(db, {
      step: 2,
      mode: 'remote',
      endpoint: 'http://localhost:11434',
      provider: 'openai',
    });
    expect(await getOnboardingProgress(db)).toEqual({
      step: 2,
      mode: 'remote',
      endpoint: 'http://localhost:11434',
      provider: 'openai',
    });
    await clearOnboardingProgress(db);
    expect(await getOnboardingProgress(db)).toBeUndefined();
  });
});
