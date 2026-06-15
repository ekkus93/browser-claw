import 'fake-indexeddb/auto';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { describe, expect, it } from 'vitest';
import storageReducer from '../store/slices/storageSlice.ts';
import { ToastProvider } from '../components/ui/Toast.tsx';
import { db } from '../db/db.ts';
import { exportBackup, serializeBackup } from '../backup/backupService.ts';
import { SAMPLE_MEMORIES } from '../memories/sampleMemories.ts';
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

  it('imports a backup file: shows a preview, then restore writes it back', async () => {
    // Integration (TODO 11.3): importing must preview before touching data (no
    // silent restore), then a confirmed restore re-creates the records.
    const user = userEvent.setup();
    const memory = SAMPLE_MEMORIES[0]!;
    await db.memories.clear();
    await db.memories.bulkPut([memory]);
    const file = new File(
      [serializeBackup(await exportBackup(db))],
      'data.clawbackup',
      { type: 'application/json' },
    );

    renderStorage();

    await user.upload(screen.getByLabelText('Import backup file'), file);
    // A preview dialog appears first — nothing is restored yet.
    expect(await screen.findByText('Restore backup?')).toBeInTheDocument();

    // Wipe local data, then confirm the restore brings it back.
    await db.memories.clear();
    await user.click(screen.getByRole('button', { name: 'Restore' }));

    // The success toast fires only after importBackup resolves, so the write
    // has already landed by the time it appears.
    expect(await screen.findByText('Backup restored')).toBeInTheDocument();
    expect(await db.memories.get(memory.id)).toBeTruthy();

    // The restore is a meaningful action and must be durably audited.
    const audited = await db.audit_events
      .where('type')
      .equals('backup.imported')
      .toArray();
    expect(audited.some((e) => e.source === 'backup')).toBe(true);
  });

  it('previews how many existing records a restore would overwrite', async () => {
    // Importing a backup of data still present in the DB must warn that the
    // restore overwrites those records (TODO 6.2 conflicts), not silently merge.
    const user = userEvent.setup();
    const memory = SAMPLE_MEMORIES[0]!;
    await db.memories.clear();
    await db.memories.bulkPut([memory]);
    const file = new File(
      [serializeBackup(await exportBackup(db))],
      'data.clawbackup',
      { type: 'application/json' },
    );

    renderStorage();
    await user.upload(screen.getByLabelText('Import backup file'), file);

    // The memory is still in the DB, so the preview flags the overwrite.
    expect(
      await screen.findByText('Overwrites existing records'),
    ).toBeInTheDocument();
  });

  it('preview notes that the backup references models, not model files', async () => {
    // A backup carries model references (catalog/cache index) but never model
    // binaries, so the preview must say referenced models may need redownloading.
    const user = userEvent.setup();
    await db.model_catalog.clear();
    await db.model_catalog.put({
      id: 'model-1',
      provider: 'wllama',
      label: 'Model 1',
    });
    const file = new File(
      [serializeBackup(await exportBackup(db))],
      'data.clawbackup',
      { type: 'application/json' },
    );

    renderStorage();
    await user.upload(screen.getByLabelText('Import backup file'), file);

    expect(
      await screen.findByText(/model files are not included/),
    ).toBeTruthy();
  });
});
