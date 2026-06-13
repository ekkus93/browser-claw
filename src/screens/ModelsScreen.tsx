import { useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  activeProviderSet,
  providerHealthSet,
  type ProviderHealth,
} from '../store/slices/providersSlice.ts';
import { useAppDispatch, useAppSelector } from '../store/hooks.ts';
import { resolveProvider } from '../providers/registry.ts';
import { resolveApiKey } from '../providers/providerKey.ts';
import { secretVault } from '../secrets/vault.ts';
import {
  listProviderProfiles,
  mergeProviderProfiles,
  saveProviderProfile,
  setActiveProviderId,
} from '../providers/providerProfiles.ts';
import { appConfig } from '../config/appConfig.ts';
import { recordAudit } from '../audit/auditSink.ts';
import { db } from '../db/db.ts';
import type { ProviderProfileRow } from '../db/types.ts';
import { Button } from '../components/ui/Button.tsx';
import { Badge, type BadgeTone } from '../components/ui/Badge.tsx';
import { Input } from '../components/ui/Input.tsx';
import { Select } from '../components/ui/Select.tsx';
import { Progress } from '../components/ui/Progress.tsx';
import { useToast } from '../components/ui/toastContext.ts';
import { MODEL_CATALOG } from '../wllama/catalog.ts';
import { isWllamaSupported, getWllamaEngine } from '../wllama/engine.ts';
import { createModelManager } from '../wllama/modelManager.ts';

const HEALTH_META: Record<ProviderHealth, { label: string; tone: BadgeTone }> =
  {
    unconfigured: { label: 'Not configured', tone: 'neutral' },
    connected: { label: 'Connected', tone: 'success' },
    auth_failed: { label: 'Auth failed', tone: 'danger' },
    cors_error: { label: 'CORS issue', tone: 'warning' },
    model_not_found: { label: 'Model not found', tone: 'warning' },
    unreachable: { label: 'Unreachable', tone: 'danger' },
  };

const LOCAL_KINDS = new Set(['ollama', 'llama_server']);

/**
 * One provider's editable, persisted profile. Form state is controlled and
 * seeded from the persisted row; Save writes back to IndexedDB and Test runs a
 * real health check against the *current* (saved) values via the registry, so
 * what you test is what you saved. Edits survive reload because they're durable.
 */
function ProviderCard({
  profile,
  variant,
}: {
  profile: ProviderProfileRow;
  variant: 'remote' | 'local';
}) {
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const health = useAppSelector(
    (state) => state.providers.health[profile.id] ?? 'unconfigured',
  );
  const meta = HEALTH_META[health];

  const [baseUrl, setBaseUrl] = useState(profile.baseUrl ?? '');
  const [model, setModel] = useState(profile.model ?? '');
  const [apiKeyMode, setApiKeyMode] = useState(profile.apiKeyMode);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  function buildRow(): ProviderProfileRow {
    return {
      id: profile.id,
      kind: profile.kind,
      label: profile.label,
      baseUrl,
      model: variant === 'remote' ? model : (profile.model ?? ''),
      apiKeyMode: variant === 'remote' ? apiKeyMode : profile.apiKeyMode,
      // Preserve any existing secret reference (set later, in Phase 2.3).
      ...(profile.encryptedSecretId
        ? { encryptedSecretId: profile.encryptedSecretId }
        : {}),
    };
  }

  async function handleSave() {
    setSaving(true);
    try {
      await saveProviderProfile(db, buildRow());
      toast({
        tone: 'success',
        title: 'Saved',
        description: `${profile.label} settings saved.`,
      });
    } catch {
      toast({
        tone: 'danger',
        title: 'Save failed',
        description: `Could not save ${profile.label}.`,
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    try {
      const resolved = resolveProvider(profile.id, appConfig, {
        baseUrl,
        ...(variant === 'remote' ? { model } : {}),
      });
      if (!resolved.ok) {
        dispatch(
          providerHealthSet({ providerId: profile.id, health: 'unreachable' }),
        );
        // A test the user explicitly ran is a real event, even when it cannot
        // resolve a provider — record the honest failure (no secrets, id only).
        void recordAudit(db, dispatch, {
          type: 'provider.test_failed',
          summary: `Provider test for ${profile.label} could not run (${resolved.reason})`,
          source: 'provider',
          risk: 'low',
          status: 'failure',
          providerId: profile.id,
        });
        return;
      }
      // Use a stored key if the vault is unlocked; an unauthenticated health
      // check is still meaningful (a 401 means "reachable, needs auth").
      const keyResult = await resolveApiKey(secretVault, buildRow());
      const callOptions =
        keyResult.ok && keyResult.apiKey !== undefined
          ? { apiKey: keyResult.apiKey }
          : undefined;
      const result = await resolved.provider.checkHealth(callOptions);
      dispatch(providerHealthSet({ providerId: profile.id, health: result }));
      const connected = result === 'connected';
      // Audit the real outcome of a user-initiated provider test. The summary
      // carries only the provider id and the health verdict — never the key.
      void recordAudit(db, dispatch, {
        type: connected ? 'provider.test_succeeded' : 'provider.test_failed',
        summary: `Provider test for ${profile.label}: ${result}`,
        source: 'provider',
        risk: connected ? 'info' : 'low',
        status: connected ? 'success' : 'failure',
        providerId: profile.id,
      });
      if (connected) {
        dispatch(
          activeProviderSet({
            id: profile.id,
            label: profile.label,
            baseUrl,
            ...(variant === 'remote' ? { model } : {}),
          }),
        );
        await setActiveProviderId(db, profile.id);
      }
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text">{profile.label}</h3>
        <Badge tone={meta.tone} dot>
          {meta.label}
        </Badge>
      </div>
      <Input
        label={variant === 'remote' ? 'Base URL' : 'Endpoint URL'}
        value={baseUrl}
        onChange={(event) => setBaseUrl(event.target.value)}
        placeholder="https://…"
      />
      {variant === 'remote' && (
        <>
          <Input
            label="Model"
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder="model id"
          />
          <Select
            label="API key mode"
            value={apiKeyMode}
            onChange={(event) =>
              setApiKeyMode(
                event.target.value as ProviderProfileRow['apiKeyMode'],
              )
            }
          >
            <option value="none">No key</option>
            <option value="session">Session only</option>
            <option value="encrypted">Encrypted</option>
          </Select>
        </>
      )}
      <div className="flex gap-2">
        <Button
          variant="primary"
          size="sm"
          loading={saving}
          onClick={() => {
            void handleSave();
          }}
        >
          Save
        </Button>
        <Button
          variant="secondary"
          size="sm"
          loading={testing}
          onClick={() => {
            void handleTest();
          }}
        >
          Test
        </Button>
      </div>
    </div>
  );
}

export default function ModelsScreen() {
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const health = useAppSelector((state) => state.providers.health);
  const downloads = useAppSelector((state) => state.models.downloads);
  const wllamaSupported = isWllamaSupported();

  const manager = useMemo(
    () => createModelManager(dispatch, getWllamaEngine()),
    [dispatch],
  );

  // Wait for the persisted profiles before rendering the editable cards so each
  // card's controlled state seeds from the saved values (not a default template).
  const persisted = useLiveQuery(() => listProviderProfiles(db));
  const profiles = persisted ? mergeProviderProfiles(persisted) : undefined;
  const remoteProfiles = profiles?.filter((p) => !LOCAL_KINDS.has(p.kind));
  const localProfiles = profiles?.filter((p) => LOCAL_KINDS.has(p.kind));

  const healthEntries = [
    ...(profiles ?? []).map((p) => ({ id: p.id, label: p.label })),
    { id: 'wllama', label: 'wllama' },
  ];

  function statusOf(id: string): ProviderHealth {
    return health[id] ?? 'unconfigured';
  }

  function runModelAction(action: Promise<void>, failure: string) {
    action.catch(() =>
      toast({ tone: 'danger', title: 'Model error', description: failure }),
    );
  }

  return (
    <div className="overflow-y-auto">
      <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <main className="flex flex-col gap-6">
          <header>
            <h1 className="text-xl font-bold text-text">Models</h1>
            <p className="text-sm text-muted">
              Configure AI providers and manage local models.
            </p>
          </header>

          <section>
            <h2 className="mb-3 text-sm font-semibold text-text">
              Remote Providers
            </h2>
            {remoteProfiles ? (
              <div className="grid gap-4 md:grid-cols-3">
                {remoteProfiles.map((profile) => (
                  <ProviderCard
                    key={profile.id}
                    profile={profile}
                    variant="remote"
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">Loading providers…</p>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold text-text">
              Local Endpoints
            </h2>
            {localProfiles ? (
              <div className="grid gap-4 md:grid-cols-2">
                {localProfiles.map((profile) => (
                  <ProviderCard
                    key={profile.id}
                    profile={profile}
                    variant="local"
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">Loading endpoints…</p>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold text-text">
              Browser-Local Models
            </h2>
            {!wllamaSupported && (
              <p className="mb-3 flex items-center gap-2 rounded-button bg-warning-subtle p-3 text-sm text-text">
                <AlertTriangle
                  className="size-4 shrink-0 text-warning"
                  aria-hidden="true"
                />
                This browser doesn&apos;t support WebAssembly workers, so
                browser-local models can&apos;t run here.
              </p>
            )}
            <div className="overflow-hidden rounded-card border border-border bg-surface">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-subtle">
                    <th className="px-4 py-2 font-medium">Model</th>
                    <th className="px-4 py-2 font-medium">Size</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 text-right font-medium">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {MODEL_CATALOG.map((model) => {
                    const dl = downloads[model.id];
                    const ready = dl?.status === 'ready';
                    return (
                      <tr
                        key={model.id}
                        className="border-b border-border last:border-0"
                      >
                        <td className="px-4 py-3 font-medium text-text">
                          {model.name}
                        </td>
                        <td className="px-4 py-3 text-muted">
                          {model.sizeLabel}
                        </td>
                        <td className="px-4 py-3 text-muted">
                          {dl
                            ? `${dl.status} ${dl.progress}%`
                            : 'Not downloaded'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-1">
                            {ready ? (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    runModelAction(
                                      manager.load(model),
                                      'Could not load the model.',
                                    )
                                  }
                                >
                                  Load
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    runModelAction(
                                      manager.remove(model),
                                      'Could not delete the model.',
                                    )
                                  }
                                >
                                  Delete
                                </Button>
                              </>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={
                                  !wllamaSupported ||
                                  dl?.status === 'downloading'
                                }
                                onClick={() =>
                                  runModelAction(
                                    manager.download(model),
                                    'Could not download the model.',
                                  )
                                }
                              >
                                Download
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </main>

        <aside className="flex flex-col gap-4">
          <div className="rounded-card border border-border bg-surface p-4">
            <h2 className="mb-3 text-sm font-semibold text-text">
              Provider Health
            </h2>
            <ul className="flex flex-col gap-2 text-sm">
              {healthEntries.map((entry) => {
                const meta = HEALTH_META[statusOf(entry.id)];
                return (
                  <li
                    key={entry.id}
                    className="flex items-center justify-between"
                  >
                    <span className="text-muted">{entry.label}</span>
                    <Badge tone={meta.tone} dot>
                      {meta.label}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="rounded-card border border-border bg-surface p-4">
            <h2 className="mb-3 text-sm font-semibold text-text">
              Model Download Queue
            </h2>
            {Object.keys(downloads).length === 0 ? (
              <p className="text-sm text-muted">No downloads in progress.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {Object.entries(downloads).map(([id, dl]) => (
                  <li key={id}>
                    <Progress value={dl.progress} label={id} showValue />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-card border border-border bg-surface p-4">
            <h2 className="mb-2 text-sm font-semibold text-text">
              Troubleshooting
            </h2>
            <ul className="flex list-inside list-disc flex-col gap-1 text-sm text-muted">
              <li>CORS issue</li>
              <li>Model not found</li>
              <li>Connection failed</li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
