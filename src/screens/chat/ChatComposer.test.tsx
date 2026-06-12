import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ChatComposer } from './ChatComposer.tsx';

describe('ChatComposer', () => {
  it('disables Send when empty and enables it with text', () => {
    const { rerender } = render(
      <ChatComposer value="" onChange={() => {}} onSend={() => {}} />,
    );
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled();
    rerender(<ChatComposer value="hi" onChange={() => {}} onSend={() => {}} />);
    expect(screen.getByRole('button', { name: /send/i })).toBeEnabled();
  });

  it('sends on click and on Enter (not Shift+Enter)', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<ChatComposer value="hi" onChange={() => {}} onSend={onSend} />);

    await user.click(screen.getByRole('button', { name: /send/i }));
    expect(onSend).toHaveBeenCalledTimes(1);

    const textarea = screen.getByRole('textbox', { name: 'Message' });
    textarea.focus();
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    expect(onSend).toHaveBeenCalledTimes(1); // shift+enter does not send
    await user.keyboard('{Enter}');
    expect(onSend).toHaveBeenCalledTimes(2);
  });
});
