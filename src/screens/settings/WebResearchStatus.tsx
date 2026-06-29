import { useState, type ReactNode } from 'react';
import { Badge, type BadgeTone } from '../../components/ui/Badge.tsx';
import { Button } from '../../components/ui/Button.tsx';
import type { WebResearchCapabilityStatus } from '../../extension/normalizeExtensionStatus.ts';

/**
 * Web Research settings/status area (Part G3 + E2/FIX3). Shows whether the
 * search provider is configured and whether the companion Chrome extension is
 * reachable. When `capabilities` is provided (from normalizeExtensionStatus),
 * renders separate rows per capability -- extension, page reading, current tab,
 * web search handler, Brave key, and live search readiness.
 */

export type ExtensionStatus = 'unknown' | 'checking' | 'connected' | 'missing';

export interface WebResearchStatusProps {
  /** The configured search provider (e.g. Brave Search). */
  searchProvider: { name: string; configured: boolean };
  /** A known extension state, when the host already determined one. */
  extension?: { available: boolean; version?: string };
  /**
   * E2 (FIX3): Per-capability facts from normalizeExtensionStatus(). When
   * provided, replaces the single "Connected/Not detected" badge with separate
   * rows per capability.
   */
  capabilities?: WebResearchCapabilityStatus;
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
  checking: 'Checking...',
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

function CapabilityRows({ caps }: { caps: WebResearchCapabilityStatus }) {
  const keyBadge = (): { tone: BadgeTone; label: string } => {
    if (caps.vaultLocked) return { tone: 'neutral', label: 'Vault locked' };
    if (caps.braveKeyConfigured)
      return { tone: 'success', label: 'Configured' };
    return { tone: 'danger', label: 'Missing' };
  };

  const pageReadingBadge = (): { tone: BadgeTone; label: string } => {
    if (!caps.extensionConnected)
      return { tone: 'neutral', label: 'Unavailable' };
    if (caps.pageReadingSupported) {
      return caps.hostPermissionFlowSupported
        ? { tone: 'success', label: 'Available' }
        : { tone: 'warning', label: 'Permission required' };
    }
    return { tone: 'danger', label: 'Unavailable' };
  };

  const { tone: keyTone, label: keyLabel } = keyBadge();
  const { tone: prTone, label: prLabel } = pageReadingBadge();

  return (
    <>
      <Row label="Extension">
        <Badge tone={caps.extensionConnected ? 'success' : 'danger'} dot>
          {caps.extensionConnected ? 'Connected' : 'Not detected'}
        </Badge>
      </Row>
      <Row label="Page reading">
        <Badge tone={prTone} dot>
          {prLabel}
        </Badge>
      </Row>
      <Row label="Current tab">
        <Badge tone="neutral" dot>
          {caps.currentTabSupported ? 'Supported' : 'Unsupported in v0.1'}
        </Badge>
      </Row>
      <Row label="Web search handler">
        <Badge tone={caps.webSearchHandlerSupported ? 'success' : 'danger'} dot>
          {caps.webSearchHandlerSupported ? 'Available' : 'Unavailable'}
        </Badge>
      </Row>
      <Row label="Brave Search key">
        <Badge tone={keyTone} dot>
          {keyLabel}
        </Badge>
      </Row>
      <Row label="Live web search">
        <Badge tone={caps.liveSearchReady ? 'success' : 'neutral'} dot>
          {caps.liveSearchReady ? 'Ready' : 'Not ready'}
        </Badge>
      </Row>
    </>
  );
}

export function WebResearchStatus({
  searchProvider,
  extension,
  capabilities,
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

      {capabilities ? (
        <CapabilityRows caps={capabilities} />
      ) : (
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
      )}

      {!capabilities && status !== 'connected' && (
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
              Choose "Load unpacked" and select{' '}
              <span className="font-mono">extension/chrome-web-research</span>.
            </li>
            <li>Reload BrowserClaw and check the status again.</li>
          </ol>
        </div>
      )}

      {capabilities && !capabilities.extensionConnected && (
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
              Choose "Load unpacked" and select{' '}
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

      {/* C2 (FIX5): truthful v0.1 copy — no BrowserClaw-driven permission flow exists. */}
      <p className="text-xs text-muted-subtle">
        Web search runs through the companion extension, which proxies the Brave
        Search API request and keeps the API key in memory only. Page reads
        require Chrome site access for the target origin. In v0.1, BrowserClaw
        cannot complete new host-permission grants from this page — grant site
        access through the extension or Chrome settings, then retry the page
        read.
      </p>
    </div>
  );
}
