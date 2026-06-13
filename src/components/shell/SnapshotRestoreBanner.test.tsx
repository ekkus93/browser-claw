import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { describe, expect, it } from 'vitest';
import runtimeReducer, {
  snapshotRestoreWarned,
} from '../../store/slices/runtimeSlice.ts';
import { SnapshotRestoreBanner } from './SnapshotRestoreBanner.tsx';

function renderBanner() {
  const store = configureStore({ reducer: { runtime: runtimeReducer } });
  render(
    <Provider store={store}>
      <SnapshotRestoreBanner />
    </Provider>,
  );
  return store;
}

describe('SnapshotRestoreBanner', () => {
  it('renders nothing when there is no snapshot issue', () => {
    renderBanner();
    expect(
      screen.queryByTestId('snapshot-restore-banner'),
    ).not.toBeInTheDocument();
  });

  it('warns about an incompatible snapshot and can be dismissed', async () => {
    const user = userEvent.setup();
    const store = renderBanner();
    store.dispatch(snapshotRestoreWarned('incompatible'));

    expect(
      await screen.findByTestId('snapshot-restore-banner'),
    ).toBeInTheDocument();
    expect(screen.getByText(/incompatible version of BrowserClaw/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(store.getState().runtime.snapshotIssue).toBeNull();
    expect(
      screen.queryByTestId('snapshot-restore-banner'),
    ).not.toBeInTheDocument();
  });

  it('shows a distinct message when the snapshot could not be read', async () => {
    const store = renderBanner();
    store.dispatch(snapshotRestoreWarned('restore_failed'));

    expect(
      await screen.findByText(/snapshot could not be read/i),
    ).toBeInTheDocument();
  });
});
