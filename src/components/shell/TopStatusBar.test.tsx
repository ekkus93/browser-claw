import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TopStatusBar } from './TopStatusBar.tsx';

const GB = 1024 ** 3;

describe('TopStatusBar', () => {
  it('shows the active provider and model', () => {
    render(<TopStatusBar providerLabel="wllama" modelLabel="SmolLM2" />);
    expect(screen.getByText('wllama')).toBeInTheDocument();
    expect(screen.getByText('SmolLM2')).toBeInTheDocument();
  });

  it('formats storage usage and exposes the ratio to assistive tech', () => {
    render(
      <TopStatusBar storageUsedBytes={2 * GB} storageTotalBytes={8 * GB} />,
    );
    expect(screen.getByTitle('Local storage usage')).toHaveTextContent(
      '2.00 GB / 8.00 GB',
    );
    expect(
      screen.getByRole('progressbar', { name: 'Storage used' }),
    ).toHaveAttribute('aria-valuenow', '25');
  });

  it('shows an honest empty state when nothing is selected or measured', () => {
    render(<TopStatusBar />);
    expect(screen.getByText('No model selected')).toBeInTheDocument();
    expect(screen.getByText('Storage not measured')).toBeInTheDocument();
    expect(
      screen.queryByRole('progressbar', { name: 'Storage used' }),
    ).not.toBeInTheDocument();
  });

  it('clamps the usage bar at 100%', () => {
    render(
      <TopStatusBar storageUsedBytes={9 * GB} storageTotalBytes={5 * GB} />,
    );
    expect(
      screen.getByRole('progressbar', { name: 'Storage used' }),
    ).toHaveAttribute('aria-valuenow', '100');
  });

  it('fires the model and settings callbacks', async () => {
    const user = userEvent.setup();
    const onSelectModel = vi.fn();
    const onOpenSettings = vi.fn();
    render(
      <TopStatusBar
        onSelectModel={onSelectModel}
        onOpenSettings={onOpenSettings}
      />,
    );

    await user.click(screen.getByTitle('Change active model or provider'));
    expect(onSelectModel).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('button', { name: /settings/i }));
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });
});
