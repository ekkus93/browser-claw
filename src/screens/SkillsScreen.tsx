import { useEffect } from 'react';
import { UploadCloud } from 'lucide-react';
import { useAppDispatch, useAppSelector } from '../store/hooks.ts';
import {
  selectedSkillSet,
  skillEnabled,
  skillDisabled,
} from '../store/slices/skillsSlice.ts';
import { Badge } from '../components/ui/Badge.tsx';
import { Toggle } from '../components/ui/Toggle.tsx';
import { Tabs } from '../components/ui/Tabs.tsx';
import { cn } from '../lib/cn.ts';

interface Skill {
  id: string;
  name: string;
  source: 'installed' | 'bundled';
  risk: 'low' | 'medium' | 'high';
  description: string;
  instructions: string;
  files: string[];
  tools: string[];
  readPath: string;
  writePath: string;
  network: boolean;
}

const SKILLS: Skill[] = [
  {
    id: 'summarize-pdf',
    name: 'summarize-pdf',
    source: 'installed',
    risk: 'low',
    description: 'Summarizes PDF documents into structured notes.',
    instructions: 'Read the attached PDF and produce a concise outline.',
    files: ['SKILL.md', 'prompts/summary.md'],
    tools: ['Page Reader', 'File Reader'],
    readPath: '/skills/summarize-pdf/data/**',
    writePath: '/skills/summarize-pdf/out/**',
    network: false,
  },
  {
    id: 'daily-review',
    name: 'daily-review',
    source: 'installed',
    risk: 'low',
    description: 'Generates a daily review from recent memories.',
    instructions: 'Collect today’s memories and summarize progress.',
    files: ['SKILL.md'],
    tools: ['Memory Reader'],
    readPath: '/skills/daily-review/data/**',
    writePath: '/skills/daily-review/out/**',
    network: false,
  },
  {
    id: 'web-search',
    name: 'web-search',
    source: 'bundled',
    risk: 'medium',
    description: 'Searches the web and reads result pages.',
    instructions: 'Issue a query and summarize the top results.',
    files: ['SKILL.md'],
    tools: ['Web Search', 'Page Reader'],
    readPath: '/skills/web-search/data/**',
    writePath: '/skills/web-search/out/**',
    network: true,
  },
  {
    id: 'code-analyzer',
    name: 'code-analyzer',
    source: 'bundled',
    risk: 'medium',
    description: 'Analyzes a code snippet for issues.',
    instructions: 'Inspect the provided code and report findings.',
    files: ['SKILL.md'],
    tools: ['File Reader'],
    readPath: '/skills/code-analyzer/data/**',
    writePath: '/skills/code-analyzer/out/**',
    network: false,
  },
];

function SkillRow({
  skill,
  enabled,
  selected,
  onSelect,
  onToggle,
}: {
  skill: Skill;
  enabled: boolean;
  selected: boolean;
  onSelect: () => void;
  onToggle: (next: boolean) => void;
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-2 rounded-button border px-3 py-2',
        selected ? 'border-primary bg-primary-subtle' : 'border-border',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="min-w-0 flex-1 text-left"
      >
        <span className="block truncate text-sm font-medium text-text">
          {skill.name}
        </span>
        <span className="text-xs text-muted-subtle">Risk: {skill.risk}</span>
      </button>
      <Toggle
        checked={enabled}
        onCheckedChange={onToggle}
        ariaLabel={`Enable ${skill.name}`}
      />
    </div>
  );
}

export default function SkillsScreen() {
  const dispatch = useAppDispatch();
  const selectedSkillId = useAppSelector(
    (state) => state.skills.selectedSkillId,
  );
  const enabledIds = useAppSelector((state) => state.skills.enabledIds);

  useEffect(() => {
    if (selectedSkillId === null) dispatch(selectedSkillSet('summarize-pdf'));
  }, [selectedSkillId, dispatch]);

  const selected = SKILLS.find((s) => s.id === selectedSkillId) ?? SKILLS[0]!;

  function toggle(id: string, next: boolean) {
    dispatch(next ? skillEnabled(id) : skillDisabled(id));
  }

  const installed = SKILLS.filter((s) => s.source === 'installed');
  const bundled = SKILLS.filter((s) => s.source === 'bundled');

  return (
    <div className="overflow-y-auto">
      <div className="grid gap-6 p-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <main className="flex flex-col gap-6">
          <header>
            <h1 className="text-xl font-bold text-text">Skills</h1>
            <p className="text-sm text-muted">Install and configure skills.</p>
          </header>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-text">
              Installed Skills
            </h2>
            <div className="flex flex-col gap-2">
              {installed.map((skill) => (
                <SkillRow
                  key={skill.id}
                  skill={skill}
                  enabled={enabledIds.includes(skill.id)}
                  selected={skill.id === selected.id}
                  onSelect={() => dispatch(selectedSkillSet(skill.id))}
                  onToggle={(next) => toggle(skill.id, next)}
                />
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-text">
              Bundled Skills
            </h2>
            <div className="flex flex-col gap-2">
              {bundled.map((skill) => (
                <SkillRow
                  key={skill.id}
                  skill={skill}
                  enabled={enabledIds.includes(skill.id)}
                  selected={skill.id === selected.id}
                  onSelect={() => dispatch(selectedSkillSet(skill.id))}
                  onToggle={(next) => toggle(skill.id, next)}
                />
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-text">
              Import Skill
            </h2>
            <div className="flex flex-col items-center gap-2 rounded-card border border-dashed border-border bg-surface-subtle px-4 py-8 text-center">
              <UploadCloud
                className="size-6 text-muted-subtle"
                aria-hidden="true"
              />
              <p className="text-sm text-muted">
                Drop a <span className="font-mono">.clawskill</span> or{' '}
                <span className="font-mono">SKILL.md</span> here
              </p>
              <p className="text-xs text-muted-subtle">
                Import with a permission review (Phase 10)
              </p>
            </div>
          </section>
        </main>

        <section className="rounded-card border border-border bg-surface p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-text">{selected.name}</h2>
            <Badge
              tone={enabledIds.includes(selected.id) ? 'success' : 'neutral'}
              dot
            >
              {enabledIds.includes(selected.id) ? 'Enabled' : 'Disabled'}
            </Badge>
          </div>

          <Tabs
            items={[
              {
                id: 'overview',
                label: 'Overview',
                content: (
                  <p className="text-sm text-muted">{selected.description}</p>
                ),
              },
              {
                id: 'instructions',
                label: 'Instructions',
                content: (
                  <p className="text-sm text-muted">{selected.instructions}</p>
                ),
              },
              {
                id: 'files',
                label: 'Files',
                content: (
                  <ul className="flex flex-col gap-1 text-sm text-muted">
                    {selected.files.map((file) => (
                      <li key={file} className="font-mono">
                        {file}
                      </li>
                    ))}
                  </ul>
                ),
              },
              {
                id: 'permissions',
                label: 'Permissions',
                content: (
                  <div className="flex flex-col gap-4 text-sm">
                    <div>
                      <p className="mb-1 font-medium text-text">
                        Allowed tools
                      </p>
                      <ul className="flex flex-col gap-1">
                        {selected.tools.map((tool) => (
                          <li
                            key={tool}
                            className="flex items-center justify-between text-muted"
                          >
                            {tool}
                            <Badge tone="success">Allowed</Badge>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="mb-1 font-medium text-text">
                        Skill filesystem access
                      </p>
                      <p className="font-mono text-xs text-muted">
                        Read: {selected.readPath}
                      </p>
                      <p className="font-mono text-xs text-muted">
                        Write: {selected.writePath}
                      </p>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-text">
                        Network access
                      </span>
                      <Badge tone={selected.network ? 'warning' : 'neutral'}>
                        {selected.network ? 'Allowed' : 'None'}
                      </Badge>
                    </div>
                  </div>
                ),
              },
              {
                id: 'state',
                label: 'State',
                content: (
                  <p className="text-sm text-muted">
                    Private, mutable per-skill state lives in an isolated store.
                  </p>
                ),
              },
              {
                id: 'audit',
                label: 'Audit',
                content: (
                  <p className="text-sm text-muted">
                    Skill audit events appear here once the skill runs.
                  </p>
                ),
              },
            ]}
          />
        </section>
      </div>
    </div>
  );
}
