import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RuntimeBlockedScreen } from './RuntimeBlockedScreen.tsx';

describe('RuntimeBlockedScreen', () => {
  it('shows the failure message and blocks the console', () => {
    render(<RuntimeBlockedScreen message="WebAssembly failed to load" />);
    expect(screen.getByTestId('runtime-blocked')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'WebAssembly failed to load',
    );
  });

  it('falls back to a generic message', () => {
    render(<RuntimeBlockedScreen />);
    expect(screen.getByRole('alert')).toHaveTextContent('console is disabled');
  });

  it('invokes the reload handler', async () => {
    const onReload = vi.fn();
    render(<RuntimeBlockedScreen onReload={onReload} />);
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(onReload).toHaveBeenCalledOnce();
  });
});
