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
} from './runtime/referenceRuntime.ts';
import { createWasmRuntime } from './runtime/wasmRuntime.ts';
import { resolveProvider } from './providers/registry.ts';

// Boot the deterministic runtime: restore the latest snapshot (if any), wire
// the provider that answers llm_request effects, then register the listener
// that drives the runtime from dispatched user messages. Prefer the real
// Rust/WASM runtime, falling back to the TS reference runtime if it can't load.
async function bootRuntime(): Promise<void> {
  const snapshot = await loadLatestSnapshot(db);
  let port: ClawRuntimePort;
  try {
    port = await createWasmRuntime(snapshot);
  } catch (error) {
    console.warn(
      'WASM runtime unavailable; using the reference runtime',
      error,
    );
    port = createReferenceRuntime(snapshot);
  }
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
