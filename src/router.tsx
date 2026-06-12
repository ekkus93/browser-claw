import type { ReactNode } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import AppLayout from './AppLayout.tsx';
import { PlaceholderScreen } from './screens/PlaceholderScreen.tsx';
import ComponentGallery from './screens/ComponentGallery.tsx';
import OnboardingScreen from './screens/OnboardingScreen.tsx';
import ChatScreen from './screens/ChatScreen.tsx';
import ModelsScreen from './screens/ModelsScreen.tsx';
import { NAV_ITEMS } from './components/shell/navItems.ts';

// Real screens replace the placeholder as each Phase 6 screen lands.
const SCREEN_OVERRIDES: Record<string, ReactNode> = {
  chat: <ChatScreen />,
  models: <ModelsScreen />,
};

/**
 * Onboarding renders standalone (its own first-run layout); every other primary
 * route renders inside the shared AppShell, using its real screen when built
 * and a placeholder otherwise.
 */
export const router = createBrowserRouter([
  { path: '/onboarding', element: <OnboardingScreen /> },
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to="/chat" replace /> },
      ...NAV_ITEMS.map((item) => {
        const key = item.path.replace(/^\//, '');
        return {
          path: key,
          element: SCREEN_OVERRIDES[key] ?? (
            <PlaceholderScreen title={item.label} phase="Phase 6" />
          ),
        };
      }),
      { path: 'showcase', element: <ComponentGallery /> },
    ],
  },
]);
