import { ErrorState } from '../ui/ErrorState.tsx';
import { Button } from '../ui/Button.tsx';

/**
 * Full-screen block shown when the runtime failed to start. BrowserClaw fails
 * closed: rather than silently running a degraded fallback, it tells the user
 * the agent runtime is unavailable and disables the console. See
 * HARDENING_NOTES.md (no silent fallbacks).
 */
export function RuntimeBlockedScreen({
  message,
  onReload,
}: {
  message?: string | null;
  onReload?: () => void;
}) {
  return (
    <div
      data-testid="runtime-blocked"
      className="flex min-h-screen items-center justify-center bg-background p-6"
    >
      <ErrorState
        title="Runtime unavailable"
        description={
          message ??
          'The BrowserClaw runtime could not start, so the console is disabled.'
        }
        action={
          <Button
            onClick={onReload ?? (() => window.location.reload())}
            variant="primary"
          >
            Reload
          </Button>
        }
      />
    </div>
  );
}
