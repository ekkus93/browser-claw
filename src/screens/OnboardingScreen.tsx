import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Check,
  Lock,
  Cpu,
  Server,
  Cloud,
  Database,
  ShieldCheck,
} from 'lucide-react';
import { Button } from '../components/ui/Button.tsx';
import { Badge } from '../components/ui/Badge.tsx';
import { Input } from '../components/ui/Input.tsx';
import { Select } from '../components/ui/Select.tsx';
import { BrandMark } from '../components/shell/BrandMark.tsx';
import { cn } from '../lib/cn.ts';
import { useAppDispatch, useAppSelector } from '../store/hooks.ts';
import { onboardingCompleted } from '../store/slices/appSlice.ts';
import { activeProviderSet } from '../store/slices/providersSlice.ts';
import {
  requestPersistentStorage,
  refreshStorageInfo,
} from '../services/storageService.ts';
import { db } from '../db/db.ts';
import { setOnboardingComplete } from '../settings/appSettings.ts';

type InferenceMode = 'wllama' | 'local' | 'remote';

const STEPS = [
  'Choose inference mode',
  'Set up storage',
  'Configure model',
  'Finish',
] as const;

interface ModeOption {
  id: InferenceMode;
  icon: typeof Cpu;
  title: string;
  recommended?: boolean;
  features: string[];
  note: string;
}

const MODES: ModeOption[] = [
  {
    id: 'wllama',
    icon: Cpu,
    title: 'Run browser-local model with wllama',
    recommended: true,
    features: [
      '100% local & private',
      'Works offline',
      'No API costs',
      'Best personal mode',
    ],
    note: 'Requires RAM',
  },
  {
    id: 'local',
    icon: Server,
    title: 'Connect to Ollama or llama-server',
    features: [
      'Use local models',
      'Flexible endpoints',
      'Leverages your hardware',
      'Works over LAN',
    ],
    note: 'Requires local server',
  },
  {
    id: 'remote',
    icon: Cloud,
    title: 'Use OpenAI / Anthropic',
    features: [
      'Frontier models',
      'Always updated',
      'Managed APIs',
      'Internet required',
    ],
    note: 'API fees apply',
  },
];

function StepRail({ current }: { current: number }) {
  return (
    <ol className="flex flex-col gap-2">
      {STEPS.map((label, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li key={label} className="flex items-center gap-2.5 text-sm">
            <span
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                done && 'bg-success text-surface',
                active && 'bg-primary text-surface',
                !done && !active && 'bg-background text-muted-subtle',
              )}
            >
              {done ? <Check className="size-3.5" /> : index + 1}
            </span>
            <span className={active ? 'font-semibold text-text' : 'text-muted'}>
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function ModeCard({
  option,
  selected,
  onSelect,
}: {
  option: ModeOption;
  selected: boolean;
  onSelect: () => void;
}) {
  const Icon = option.icon;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'flex w-full flex-col gap-3 rounded-card border bg-surface p-4 text-left transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
        selected
          ? 'border-primary ring-1 ring-primary'
          : 'border-border hover:bg-surface-subtle',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <Icon
          className={selected ? 'size-6 text-primary' : 'size-6 text-muted'}
          aria-hidden="true"
        />
        {option.recommended && <Badge tone="primary">Recommended</Badge>}
      </div>
      <h3 className="text-sm font-semibold text-text">{option.title}</h3>
      <ul className="flex flex-col gap-1">
        {option.features.map((feature) => (
          <li
            key={feature}
            className="flex items-center gap-1.5 text-sm text-muted"
          >
            <Check
              className="size-3.5 shrink-0 text-success"
              aria-hidden="true"
            />
            {feature}
          </li>
        ))}
      </ul>
      <Badge tone="neutral">{option.note}</Badge>
    </button>
  );
}

function formatGb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export default function OnboardingScreen() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<InferenceMode>('wllama');
  const [endpoint, setEndpoint] = useState('http://localhost:11434');
  const [provider, setProvider] = useState('anthropic');

  const storage = useAppSelector((state) => state.storage);

  async function finish() {
    // Persist completion durably so the index route doesn't re-show onboarding
    // on the next reload (TODO Phase 9.1).
    await setOnboardingComplete(db, true);
    dispatch(onboardingCompleted());
    if (mode === 'remote') {
      dispatch(
        activeProviderSet({
          id: provider,
          label: provider === 'openai' ? 'OpenAI' : 'Anthropic',
        }),
      );
    }
    navigate('/chat');
  }

  let body: ReactNode;
  if (step === 0) {
    body = (
      <div className="grid gap-4 sm:grid-cols-3">
        {MODES.map((option) => (
          <ModeCard
            key={option.id}
            option={option}
            selected={mode === option.id}
            onSelect={() => setMode(option.id)}
          />
        ))}
      </div>
    );
  } else if (step === 1) {
    body = (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          BrowserClaw stores everything in your browser&apos;s IndexedDB. Enable
          persistent storage so the browser won&apos;t evict your data.
        </p>
        <div className="flex items-center gap-3 rounded-card border border-border bg-surface p-4">
          <Database className="size-5 text-muted" aria-hidden="true" />
          <div className="flex-1 text-sm">
            <p className="font-medium text-text">Local database</p>
            <p className="text-muted">
              {storage.quotaBytes > 0
                ? `${formatGb(storage.usedBytes)} used of ${formatGb(storage.quotaBytes)} · ${storage.persisted ? 'persistent' : 'not persistent'}`
                : 'Not measured yet'}
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void requestPersistentStorage().then(() =>
                refreshStorageInfo(dispatch),
              );
            }}
          >
            Enable persistent storage
          </Button>
        </div>
      </div>
    );
  } else if (step === 2) {
    body = (
      <div className="flex max-w-md flex-col gap-4">
        {mode === 'wllama' && (
          <Select label="Browser-local model" defaultValue="smollm2">
            <option value="smollm2">SmolLM2-1.7B-Instruct (GGUF)</option>
            <option value="qwen">Qwen2.5-0.5B-Instruct (GGUF)</option>
          </Select>
        )}
        {mode === 'local' && (
          <Input
            label="Local endpoint URL"
            value={endpoint}
            onChange={(event) => setEndpoint(event.target.value)}
          />
        )}
        {mode === 'remote' && (
          <>
            <Select
              label="Provider"
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
            >
              <option value="anthropic">Anthropic</option>
              <option value="openai">OpenAI</option>
            </Select>
            <p className="flex items-start gap-2 rounded-button bg-warning-subtle p-3 text-sm text-text">
              <Lock
                className="mt-0.5 size-4 shrink-0 text-warning"
                aria-hidden="true"
              />
              Browser-direct API keys are visible to this site&apos;s scripts.
              BrowserClaw encrypts stored keys, but use a restricted key.
            </p>
          </>
        )}
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-success-subtle text-success">
          <ShieldCheck className="size-6" aria-hidden="true" />
        </span>
        <h3 className="text-lg font-semibold text-text">You&apos;re all set</h3>
        <p className="max-w-sm text-sm text-muted">
          BrowserClaw will create your default workspace and install the bundled
          skills, then open the chat workbench.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto grid max-w-5xl gap-6 p-8 lg:grid-cols-[1fr_280px]">
        <main className="flex flex-col gap-6">
          <header className="flex items-center gap-3">
            <BrandMark size={36} />
            <div>
              <h1 className="text-2xl font-extrabold text-text">
                Welcome to BrowserClaw
              </h1>
              <p className="text-sm text-muted">
                Let&apos;s get you set up in a few simple steps.
              </p>
            </div>
          </header>

          <div className="rounded-card border border-border bg-surface p-6">
            <p className="text-sm font-semibold text-muted-subtle">
              Step {step + 1} of {STEPS.length}
            </p>
            <h2 className="mt-1 mb-4 text-lg font-semibold text-text">
              {STEPS[step]}
            </h2>
            {body}

            <p className="mt-6 flex items-center gap-2 text-sm text-muted">
              <Lock className="size-4 text-muted-subtle" aria-hidden="true" />
              Your data stays private. API keys and sensitive settings are
              encrypted locally in your browser.
            </p>

            <div className="mt-6 flex justify-between">
              <Button
                variant="ghost"
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                disabled={step === 0}
              >
                Back
              </Button>
              {step < STEPS.length - 1 ? (
                <Button variant="primary" onClick={() => setStep((s) => s + 1)}>
                  Continue
                </Button>
              ) : (
                <Button variant="primary" onClick={() => void finish()}>
                  Finish setup
                </Button>
              )}
            </div>
          </div>
        </main>

        <aside className="flex flex-col gap-4">
          <div className="rounded-card border border-border bg-surface p-4">
            <h2 className="mb-3 text-sm font-semibold text-text">
              Setup overview
            </h2>
            <StepRail current={step} />
          </div>
          <div className="rounded-card border border-border bg-surface p-4">
            <h2 className="text-sm font-semibold text-text">Need help?</h2>
            <button
              type="button"
              className="mt-1 text-sm font-medium text-primary hover:text-primary/80"
            >
              View setup guide
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
