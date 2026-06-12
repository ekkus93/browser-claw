import { Outlet, useLocation } from 'react-router-dom';
import { AppShell } from './components/shell/AppShell.tsx';
import { RightInspectorPanel } from './components/shell/RightInspectorPanel.tsx';

/**
 * Top-level layout route: wraps every screen in the shared AppShell. The right
 * inspector is shown only where it's useful (Chat for now, per the spec);
 * individual screens will refine this in later phases.
 */
export default function AppLayout() {
  const { pathname } = useLocation();
  const showInspector = pathname.startsWith('/chat');

  return (
    <AppShell inspector={showInspector ? <RightInspectorPanel /> : undefined}>
      <Outlet />
    </AppShell>
  );
}
