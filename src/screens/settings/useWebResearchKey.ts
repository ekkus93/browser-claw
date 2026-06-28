import { useState } from 'react';
import { useAppDispatch, useAppSelector } from '../../store/hooks.ts';
import { db } from '../../db/db.ts';
import { secretVault } from '../../secrets/vault.ts';
import { recordAudit } from '../../audit/auditSink.ts';
import {
  searchProviderSecretId,
  BRAVE_PROFILE_ID,
} from '../../webresearch/braveSearch.ts';

// D2: canonical key ID is search_provider:brave (matches resolveSearchProviderKey)
export const BRAVE_KEY_ID = searchProviderSecretId(BRAVE_PROFILE_ID);
export const BRAVE_KEY_LABEL = 'Brave Search API key';

export interface WebResearchKeyState {
  /** True when a key is present in the vault (Redux metadata reflects this). */
  keyConfigured: boolean;
  /** True when the vault is locked — saving is not possible. */
  vaultLocked: boolean;
  /** True when the vault is unlocked but cannot persist encrypted secrets
   *  (session-only mode — key will be lost on reload). */
  sessionOnly: boolean;
  /** Controlled input value for the key entry field. */
  keyInput: string;
  setKeyInput: (v: string) => void;
  /** Save the current keyInput value to the vault and Dexie. */
  saveKey: () => Promise<void>;
  /** Remove the key from the vault and Dexie. */
  clearKey: () => Promise<void>;
  saving: boolean;
  saveError: string | null;
}

/**
 * Manages the Brave Search API key entry, save, and clear lifecycle.
 *
 * Security contract:
 *   - The raw key never touches Redux state, localStorage, or audit details.
 *   - If the vault has a passphrase key, the secret is persisted encrypted.
 *   - If the vault is session-only (no passphrase), the secret is held in
 *     memory only and lost on reload.
 *   - If the vault is locked, saving is rejected.
 */
export function useWebResearchKey(): WebResearchKeyState {
  const dispatch = useAppDispatch();
  const vaultLocked = useAppSelector((state) => state.secrets.vaultLocked);
  const keyConfigured = useAppSelector((state) =>
    state.secrets.secrets.some((s) => s.id === BRAVE_KEY_ID),
  );

  const [keyInput, setKeyInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const sessionOnly = !vaultLocked && !secretVault.canStoreEncrypted();

  const saveKey = async (): Promise<void> => {
    const trimmed = keyInput.trim();
    if (!trimmed) {
      setSaveError('API key cannot be blank.');
      return;
    }
    if (vaultLocked) {
      setSaveError('Vault is locked — unlock it before saving a key.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      if (secretVault.canStoreEncrypted()) {
        await secretVault.putEncryptedSecret(
          BRAVE_KEY_ID,
          BRAVE_KEY_LABEL,
          trimmed,
        );
      } else {
        secretVault.setSessionSecret(BRAVE_KEY_ID, BRAVE_KEY_LABEL, trimmed);
      }
      await recordAudit(db, dispatch, {
        type: 'web.search_key_saved',
        summary: 'Brave Search API key saved',
        source: 'user',
        status: 'success',
        risk: 'low',
      });
      setKeyInput('');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save key.');
    } finally {
      setSaving(false);
    }
  };

  const clearKey = async (): Promise<void> => {
    try {
      await secretVault.removeSecret(BRAVE_KEY_ID);
      await recordAudit(db, dispatch, {
        type: 'web.search_key_cleared',
        summary: 'Brave Search API key cleared',
        source: 'user',
        status: 'success',
        risk: 'medium',
      });
    } catch {
      // Key may not exist in the store; ignore.
    }
  };

  return {
    keyConfigured,
    vaultLocked,
    sessionOnly,
    keyInput,
    setKeyInput,
    saveKey,
    clearKey,
    saving,
    saveError,
  };
}
