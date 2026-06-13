import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AppShell } from './components/shell/AppShell.tsx';
import { RightInspectorPanel } from './components/shell/RightInspectorPanel.tsx';
import { SafetyOverrideBanner } from './components/shell/SafetyOverrideBanner.tsx';
import { SnapshotRestoreBanner } from './components/shell/SnapshotRestoreBanner.tsx';
import { RuntimeBlockedScreen } from './components/shell/RuntimeBlockedScreen.tsx';
import { useAppSelector } from './store/hooks.ts';
import { APP_VERSION } from './lib/appMeta.ts';

/**
 * Top-level layout route: wraps every screen in the shared AppShell. The right
 * inspector is shown only where it's useful (Chat for now, per the spec);
 * individual screens will refine this in later phases.
 */
export default function AppLayout() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const showInspector = pathname.startsWith('/chat');
  const runtimeStatus = useAppSelector((state) => state.runtime.status);
  const runtimeFatal = useAppSelector((state) => state.runtime.fatal);
  const runtimeMessage = useAppSelector((state) => state.runtime.message);
  const providerLabel = useAppSelector(
    (state) => state.providers.activeProviderLabel,
  );
  const localModelLabel = useAppSelector(
    (state) => state.models.activeModelLabel,
  );
  const providerModel = useAppSelector(
    (state) => state.providers.activeProviderModel,
  );
  // Prefer the active remote provider's model; fall back to a loaded local model.
  const modelLabel = providerModel ?? localModelLabel;
  const storageUsedBytes = useAppSelector((state) => state.storage.usedBytes);
  const storageTotalBytes = useAppSelector((state) => state.storage.quotaBytes);

  if (runtimeFatal) {
    return <RuntimeBlockedScreen message={runtimeMessage} />;
  }

  return (
    <AppShell
      inspector={showInspector ? <RightInspectorPanel /> : undefined}
      topBar={{
        providerLabel,
        modelLabel,
        storageUsedBytes,
        storageTotalBytes,
        // The top-bar Settings button is a real affordance: route to /settings
        // (TODO Phase 9.2) instead of leaving the onClick a silent no-op.
        onOpenSettings: () => navigate('/settings'),
      }}
      sidebar={{ footer: { status: runtimeStatus, version: APP_VERSION } }}
    >
      <SafetyOverrideBanner />
      <SnapshotRestoreBanner />
      <Outlet />
    </AppShell>
  );
}
