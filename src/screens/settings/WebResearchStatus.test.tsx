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
    expect(screen.getByText(/proxies the Brave/i)).toBeInTheDocument();
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

// ---------------------------------------------------------------------------
// E2 (FIX3) — per-capability rows when capabilities prop is provided
// ---------------------------------------------------------------------------

import type { WebResearchCapabilityStatus } from '../../extension/normalizeExtensionStatus.ts';

function allReady(): WebResearchCapabilityStatus {
  return {
    extensionConnected: true,
    pageReadingSupported: true,
    hostPermissionFlowSupported: true,
    currentTabSupported: false,
    webSearchHandlerSupported: true,
    braveKeyConfigured: true,
    vaultLocked: false,
    liveSearchReady: true,
  };
}

describe('E2 — capability rows', () => {
  it('E2: shows Connected extension row when connected', () => {
    render(
      <WebResearchStatus
        searchProvider={{ name: 'Brave Search', configured: true }}
        capabilities={allReady()}
      />,
    );
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('Live web search')).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
  });

  it('E2: shows Not detected and install instructions when extension missing', () => {
    render(
      <WebResearchStatus
        searchProvider={{ name: 'Brave Search', configured: true }}
        capabilities={{
          ...allReady(),
          extensionConnected: false,
          liveSearchReady: false,
        }}
      />,
    );
    expect(screen.getAllByText('Not detected').length).toBeGreaterThan(0);
    expect(
      screen.getByText(/Install the companion extension/i),
    ).toBeInTheDocument();
  });

  it('E2: shows page reading Available when supported', () => {
    render(
      <WebResearchStatus
        searchProvider={{ name: 'Brave Search', configured: true }}
        capabilities={allReady()}
      />,
    );
    expect(screen.getByText('Page reading')).toBeInTheDocument();
    expect(screen.getAllByText('Available').length).toBeGreaterThan(0);
  });

  it('E2: shows page reading Unavailable when not supported', () => {
    render(
      <WebResearchStatus
        searchProvider={{ name: 'Brave Search', configured: false }}
        capabilities={{
          ...allReady(),
          pageReadingSupported: false,
          liveSearchReady: false,
        }}
      />,
    );
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
  });

  it('E2: shows current tab Unsupported in v0.1', () => {
    render(
      <WebResearchStatus
        searchProvider={{ name: 'Brave Search', configured: true }}
        capabilities={{ ...allReady(), currentTabSupported: false }}
      />,
    );
    expect(screen.getByText('Unsupported in v0.1')).toBeInTheDocument();
  });

  it('E2: shows Brave key Missing when not configured', () => {
    render(
      <WebResearchStatus
        searchProvider={{ name: 'Brave Search', configured: false }}
        capabilities={{
          ...allReady(),
          braveKeyConfigured: false,
          liveSearchReady: false,
        }}
      />,
    );
    expect(screen.getByText('Brave Search key')).toBeInTheDocument();
    expect(screen.getByText('Missing')).toBeInTheDocument();
    expect(screen.getByText('Not ready')).toBeInTheDocument();
  });

  it('E2: shows Vault locked when vault is locked', () => {
    render(
      <WebResearchStatus
        searchProvider={{ name: 'Brave Search', configured: true }}
        capabilities={{
          ...allReady(),
          vaultLocked: true,
          liveSearchReady: false,
        }}
      />,
    );
    expect(screen.getByText('Vault locked')).toBeInTheDocument();
  });

  it('E2: live web search Not ready when key missing and extension present', () => {
    render(
      <WebResearchStatus
        searchProvider={{ name: 'Brave Search', configured: false }}
        capabilities={{
          ...allReady(),
          braveKeyConfigured: false,
          liveSearchReady: false,
        }}
      />,
    );
    expect(screen.getByText('Not ready')).toBeInTheDocument();
  });
});
