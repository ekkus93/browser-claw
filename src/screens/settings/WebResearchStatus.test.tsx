import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WebResearchStatus } from './WebResearchStatus.tsx';

describe('WebResearchStatus (G3)', () => {
  it('shows the search provider config status', () => {
    render(
      <WebResearchStatus
        searchProvider={{ name: 'Brave Search', configured: false }}
      />,
    );
    expect(screen.getByText('Brave Search')).toBeInTheDocument();
    expect(screen.getByText('No API key')).toBeInTheDocument();
  });

  it('shows install instructions and the CORS note when the extension is absent', () => {
    render(
      <WebResearchStatus
        searchProvider={{ name: 'Brave Search', configured: true }}
        extension={{ available: false }}
      />,
    );
    expect(screen.getByText('Not detected')).toBeInTheDocument();
    expect(
      screen.getByText(/Install the companion extension/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/chrome:\/\/extensions/)).toBeInTheDocument();
    expect(screen.getByText(/CORS policy/i)).toBeInTheDocument();
  });

  it('hides install instructions when the extension is connected', () => {
    render(
      <WebResearchStatus
        searchProvider={{ name: 'Brave Search', configured: true }}
        extension={{ available: true, version: '1.0.0' }}
      />,
    );
    expect(screen.getByText(/Connected v1\.0\.0/)).toBeInTheDocument();
    expect(
      screen.queryByText(/Install the companion extension/i),
    ).not.toBeInTheDocument();
  });

  it('probes availability on demand when a checker is wired', async () => {
    const user = userEvent.setup();
    const probe = vi.fn(() =>
      Promise.resolve({ available: true, version: '2' }),
    );
    render(
      <WebResearchStatus
        searchProvider={{ name: 'Brave Search', configured: true }}
        probe={probe}
      />,
    );
    expect(screen.getByText('Not checked')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Check' }));
    expect(probe).toHaveBeenCalled();
    expect(await screen.findByText(/Connected v2/)).toBeInTheDocument();
  });

  it('lists research bundle output paths', () => {
    render(
      <WebResearchStatus
        searchProvider={{ name: 'Brave Search', configured: true }}
        extension={{ available: true }}
        researchPaths={['/workspace/research/opfs-42']}
      />,
    );
    expect(screen.getByText('/workspace/research/opfs-42')).toBeInTheDocument();
  });

  it('does not offer a Check button without a probe', () => {
    render(
      <WebResearchStatus
        searchProvider={{ name: 'Brave Search', configured: true }}
        extension={{ available: false }}
      />,
    );
    expect(
      screen.queryByRole('button', { name: 'Check' }),
    ).not.toBeInTheDocument();
  });

  // FIX1-A1: when probe returns available:false (because get_status returned
  // pageReadingAvailable:false), the UI must show "Not detected" not "Connected".
  it('A1: shows unavailable state when probe reports page reading unavailable', async () => {
    const user = userEvent.setup();
    const probe = vi.fn(() => Promise.resolve({ available: false }));
    render(
      <WebResearchStatus
        searchProvider={{ name: 'Brave Search', configured: true }}
        probe={probe}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Check' }));
    expect(probe).toHaveBeenCalled();
    expect(await screen.findByText('Not detected')).toBeInTheDocument();
    expect(
      screen.getByText(/Install the companion extension/i),
    ).toBeInTheDocument();
  });
});
