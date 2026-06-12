import { createBrowserRouter } from 'react-router-dom';
import App from './App.tsx';

/**
 * Phase 6 builds the nine screens (/onboarding, /chat, /models, /storage,
 * /skills, /memories, /audit, /settings, /workflow) under the shared AppShell.
 * This is the bootstrap router with a single index route.
 */
export const router = createBrowserRouter([{ path: '/', element: <App /> }]);
