import 'fake-indexeddb/auto';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { afterEach, describe, expect, it } from 'vitest';
import providersReducer from '../store/slices/providersSlice.ts';
import modelsReducer from '../store/slices/modelsSlice.ts';
import runtimeReducer, {
  runtimeReady,
  runtimeLoaded,
} from '../store/slices/runtimeSlice.ts';
import SettingsScreen from './SettingsScreen.tsx';
import { db } from '../db/db.ts';
import {
  getLockTimeoutMinutes,
  setLockTimeoutMinutes,
  getWllamaCdnConsent,
  setWllamaCdnConsent,
} from '../settings/appSettings.ts';
import { queryAuditEvents } from '../audit/auditService.ts';

function renderSettings() {
  const store = configureStore({
    reducer: {
      providers: providersReducer,
      models: modelsReducer,
      runtime: runtimeReducer,
    },
  });
  store.dispatch(runtimeReady());
  render(
    <Provider store={store}>
      <SettingsScreen />
    </Provider>,
  );
  return store;
}

describe('SettingsScreen', () => {
  afterEach(async () => {
    await db.app_settings.clear();
    await db.audit_events.clear();
  });

  it('renders the configuration sections', () => {
    renderSettings();
    for (const section of [
      'General',
      'Models',
      'Security',
      'Storage',
      'Skills',
      'Developer',
    ]) {
      expect(
        screen.getByRole('heading', { name: section }),
      ).toBeInTheDocument();
    }
  });

  it('shows the actual runtime mode, not a hardcoded label', () => {
    // The Environment panel must reflect which runtime really loaded so a user
    // can tell the real WASM runtime from the dev-only reference fallback.
    const store = renderSettings();

    act(() => {
      store.dispatch(runtimeLoaded({ mode: 'wasm' }));
    });
    expect(screen.getByText('ready (wasm)')).toBeInTheDocument();

    // Switching to the reference fallback is reflected, never masked as wasm.
    act(() => {
      store.dispatch(runtimeLoaded({ mode: 'reference' }));
    });
    expect(screen.getByText('ready (reference)')).toBeInTheDocument();
    expect(screen.queryByText('ready (wasm)')).not.toBeInTheDocument();
  });

  it('shows unwired preferences as disabled placeholders, not fake switches', async () => {
    renderSettings();
    // These have no consumer yet, so they must be visibly inactive rather than
    // switches that flip but change nothing (Phase 10 honesty).
    expect(
      screen.getByRole('switch', { name: 'Require approval by default' }),
    ).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Auto-backup' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Dev mode' })).toBeDisabled();
    // The genuinely-wired control is NOT disabled, for contrast.
    expect(
      screen.getByRole('switch', { name: 'Load runtime from CDN' }),
    ).not.toBeDisabled();
  });

  it('resets the runtime (a real action)', async () => {
    const user = userEvent.setup();
    const store = renderSettings();

    expect(store.getState().runtime.status).toBe('ready');
    await user.click(screen.getByRole('button', { name: 'Reset runtime' }));
    expect(store.getState().runtime.status).toBe('initializing');
  });

  it('loads the persisted lock timeout and writes changes to IndexedDB', async () => {
    // A real, persisted setting: seed a durable value, confirm the control
    // reflects it on mount, then prove a change is written back to IndexedDB.
    await setLockTimeoutMinutes(db, 60);
    const user = userEvent.setup();
    renderSettings();

    const select = await screen.findByRole('combobox', {
      name: 'Lock timeout',
    });
    await waitFor(() => expect(select).toHaveValue('60'));

    await user.selectOptions(select, '5');
    expect(select).toHaveValue('5');
    await waitFor(async () => expect(await getLockTimeoutMinutes(db)).toBe(5));
  });

  it('defaults the wllama CDN-consent toggle off and persists + audits a grant', async () => {
    // Fail-closed: the runtime never loads from the CDN until the user opts in.
    const user = userEvent.setup();
    renderSettings();

    const toggle = screen.getByRole('switch', {
      name: 'Load runtime from CDN',
    });
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await waitFor(async () => expect(await getWllamaCdnConsent(db)).toBe(true));

    // The security-policy change must be audited — no silent meaningful action.
    const events = await queryAuditEvents(db, { source: 'model' });
    expect(
      events.some((e) => e.type === 'settings.wllama_cdn_consent_granted'),
    ).toBe(true);
  });

  it('reflects a persisted wllama CDN consent on mount', async () => {
    await setWllamaCdnConsent(db, true);
    renderSettings();

    const toggle = await screen.findByRole('switch', {
      name: 'Load runtime from CDN',
    });
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
  });
});
