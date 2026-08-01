import 'fake-indexeddb/auto';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import providersReducer from '../store/slices/providersSlice.ts';
import modelsReducer from '../store/slices/modelsSlice.ts';
import runtimeReducer, {
  runtimeReady,
  runtimeLoaded,
} from '../store/slices/runtimeSlice.ts';
import secretsReducer, {
  vaultLockedSet,
  secretMetadataUpserted,
  secretMetadataRemoved,
} from '../store/slices/secretsSlice.ts';
import auditReducer from '../store/slices/auditSlice.ts';
import SettingsScreen from './SettingsScreen.tsx';
import { db } from '../db/db.ts';
import {
  getLockTimeoutMinutes,
  setLockTimeoutMinutes,
  getWllamaCdnConsent,
  setWllamaCdnConsent,
  getTheme,
  setTheme,
} from '../settings/appSettings.ts';
import {
  getActiveProviderId,
  setActiveProviderId,
} from '../providers/providerProfiles.ts';
import {
  getApprovalPolicy,
  getFallbackProviderId,
} from '../settings/appSettings.ts';
import { queryAuditEvents } from '../audit/auditService.ts';
import { BRAVE_KEY_ID } from './settings/useWebResearchKey.ts';

vi.mock('../extension/chromeTransport.ts', () => ({
  createChromeExtensionTransport: vi.fn(),
}));
import { createChromeExtensionTransport } from '../extension/chromeTransport.ts';

function renderSettings() {
  const store = configureStore({
    reducer: {
      providers: providersReducer,
      models: modelsReducer,
      runtime: runtimeReducer,
      secrets: secretsReducer,
      audit: auditReducer,
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
    cleanup();
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
      screen.getByRole('switch', { name: 'Warn on browser-direct keys' }),
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

  it('loads the persisted theme, applies it to <html>, and writes changes back', async () => {
    await setTheme(db, 'dark');
    const user = userEvent.setup();
    renderSettings();

    const select = await screen.findByRole('combobox', { name: 'Theme' });
    await waitFor(() => expect(select).toHaveValue('dark'));

    // Changing the control applies the theme to the document root (boot owns
    // applying the persisted value; the screen applies live edits) and writes
    // the new value back durably.
    await user.selectOptions(select, 'light');
    expect(select).toHaveValue('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    await waitFor(async () => expect(await getTheme(db)).toBe('light'));
  });

  it('loads the persisted default provider, then persists + goes live on change', async () => {
    // Reuses the existing active-provider key (not a parallel one): the Settings
    // dropdown reflects the durable activeProviderId and changing it both writes
    // it back and updates the live providers slice the runtime reads.
    await setActiveProviderId(db, 'openai');
    const user = userEvent.setup();
    const store = renderSettings();

    const select = await screen.findByRole('combobox', {
      name: 'Default provider',
    });
    await waitFor(() => expect(select).toHaveValue('openai'));

    await user.selectOptions(select, 'anthropic');
    expect(select).toHaveValue('anthropic');
    await waitFor(async () =>
      expect(await getActiveProviderId(db)).toBe('anthropic'),
    );
    await waitFor(() =>
      expect(store.getState().providers.activeProviderId).toBe('anthropic'),
    );
  });

  it('defaults the approval policy to require-all and persists + audits a relax', async () => {
    const user = userEvent.setup();
    renderSettings();

    const select = await screen.findByRole('combobox', {
      name: 'Approval policy',
    });
    // Fail-closed default: require approval for everything.
    await waitFor(() => expect(select).toHaveValue('require_all'));

    await user.selectOptions(select, 'auto_low_medium');
    expect(select).toHaveValue('auto_low_medium');
    await waitFor(async () =>
      expect(await getApprovalPolicy(db)).toBe('auto_low_medium'),
    );
    // Relaxing the policy is a meaningful security change and must be audited.
    await waitFor(async () => {
      const events = await queryAuditEvents(db, {});
      expect(
        events.some((e) => e.type === 'settings.approval_policy_relaxed'),
      ).toBe(true);
    });
  });

  it('defaults the fallback provider to None and persists a selection', async () => {
    const user = userEvent.setup();
    renderSettings();

    const select = await screen.findByRole('combobox', {
      name: 'Fallback provider',
    });
    await waitFor(() => expect(select).toHaveValue(''));

    await user.selectOptions(select, 'anthropic');
    expect(select).toHaveValue('anthropic');
    await waitFor(async () =>
      expect(await getFallbackProviderId(db)).toBe('anthropic'),
    );
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

// ---------------------------------------------------------------------------
// C1 (FIX5) — normalizeExtensionStatus wired into SettingsScreen
// ---------------------------------------------------------------------------

function makeStore(
  opts: { vaultLocked?: boolean; keyConfigured?: boolean } = {},
) {
  const store = configureStore({
    reducer: {
      providers: providersReducer,
      models: modelsReducer,
      runtime: runtimeReducer,
      secrets: secretsReducer,
      audit: auditReducer,
    },
  });
  store.dispatch(runtimeReady());
  if (opts.vaultLocked === false) store.dispatch(vaultLockedSet(false));
  if (opts.keyConfigured) {
    store.dispatch(
      secretMetadataUpserted({
        id: BRAVE_KEY_ID,
        label: 'Brave Search API key',
        storageMode: 'encrypted',
      }),
    );
  }
  return store;
}

function rawExtStatus(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ok: true,
    requestId: 'r',
    protocolVersion: 1,
    extensionVersion: '0.1.0',
    capabilities: {
      readPage: {
        supported: true,
        requiresHostPermission: true,
        permissionRequestSupported: false,
      },
      readCurrentTab: { supported: false, requiresActiveTab: true },
      webSearch: { supported: true, providerConfigured: true },
    },
    pageReadingAvailable: true,
    ...overrides,
  };
}

describe('C1 (FIX5) — capability status wired into SettingsScreen', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_CHROME_EXTENSION_ID', 'test-ext-id');
    vi.mocked(createChromeExtensionTransport).mockReturnValue({
      send: vi.fn().mockResolvedValue(rawExtStatus()),
    });
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await db.app_settings.clear();
    await db.audit_events.clear();
  });

  it('C1: connected ext + no key → Connected row, Not ready live search', async () => {
    const user = userEvent.setup();
    const store = makeStore({ vaultLocked: false, keyConfigured: false });
    render(
      <Provider store={store}>
        <SettingsScreen />
      </Provider>,
    );
    await user.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('Not ready')).toBeInTheDocument();
  });

  it('C1: vault locked → Vault locked row, Not ready live search', async () => {
    const user = userEvent.setup();
    const store = makeStore({ vaultLocked: true, keyConfigured: true });
    render(
      <Provider store={store}>
        <SettingsScreen />
      </Provider>,
    );
    await user.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByText('Vault locked')).toBeInTheDocument();
    expect(screen.getByText('Not ready')).toBeInTheDocument();
  });

  it('C1: permissionRequestSupported false → permission row shows Permission required', async () => {
    const user = userEvent.setup();
    const store = makeStore({ vaultLocked: false, keyConfigured: false });
    render(
      <Provider store={store}>
        <SettingsScreen />
      </Provider>,
    );
    await user.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByText('Permission required')).toBeInTheDocument();
  });

  it('C1: current-tab shows Unsupported in v0.1', async () => {
    const user = userEvent.setup();
    const store = makeStore({ vaultLocked: false });
    render(
      <Provider store={store}>
        <SettingsScreen />
      </Provider>,
    );
    await user.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByText('Unsupported in v0.1')).toBeInTheDocument();
  });

  it('C1: ext + key + unlocked → live search Ready', async () => {
    const user = userEvent.setup();
    const store = makeStore({ vaultLocked: false, keyConfigured: true });
    render(
      <Provider store={store}>
        <SettingsScreen />
      </Provider>,
    );
    await user.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByText('Ready')).toBeInTheDocument();
  });

  // C1 (FIX6): capabilityStatus updates reactively without a new probe.

  it('C1 FIX6: clearing key after probe changes live search to Not ready without new probe', async () => {
    const user = userEvent.setup();
    const store = makeStore({ vaultLocked: false, keyConfigured: true });
    render(
      <Provider store={store}>
        <SettingsScreen />
      </Provider>,
    );
    // First probe shows Ready
    await user.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByText('Ready')).toBeInTheDocument();
    // Now clear the key (no new probe)
    act(() => {
      store.dispatch(secretMetadataRemoved(BRAVE_KEY_ID));
    });
    await waitFor(() => {
      expect(screen.getByText('Not ready')).toBeInTheDocument();
    });
  });

  it('C1 FIX6: vault locking after probe changes live search to Not ready without new probe', async () => {
    const user = userEvent.setup();
    const store = makeStore({ vaultLocked: false, keyConfigured: true });
    render(
      <Provider store={store}>
        <SettingsScreen />
      </Provider>,
    );
    // First probe shows Ready
    await user.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByText('Ready')).toBeInTheDocument();
    // Vault locks (no new probe)
    act(() => {
      store.dispatch(vaultLockedSet(true));
    });
    await waitFor(() => {
      expect(screen.getByText('Not ready')).toBeInTheDocument();
    });
  });
});
