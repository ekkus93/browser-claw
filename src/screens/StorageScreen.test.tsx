import 'fake-indexeddb/auto';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { describe, expect, it } from 'vitest';
import storageReducer from '../store/slices/storageSlice.ts';
import { ToastProvider } from '../components/ui/Toast.tsx';
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

  it('toasts when exporting a backup (Phase 9 placeholder)', async () => {
    const user = userEvent.setup();
    renderStorage();
    await user.click(screen.getByRole('button', { name: 'Export Backup' }));
    expect(await screen.findByText(/arrives in Phase 9/i)).toBeInTheDocument();
  });
});
