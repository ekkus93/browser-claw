import { AlertTriangle } from 'lucide-react';
import { appConfig, type AppConfig } from '../../config/appConfig.ts';

/**
 * Persistent warning shown whenever a safety override is active (demo data,
 * reference-runtime fallback, or the mock provider). In a normal fail-closed
 * build none of these are on, so this renders nothing. When something is on,
 * the user must always be able to see that BrowserClaw is not running its real
 * runtime/provider/data paths. See `appConfig` and HARDENING_NOTES.md.
 */
export function SafetyOverrideBanner({
  config = appConfig,
}: {
  config?: AppConfig;
}) {
  if (!config.isSafetyOverrideActive) return null;

  const active: string[] = [];
  if (config.isDemoMode) active.push('demo data');
  if (config.isDevFallbackAllowed) active.push('reference-runtime fallback');
  if (config.isMockProviderAllowed) active.push('mock provider');

  return (
    <div
      role="status"
      data-testid="safety-override-banner"
      className="flex items-center gap-2 border-b border-warning bg-warning-subtle px-4 py-2 text-sm font-medium text-warning"
    >
      <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
      <span>
        Developer/demo mode — unsafe paths enabled: {active.join(', ')}. Output
        may not reflect the real runtime, provider, or data.
      </span>
    </div>
  );
}
