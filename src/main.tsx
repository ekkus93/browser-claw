import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { RouterProvider } from 'react-router-dom';
import './index.css';
import { store } from './store/store.ts';
import { startAppListening } from './store/listenerMiddleware.ts';
import { router } from './router.tsx';
import { ToastProvider } from './components/ui/Toast.tsx';
import { db } from './db/db.ts';
import { RuntimeHost, loadLatestSnapshot } from './runtime/runtimeHost.ts';
import { registerRuntimeListeners } from './runtime/runtimeListeners.ts';
import { createLlmRequestHandler } from './runtime/llmRunner.ts';
import { createSkillEffectHandler } from './runtime/skillRunner.ts';
import { createStorageEffectHandler } from './runtime/storageRunner.ts';
import { createToolEffectHandler } from './runtime/toolRunner.ts';
import { createSkillManager } from './skills/skillManager.ts';
import type { EffectContext } from './runtime/effectExecutor.ts';
import {
  createReferenceRuntime,
  SNAPSHOT_SCHEMA_VERSION,
  type ClawRuntimePort,
  type RuntimeSnapshot,
} from './runtime/referenceRuntime.ts';
import { createWasmRuntime } from './runtime/wasmRuntime.ts';
import { loadRuntimePort } from './runtime/runtimeBoot.ts';
import {
  resolveProvider,
  defaultActiveProviderId,
} from './providers/registry.ts';
import {
  getActiveProviderProfile,
  getProviderProfile,
  defaultProviderProfile,
} from './providers/providerProfiles.ts';
import { resolveApiKey } from './providers/providerKey.ts';
import { secretVault } from './secrets/vault.ts';
import { activeProviderSet } from './store/slices/providersSlice.ts';
import { appConfig } from './config/appConfig.ts';
import {
  runtimeLoaded,
  runtimeFailed,
  snapshotRestoreWarned,
} from './store/slices/runtimeSlice.ts';
import { hydrated, onboardingCompleted } from './store/slices/appSlice.ts';
import {
  getOnboardingComplete,
  getLockTimeoutMinutes,
  getTheme,
  getFallbackProviderId,
} from './settings/appSettings.ts';
import { applyTheme } from './settings/theme.ts';
import { recordAudit } from './audit/auditSink.ts';
import type { AuditRiskLevel, AuditStatus } from './db/types.ts';

const RUNTIME_FAILED_MESSAGE =
  'The BrowserClaw runtime could not start (WebAssembly failed to load). ' +
  'The console is disabled. Reload to try again.';

// Durable audit + live tail. Never include secrets in audit payloads.
function appendAudit(
  type: string,
  summary: string,
  risk: AuditRiskLevel,
  status: AuditStatus,
): void {
  void recordAudit(db, store.dispatch, {
    type,
    summary,
    source: 'runtime',
    risk,
    status,
  });
}

// Wrap a runtime factory so a corrupted/incompatible snapshot doesn't take the
// app down: if constructing from the snapshot throws, audit the restore failure
// and start fresh (a real construction failure on the fresh path still
// propagates and is handled as a runtime load failure). A successful restore is
// audited too. See replies1.md Q5 / TODO Phase 4.
function withSnapshotRestore<T extends ClawRuntimePort>(
  create: (snapshot?: RuntimeSnapshot) => T | Promise<T>,
): (snapshot?: RuntimeSnapshot) => Promise<T> {
  return async (snapshot) => {
    if (snapshot === undefined) return create(undefined);
    try {
      const port = await create(snapshot);
      appendAudit(
        'runtime.snapshot_restored',
        'Runtime snapshot restored',
        'info',
        'success',
      );
      return port;
    } catch (error) {
      console.error(
        'Runtime snapshot could not be restored; starting fresh',
        error,
      );
      appendAudit(
        'runtime.snapshot_restore_failed',
        'Runtime snapshot could not be restored; started fresh',
        'medium',
        'failure',
      );
      // Surface a visible, dismissible warning so the user knows their previous
      // session was dropped rather than silently lost.
      store.dispatch(snapshotRestoreWarned('restore_failed'));
      return create(undefined);
    }
  };
}

function onSnapshotSaveError(error: unknown): void {
  console.error('Runtime snapshot save failed', error);
  appendAudit(
    'runtime.snapshot_save_failed',
    'Runtime snapshot save failed',
    'medium',
    'failure',
  );
}

// Boot the deterministic runtime: restore the latest snapshot (if any), wire
// the provider that answers llm_request effects, then register the listener
// that drives the runtime from dispatched user messages.
//
// Fails closed: the real Rust/WASM runtime is required. If it can't load, the
// app blocks (no silent reference-runtime fallback). The reference runtime is
// used only when VITE_ALLOW_REFERENCE_RUNTIME_FALLBACK (or demo mode) is set.
async function bootRuntime(): Promise<void> {
  // Restore the latest snapshot only when its schema version matches this
  // build. An incompatible snapshot is dropped and audited rather than restored
  // into a runtime that would misinterpret it (silent state corruption).
  const load = await loadLatestSnapshot(db);
  if (load.status === 'incompatible') {
    appendAudit(
      'runtime.snapshot_incompatible',
      `Discarded an incompatible runtime snapshot (found v${load.foundVersion ?? 'unversioned'}, expected v${SNAPSHOT_SCHEMA_VERSION}); started fresh`,
      'medium',
      'failure',
    );
    // Tell the user their previous session was discarded (not silently lost).
    store.dispatch(snapshotRestoreWarned('incompatible'));
  }
  const snapshot = load.status === 'ok' ? load.snapshot : undefined;
  const { port } = await loadRuntimePort(
    {
      config: appConfig,
      createWasm: withSnapshotRestore(createWasmRuntime),
      createReference: withSnapshotRestore(createReferenceRuntime),
      onLoaded: (mode) => {
        store.dispatch(runtimeLoaded({ mode }));
        appendAudit(
          'runtime.loaded',
          `Runtime loaded (${mode})`,
          'info',
          'success',
        );
      },
      onFallback: (error) => {
        console.warn(
          'WASM runtime unavailable; using the reference runtime (dev fallback enabled)',
          error,
        );
        store.dispatch(runtimeLoaded({ mode: 'reference' }));
        appendAudit(
          'runtime.reference_fallback_used',
          'WASM runtime unavailable; using the reference runtime (dev fallback enabled)',
          'high',
          'success',
        );
      },
      onFailed: (error) => {
        console.error(RUNTIME_FAILED_MESSAGE, error);
        store.dispatch(runtimeFailed(RUNTIME_FAILED_MESSAGE));
        appendAudit(
          'runtime.load_failed',
          RUNTIME_FAILED_MESSAGE,
          'high',
          'failure',
        );
      },
    },
    snapshot,
  );
  if (!port) return;
  const ctx: EffectContext = { dispatch: store.dispatch, db };
  const host = new RuntimeHost(port, ctx, {
    snapshot: { delayMs: 500, onError: onSnapshotSaveError },
  });
  // Persist any pending snapshot when the page is being hidden/unloaded.
  window.addEventListener('pagehide', () => {
    void host.flushSnapshot();
  });
  ctx.ports = {
    llmRequest: createLlmRequestHandler({
      db,
      dispatch: store.dispatch,
      getProvider: () => {
        const { activeProviderId, activeProviderBaseUrl, activeProviderModel } =
          store.getState().providers;
        // Use the persisted profile's base URL/model so the runtime calls
        // exactly what the user saved on the Models screen.
        const resolved = resolveProvider(activeProviderId, appConfig, {
          ...(activeProviderBaseUrl ? { baseUrl: activeProviderBaseUrl } : {}),
          ...(activeProviderModel ? { model: activeProviderModel } : {}),
        });
        // The chat UI blocks sending unless a provider is configured, so this
        // is a defensive guard, not the user-facing path.
        if (!resolved.ok) {
          throw new Error(`No provider configured (${resolved.reason}).`);
        }
        return resolved.provider;
      },
      getApiKey: () =>
        getActiveProviderProfile(db).then((profile) =>
          resolveApiKey(secretVault, profile),
        ),
      // Resolve the configured fallback provider for failover. Skipped when none
      // is set or it equals the active provider (no point retrying the same one).
      resolveFallback: async () => {
        const fallbackId = await getFallbackProviderId(db);
        if (!fallbackId) return null;
        if (fallbackId === store.getState().providers.activeProviderId) {
          return null;
        }
        const profile =
          (await getProviderProfile(db, fallbackId)) ??
          defaultProviderProfile(fallbackId);
        if (!profile) return null;
        const resolved = resolveProvider(fallbackId, appConfig, {
          ...(profile.baseUrl ? { baseUrl: profile.baseUrl } : {}),
          ...(profile.model ? { model: profile.model } : {}),
        });
        if (!resolved.ok) return null;
        return {
          id: fallbackId,
          provider: resolved.provider,
          getApiKey: () => resolveApiKey(secretVault, profile),
        };
      },
      submit: (command) => host.submit(command),
    }),
    storage: createStorageEffectHandler({ db, dispatch: store.dispatch }),
    tool: createToolEffectHandler({
      db,
      dispatch: store.dispatch,
      submit: (command) => host.submit(command),
      getConversationId: () => store.getState().chat.activeConversationId ?? '',
    }),
    skill: createSkillEffectHandler({
      db,
      dispatch: store.dispatch,
      // Route every skill fs/state effect through the permission-scoped
      // SkillFs so namespace/reserved-key rules are enforced, not UI-only.
      fsFor: (skillId) =>
        createSkillManager({ db, dispatch: store.dispatch }).fsFor(skillId),
      submit: (command) => host.submit(command),
    }),
  };
  registerRuntimeListeners(startAppListening, host, { db });
}

bootRuntime().catch((error: unknown) => {
  console.error('Runtime boot failed', error);
});

// Restore the persisted active provider so its base URL/model drive real calls
// and the status bar shows it after reload. Fails closed: if nothing was saved,
// only the explicitly-allowed mock is pre-selected (demo/dev); otherwise chat
// shows a setup CTA.
async function restoreActiveProvider(): Promise<void> {
  const profile = await getActiveProviderProfile(db);
  if (profile) {
    store.dispatch(
      activeProviderSet({
        id: profile.id,
        label: profile.label,
        ...(profile.model ? { model: profile.model } : {}),
        ...(profile.baseUrl ? { baseUrl: profile.baseUrl } : {}),
      }),
    );
    return;
  }
  const defaultProviderId = defaultActiveProviderId(appConfig);
  if (
    defaultProviderId !== null &&
    store.getState().providers.activeProviderId === null
  ) {
    store.dispatch(
      activeProviderSet({ id: defaultProviderId, label: 'Mock (dev)' }),
    );
  }
}

void restoreActiveProvider();

// Apply the user's persisted auto-lock timeout to the vault so idle locking
// honours their Settings choice after reload — not just the session it was set.
async function restoreLockTimeout(): Promise<void> {
  const minutes = await getLockTimeoutMinutes(db);
  secretVault.setLockTimeout(minutes * 60_000);
}

void restoreLockTimeout();

// Apply the user's persisted color theme so a reload honours their choice
// instead of always starting on the default light theme.
async function restoreTheme(): Promise<void> {
  applyTheme(await getTheme(db));
}

void restoreTheme();

// Restore durable first-run state, then mark the session hydrated so the index
// route can decide between onboarding and chat. onboardingComplete is dispatched
// BEFORE hydrated so the index guard reads a consistent state in one paint and
// never bounces a returning user to onboarding. See Phase 9.1 / IndexRedirect.
async function restoreOnboardingState(): Promise<void> {
  try {
    if (await getOnboardingComplete(db)) {
      store.dispatch(onboardingCompleted());
    }
  } finally {
    store.dispatch(hydrated());
  }
}

void restoreOnboardingState();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <Provider store={store}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </Provider>
  </StrictMode>,
);
