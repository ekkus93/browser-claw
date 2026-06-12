import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { StatusFooter, type RuntimeStatus } from './StatusFooter.tsx';

describe('StatusFooter', () => {
  it.each<[RuntimeStatus, RegExp]>([
    ['ready', /runtime is ready/i],
    ['initializing', /starting/i],
    ['busy', /working/i],
    ['error', /hit an error/i],
  ])('renders the %s runtime message', (status, message) => {
    render(<StatusFooter status={status} />);
    expect(screen.getByText(message)).toBeInTheDocument();
  });

  it('shows the version and fires the view-status callback', async () => {
    const user = userEvent.setup();
    const onViewStatus = vi.fn();
    render(<StatusFooter version="v0.7.0" onViewStatus={onViewStatus} />);

    expect(screen.getByText('v0.7.0')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /view status/i }));
    expect(onViewStatus).toHaveBeenCalledOnce();
  });
});
