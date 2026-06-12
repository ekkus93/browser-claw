import { createBrowserRouter, Navigate } from 'react-router-dom';
import AppLayout from './AppLayout.tsx';
import { PlaceholderScreen } from './screens/PlaceholderScreen.tsx';
import { NAV_ITEMS } from './components/shell/navItems.ts';

/**
 * Phase 6 replaces each placeholder element with the real screen built from
 * its mockup. For now every primary route renders inside the shared AppShell
 * so the navigation, active states, and layout are exercised end to end.
 */
export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to="/chat" replace /> },
      ...NAV_ITEMS.map((item) => ({
        path: item.path.replace(/^\//, ''),
        element: <PlaceholderScreen title={item.label} phase="Phase 6" />,
      })),
    ],
  },
]);
