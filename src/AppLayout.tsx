import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AppShell } from './components/shell/AppShell.tsx';
import { RightInspectorPanel } from './components/shell/RightInspectorPanel.tsx';
import { SafetyOverrideBanner } from './components/shell/SafetyOverrideBanner.tsx';
import { SnapshotRestoreBanner } from './components/shell/SnapshotRestoreBanner.tsx';
import { RuntimeBlockedScreen } from './components/shell/RuntimeBlockedScreen.tsx';
import { useAppSelector } from './store/hooks.ts';
import { APP_BUILD, APP_VERSION } from './lib/appMeta.ts';

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
        onSelectModel: () => navigate('/models'),
        onOpenSettings: () => navigate('/settings'),
      }}
      sidebar={{
        footer: {
          status: runtimeStatus,
          version: `${APP_VERSION} · ${APP_BUILD.shortGitSha}`,
        },
      }}
    >
      <SafetyOverrideBanner />
      <SnapshotRestoreBanner />
      <Outlet />
    </AppShell>
  );
}
