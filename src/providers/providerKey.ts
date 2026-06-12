import type { ProviderProfileRow } from '../db/types.ts';

/**
 * Resolving a provider's API key from the SecretVault, failing closed.
 *
 * The decrypted key is read from the in-memory vault only at call time and
 * handed straight to the provider — it never lands in Redux, the profile row,
 * audit payloads, or logs. A locked vault or an absent key produces a specific,
 * non-secret reason instead of a silent empty key. See HARDENING_NOTES.md.
 */

/** The narrow vault surface key resolution needs (SecretVault satisfies it). */
export interface KeySource {
  isUnlocked(): boolean;
  getSecret(id: string): Promise<string | undefined>;
}

export type SecretFailureKind = 'secret_locked' | 'secret_missing';

export type ApiKeyResolution =
  | { ok: true; apiKey?: string }
  | { ok: false; kind: SecretFailureKind; message: string };

const SECRET_MESSAGES: Record<SecretFailureKind, string> = {
  secret_locked: 'The secret vault is locked. Unlock it to use this provider.',
  secret_missing:
    'No API key is stored for this provider. Add one on the Models screen.',
};

/** Deterministic SecretVault id that holds a provider profile's API key. */
export function providerSecretId(providerId: string): string {
  return `provider:${providerId}`;
}

/**
 * Resolve the API key for a provider profile. Profiles with `apiKeyMode: 'none'`
 * (local endpoints, mock) need no key and resolve OK with none. Otherwise the
 * key must come from an unlocked vault and must exist — a locked vault yields
 * `secret_locked`, an absent key yields `secret_missing`.
 */
export async function resolveApiKey(
  source: KeySource,
  profile: ProviderProfileRow | null,
): Promise<ApiKeyResolution> {
  if (profile === null || profile.apiKeyMode === 'none') {
    return { ok: true };
  }
  if (!source.isUnlocked()) {
    return {
      ok: false,
      kind: 'secret_locked',
      message: SECRET_MESSAGES.secret_locked,
    };
  }
  const apiKey = await source.getSecret(providerSecretId(profile.id));
  if (apiKey === undefined || apiKey === '') {
    return {
      ok: false,
      kind: 'secret_missing',
      message: SECRET_MESSAGES.secret_missing,
    };
  }
  return { ok: true, apiKey };
}
