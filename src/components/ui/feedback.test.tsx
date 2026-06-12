import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Tabs } from './Tabs.tsx';
import { Dialog } from './Dialog.tsx';
import { Progress } from './Progress.tsx';
import { EmptyState } from './EmptyState.tsx';
import { ErrorState } from './ErrorState.tsx';
import { ToastProvider } from './Toast.tsx';
import { useToast } from './toastContext.ts';

const TAB_ITEMS = [
  { id: 'a', label: 'Alpha', content: <p>Alpha panel</p> },
  { id: 'b', label: 'Beta', content: <p>Beta panel</p> },
];

describe('Tabs', () => {
  it('shows the first panel by default and switches on click', async () => {
    const user = userEvent.setup();
    render(<Tabs items={TAB_ITEMS} />);
    expect(screen.getByText('Alpha panel')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Beta' }));
    expect(screen.getByText('Beta panel')).toBeInTheDocument();
  });

  it('moves between tabs with arrow keys', async () => {
    const user = userEvent.setup();
    render(<Tabs items={TAB_ITEMS} />);
    screen.getByRole('tab', { name: 'Alpha' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Beta' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
});

describe('Dialog', () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open
        </button>
        <Dialog open={open} onClose={() => setOpen(false)} title="Confirm">
          <p>Body</p>
        </Dialog>
      </>
    );
  }

  it('opens, moves focus inside, closes on Escape, and restores focus', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open' });

    await user.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Confirm' });
    expect(dialog).toContainElement(
      document.activeElement as HTMLElement | null,
    );

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

describe('Progress', () => {
  it('exposes its value to assistive tech', () => {
    render(<Progress value={42} label="Loading" />);
    expect(
      screen.getByRole('progressbar', { name: 'Loading' }),
    ).toHaveAttribute('aria-valuenow', '42');
  });
});

describe('EmptyState / ErrorState', () => {
  it('render their titles', () => {
    render(
      <>
        <EmptyState title="No skills installed" />
        <ErrorState title="Endpoint unreachable" />
      </>,
    );
    expect(screen.getByText('No skills installed')).toBeInTheDocument();
    expect(screen.getByText('Endpoint unreachable')).toBeInTheDocument();
  });
});

describe('Toast', () => {
  function ToastHarness() {
    const { toast } = useToast();
    return (
      <button
        type="button"
        onClick={() => toast({ title: 'Saved', duration: 0 })}
      >
        Notify
      </button>
    );
  }

  it('shows a toast on trigger and dismisses it', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Notify' }));
    expect(screen.getByText('Saved')).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Dismiss notification' }),
    );
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
  });
});
