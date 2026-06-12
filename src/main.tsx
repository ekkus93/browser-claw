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
import { createReferenceRuntime } from './runtime/referenceRuntime.ts';
import { createWasmRuntime } from './runtime/wasmRuntime.ts';
import { loadRuntimePort } from './runtime/runtimeBoot.ts';
import { resolveProvider } from './providers/registry.ts';
import { appConfig } from './config/appConfig.ts';
import {
  runtimeLoaded,
  runtimeFailed,
} from './store/slices/runtimeSlice.ts';
import { auditAppended, type AuditRisk } from './store/slices/auditSlice.ts';

const RUNTIME_FAILED_MESSAGE =
  'The BrowserClaw runtime could not start (WebAssembly failed to load). ' +
  'The console is disabled. Reload to try again.';

// Live recent-audit feed only; the durable audit log lands in Phase 3. Never
// include secrets in audit payloads.
function appendAudit(type: string, summary: string, risk: AuditRisk): void {
  const at = Date.now();
  store.dispatch(auditAppended({ id: `${type}-${at}`, type, summary, risk, at }));
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
      createWasm: createWasmRuntime,
      createReference: createReferenceRuntime,
      onLoaded: (mode) => {
        store.dispatch(runtimeLoaded({ mode }));
        appendAudit('runtime.loaded', `Runtime loaded (${mode})`, 'info');
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
        );
      },
      onFailed: (error) => {
        console.error(RUNTIME_FAILED_MESSAGE, error);
        store.dispatch(runtimeFailed(RUNTIME_FAILED_MESSAGE));
        appendAudit('runtime.load_failed', RUNTIME_FAILED_MESSAGE, 'high');
      },
    },
    snapshot,
  );
  if (!port) return;
  const ctx: EffectContext = { dispatch: store.dispatch, db };
  const host = new RuntimeHost(port, ctx);
  ctx.ports = {
    llmRequest: createLlmRequestHandler({
      db,
      dispatch: store.dispatch,
      getProvider: () =>
        resolveProvider(store.getState().providers.activeProviderId),
      submit: (command) => host.submit(command),
    }),
  };
  registerRuntimeListeners(startAppListening, host);
}

bootRuntime().catch((error: unknown) => {
  console.error('Runtime boot failed', error);
});

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
