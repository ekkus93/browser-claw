import 'fake-indexeddb/auto';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { describe, expect, it } from 'vitest';
import storageReducer from '../store/slices/storageSlice.ts';
import { ToastProvider } from '../components/ui/Toast.tsx';
import { db } from '../db/db.ts';
import StorageScreen from './StorageScreen.tsx';

function renderStorage() {
  const store = configureStore({ reducer: { storage: storageReducer } });
  render(
    <Provider store={store}>
      <ToastProvider>
        <StorageScreen />
      </ToastProvider>
    </Provider>,
  );
  return store;
}

describe('StorageScreen', () => {
  it('shows the storage overview and backup sections', () => {
    renderStorage();
    expect(
      screen.getByRole('heading', { name: 'Storage Overview' }),
    ).toBeInTheDocument();
    expect(screen.getByText('IndexedDB')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /Backup & Restore/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('No backups yet.')).toBeInTheDocument();
  });

  it('surfaces an honest storage-unavailable state instead of fake all-green health', async () => {
    // In jsdom navigator.storage is absent, so the estimate is unavailable
    // (quotaBytes 0). The health panel must say so — not claim a hardcoded set
    // of always-healthy subsystems.
    renderStorage();

    expect(
      await screen.findByText(/storage estimate unavailable/i),
    ).toBeInTheDocument();
    // The previously-fabricated, always-green health claims must be gone.
    expect(screen.queryByText('Cache storage healthy')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Service worker healthy'),
    ).not.toBeInTheDocument();
  });

  it('reports the real model-cache size, not a hardcoded figure', async () => {
    // Empty blob store -> an honest "0 models cached" derived from db, replacing
    // the prior static "Tracked per model" sub-label.
    await db.model_blobs.clear();
    renderStorage();

    expect(await screen.findByText('0 models cached')).toBeInTheDocument();
    expect(screen.queryByText('Tracked per model')).not.toBeInTheDocument();
  });

  it('exports a backup over Dexie', async () => {
    const user = userEvent.setup();
    renderStorage();
    await user.click(screen.getByRole('button', { name: 'Export Backup' }));
    expect(await screen.findByText('Backup exported')).toBeInTheDocument();
  });
});
