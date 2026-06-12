import type { MessageRole } from '../../db/types.ts';
import { cn } from '../../lib/cn.ts';

export interface MessageBubbleProps {
  role: MessageRole;
  content: string;
  /** Epoch ms; rendered as a short local time. */
  at?: number;
}

const ROLE_LABEL: Record<MessageRole, string> = {
  user: 'You',
  assistant: 'BrowserClaw',
  system: 'System',
  tool: 'Tool',
};

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function MessageBubble({ role, content, at }: MessageBubbleProps) {
  const isUser = role === 'user';
  return (
    <div className={cn('flex flex-col gap-1', isUser && 'items-end')}>
      <div className="flex items-baseline gap-2 text-xs text-muted-subtle">
        <span className="font-semibold text-muted">{ROLE_LABEL[role]}</span>
        {at != null && <span>{formatTime(at)}</span>}
      </div>
      <div
        className={cn(
          'max-w-[42rem] whitespace-pre-wrap rounded-card px-4 py-3 text-sm',
          isUser
            ? 'bg-primary text-surface'
            : 'border border-border bg-surface text-text',
        )}
      >
        {content}
      </div>
    </div>
  );
}
