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

// Boot the deterministic runtime: restore the latest snapshot (if any), then
// wire the listener that drives it from dispatched user messages.
async function bootRuntime(): Promise<void> {
  const snapshot = await loadLatestSnapshot(db);
  const host = createRuntimeHost({ dispatch: store.dispatch, db }, snapshot);
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
