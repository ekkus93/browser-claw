import { describe, expect, it } from 'vitest';
import { parseAppConfig } from './appConfig.ts';

describe('parseAppConfig — fail closed by default', () => {
  it('an empty env disables every override', () => {
    const config = parseAppConfig({});
    expect(config.isDemoMode).toBe(false);
    expect(config.isDevFallbackAllowed).toBe(false);
    expect(config.isMockProviderAllowed).toBe(false);
    expect(config.isSafetyOverrideActive).toBe(false);
  });

  it('a production-like env (only Vite defaults) stays fail closed', () => {
    const config = parseAppConfig({ MODE: 'production', PROD: true, DEV: false });
    expect(config.isSafetyOverrideActive).toBe(false);
  });

  it('treats any non-"true" value as off', () => {
    const config = parseAppConfig({
      VITE_DEMO_MODE: '1',
      VITE_ALLOW_REFERENCE_RUNTIME_FALLBACK: 'yes',
      VITE_ALLOW_MOCK_PROVIDER: 'TRUE',
    });
    expect(config.isDemoMode).toBe(false);
    expect(config.isDevFallbackAllowed).toBe(false);
    expect(config.isMockProviderAllowed).toBe(false);
    expect(config.isSafetyOverrideActive).toBe(false);
  });
});

describe('parseAppConfig — explicit opt-in', () => {
  it('enables the reference-runtime fallback only with its exact flag', () => {
    const config = parseAppConfig({
      VITE_ALLOW_REFERENCE_RUNTIME_FALLBACK: 'true',
    });
    expect(config.isDevFallbackAllowed).toBe(true);
    expect(config.isMockProviderAllowed).toBe(false);
    expect(config.isDemoMode).toBe(false);
    expect(config.isSafetyOverrideActive).toBe(true);
  });

  it('enables the mock provider only with its exact flag', () => {
    const config = parseAppConfig({ VITE_ALLOW_MOCK_PROVIDER: 'true' });
    expect(config.isMockProviderAllowed).toBe(true);
    expect(config.isDevFallbackAllowed).toBe(false);
    expect(config.isSafetyOverrideActive).toBe(true);
  });

  it('accepts a boolean true (not just the string)', () => {
    const config = parseAppConfig({ VITE_ALLOW_MOCK_PROVIDER: true });
    expect(config.isMockProviderAllowed).toBe(true);
  });

  it('demo mode implies both dev overrides', () => {
    const config = parseAppConfig({ VITE_DEMO_MODE: 'true' });
    expect(config.isDemoMode).toBe(true);
    expect(config.isDevFallbackAllowed).toBe(true);
    expect(config.isMockProviderAllowed).toBe(true);
    expect(config.isSafetyOverrideActive).toBe(true);
  });
});
