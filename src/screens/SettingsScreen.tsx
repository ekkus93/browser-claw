import { useState, type ReactNode } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks.ts';
import { runtimeReset } from '../store/slices/runtimeSlice.ts';
import { APP_VERSION } from '../lib/appMeta.ts';
import { Toggle } from '../components/ui/Toggle.tsx';
import { Select } from '../components/ui/Select.tsx';
import { Input } from '../components/ui/Input.tsx';
import { Button } from '../components/ui/Button.tsx';
import { Badge } from '../components/ui/Badge.tsx';

interface Flags {
  autoStart: boolean;
  requireApproval: boolean;
  keyWarning: boolean;
  autoBackup: boolean;
  allowUnsigned: boolean;
  autoUpdate: boolean;
  devMode: boolean;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4">
      <h2 className="text-sm font-semibold text-text">{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, control }: { label: string; control: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-muted">{label}</span>
      {control}
    </div>
  );
}

export default function SettingsScreen() {
  const dispatch = useAppDispatch();
  const provider = useAppSelector(
    (state) => state.providers.activeProviderLabel,
  );
  const model = useAppSelector((state) => state.models.activeModelLabel);
  const runtimeStatus = useAppSelector((state) => state.runtime.status);

  const [flags, setFlags] = useState<Flags>({
    autoStart: false,
    requireApproval: true,
    keyWarning: true,
    autoBackup: true,
    allowUnsigned: false,
    autoUpdate: true,
    devMode: false,
  });
  const toggle = (key: keyof Flags) =>
    setFlags((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className="overflow-y-auto">
      <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <main className="flex flex-col gap-4">
          <header>
            <h1 className="text-xl font-bold text-text">Settings</h1>
            <p className="text-sm text-muted">
              Configure workflow and security preferences.
            </p>
          </header>

          <div className="grid gap-4 md:grid-cols-2">
            <Section title="General">
              <Field
                label="Theme"
                control={
                  <Select defaultValue="light" className="w-40">
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                  </Select>
                }
              />
              <Field
                label="Auto-start runtime"
                control={
                  <Toggle
                    checked={flags.autoStart}
                    onCheckedChange={() => toggle('autoStart')}
                    ariaLabel="Auto-start runtime"
                  />
                }
              />
            </Section>

            <Section title="Models">
              <Field
                label="Default provider"
                control={
                  <Select defaultValue="wllama" className="w-40">
                    <option value="wllama">wllama</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="openai">OpenAI</option>
                  </Select>
                }
              />
              <Field
                label="Default model"
                control={<Input defaultValue="SmolLM2" className="w-40" />}
              />
            </Section>

            <Section title="Security">
              <Field
                label="Key storage mode"
                control={
                  <Select defaultValue="encrypted" className="w-40">
                    <option value="session">Session only</option>
                    <option value="encrypted">Encrypted</option>
                  </Select>
                }
              />
              <Field
                label="Lock timeout"
                control={
                  <Select defaultValue="15" className="w-40">
                    <option value="5">5 minutes</option>
                    <option value="15">15 minutes</option>
                    <option value="60">1 hour</option>
                  </Select>
                }
              />
              <Field
                label="Require approval by default"
                control={
                  <Toggle
                    checked={flags.requireApproval}
                    onCheckedChange={() => toggle('requireApproval')}
                    ariaLabel="Require approval by default"
                  />
                }
              />
              <Field
                label="Warn on browser-direct keys"
                control={
                  <Toggle
                    checked={flags.keyWarning}
                    onCheckedChange={() => toggle('keyWarning')}
                    ariaLabel="Warn on browser-direct keys"
                  />
                }
              />
            </Section>

            <Section title="Storage">
              <Field
                label="Data location"
                control={<Badge tone="neutral">Browser IndexedDB</Badge>}
              />
              <Field
                label="Auto-backup"
                control={
                  <Toggle
                    checked={flags.autoBackup}
                    onCheckedChange={() => toggle('autoBackup')}
                    ariaLabel="Auto-backup"
                  />
                }
              />
            </Section>

            <Section title="Skills">
              <Field
                label="Allow unsigned skills"
                control={
                  <Toggle
                    checked={flags.allowUnsigned}
                    onCheckedChange={() => toggle('allowUnsigned')}
                    ariaLabel="Allow unsigned skills"
                  />
                }
              />
              <Field
                label="Auto-update skills"
                control={
                  <Toggle
                    checked={flags.autoUpdate}
                    onCheckedChange={() => toggle('autoUpdate')}
                    ariaLabel="Auto-update skills"
                  />
                }
              />
            </Section>

            <Section title="Developer">
              <Field
                label="Log level"
                control={
                  <Select defaultValue="info" className="w-40">
                    <option value="error">Error</option>
                    <option value="info">Info</option>
                    <option value="debug">Debug</option>
                  </Select>
                }
              />
              <Field
                label="Dev mode"
                control={
                  <Toggle
                    checked={flags.devMode}
                    onCheckedChange={() => toggle('devMode')}
                    ariaLabel="Dev mode"
                  />
                }
              />
              <Button
                variant="danger"
                size="sm"
                onClick={() => dispatch(runtimeReset())}
              >
                Reset runtime
              </Button>
            </Section>
          </div>
        </main>

        <aside className="flex flex-col gap-4">
          <div className="rounded-card border border-border bg-surface p-4">
            <h2 className="mb-3 text-sm font-semibold text-text">
              Environment
            </h2>
            <dl className="flex flex-col gap-1.5 text-sm">
              <Row label="Provider" value={provider ?? 'None'} />
              <Row label="Model" value={model ?? 'None'} />
              <Row label="Runtime" value={runtimeStatus} />
              <Row label="Mode" value="Local" />
              <Row label="Data" value="IndexedDB" />
            </dl>
          </div>

          <div className="rounded-card border border-border bg-surface p-4">
            <h2 className="mb-3 text-sm font-semibold text-text">Version</h2>
            <dl className="flex flex-col gap-1.5 text-sm">
              <Row label="BrowserClaw" value={APP_VERSION} />
              <Row label="Runtime" value={APP_VERSION} />
            </dl>
            <Badge tone="success" dot>
              Up to date
            </Badge>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted-subtle">{label}</dt>
      <dd className="truncate font-medium text-text">{value}</dd>
    </div>
  );
}
