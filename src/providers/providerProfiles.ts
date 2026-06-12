import type { BrowserClawDB } from '../db/db.ts';
import type { ProviderProfileRow } from '../db/types.ts';

/**
 * Durable provider-profile store. A profile (base URL, model, key reference) is
 * the source of truth for how a provider connects; profiles live in IndexedDB,
 * not Redux. No secret material here — `encryptedSecretId` only references an
 * `encrypted_secrets` row (Phase 2.3); the decrypted key lives solely in the
 * in-memory SecretVault. See HARDENING_NOTES.md.
 */

const ACTIVE_PROVIDER_SETTING = 'activeProviderId';

/**
 * Built-in provider templates. These are NOT auto-seeded into IndexedDB; they
 * are merged over persisted rows so the Models screen always shows the known
 * providers, with the user's saved edits taking precedence.
 */
export const DEFAULT_PROVIDER_PROFILES: readonly ProviderProfileRow[] = [
  {
    id: 'openai',
    kind: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    apiKeyMode: 'encrypted',
  },
  {
    id: 'anthropic',
    kind: 'anthropic',
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-opus-4-8',
    apiKeyMode: 'encrypted',
  },
  {
    id: 'compatible',
    kind: 'openai_compatible',
    label: 'OpenAI-compatible',
    baseUrl: '',
    model: '',
    apiKeyMode: 'encrypted',
  },
  {
    id: 'ollama',
    kind: 'ollama',
    label: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3',
    apiKeyMode: 'none',
  },
  {
    id: 'llama-server',
    kind: 'llama_server',
    label: 'llama-server',
    baseUrl: 'http://localhost:8080/v1',
    model: 'local-model',
    apiKeyMode: 'none',
  },
];

/** The default template for a known provider id, if any. */
export function defaultProviderProfile(
  id: string,
): ProviderProfileRow | undefined {
  return DEFAULT_PROVIDER_PROFILES.find((profile) => profile.id === id);
}

/**
 * Merge persisted rows over the built-in templates, in template order. Persisted
 * edits win; providers the user has never touched fall back to their template.
 */
export function mergeProviderProfiles(
  persisted: readonly ProviderProfileRow[],
): ProviderProfileRow[] {
  const byId = new Map(persisted.map((profile) => [profile.id, profile]));
  return DEFAULT_PROVIDER_PROFILES.map((template) => {
    const saved = byId.get(template.id);
    return saved ?? template;
  });
}

export function listProviderProfiles(
  db: BrowserClawDB,
): Promise<ProviderProfileRow[]> {
  return db.provider_profiles.toArray();
}

export function getProviderProfile(
  db: BrowserClawDB,
  id: string,
): Promise<ProviderProfileRow | undefined> {
  return db.provider_profiles.get(id);
}

/** Create or update a profile (id is the primary key). */
export async function saveProviderProfile(
  db: BrowserClawDB,
  profile: ProviderProfileRow,
): Promise<ProviderProfileRow> {
  await db.provider_profiles.put(profile);
  return profile;
}

export async function deleteProviderProfile(
  db: BrowserClawDB,
  id: string,
): Promise<void> {
  await db.provider_profiles.delete(id);
}

export async function getActiveProviderId(
  db: BrowserClawDB,
): Promise<string | null> {
  const row = await db.app_settings.get(ACTIVE_PROVIDER_SETTING);
  return typeof row?.value === 'string' ? row.value : null;
}

export async function setActiveProviderId(
  db: BrowserClawDB,
  id: string | null,
): Promise<void> {
  await db.app_settings.put({ key: ACTIVE_PROVIDER_SETTING, value: id });
}

/** The active profile, merged with its template, or null when none is set. */
export async function getActiveProviderProfile(
  db: BrowserClawDB,
): Promise<ProviderProfileRow | null> {
  const id = await getActiveProviderId(db);
  if (id === null) return null;
  const persisted = await getProviderProfile(db, id);
  return persisted ?? defaultProviderProfile(id) ?? null;
}
