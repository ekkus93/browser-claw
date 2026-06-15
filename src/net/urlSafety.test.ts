import { describe, expect, it } from 'vitest';
import {
  BlockedUrlError,
  assertFetchUrlAllowed,
  classifyFetchUrl,
} from './urlSafety.ts';

describe('classifyFetchUrl — SSRF / private-network blocking (A1.4)', () => {
  const blocked = [
    ['localhost', 'http://localhost/'],
    ['localhost subdomain', 'http://api.localhost/'],
    ['.local mDNS', 'http://printer.local/'],
    ['loopback v4', 'http://127.0.0.1/'],
    ['loopback v4 range', 'http://127.5.5.5/'],
    ['this-host 0.0.0.0', 'http://0.0.0.0/'],
    ['private 10/8', 'http://10.0.0.5/'],
    ['private 172.16/12', 'http://172.16.0.1/'],
    ['private 172.31/12', 'http://172.31.255.255/'],
    ['private 192.168/16', 'http://192.168.1.1/'],
    ['CGNAT 100.64/10', 'http://100.64.0.1/'],
    ['link-local', 'http://169.254.1.1/'],
    ['cloud metadata', 'http://169.254.169.254/latest/meta-data/'],
    ['multicast', 'http://224.0.0.1/'],
    ['decimal-encoded loopback', 'http://2130706433/'],
    ['loopback v6', 'http://[::1]/'],
    ['unspecified v6', 'http://[::]/'],
    ['link-local v6', 'http://[fe80::1]/'],
    ['unique-local v6', 'http://[fc00::1]/'],
    ['ipv4-mapped loopback', 'http://[::ffff:127.0.0.1]/'],
  ] as const;

  it.each(blocked)('blocks %s', (_label, url) => {
    const result = classifyFetchUrl(url);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('blocked_host');
  });

  it('blocks non-http(s) schemes', () => {
    for (const url of ['file:///etc/passwd', 'ftp://example.com/', 'data:,x']) {
      const result = classifyFetchUrl(url);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('bad_scheme');
    }
  });

  it('reports an invalid URL', () => {
    const result = classifyFetchUrl('not a url');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid_url');
  });

  it('allows safe public http(s) URLs', () => {
    for (const url of [
      'https://example.com/article',
      'http://93.184.216.34/',
      'https://sub.domain.example.org/path?q=1',
    ]) {
      const result = classifyFetchUrl(url);
      expect(result.ok).toBe(true);
    }
  });
});

describe('assertFetchUrlAllowed', () => {
  it('returns the parsed URL when safe', () => {
    expect(assertFetchUrlAllowed('https://example.com/x').hostname).toBe(
      'example.com',
    );
  });

  it('throws BlockedUrlError with a reason when blocked', () => {
    expect(() => assertFetchUrlAllowed('http://127.0.0.1/')).toThrow(
      BlockedUrlError,
    );
    try {
      assertFetchUrlAllowed('http://169.254.169.254/');
    } catch (error) {
      expect((error as BlockedUrlError).reason).toBe('blocked_host');
    }
  });
});
