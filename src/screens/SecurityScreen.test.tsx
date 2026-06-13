import 'fake-indexeddb/auto';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// SecurityScreen reads lock state / metadata that the singleton SecretVault
// mirrors into the REAL app store, so the test must render against that store.
import { store } from '../store/store.ts';
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
  secretVault.lock();
});

afterEach(() => {
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
});
