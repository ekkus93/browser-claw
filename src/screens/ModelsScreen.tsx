import { useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  activeProviderSet,
  providerHealthSet,
  type ProviderHealth,
} from '../store/slices/providersSlice.ts';
import { useAppDispatch, useAppSelector } from '../store/hooks.ts';
import { resolveProvider } from '../providers/registry.ts';
import { appConfig } from '../config/appConfig.ts';
import { Button } from '../components/ui/Button.tsx';
import { Badge, type BadgeTone } from '../components/ui/Badge.tsx';
import { Input } from '../components/ui/Input.tsx';
import { Select } from '../components/ui/Select.tsx';
import { Progress } from '../components/ui/Progress.tsx';
import { useToast } from '../components/ui/toastContext.ts';
import { MODEL_CATALOG } from '../wllama/catalog.ts';
import { isWllamaSupported, getWllamaEngine } from '../wllama/engine.ts';
import { createModelManager } from '../wllama/modelManager.ts';

interface RemoteProvider {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
}

const REMOTE_PROVIDERS: RemoteProvider[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-opus-4-8',
  },
  {
    id: 'compatible',
    label: 'OpenAI-compatible',
    baseUrl: '',
    model: '',
  },
];

const LOCAL_ENDPOINTS = [
  { id: 'ollama', label: 'Ollama', baseUrl: 'http://localhost:11434' },
  {
    id: 'llama-server',
    label: 'llama-server',
    baseUrl: 'http://localhost:8080',
  },
];

const HEALTH_META: Record<ProviderHealth, { label: string; tone: BadgeTone }> =
  {
    unconfigured: { label: 'Not configured', tone: 'neutral' },
    connected: { label: 'Connected', tone: 'success' },
    auth_failed: { label: 'Auth failed', tone: 'danger' },
    cors_error: { label: 'CORS issue', tone: 'warning' },
    model_not_found: { label: 'Model not found', tone: 'warning' },
    unreachable: { label: 'Unreachable', tone: 'danger' },
  };

const ALL_PROVIDERS = [
  ...REMOTE_PROVIDERS.map((p) => p.label),
  ...LOCAL_ENDPOINTS.map((p) => p.label),
  'wllama',
];

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

  const [testingIds, setTestingIds] = useState<readonly string[]>([]);

  function statusOf(id: string): ProviderHealth {
    return health[id] ?? 'unconfigured';
  }

  /**
   * Run a real reachability/health check against the provider. No API key is
   * needed — an unauthenticated request still tells us if the endpoint is
   * reachable (and a 401 means "reachable, needs auth"); local endpoints need
   * no key at all.
   */
  async function testProvider(id: string, label: string) {
    setTestingIds((prev) => [...prev, id]);
    try {
      const resolved = resolveProvider(id, appConfig);
      if (!resolved.ok) {
        dispatch(providerHealthSet({ providerId: id, health: 'unreachable' }));
        return;
      }
      const result = await resolved.provider.checkHealth();
      dispatch(providerHealthSet({ providerId: id, health: result }));
      if (result === 'connected') dispatch(activeProviderSet({ id, label }));
    } finally {
      setTestingIds((prev) => prev.filter((value) => value !== id));
    }
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
            <div className="grid gap-4 md:grid-cols-3">
              {REMOTE_PROVIDERS.map((provider) => {
                const meta = HEALTH_META[statusOf(provider.id)];
                return (
                  <div
                    key={provider.id}
                    className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-text">
                        {provider.label}
                      </h3>
                      <Badge tone={meta.tone} dot>
                        {meta.label}
                      </Badge>
                    </div>
                    <Input
                      label="Base URL"
                      defaultValue={provider.baseUrl}
                      placeholder="https://…"
                    />
                    <Input
                      label="Model"
                      defaultValue={provider.model}
                      placeholder="model id"
                    />
                    <Select label="API key mode" defaultValue="encrypted">
                      <option value="none">No key</option>
                      <option value="session">Session only</option>
                      <option value="encrypted">Encrypted</option>
                    </Select>
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={testingIds.includes(provider.id)}
                      onClick={() => {
                        void testProvider(provider.id, provider.label);
                      }}
                    >
                      Test
                    </Button>
                  </div>
                );
              })}
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold text-text">
              Local Endpoints
            </h2>
            <div className="grid gap-4 md:grid-cols-2">
              {LOCAL_ENDPOINTS.map((endpoint) => {
                const meta = HEALTH_META[statusOf(endpoint.id)];
                return (
                  <div
                    key={endpoint.id}
                    className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-text">
                        {endpoint.label}
                      </h3>
                      <Badge tone={meta.tone} dot>
                        {meta.label}
                      </Badge>
                    </div>
                    <Input
                      label="Endpoint URL"
                      defaultValue={endpoint.baseUrl}
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={testingIds.includes(endpoint.id)}
                      onClick={() => {
                        void testProvider(endpoint.id, endpoint.label);
                      }}
                    >
                      Test
                    </Button>
                  </div>
                );
              })}
            </div>
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
              {ALL_PROVIDERS.map((label) => {
                const id = label.toLowerCase().replace(/[^a-z]/g, '');
                const meta = HEALTH_META[statusOf(id)];
                return (
                  <li key={label} className="flex items-center justify-between">
                    <span className="text-muted">{label}</span>
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
