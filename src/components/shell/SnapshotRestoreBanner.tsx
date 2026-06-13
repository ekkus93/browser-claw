import { AlertTriangle, X } from 'lucide-react';
import { useAppDispatch, useAppSelector } from '../../store/hooks.ts';
import {
  snapshotWarningDismissed,
  type SnapshotRestoreIssue,
} from '../../store/slices/runtimeSlice.ts';

/**
 * Visible, dismissible warning shown when the persisted session snapshot could
 * not be restored on boot — because it was saved by an incompatible build, or
 * could not be read. The app starts fresh either way; this makes that honest to
 * the user instead of silently dropping their previous session. See Phase 4 /
 * runtimeSlice `snapshotIssue` and HARDENING_NOTES.md.
 */
const MESSAGES: Record<SnapshotRestoreIssue, string> = {
  incompatible:
    'Your previous session could not be restored — it was saved by an incompatible version of BrowserClaw and has been discarded. Starting fresh.',
  restore_failed:
    'Your previous session could not be restored — the saved snapshot could not be read. Starting fresh.',
};

export function SnapshotRestoreBanner() {
  const issue = useAppSelector((state) => state.runtime.snapshotIssue);
  const dispatch = useAppDispatch();
  if (!issue) return null;

  return (
    <div
      role="alert"
      data-testid="snapshot-restore-banner"
      className="flex items-center gap-2 border-b border-warning bg-warning-subtle px-4 py-2 text-sm font-medium text-warning"
    >
      <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
      <span className="flex-1">{MESSAGES[issue]}</span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => dispatch(snapshotWarningDismissed())}
        className="shrink-0 rounded p-1 hover:bg-warning/10"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
