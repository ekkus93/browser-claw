import { createBrowserRouter, Navigate } from 'react-router-dom';
import AppLayout from './AppLayout.tsx';
import { PlaceholderScreen } from './screens/PlaceholderScreen.tsx';
import ComponentGallery from './screens/ComponentGallery.tsx';
import OnboardingScreen from './screens/OnboardingScreen.tsx';
import { NAV_ITEMS } from './components/shell/navItems.ts';

/**
 * Phase 6 replaces each placeholder element with the real screen built from
 * its mockup. Onboarding renders standalone (its own first-run layout); every
 * other primary route renders inside the shared AppShell.
 */
export const router = createBrowserRouter([
  { path: '/onboarding', element: <OnboardingScreen /> },
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to="/chat" replace /> },
      ...NAV_ITEMS.map((item) => ({
        path: item.path.replace(/^\//, ''),
        element: <PlaceholderScreen title={item.label} phase="Phase 6" />,
      })),
      { path: 'showcase', element: <ComponentGallery /> },
    ],
  },
]);
