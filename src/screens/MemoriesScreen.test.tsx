import 'fake-indexeddb/auto';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { beforeEach, describe, expect, it } from 'vitest';
import memoriesReducer from '../store/slices/memoriesSlice.ts';
import { db } from '../db/db.ts';
import { SAMPLE_MEMORIES } from '../memories/sampleMemories.ts';
import MemoriesScreen from './MemoriesScreen.tsx';

// A normal build no longer seeds; the tests populate the store directly.
beforeEach(async () => {
  await db.open();
  await db.memories.clear();
  await db.memories.bulkPut(SAMPLE_MEMORIES);
});

function renderMemories() {
  const store = configureStore({ reducer: { memories: memoriesReducer } });
  render(
    <Provider store={store}>
      <MemoriesScreen />
    </Provider>,
  );
  return store;
}

describe('MemoriesScreen', () => {
  it('a fresh non-demo DB shows the empty state and seeds nothing', async () => {
    // The default (non-demo) build must never auto-insert sample memories.
    // appConfig.isDemoMode is false unless VITE_DEMO_MODE is set, so the
    // seeding effect must early-return and leave the store empty.
    await db.memories.clear();
    renderMemories();

    await waitFor(() =>
      expect(screen.getByText('No memories yet.')).toBeInTheDocument(),
    );
    // Give the seeding effect a chance to (wrongly) run, then assert it didn't.
    expect(await db.memories.count()).toBe(0);
    expect(
      screen.queryByRole('button', { name: /Rust ownership basics/ }),
    ).not.toBeInTheDocument();
  });

  it('shows honest sidebar empty states when no memory has been used', async () => {
    // Memories exist but none have been retrieved into a chat (no lastUsedAt):
    // the "Recently used" / "Retrieval history" boxes must say so, not render a
    // blank, ambiguous panel.
    await db.memories.clear();
    await db.memories.bulkPut(
      SAMPLE_MEMORIES.map((m) => {
        const copy = { ...m };
        delete copy.lastUsedAt;
        return copy;
      }),
    );
    renderMemories();

    expect(
      await screen.findByText('No memories used yet.'),
    ).toBeInTheDocument();
    expect(screen.getByText('No retrievals yet.')).toBeInTheDocument();
  });

  it('lists memories, then filters by search', async () => {
    const user = userEvent.setup();
    renderMemories();

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /Rust ownership basics/ }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole('button', { name: /WebAssembly memory model/ }),
    ).toBeInTheDocument();

    await user.type(
      screen.getByRole('textbox', { name: 'Search' }),
      'ownership',
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: /WebAssembly memory model/ }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole('button', { name: /Rust ownership basics/ }),
    ).toBeInTheDocument();
  });

  it('filters the list by created-by (a real, wired filter)', async () => {
    const user = userEvent.setup();
    renderMemories();

    // mem-3 ("Rust ownership basics") was created by the user; the two
    // assistant-authored samples should disappear when we filter to "user".
    await screen.findByRole('button', { name: /WebAssembly memory model/ });
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Created by' }),
      'user',
    );

    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: /WebAssembly memory model/ }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole('button', { name: /Rust ownership basics/ }),
    ).toBeInTheDocument();

    // Clearing filters restores the full list.
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /WebAssembly memory model/ }),
      ).toBeInTheDocument(),
    );
  });

  it('edits the selected memory and persists the change', async () => {
    const user = userEvent.setup();
    renderMemories();
    await screen.findByRole('button', { name: /Rust\/WASM architecture/ });

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const titleInput = screen.getByLabelText('Title');
    await user.clear(titleInput);
    await user.type(titleInput, 'Rust/WASM (edited)');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Rust/WASM (edited)' }),
      ).toBeInTheDocument(),
    );
  });
});
