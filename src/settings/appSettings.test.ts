import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { db } from '../db/db.ts';
import {
  getSetting,
  setSetting,
  getOnboardingComplete,
  setOnboardingComplete,
  ONBOARDING_COMPLETE_KEY,
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
});
