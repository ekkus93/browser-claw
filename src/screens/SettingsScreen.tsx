import { useEffect, useState, type ChangeEvent, type ReactNode } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks.ts';
import { runtimeReset } from '../store/slices/runtimeSlice.ts';
import { db } from '../db/db.ts';
import {
  getLockTimeoutMinutes,
  setLockTimeoutMinutes,
  getWllamaCdnConsent,
  setWllamaCdnConsent,
  getTheme,
  setTheme,
  getApprovalPolicy,
  setApprovalPolicy,
  type ApprovalPolicy,
  getFallbackProviderId,
  setFallbackProviderId,
} from '../settings/appSettings.ts';
import { applyTheme, normalizeTheme, type Theme } from '../settings/theme.ts';
import {
  loadEffectAuditPref,
  setEffectAuditEnabled,
} from '../settings/runtimeAuditPref.ts';
import {
  getActiveProviderId,
  setActiveProviderId,
  getActiveProviderProfile,
  DEFAULT_PROVIDER_PROFILES,
} from '../providers/providerProfiles.ts';
import { activeProviderSet } from '../store/slices/providersSlice.ts';
import { recordAudit } from '../audit/auditSink.ts';
import { secretVault } from '../secrets/vault.ts';
import { APP_VERSION } from '../lib/appMeta.ts';
import { Toggle } from '../components/ui/Toggle.tsx';
import { Select } from '../components/ui/Select.tsx';
import { Input } from '../components/ui/Input.tsx';
import { Button } from '../components/ui/Button.tsx';
import { Badge } from '../components/ui/Badge.tsx';
import { WebResearchStatus } from './settings/WebResearchStatus.tsx';

// No-op for placeholder controls that are shown disabled until their behavior
// is implemented (Phase 10 honesty: a control either works or is visibly
// inactive — never a switch that flips but changes nothing).
const noop = (): void => undefined;

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
  const runtimeMode = useAppSelector((state) => state.runtime.mode);

  // Theme is a real, persisted preference: read the durable value on mount,
  // and on change apply it to <html data-theme> immediately and write it back.
  const [theme, setThemeState] = useState<Theme>('light');
  useEffect(() => {
    let active = true;
    void getTheme(db).then((value) => {
      if (active) setThemeState(value);
    });
    return () => {
      active = false;
    };
  }, []);
  const handleThemeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = normalizeTheme(event.target.value);
    setThemeState(value);
    applyTheme(value);
    void setTheme(db, value);
  };

  // Default provider is the real, persisted active provider (app_settings key
  // 'activeProviderId') — the same one Onboarding writes and the runtime reads.
  // Read it on mount; on change persist it AND dispatch activeProviderSet so the
  // live UI/runtime switch immediately (mirroring main.tsx restoreActiveProvider,
  // resolving label/model/baseUrl from the persisted-or-default profile).
  const [activeProviderId, setActiveProviderIdState] = useState<string | null>(
    null,
  );
  useEffect(() => {
    let active = true;
    void getActiveProviderId(db).then((id) => {
      if (active) setActiveProviderIdState(id);
    });
    return () => {
      active = false;
    };
  }, []);
  const handleProviderChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const id = event.target.value;
    setActiveProviderIdState(id);
    void (async () => {
      await setActiveProviderId(db, id);
      const profile = await getActiveProviderProfile(db);
      if (profile) {
        dispatch(
          activeProviderSet({
            id: profile.id,
            label: profile.label,
            ...(profile.model ? { model: profile.model } : {}),
            ...(profile.baseUrl ? { baseUrl: profile.baseUrl } : {}),
          }),
        );
      }
    })();
  };

  // Approval policy is a real, persisted security setting that the tool-effect
  // handler reads to decide whether a proposed call must be confirmed or may
  // auto-run (low/medium only — high always prompts). Relaxing it is a
  // meaningful security change, so the switch is audited. Default fail-closed.
  const [approvalPolicy, setApprovalPolicyState] =
    useState<ApprovalPolicy>('require_all');
  useEffect(() => {
    let active = true;
    void getApprovalPolicy(db).then((policy) => {
      if (active) setApprovalPolicyState(policy);
    });
    return () => {
      active = false;
    };
  }, []);
  const handleApprovalPolicyChange = (
    event: ChangeEvent<HTMLSelectElement>,
  ) => {
    const policy: ApprovalPolicy =
      event.target.value === 'auto_low_medium'
        ? 'auto_low_medium'
        : 'require_all';
    setApprovalPolicyState(policy);
    void setApprovalPolicy(db, policy);
    const relaxed = policy === 'auto_low_medium';
    void recordAudit(db, dispatch, {
      type: relaxed
        ? 'settings.approval_policy_relaxed'
        : 'settings.approval_policy_strict',
      summary: relaxed
        ? 'Approval policy set to auto-approve low & medium risk'
        : 'Approval policy set to require approval for everything',
      source: 'user',
      status: 'success',
      risk: relaxed ? 'medium' : 'info',
    });
  };

  // Fallback provider is a real, persisted setting the runtime reads: if the
  // active provider fails with a reachability error, llmRunner retries once on
  // this provider. '' = None (no failover). Read on mount; write on change.
  const [fallbackProviderId, setFallbackProviderIdState] = useState<
    string | null
  >(null);
  useEffect(() => {
    let active = true;
    void getFallbackProviderId(db).then((id) => {
      if (active) setFallbackProviderIdState(id);
    });
    return () => {
      active = false;
    };
  }, []);
  const handleFallbackProviderChange = (
    event: ChangeEvent<HTMLSelectElement>,
  ) => {
    const id = event.target.value === '' ? null : event.target.value;
    setFallbackProviderIdState(id);
    void setFallbackProviderId(db, id);
  };

  // Verbose runtime audit: opt-in diagnostic that makes the runtime host emit
  // an audit per non-terminal effect (emitted/resolved). Off by default.
  const [effectAudit, setEffectAuditState] = useState(false);
  useEffect(() => {
    let active = true;
    void loadEffectAuditPref(db).then((value) => {
      if (active) setEffectAuditState(value);
    });
    return () => {
      active = false;
    };
  }, []);
  const handleEffectAuditChange = (value: boolean) => {
    setEffectAuditState(value);
    void setEffectAuditEnabled(db, value);
  };

  // Lock timeout is a real, persisted setting: it drives the SecretVault's
  // auto-lock timer. Read the durable value on mount and write changes back to
  // IndexedDB while applying them to the live vault immediately.
  const [lockTimeoutMinutes, setLockTimeoutMinutesState] = useState(15);
  useEffect(() => {
    let active = true;
    void getLockTimeoutMinutes(db).then((minutes) => {
      if (active) setLockTimeoutMinutesState(minutes);
    });
    return () => {
      active = false;
    };
  }, []);
  const handleLockTimeoutChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const minutes = Number(event.target.value);
    setLockTimeoutMinutesState(minutes);
    secretVault.setLockTimeout(minutes * 60_000);
    void setLockTimeoutMinutes(db, minutes);
  };

  // CDN consent for the wllama runtime is a real, persisted security policy:
  // off by default (fail closed), it gates whether browser-local models may
  // fetch the runtime WASM from the CDN. Changing it is a meaningful action, so
  // it's audited. Read the durable value on mount; write changes back.
  const [wllamaCdnConsent, setWllamaCdnConsentState] = useState(false);
  useEffect(() => {
    let active = true;
    void getWllamaCdnConsent(db).then((value) => {
      if (active) setWllamaCdnConsentState(value);
    });
    return () => {
      active = false;
    };
  }, []);
  const handleWllamaCdnConsentChange = (value: boolean) => {
    setWllamaCdnConsentState(value);
    void setWllamaCdnConsent(db, value);
    void recordAudit(db, dispatch, {
      type: value
        ? 'settings.wllama_cdn_consent_granted'
        : 'settings.wllama_cdn_consent_revoked',
      summary: value
        ? 'Granted consent to load the wllama runtime from the CDN'
        : 'Revoked consent to load the wllama runtime from the CDN',
      source: 'model',
      status: 'success',
      risk: value ? 'medium' : 'info',
    });
  };

  return (
    <div className="overflow-y-auto">
      <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <main className="flex flex-col gap-4">
          <header>
            <h1 className="text-xl font-bold text-text">Settings</h1>
            <p className="text-sm text-muted">
              Configure workflow and security preferences.
            </p>
            <p className="mt-1 text-xs text-muted-subtle">
              Disabled controls are placeholders for upcoming preferences and
              don&apos;t take effect yet. Theme, default provider, fallback
              provider, approval policy, lock timeout, and &ldquo;Load runtime
              from CDN&rdquo; are active.
            </p>
          </header>

          <div className="grid gap-4 md:grid-cols-2">
            <Section title="General">
              <Field
                label="Theme"
                control={
                  <Select
                    aria-label="Theme"
                    className="w-40"
                    value={theme}
                    onChange={handleThemeChange}
                  >
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                  </Select>
                }
              />
              <Field
                label="Auto-start runtime"
                control={
                  <Toggle
                    checked={false}
                    onCheckedChange={noop}
                    disabled
                    ariaLabel="Auto-start runtime"
                  />
                }
              />
            </Section>

            <Section title="Models">
              <Field
                label="Default provider"
                control={
                  <Select
                    aria-label="Default provider"
                    className="w-40"
                    value={activeProviderId ?? ''}
                    onChange={handleProviderChange}
                  >
                    <option value="" disabled>
                      Select a provider
                    </option>
                    {DEFAULT_PROVIDER_PROFILES.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.label}
                      </option>
                    ))}
                  </Select>
                }
              />
              <Field
                label="Fallback provider"
                control={
                  <Select
                    aria-label="Fallback provider"
                    className="w-40"
                    value={fallbackProviderId ?? ''}
                    onChange={handleFallbackProviderChange}
                  >
                    <option value="">None</option>
                    {DEFAULT_PROVIDER_PROFILES.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.label}
                      </option>
                    ))}
                  </Select>
                }
              />
              <Field
                label="Default model"
                control={
                  <Input defaultValue="SmolLM2" className="w-40" disabled />
                }
              />
              <Field
                label="Load runtime from CDN"
                control={
                  <Toggle
                    checked={wllamaCdnConsent}
                    onCheckedChange={handleWllamaCdnConsentChange}
                    ariaLabel="Load runtime from CDN"
                  />
                }
              />
            </Section>

            <Section title="Security">
              <Field
                label="Key storage mode"
                control={
                  <Select defaultValue="encrypted" className="w-40" disabled>
                    <option value="session">Session only</option>
                    <option value="encrypted">Encrypted</option>
                  </Select>
                }
              />
              <Field
                label="Lock timeout"
                control={
                  <Select
                    aria-label="Lock timeout"
                    className="w-40"
                    value={String(lockTimeoutMinutes)}
                    onChange={handleLockTimeoutChange}
                  >
                    <option value="5">5 minutes</option>
                    <option value="15">15 minutes</option>
                    <option value="60">1 hour</option>
                  </Select>
                }
              />
              <Field
                label="Approval policy"
                control={
                  <Select
                    aria-label="Approval policy"
                    className="w-56"
                    value={approvalPolicy}
                    onChange={handleApprovalPolicyChange}
                  >
                    <option value="require_all">
                      Require approval for everything
                    </option>
                    <option value="auto_low_medium">
                      Auto-approve low &amp; medium risk
                    </option>
                  </Select>
                }
              />
              <Field
                label="Warn on browser-direct keys"
                control={
                  <Toggle
                    checked={true}
                    onCheckedChange={noop}
                    disabled
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
                    checked={false}
                    onCheckedChange={noop}
                    disabled
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
                    checked={false}
                    onCheckedChange={noop}
                    disabled
                    ariaLabel="Allow unsigned skills"
                  />
                }
              />
              <Field
                label="Auto-update skills"
                control={
                  <Toggle
                    checked={true}
                    onCheckedChange={noop}
                    disabled
                    ariaLabel="Auto-update skills"
                  />
                }
              />
            </Section>

            <Section title="Developer">
              <Field
                label="Log level"
                control={
                  <Select defaultValue="info" className="w-40" disabled>
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
                    checked={false}
                    onCheckedChange={noop}
                    disabled
                    ariaLabel="Dev mode"
                  />
                }
              />
              <Field
                label="Verbose runtime audit"
                control={
                  <Toggle
                    checked={effectAudit}
                    onCheckedChange={handleEffectAuditChange}
                    ariaLabel="Verbose runtime audit"
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

            <Section title="Web research">
              <WebResearchStatus
                searchProvider={{ name: 'Brave Search', configured: false }}
              />
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
              <Row
                label="Runtime"
                value={
                  runtimeMode
                    ? `${runtimeStatus} (${runtimeMode})`
                    : runtimeStatus
                }
              />
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
