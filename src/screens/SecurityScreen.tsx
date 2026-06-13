import { useEffect, useState } from 'react';
import { KeyRound, Lock, LockOpen, ShieldCheck } from 'lucide-react';
import { useAppSelector } from '../store/hooks.ts';
import { secretVault } from '../secrets/vault.ts';
import { Button } from '../components/ui/Button.tsx';
import { Input } from '../components/ui/Input.tsx';
import { Badge } from '../components/ui/Badge.tsx';
import { useToast } from '../components/ui/toastContext.ts';

/**
 * Security / SecretVault screen — the lock lifecycle (setup, unlock, lock,
 * session-only). Decrypted keys live ONLY in the in-memory SecretVault; this
 * screen never reads or renders a key value, only the lock state and metadata
 * mirrored into Redux by the vault observer. Secret entry/delete lands next.
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

          {!vaultLocked && (
            <p className="mt-3 text-sm text-muted">
              {secrets.length === 0
                ? 'No keys stored yet.'
                : `${secrets.length} key${secrets.length === 1 ? '' : 's'} available this session.`}
            </p>
          )}

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
