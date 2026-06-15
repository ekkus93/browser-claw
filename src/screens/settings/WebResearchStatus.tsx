import { useState, type ReactNode } from 'react';
import { Badge, type BadgeTone } from '../../components/ui/Badge.tsx';
import { Button } from '../../components/ui/Button.tsx';

/**
 * Web Research settings/status area (Part G3). Shows whether the search provider
 * is configured and whether the companion Chrome extension is reachable, with
 * install guidance when it isn't, plus where research bundles are written and
 * the CORS limitation of the in-page Browser Fetch tool. It is honest about
 * capability: the extension probe is only offered when a live checker is wired.
 */

export type ExtensionStatus = 'unknown' | 'checking' | 'connected' | 'missing';

export interface WebResearchStatusProps {
  /** The configured search provider (e.g. Brave Search). */
  searchProvider: { name: string; configured: boolean };
  /** A known extension state, when the host already determined one. */
  extension?: { available: boolean; version?: string };
  /** Output directories of recent research bundles, newest first. */
  researchPaths?: readonly string[];
  /** Live availability probe (extension ping). Omit when none is wired yet. */
  probe?: () => Promise<{ available: boolean; version?: string }>;
}

const STATUS_TONE: Record<ExtensionStatus, BadgeTone> = {
  unknown: 'neutral',
  checking: 'primary',
  connected: 'success',
  missing: 'danger',
};

const STATUS_LABEL: Record<ExtensionStatus, string> = {
  unknown: 'Not checked',
  checking: 'Checking…',
  connected: 'Connected',
  missing: 'Not detected',
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-muted">{label}</span>
      {children}
    </div>
  );
}

export function WebResearchStatus({
  searchProvider,
  extension,
  researchPaths = [],
  probe,
}: WebResearchStatusProps) {
  const initial: ExtensionStatus = extension
    ? extension.available
      ? 'connected'
      : 'missing'
    : 'unknown';
  const [status, setStatus] = useState<ExtensionStatus>(initial);
  const [version, setVersion] = useState<string | undefined>(
    extension?.version,
  );

  const check = async (): Promise<void> => {
    if (!probe) return;
    setStatus('checking');
    try {
      const result = await probe();
      setStatus(result.available ? 'connected' : 'missing');
      setVersion(result.version);
    } catch {
      setStatus('missing');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Row label="Search provider">
        <span className="flex items-center gap-2">
          <span className="text-sm font-medium text-text">
            {searchProvider.name}
          </span>
          <Badge tone={searchProvider.configured ? 'success' : 'neutral'} dot>
            {searchProvider.configured ? 'Configured' : 'No API key'}
          </Badge>
        </span>
      </Row>

      <Row label="Chrome extension">
        <span className="flex items-center gap-2">
          <Badge tone={STATUS_TONE[status]} dot>
            {STATUS_LABEL[status]}
            {status === 'connected' && version ? ` v${version}` : ''}
          </Badge>
          {probe && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void check()}
              disabled={status === 'checking'}
            >
              Check
            </Button>
          )}
        </span>
      </Row>

      {status !== 'connected' && (
        <div className="rounded-button border border-border bg-surface-subtle p-3">
          <p className="text-xs font-medium text-text">
            Install the companion extension
          </p>
          <ol className="mt-1 list-inside list-decimal text-xs text-muted">
            <li>
              Open <span className="font-mono">chrome://extensions</span> and
              enable Developer mode.
            </li>
            <li>
              Choose “Load unpacked” and select{' '}
              <span className="font-mono">extension/chrome-web-research</span>.
            </li>
            <li>Reload BrowserClaw and check the status again.</li>
          </ol>
        </div>
      )}

      <div>
        <p className="mb-1 text-xs font-medium text-muted-subtle">
          Research output
        </p>
        {researchPaths.length === 0 ? (
          <p className="text-xs text-muted-subtle">No research runs yet.</p>
        ) : (
          <ul className="font-mono text-xs text-text">
            {researchPaths.map((path) => (
              <li key={path}>{path}</li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-xs text-muted-subtle">
        The in-page Browser Fetch tool is limited by the browser’s CORS policy
        and cannot read most sites directly — the extension reads pages on your
        behalf, and each new site asks for permission first.
      </p>
    </div>
  );
}
