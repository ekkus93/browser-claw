import { useState, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
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
    </div>
  );
}
