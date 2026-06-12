import { describe, expect, it } from 'vitest';
import {
  resolveApiKey,
  providerSecretId,
  type KeySource,
} from './providerKey.ts';
import type { ProviderProfileRow } from '../db/types.ts';

function profile(over: Partial<ProviderProfileRow> = {}): ProviderProfileRow {
  return {
    id: 'openai',
    kind: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    apiKeyMode: 'encrypted',
    ...over,
  };
}

function source(opts: {
  unlocked: boolean;
  secrets?: Record<string, string>;
}): KeySource {
  return {
    isUnlocked: () => opts.unlocked,
    getSecret: (id) => Promise.resolve(opts.secrets?.[id]),
  };
}

describe('resolveApiKey', () => {
  it('needs no key for key-less providers or no profile', async () => {
    expect(
      await resolveApiKey(
        source({ unlocked: false }),
        profile({ apiKeyMode: 'none' }),
      ),
    ).toEqual({ ok: true });
    expect(await resolveApiKey(source({ unlocked: false }), null)).toEqual({
      ok: true,
    });
  });

  it('fails closed with secret_locked when the vault is locked', async () => {
    const result = await resolveApiKey(source({ unlocked: false }), profile());
    expect(result).toMatchObject({ ok: false, kind: 'secret_locked' });
  });

  it('fails with secret_missing when unlocked but no key is stored', async () => {
    const result = await resolveApiKey(source({ unlocked: true }), profile());
    expect(result).toMatchObject({ ok: false, kind: 'secret_missing' });
  });

  it('returns the stored key for the provider when present', async () => {
    const result = await resolveApiKey(
      source({
        unlocked: true,
        secrets: { [providerSecretId('openai')]: 'sk-live-123' },
      }),
      profile(),
    );
    expect(result).toEqual({ ok: true, apiKey: 'sk-live-123' });
  });
});
