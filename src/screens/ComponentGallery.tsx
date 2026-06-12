import { useState, type ReactNode } from 'react';
import { Plus, FolderOpen } from 'lucide-react';
import { Button } from '../components/ui/Button.tsx';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '../components/ui/Card.tsx';
import { Badge, type BadgeTone } from '../components/ui/Badge.tsx';
import { Input } from '../components/ui/Input.tsx';
import { Select } from '../components/ui/Select.tsx';
import { Toggle } from '../components/ui/Toggle.tsx';
import { Tabs } from '../components/ui/Tabs.tsx';
import { Dialog } from '../components/ui/Dialog.tsx';
import { Progress } from '../components/ui/Progress.tsx';
import { EmptyState } from '../components/ui/EmptyState.tsx';
import { ErrorState } from '../components/ui/ErrorState.tsx';
import { useToast } from '../components/ui/toastContext.ts';

const BADGE_TONES: BadgeTone[] = [
  'neutral',
  'primary',
  'success',
  'warning',
  'danger',
  'purple',
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-subtle">
        {title}
      </h2>
      <div className="flex flex-wrap items-end gap-3">{children}</div>
    </section>
  );
}

/**
 * Design-system gallery — a living reference for the shared components. Not a
 * product screen; lives at /showcase to aid development and visual review.
 */
export default function ComponentGallery() {
  const [toggleOn, setToggleOn] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const { toast } = useToast();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 p-8">
      <header>
        <h1 className="text-2xl font-extrabold text-text">Component Gallery</h1>
        <p className="mt-1 text-sm text-muted">
          Shared design-system primitives built from the canonical tokens.
        </p>
      </header>

      <Section title="Buttons">
        <Button variant="primary" leadingIcon={<Plus className="size-4" />}>
          Primary
        </Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Danger</Button>
        <Button variant="primary" loading>
          Loading
        </Button>
        <Button variant="secondary" disabled>
          Disabled
        </Button>
        <Button variant="secondary" size="sm">
          Small
        </Button>
      </Section>

      <Section title="Badges">
        {BADGE_TONES.map((tone) => (
          <Badge key={tone} tone={tone} dot>
            {tone}
          </Badge>
        ))}
      </Section>

      <Section title="Form controls">
        <Input label="Base URL" placeholder="https://api.example.com" />
        <Input label="API key" type="password" error="This field is required" />
        <Select label="Provider" defaultValue="anthropic">
          <option value="openai">OpenAI</option>
          <option value="anthropic">Anthropic</option>
          <option value="ollama">Ollama</option>
        </Select>
        <Toggle
          checked={toggleOn}
          onCheckedChange={setToggleOn}
          label="Require approval"
        />
      </Section>

      <Section title="Card">
        <Card className="w-80">
          <CardHeader>
            <CardTitle description="OpenAI-compatible endpoint">
              Anthropic
            </CardTitle>
            <Badge tone="success" dot>
              Connected
            </Badge>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted">
              Frontier models via the Anthropic API. Keys are held only in the
              in-memory vault.
            </p>
          </CardContent>
          <CardFooter>
            <Button variant="ghost" size="sm">
              Test
            </Button>
            <Button variant="primary" size="sm">
              Edit
            </Button>
          </CardFooter>
        </Card>
      </Section>

      <Section title="Progress">
        <div className="flex w-full flex-col gap-4">
          <Progress value={64} label="Downloading SmolLM2-1.7B" showValue />
          <Progress value={100} tone="success" label="Backup complete" />
        </div>
      </Section>

      <Section title="Tabs">
        <div className="w-full">
          <Tabs
            items={[
              {
                id: 'overview',
                label: 'Overview',
                content: (
                  <p className="text-sm text-muted">
                    Skill overview and description.
                  </p>
                ),
              },
              {
                id: 'permissions',
                label: 'Permissions',
                content: (
                  <p className="text-sm text-muted">
                    Declared permissions and approved namespaces.
                  </p>
                ),
              },
              {
                id: 'state',
                label: 'State',
                content: (
                  <p className="text-sm text-muted">
                    Private per-skill mutable state.
                  </p>
                ),
              },
            ]}
          />
        </div>
      </Section>

      <Section title="Overlays & feedback">
        <Button variant="secondary" onClick={() => setDialogOpen(true)}>
          Open dialog
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            toast({
              tone: 'success',
              title: 'Provider connected',
              description: 'Anthropic responded successfully.',
            })
          }
        >
          Show toast
        </Button>
      </Section>

      <Section title="Empty & error states">
        <div className="grid w-full gap-4 sm:grid-cols-2">
          <EmptyState
            icon={<FolderOpen className="size-5" />}
            title="No skills installed"
            description="Import a .clawskill or SKILL.md to get started."
            action={
              <Button variant="primary" size="sm">
                Import skill
              </Button>
            }
          />
          <ErrorState
            description="The local endpoint was unreachable. Check that llama-server is running."
            action={
              <Button variant="secondary" size="sm">
                Retry
              </Button>
            }
          />
        </div>
      </Section>

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="Delete conversation?"
        description="This permanently removes the conversation and its messages."
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => setDialogOpen(false)}>
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          Conversations live in local IndexedDB. This action cannot be undone.
        </p>
      </Dialog>
    </div>
  );
}
