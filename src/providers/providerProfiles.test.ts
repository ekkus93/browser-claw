import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { BrowserClawDB } from '../db/db.ts';
import type { ProviderProfileRow } from '../db/types.ts';
import {
  DEFAULT_PROVIDER_PROFILES,
  defaultProviderProfile,
  mergeProviderProfiles,
  listProviderProfiles,
  getProviderProfile,
  saveProviderProfile,
  deleteProviderProfile,
  getActiveProviderId,
  setActiveProviderId,
  getActiveProviderProfile,
} from './providerProfiles.ts';

const db = new BrowserClawDB();

afterEach(async () => {
  await db.provider_profiles.clear();
  await db.app_settings.clear();
});

const openai = (
  over: Partial<ProviderProfileRow> = {},
): ProviderProfileRow => ({
  id: 'openai',
  kind: 'openai',
  label: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o',
  apiKeyMode: 'encrypted',
  ...over,
});

describe('provider profile store', () => {
  it('creates, reads, updates, and deletes profiles', async () => {
    await saveProviderProfile(db, openai({ baseUrl: 'https://proxy/v1' }));
    expect((await getProviderProfile(db, 'openai'))?.baseUrl).toBe(
      'https://proxy/v1',
    );

    // put() upserts: a second save with the same id updates in place.
    await saveProviderProfile(db, openai({ model: 'gpt-4.1' }));
    const list = await listProviderProfiles(db);
    expect(list).toHaveLength(1);
    expect(list[0]?.model).toBe('gpt-4.1');

    await deleteProviderProfile(db, 'openai');
    expect(await getProviderProfile(db, 'openai')).toBeUndefined();
  });

  it('merges persisted edits over the built-in templates, in order', () => {
    const merged = mergeProviderProfiles([
      openai({ baseUrl: 'https://edited' }),
    ]);
    expect(merged).toHaveLength(DEFAULT_PROVIDER_PROFILES.length);
    expect(merged[0]?.id).toBe('openai');
    expect(merged[0]?.baseUrl).toBe('https://edited');
    // Untouched providers fall back to their template.
    expect(merged[1]).toEqual(defaultProviderProfile('anthropic'));
  });

  it('persists and resolves the active provider id', async () => {
    expect(await getActiveProviderId(db)).toBeNull();
    expect(await getActiveProviderProfile(db)).toBeNull();

    await setActiveProviderId(db, 'openai');
    expect(await getActiveProviderId(db)).toBe('openai');

    // With no saved row, the active profile falls back to the template.
    expect((await getActiveProviderProfile(db))?.label).toBe('OpenAI');

    await saveProviderProfile(db, openai({ model: 'custom' }));
    expect((await getActiveProviderProfile(db))?.model).toBe('custom');
  });
});
