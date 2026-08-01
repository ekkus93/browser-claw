import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AppShell } from './AppShell.tsx';
import { RightInspectorPanel } from './RightInspectorPanel.tsx';

function renderShell(initialPath = '/chat') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AppShell inspector={<RightInspectorPanel />}>
        <div>Main content</div>
      </AppShell>
    </MemoryRouter>,
  );
}

describe('AppShell', () => {
  it('renders the brand, all nav items, runtime status, version, and main content', () => {
    renderShell();
    expect(screen.getByText('BrowserClaw')).toBeInTheDocument();
    for (const label of [
      'Chat',
      'Models',
      'Storage',
      'Skills',
      'Memories',
      'Audit',
      'Settings',
    ]) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByText(/runtime is ready/i)).toBeInTheDocument();
    expect(screen.getByText('v0.7.0')).toBeInTheDocument();
    expect(screen.getByText('Main content')).toBeInTheDocument();
  });

  it('marks the current route as the active nav item', () => {
    renderShell('/models');
    expect(screen.getByRole('link', { name: 'Models' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Chat' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('switches inspector tab panels on click', async () => {
    const user = userEvent.setup();
    renderShell();
    expect(screen.getByText(/recent tool calls/i)).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Memory' }));
    expect(
      screen.getByText(/retrieved and recently used memories/i),
    ).toBeInTheDocument();
  });
});
