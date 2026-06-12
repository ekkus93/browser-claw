import {
  Rocket,
  Boxes,
  MessageSquare,
  Brain,
  Sparkles,
  CheckCircle2,
  Save,
  Archive,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';

interface Step {
  n: number;
  icon: LucideIcon;
  title: string;
  description: string;
}

const STEPS: Step[] = [
  {
    n: 1,
    icon: Rocket,
    title: 'First-run setup',
    description: 'Pick an inference mode and set up local storage.',
  },
  {
    n: 2,
    icon: Boxes,
    title: 'Choose model / provider',
    description:
      'Use a browser-local model, a local endpoint, or a remote API.',
  },
  {
    n: 3,
    icon: MessageSquare,
    title: 'Start chat / intent',
    description: 'Ask a question or give the agent a command.',
  },
  {
    n: 4,
    icon: Brain,
    title: 'Retrieve memory / skills',
    description: 'Relevant memories and enabled skills are pulled in.',
  },
  {
    n: 5,
    icon: Sparkles,
    title: 'Agent proposes',
    description: 'Side-effectful actions appear as approval cards.',
  },
  {
    n: 6,
    icon: CheckCircle2,
    title: 'You approve',
    description:
      'Review the risk and exact data, then approve, edit, or reject.',
  },
  {
    n: 7,
    icon: Save,
    title: 'Save to memory / audit',
    description: 'Results persist locally and every action is audited.',
  },
  {
    n: 8,
    icon: Archive,
    title: 'Backup / restore',
    description: 'Export an encrypted backup or restore on a new device.',
  },
];

const JOURNEY = [
  'Onboard',
  'Ask a question',
  'Approve actions',
  'Review memory',
  'Export backups',
];

export default function WorkflowScreen() {
  return (
    <div className="overflow-y-auto">
      <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <main className="flex flex-col gap-6">
          <header>
            <h1 className="text-xl font-bold text-text">User Workflow</h1>
            <p className="text-sm text-muted">
              See how BrowserClaw turns your intent into trusted, local AI
              actions.
            </p>
          </header>

          <ol className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {STEPS.map((step) => {
              const Icon = step.icon;
              return (
                <li
                  key={step.n}
                  className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4"
                >
                  <div className="flex items-center gap-2">
                    <span className="flex size-7 items-center justify-center rounded-full bg-primary-subtle text-xs font-bold text-primary">
                      {step.n}
                    </span>
                    <Icon className="size-4 text-muted" aria-hidden="true" />
                  </div>
                  <h2 className="text-sm font-semibold text-text">
                    {step.title}
                  </h2>
                  <p className="text-sm leading-snug text-muted">
                    {step.description}
                  </p>
                </li>
              );
            })}
          </ol>

          <p className="flex items-center gap-2 rounded-card border border-success-subtle bg-success-subtle p-3 text-sm text-text">
            <ShieldCheck
              className="size-4 shrink-0 text-success"
              aria-hidden="true"
            />
            Your data stays local and private unless you choose a remote model
            or an export action.
          </p>
        </main>

        <aside>
          <div className="rounded-card border border-border bg-surface p-4">
            <h2 className="mb-3 text-sm font-semibold text-text">
              Typical user journey
            </h2>
            <ol className="flex flex-col gap-2 text-sm">
              {JOURNEY.map((item, index) => (
                <li key={item} className="flex items-center gap-2 text-muted">
                  <span className="flex size-5 items-center justify-center rounded-full bg-background text-xs font-semibold text-muted-subtle">
                    {index + 1}
                  </span>
                  {item}
                </li>
              ))}
            </ol>
          </div>
        </aside>
      </div>
    </div>
  );
}
