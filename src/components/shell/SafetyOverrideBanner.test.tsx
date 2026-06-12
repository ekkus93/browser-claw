import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SafetyOverrideBanner } from './SafetyOverrideBanner.tsx';
import type { AppConfig } from '../../config/appConfig.ts';

const failClosed: AppConfig = {
  isDemoMode: false,
  isDevFallbackAllowed: false,
  isMockProviderAllowed: false,
  isSafetyOverrideActive: false,
};

describe('SafetyOverrideBanner', () => {
  it('renders nothing when no override is active (default build)', () => {
    const { container } = render(<SafetyOverrideBanner config={failClosed} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('warns and lists the active overrides', () => {
    render(
      <SafetyOverrideBanner
        config={{
          isDemoMode: true,
          isDevFallbackAllowed: true,
          isMockProviderAllowed: true,
          isSafetyOverrideActive: true,
        }}
      />,
    );
    const banner = screen.getByTestId('safety-override-banner');
    expect(banner).toHaveTextContent('demo data');
    expect(banner).toHaveTextContent('reference-runtime fallback');
    expect(banner).toHaveTextContent('mock provider');
  });

  it('lists only the overrides that are on', () => {
    render(
      <SafetyOverrideBanner
        config={{
          isDemoMode: false,
          isDevFallbackAllowed: true,
          isMockProviderAllowed: false,
          isSafetyOverrideActive: true,
        }}
      />,
    );
    const banner = screen.getByTestId('safety-override-banner');
    expect(banner).toHaveTextContent('reference-runtime fallback');
    expect(banner).not.toHaveTextContent('mock provider');
    expect(banner).not.toHaveTextContent('demo data');
  });
});
