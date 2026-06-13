import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { KeyRound, Lock, LockOpen, ShieldCheck, Trash2 } from 'lucide-react';
import { useAppSelector } from '../store/hooks.ts';
import { db } from '../db/db.ts';
import { secretVault } from '../secrets/vault.ts';
import {
  listProviderProfiles,
  mergeProviderProfiles,
  saveProviderProfile,
} from '../providers/providerProfiles.ts';
import { providerSecretId } from '../providers/providerKey.ts';
import type { SecretStorageMode } from '../store/slices/secretsSlice.ts';
import { Button } from '../components/ui/Button.tsx';
import { Input } from '../components/ui/Input.tsx';
import { Select } from '../components/ui/Select.tsx';
import { Badge } from '../components/ui/Badge.tsx';
import { useToast } from '../components/ui/toastContext.ts';

/**
 * Security / SecretVault screen — the lock lifecycle (setup, unlock, lock,
 * session-only) plus per-provider key entry and deletion. Decrypted keys live
 * ONLY in the in-memory SecretVault; this screen writes key text straight to
 * the vault and otherwise renders only the lock state and metadata (id, label,
 * storage mode) mirrored into Redux by the vault observer — never a key value.
 */
export default function SecurityScreen() {
  const { toast } = useToast();
  const vaultLocked = useAppSelector((state) => state.secrets.vaultLocked);
  const secrets = useAppSelector((state) => state.secrets.secrets);

  const [configured, setConfigured] = useState<boolean | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  // Detect whether a passphrase-protected vault already exists. Re-checked
  // whenever the lock state flips (e.g. after a fresh setup).
  useEffect(() => {
    let active = true;
    void secretVault.isConfigured().then((value) => {
      if (active) setConfigured(value);
    });
    return () => {
      active = false;
    };
  }, [vaultLocked]);

  function clearInputs() {
    setPassphrase('');
    setConfirm('');
  }

  async function handleSetup() {
    if (passphrase.length < 8) {
      toast({
        tone: 'danger',
        title: 'Passphrase too short',
        description: 'Use at least 8 characters.',
      });
      return;
    }
    if (passphrase !== confirm) {
      toast({ tone: 'danger', title: 'Passphrases do not match' });
      return;
    }
    setBusy(true);
    try {
      await secretVault.setup(passphrase);
      clearInputs();
      toast({ tone: 'success', title: 'Vault created and unlocked' });
    } catch {
      toast({ tone: 'danger', title: 'Could not create the vault' });
    } finally {
      setBusy(false);
    }
  }

  async function handleUnlock() {
    setBusy(true);
    try {
      const ok = await secretVault.unlock(passphrase);
      if (ok) {
        clearInputs();
        toast({ tone: 'success', title: 'Vault unlocked' });
      } else {
        setPassphrase('');
        toast({
          tone: 'danger',
          title: 'Incorrect passphrase',
          description: 'The vault stays locked.',
        });
      }
    } catch {
      toast({ tone: 'danger', title: 'Could not unlock the vault' });
    } finally {
      setBusy(false);
    }
  }

  function handleSession() {
    secretVault.openSession();
    toast({
      tone: 'success',
      title: 'Session vault opened',
      description:
        'Keys live in memory only and clear when you lock or reload.',
    });
  }

  function handleLock() {
    secretVault.lock();
    clearInputs();
    toast({ tone: 'info', title: 'Vault locked' });
  }

  // --- Per-provider key entry -------------------------------------------------

  const persistedProfiles = useLiveQuery(() => listProviderProfiles(db), []);
  // Built-in templates merged with the user's saved edits; only providers that
  // actually take an API key are offered a key.
  const keyProviders = mergeProviderProfiles(persistedProfiles ?? []).filter(
    (profile) => profile.apiKeyMode !== 'none',
  );
  const canEncrypt = secretVault.canStoreEncrypted();

  const [providerId, setProviderId] = useState('');
  const [keyValue, setKeyValue] = useState('');
  const [keyMode, setKeyMode] = useState<SecretStorageMode>('session');

  const selectedProvider =
    keyProviders.find((p) => p.id === providerId) ?? keyProviders[0];

  async function handleAddKey() {
    const provider = selectedProvider;
    if (!provider || keyValue === '') return;
    // A session-only vault cannot persist ciphertext, so force session mode.
    const mode: SecretStorageMode = canEncrypt ? keyMode : 'session';
    const secretId = providerSecretId(provider.id);
    try {
      if (mode === 'encrypted') {
        await secretVault.putEncryptedSecret(
          secretId,
          provider.label,
          keyValue,
        );
      } else {
        secretVault.setSessionSecret(secretId, provider.label, keyValue);
      }
      // Keep the profile's mode honest so reloads and the Models screen agree.
      const profile = { ...provider, apiKeyMode: mode };
      if (mode === 'encrypted') profile.encryptedSecretId = secretId;
      else delete profile.encryptedSecretId;
      await saveProviderProfile(db, profile);
      setKeyValue('');
      toast({ tone: 'success', title: `Key saved for ${provider.label}` });
    } catch {
      setKeyValue('');
      toast({ tone: 'danger', title: 'Could not save the key' });
    }
  }

  async function handleDeleteKey(id: string, label: string) {
    try {
      // Remove the secret but leave the provider's apiKeyMode intact so a later
      // call fails closed (secret_missing) rather than running with no key.
      await secretVault.removeSecret(id);
      toast({ tone: 'info', title: `Key removed for ${label}` });
    } catch {
      toast({ tone: 'danger', title: 'Could not remove the key' });
    }
  }

  return (
    <div className="overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
        <header>
          <h1 className="text-xl font-bold text-text">Security</h1>
          <p className="text-sm text-muted">
            Manage the SecretVault that holds your provider API keys. Decrypted
            keys never leave memory — they are not written to disk, logs, or
            backups.
          </p>
        </header>

        <section className="rounded-card border border-border bg-surface p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {vaultLocked ? (
                <Lock className="size-5 text-muted" aria-hidden="true" />
              ) : (
                <LockOpen className="size-5 text-success" aria-hidden="true" />
              )}
              <span className="font-medium text-text">Vault</span>
              <Badge tone={vaultLocked ? 'neutral' : 'success'}>
                {vaultLocked ? 'Locked' : 'Unlocked'}
              </Badge>
            </div>
            {!vaultLocked && (
              <Button
                variant="secondary"
                size="sm"
                leadingIcon={<Lock className="size-4" />}
                onClick={handleLock}
              >
                Lock
              </Button>
            )}
          </div>

          {vaultLocked && configured === true && (
            <form
              className="mt-4 flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                void handleUnlock();
              }}
            >
              <Input
                label="Passphrase"
                type="password"
                autoComplete="current-password"
                value={passphrase}
                onChange={(event) => setPassphrase(event.target.value)}
              />
              <div className="flex justify-end">
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={busy || passphrase === ''}
                  leadingIcon={<LockOpen className="size-4" />}
                >
                  Unlock
                </Button>
              </div>
            </form>
          )}

          {vaultLocked && configured === false && (
            <div className="mt-4 flex flex-col gap-4">
              <form
                className="flex flex-col gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleSetup();
                }}
              >
                <p className="text-sm text-muted">
                  Set a passphrase to store encrypted keys that survive reloads,
                  or open a session-only vault for keys that vanish when you
                  lock or close the tab.
                </p>
                <Input
                  label="New passphrase"
                  type="password"
                  autoComplete="new-password"
                  hint="At least 8 characters. There is no recovery if you forget it."
                  value={passphrase}
                  onChange={(event) => setPassphrase(event.target.value)}
                />
                <Input
                  label="Confirm passphrase"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                />
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    leadingIcon={<KeyRound className="size-4" />}
                    onClick={handleSession}
                  >
                    Session-only instead
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    disabled={busy || passphrase === ''}
                    leadingIcon={<ShieldCheck className="size-4" />}
                  >
                    Create vault
                  </Button>
                </div>
              </form>
            </div>
          )}
        </section>

        {!vaultLocked && (
          <section className="rounded-card border border-border bg-surface p-4">
            <h2 className="mb-3 text-sm font-semibold text-text">
              Provider keys
            </h2>

            {secrets.length === 0 ? (
              <p className="text-sm text-muted">No keys stored yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {secrets.map((secret) => (
                  <li
                    key={secret.id}
                    className="flex items-center justify-between gap-2 rounded-button border border-border px-3 py-2"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <KeyRound
                        className="size-4 shrink-0 text-muted"
                        aria-hidden="true"
                      />
                      <span className="truncate text-sm text-text">
                        {secret.label}
                      </span>
                      <Badge
                        tone={
                          secret.storageMode === 'encrypted'
                            ? 'success'
                            : 'neutral'
                        }
                      >
                        {secret.storageMode === 'encrypted'
                          ? 'Encrypted'
                          : 'Session'}
                      </Badge>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      leadingIcon={<Trash2 className="size-4" />}
                      onClick={() => {
                        void handleDeleteKey(secret.id, secret.label);
                      }}
                    >
                      Delete
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            {keyProviders.length === 0 ? (
              <p className="mt-4 text-sm text-muted">
                Add a provider on the Models screen to store a key for it.
              </p>
            ) : (
              <form
                className="mt-4 flex flex-col gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleAddKey();
                }}
              >
                <div className="flex flex-wrap items-end gap-3">
                  <Select
                    label="Provider"
                    value={selectedProvider?.id ?? ''}
                    onChange={(event) => setProviderId(event.target.value)}
                  >
                    {keyProviders.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.label}
                      </option>
                    ))}
                  </Select>
                  <Select
                    label="Storage"
                    value={canEncrypt ? keyMode : 'session'}
                    disabled={!canEncrypt}
                    onChange={(event) =>
                      setKeyMode(event.target.value as SecretStorageMode)
                    }
                  >
                    <option value="session">Session only</option>
                    {canEncrypt && <option value="encrypted">Encrypted</option>}
                  </Select>
                </div>
                <Input
                  label="API key"
                  type="password"
                  autoComplete="off"
                  placeholder="Paste the provider API key"
                  value={keyValue}
                  onChange={(event) => setKeyValue(event.target.value)}
                />
                <div className="flex justify-end">
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    disabled={keyValue === '' || !selectedProvider}
                    leadingIcon={<KeyRound className="size-4" />}
                  >
                    Save key
                  </Button>
                </div>
                {!canEncrypt && (
                  <p className="text-xs text-muted-subtle">
                    Session-only vault: keys are held in memory and cleared when
                    you lock or reload. Set a passphrase to store encrypted
                    keys.
                  </p>
                )}
              </form>
            )}
          </section>
        )}

        <section className="rounded-card border border-border bg-surface p-4">
          <h2 className="mb-2 text-sm font-semibold text-text">
            How keys are protected
          </h2>
          <ul className="flex list-inside list-disc flex-col gap-1 text-sm text-muted">
            <li>
              Encrypted keys are sealed with AES-GCM using your passphrase.
            </li>
            <li>
              Decrypted keys exist only in memory while the vault is open.
            </li>
            <li>The vault auto-locks after a period of inactivity.</li>
            <li>Keys are never included in audit logs or exported backups.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
