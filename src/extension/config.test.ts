import { describe, expect, it } from 'vitest';
import manifest from '../../extension/chrome-web-research/manifest.json';
import {
  DEV_ORIGINS,
  PROD_ORIGIN_PLACEHOLDER,
  allowedExternalOrigins,
  isValidExtensionId,
} from './config.ts';

describe('extension config (E4)', () => {
  it('allows dev origins and appends a real production origin only', () => {
    expect(allowedExternalOrigins()).toEqual([...DEV_ORIGINS]);
    expect(allowedExternalOrigins(PROD_ORIGIN_PLACEHOLDER)).toEqual([
      ...DEV_ORIGINS,
    ]);
    expect(allowedExternalOrigins('https://app.browserclaw.example')).toContain(
      'https://app.browserclaw.example',
    );
  });

  it('validates a Chrome extension id (32 chars a-p)', () => {
    expect(isValidExtensionId('a'.repeat(32))).toBe(true);
    expect(isValidExtensionId('abcdefghijklmnop'.repeat(2))).toBe(true);
    expect(isValidExtensionId('z'.repeat(32))).toBe(false); // z is out of a-p
    expect(isValidExtensionId('abc')).toBe(false);
  });
});

describe('extension manifest (E4)', () => {
  it('is Manifest V3 with a module service worker', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.background.service_worker).toBe('service-worker.js');
  });

  it('uses least-privilege permissions (no <all_urls> at install)', () => {
    expect(manifest.permissions).toEqual(['tabs', 'scripting', 'storage']);
    expect(manifest.permissions as string[]).not.toContain('<all_urls>');
    // Broad host access is OPTIONAL, requested per-origin at read time.
    expect(manifest.optional_host_permissions).toEqual([
      'https://*/*',
      'http://*/*',
    ]);
  });

  it('only allows the BrowserClaw dev origins to message it', () => {
    const matches = manifest.externally_connectable.matches;
    expect(matches).toContain('http://localhost:5173/*');
    // Never a wildcard external connection.
    expect(matches.some((m) => m.includes('*://*'))).toBe(false);
  });
});
