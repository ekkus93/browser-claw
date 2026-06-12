import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { UploadCloud } from 'lucide-react';
import { db } from '../db/db.ts';
import { useAppDispatch, useAppSelector } from '../store/hooks.ts';
import { selectedSkillSet } from '../store/slices/skillsSlice.ts';
import { createSkillManager } from '../skills/skillManager.ts';
import { parseSkillMd, parseClawskill } from '../skills/parseSkill.ts';
import {
  emptyPermissions,
  type ParsedSkill,
  type SkillPermissions,
} from '../skills/skillTypes.ts';
import { Badge } from '../components/ui/Badge.tsx';
import { Toggle } from '../components/ui/Toggle.tsx';
import { Tabs } from '../components/ui/Tabs.tsx';
import { Button } from '../components/ui/Button.tsx';
import { Dialog } from '../components/ui/Dialog.tsx';
import { useToast } from '../components/ui/toastContext.ts';
import { cn } from '../lib/cn.ts';

const BUNDLED_SKILLS = [
  `---\nname: web-search\nversion: 1.0.0\ndescription: Search the web and read result pages.\ntools: [Web Search, Page Reader]\nread: skills/web-search/data/**\nwrite: skills/web-search/out/**\nnetwork: true\n---\nIssue a query and summarize the top results.`,
  `---\nname: summarize-pdf\nversion: 1.0.0\ndescription: Summarize PDF documents into structured notes.\ntools: [File Reader]\nread: skills/summarize-pdf/data/**\nwrite: skills/summarize-pdf/out/**\nnetwork: false\n---\nRead the attached PDF and produce a concise outline.`,
];

export default function SkillsScreen() {
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const selectedSkillId = useAppSelector(
    (state) => state.skills.selectedSkillId,
  );
  const seededRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<ParsedSkill | null>(null);

  const manager = useMemo(
    () => createSkillManager({ db, dispatch }),
    [dispatch],
  );

  useEffect(() => {
    void (async () => {
      if (seededRef.current) return;
      seededRef.current = true;
      if ((await db.skills.count()) === 0) {
        for (const text of BUNDLED_SKILLS) {
          await manager.install(parseSkillMd(text), 'bundled');
        }
      }
    })();
  }, [manager]);

  const skills = useLiveQuery(() => db.skills.toArray(), []) ?? [];
  const selected =
    skills.find((s) => s.id === selectedSkillId) ?? skills[0] ?? null;

  const detail = useLiveQuery(async () => {
    if (!selected) return null;
    const permRow = await db.skill_state.get([selected.id, '__permissions__']);
    const files = await db.skill_files
      .where('skillId')
      .equals(selected.id)
      .toArray();
    return {
      permissions:
        (permRow?.value as SkillPermissions | undefined) ?? emptyPermissions(),
      files: files.map((f) => f.path),
    };
  }, [selected?.id]);

  async function handleFile(file: File) {
    try {
      const text = await file.text();
      setPending(
        file.name.endsWith('.clawskill')
          ? parseClawskill(text)
          : parseSkillMd(text),
      );
    } catch {
      toast({
        tone: 'danger',
        title: 'Import failed',
        description: 'Could not parse the skill.',
      });
    }
  }

  async function confirmInstall() {
    if (pending) {
      const source = pending.files['SKILL.md'] ? 'skill_md' : 'clawskill';
      await manager.install(pending, source);
      dispatch(selectedSkillSet(pending.manifest.name));
      toast({ tone: 'success', title: `Installed ${pending.manifest.name}` });
    }
    setPending(null);
  }

  const permissions = detail?.permissions ?? emptyPermissions();

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
              {skills.length === 0 ? (
                <p className="text-sm text-muted">No skills installed.</p>
              ) : (
                skills.map((skill) => (
                  <div
                    key={skill.id}
                    className={cn(
                      'flex items-center justify-between gap-2 rounded-button border px-3 py-2',
                      skill.id === selected?.id
                        ? 'border-primary bg-primary-subtle'
                        : 'border-border',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => dispatch(selectedSkillSet(skill.id))}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="block truncate text-sm font-medium text-text">
                        {skill.name}
                      </span>
                      <span className="text-xs text-muted-subtle">
                        {skill.source} · v{skill.version}
                      </span>
                    </button>
                    <Toggle
                      checked={skill.enabled}
                      onCheckedChange={(next) => {
                        void manager.setEnabled(skill.id, next);
                      }}
                      ariaLabel={`Enable ${skill.name}`}
                    />
                  </div>
                ))
              )}
            </div>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-text">
              Import Skill
            </h2>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full flex-col items-center gap-2 rounded-card border border-dashed border-border bg-surface-subtle px-4 py-8 text-center transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <UploadCloud
                className="size-6 text-muted-subtle"
                aria-hidden="true"
              />
              <span className="text-sm text-muted">
                Import a <span className="font-mono">.clawskill</span> or{' '}
                <span className="font-mono">SKILL.md</span>
              </span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".clawskill,.md,text/markdown,application/json"
              className="hidden"
              aria-label="Import skill file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleFile(file);
                event.target.value = '';
              }}
            />
          </section>
        </main>

        {selected ? (
          <section className="rounded-card border border-border bg-surface p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-text">
                {selected.name}
              </h2>
              <div className="flex items-center gap-2">
                <Badge tone={selected.enabled ? 'success' : 'neutral'} dot>
                  {selected.enabled ? 'Enabled' : 'Disabled'}
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    void manager.uninstall(selected.id);
                    dispatch(selectedSkillSet(null));
                  }}
                >
                  Uninstall
                </Button>
              </div>
            </div>

            <Tabs
              items={[
                {
                  id: 'overview',
                  label: 'Overview',
                  content: (
                    <p className="text-sm text-muted">
                      {selected.description || 'No description provided.'}
                    </p>
                  ),
                },
                {
                  id: 'files',
                  label: 'Files',
                  content: (
                    <ul className="flex flex-col gap-1 text-sm text-muted">
                      {(detail?.files ?? []).map((file) => (
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
                  content: <PermissionView permissions={permissions} />,
                },
                {
                  id: 'state',
                  label: 'State',
                  content: (
                    <p className="text-sm text-muted">
                      Private, mutable per-skill state lives in an isolated
                      store.
                    </p>
                  ),
                },
              ]}
            />
          </section>
        ) : (
          <section className="rounded-card border border-dashed border-border bg-surface p-8 text-center text-sm text-muted">
            Select a skill to view its details.
          </section>
        )}
      </div>

      <Dialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title={`Install ${pending?.manifest.name ?? 'skill'}?`}
        description="Review the permissions this skill requests."
        footer={
          <>
            <Button variant="ghost" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                void confirmInstall();
              }}
            >
              Install
            </Button>
          </>
        }
      >
        {pending && (
          <PermissionView permissions={pending.manifest.permissions} />
        )}
      </Dialog>
    </div>
  );
}

function PermissionView({ permissions }: { permissions: SkillPermissions }) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div>
        <p className="mb-1 font-medium text-text">Allowed tools</p>
        {permissions.tools.length === 0 ? (
          <p className="text-muted">None</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {permissions.tools.map((tool) => (
              <li
                key={tool}
                className="flex items-center justify-between text-muted"
              >
                {tool}
                <Badge tone="success">Allowed</Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <p className="mb-1 font-medium text-text">Filesystem access</p>
        <p className="font-mono text-xs text-muted">
          Read: {permissions.read.join(', ') || '—'}
        </p>
        <p className="font-mono text-xs text-muted">
          Write: {permissions.write.join(', ') || '—'}
        </p>
      </div>
      <div className="flex items-center justify-between">
        <span className="font-medium text-text">Network access</span>
        <Badge tone={permissions.network ? 'warning' : 'neutral'}>
          {permissions.network ? 'Allowed' : 'None'}
        </Badge>
      </div>
    </div>
  );
}
