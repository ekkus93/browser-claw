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
import {
  createRuntimeHost,
  loadLatestSnapshot,
} from './runtime/runtimeHost.ts';
import { registerRuntimeListeners } from './runtime/runtimeListeners.ts';
import { createLlmRequestHandler } from './runtime/llmRunner.ts';
import type { EffectContext } from './runtime/effectExecutor.ts';
import { resolveProvider } from './providers/registry.ts';

// Boot the deterministic runtime: restore the latest snapshot (if any), wire
// the provider that answers llm_request effects, then register the listener
// that drives the runtime from dispatched user messages.
async function bootRuntime(): Promise<void> {
  const snapshot = await loadLatestSnapshot(db);
  const ctx: EffectContext = { dispatch: store.dispatch, db };
  const host = createRuntimeHost(ctx, snapshot);
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
