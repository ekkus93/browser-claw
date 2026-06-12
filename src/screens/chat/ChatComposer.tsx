import type { KeyboardEvent } from 'react';
import { Paperclip, ArrowUp } from 'lucide-react';
import { Button } from '../../components/ui/Button.tsx';

export interface ChatComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled?: boolean;
}

export function ChatComposer({
  value,
  onChange,
  onSend,
  disabled = false,
}: ChatComposerProps) {
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter inserts a newline.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (value.trim() && !disabled) onSend();
    }
  }

  return (
    <div className="rounded-card border border-border bg-surface p-3 shadow-sm">
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        rows={2}
        placeholder="Ask anything or give a command…"
        aria-label="Message"
        className="w-full resize-none bg-transparent text-sm text-text placeholder:text-muted-subtle focus:outline-none"
      />
      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-subtle">
          <button
            type="button"
            aria-label="Attach"
            className="flex size-7 items-center justify-center rounded-button text-muted transition-colors hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <Paperclip className="size-4" aria-hidden="true" />
          </button>
          <span>
            Type <span className="font-mono text-muted">/</span> for commands
          </span>
        </div>
        <Button
          variant="primary"
          size="sm"
          trailingIcon={<ArrowUp className="size-4" />}
          disabled={disabled || value.trim() === ''}
          onClick={onSend}
        >
          Send
        </Button>
      </div>
    </div>
  );
}
