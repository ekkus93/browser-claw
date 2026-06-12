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
import type { EffectContext } from './runtime/effectExecutor.ts';
import {
  createReferenceRuntime,
  type ClawRuntimePort,
  type RuntimeSnapshot,
} from './runtime/referenceRuntime.ts';
import { createWasmRuntime } from './runtime/wasmRuntime.ts';
import { loadRuntimePort } from './runtime/runtimeBoot.ts';
import {
  resolveProvider,
  defaultActiveProviderId,
} from './providers/registry.ts';
import { getActiveProviderProfile } from './providers/providerProfiles.ts';
import { activeProviderSet } from './store/slices/providersSlice.ts';
import { appConfig } from './config/appConfig.ts';
import {
  runtimeLoaded,
  runtimeFailed,
} from './store/slices/runtimeSlice.ts';
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
  const snapshot = await loadLatestSnapshot(db);
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
      submit: (command) => host.submit(command),
    }),
  };
  registerRuntimeListeners(startAppListening, host);
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
