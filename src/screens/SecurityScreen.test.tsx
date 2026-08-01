import 'fake-indexeddb/auto';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// SecurityScreen reads lock state / metadata that the singleton SecretVault
// mirrors into the REAL app store, so the test must render against that store.
import { store } from '../store/store.ts';
import { secretMetadataRemoved } from '../store/slices/secretsSlice.ts';
import { db } from '../db/db.ts';
import { secretVault } from '../secrets/vault.ts';
import { ToastProvider } from '../components/ui/Toast.tsx';
import SecurityScreen from './SecurityScreen.tsx';

function renderSecurity() {
  render(
    <Provider store={store}>
      <ToastProvider>
        <SecurityScreen />
      </ToastProvider>
    </Provider>,
  );
}

beforeEach(async () => {
  await db.open();
  // Start every test from a pristine, unconfigured, locked vault.
  await db.app_settings.clear();
  await db.encrypted_secrets.clear();
  await db.provider_profiles.clear();
  secretVault.lock();
  // The singleton vault mirrors metadata into the shared real store; clear any
  // leftovers so each test starts with no listed keys regardless of order.
  for (const secret of store.getState().secrets.secrets) {
    store.dispatch(secretMetadataRemoved(secret.id));
  }
});

afterEach(() => {
  cleanup();
  // Clear plaintext + the 15-min auto-lock timer between tests.
  secretVault.lock();
});

describe('SecurityScreen', () => {
  it('first run: setting a passphrase creates and unlocks the vault', async () => {
    const user = userEvent.setup();
    renderSecurity();

    // No vault configured yet -> the setup form is shown.
    const passphrase = await screen.findByLabelText('New passphrase');
    await user.type(passphrase, 'correct horse');
    await user.type(
      screen.getByLabelText('Confirm passphrase'),
      'correct horse',
    );
    await user.click(screen.getByRole('button', { name: 'Create vault' }));

    await waitFor(() =>
      expect(screen.getByText('Unlocked')).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Lock' })).toBeInTheDocument();
    expect(await secretVault.isConfigured()).toBe(true);
  });

  it('a wrong passphrase keeps the vault locked', async () => {
    // Pre-configure a vault, then lock it so the unlock form renders.
    await secretVault.setup('the-real-passphrase');
    secretVault.lock();

    const user = userEvent.setup();
    renderSecurity();

    const passphrase = await screen.findByLabelText('Passphrase');
    await user.type(passphrase, 'not-the-passphrase');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));

    expect(await screen.findByText('Incorrect passphrase')).toBeInTheDocument();
    expect(screen.getByText('Locked')).toBeInTheDocument();
    expect(secretVault.isUnlocked()).toBe(false);
  });

  it('opens a session-only vault without a passphrase', async () => {
    const user = userEvent.setup();
    renderSecurity();

    await screen.findByLabelText('New passphrase');
    await user.click(
      screen.getByRole('button', { name: 'Session-only instead' }),
    );

    await waitFor(() =>
      expect(screen.getByText('Unlocked')).toBeInTheDocument(),
    );
    // A session vault persists nothing.
    expect(await secretVault.isConfigured()).toBe(false);
  });

  it('locks an unlocked vault', async () => {
    secretVault.openSession();
    const user = userEvent.setup();
    renderSecurity();

    await waitFor(() =>
      expect(screen.getByText('Unlocked')).toBeInTheDocument(),
    );
    await user.click(screen.getByRole('button', { name: 'Lock' }));

    await waitFor(() => expect(screen.getByText('Locked')).toBeInTheDocument());
    expect(secretVault.isUnlocked()).toBe(false);
  });

  it('adds a session key for a provider and then deletes it', async () => {
    const SECRET = 'sk-super-secret-value';
    secretVault.openSession();
    const user = userEvent.setup();
    renderSecurity();

    // Provider picker is populated from the built-in templates (no seeding).
    const apiKey = await screen.findByLabelText('API key');
    expect(apiKey).toHaveAttribute('type', 'password');
    await user.type(apiKey, SECRET);
    await user.click(screen.getByRole('button', { name: 'Save key' }));

    // The stored key shows up by provider label + storage mode — never value.
    expect(await screen.findByText('Session')).toBeInTheDocument();
    expect(secretVault.listSecrets().length).toBe(1);

    // The raw key text must NOT appear anywhere in the rendered DOM, and the
    // Redux metadata must carry no value field.
    expect(document.body.textContent).not.toContain(SECRET);
    const meta = store.getState().secrets.secrets[0];
    expect(meta).toBeDefined();
    expect(JSON.stringify(meta)).not.toContain(SECRET);

    // Delete removes the key from the vault and the list.
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(screen.getByText('No keys stored yet.')).toBeInTheDocument(),
    );
    expect(secretVault.listSecrets().length).toBe(0);
  });
});
