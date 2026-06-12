import 'fake-indexeddb/auto';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { describe, expect, it } from 'vitest';
import memoriesReducer from '../store/slices/memoriesSlice.ts';
import MemoriesScreen from './MemoriesScreen.tsx';

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
  it('seeds and lists memories, then filters by search', async () => {
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
});
