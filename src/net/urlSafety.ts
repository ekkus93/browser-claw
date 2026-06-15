/**
 * Shared URL / network safety validator (hardening A1.4). Every browser-side
 * fetch tool (Page Reader now; `browser_fetch` later) must run a candidate URL
 * through this before making a request, so none can be pointed at the local
 * machine, the private LAN, link-local addresses, or the cloud metadata
 * endpoint (`169.254.169.254`) — the classic SSRF targets. Only http(s) is
 * allowed.
 *
 * The WHATWG URL parser normalizes alternate IPv4 encodings (decimal/hex/octal)
 * to dotted-decimal for http(s), so the dotted-decimal checks below also cover
 * `http://2130706433/` and friends.
 */

export type UrlBlockReason = 'invalid_url' | 'bad_scheme' | 'blocked_host';

export type UrlSafety =
  | { ok: true; url: URL }
  | { ok: false; reason: UrlBlockReason; message: string };

/** Thrown by {@link assertFetchUrlAllowed}; carries the machine-readable reason. */
export class BlockedUrlError extends Error {
  readonly reason: UrlBlockReason;
  constructor(reason: UrlBlockReason, message: string) {
    super(message);
    this.name = 'BlockedUrlError';
    this.reason = reason;
  }
}

function parseIpv4(host: string): [number, number, number, number] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const octets = m.slice(1, 5).map(Number) as [number, number, number, number];
  if (octets.some((o) => o > 255)) return null;
  return octets;
}

function isBlockedIpv4(host: string): boolean {
  const ip = parseIpv4(host);
  if (!ip) return false;
  const [a, b] = ip;
  return (
    a === 0 || // 0.0.0.0/8 "this host"
    a === 10 || // 10.0.0.0/8 private
    a === 127 || // 127.0.0.0/8 loopback
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 CGNAT
    (a === 169 && b === 254) || // 169.254.0.0/16 link-local (incl. metadata)
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12 private
    (a === 192 && b === 168) || // 192.168.0.0/16 private
    a >= 224 // 224.0.0.0/4 multicast + reserved
  );
}

function isBlockedIpv6(rawHost: string): boolean {
  // URL hostnames carry IPv6 literals in brackets; strip them and any zone id.
  let host = rawHost.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  const zone = host.indexOf('%');
  if (zone !== -1) host = host.slice(0, zone);
  if (!host.includes(':')) return false; // not IPv6
  if (host === '::1' || host === '::') return true; // loopback / unspecified
  // IPv4-mapped (::ffff:...) — the URL parser may render the embedded address
  // in dotted (a.b.c.d) or hex (HHHH:HHHH) form; check the IPv4 either way.
  const mapped = /^::ffff:(.+)$/.exec(host);
  if (mapped?.[1]) {
    const rest = mapped[1];
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(rest)) {
      return isBlockedIpv4(rest);
    }
    const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(rest);
    if (hex?.[1] && hex[2]) {
      const hi = parseInt(hex[1], 16);
      const lo = parseInt(hex[2], 16);
      const ipv4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
      return isBlockedIpv4(ipv4);
    }
    return true; // unrecognized mapped form — fail closed
  }
  return (
    /^fe[89ab]/.test(host) || // fe80::/10 link-local
    /^f[cd]/.test(host) || // fc00::/7 unique-local
    /^ff/.test(host) // ff00::/8 multicast
  );
}

function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h.length === 0) return true;
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h.endsWith('.local')) return true; // mDNS link-local names
  if (isBlockedIpv4(h)) return true;
  if (isBlockedIpv6(host)) return true;
  return false;
}

/**
 * Classify a candidate fetch URL. Returns the parsed URL when safe, or a
 * machine-readable reason + human message when it must be blocked.
 */
export function classifyFetchUrl(raw: string): UrlSafety {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'invalid_url', message: 'Invalid URL.' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return {
      ok: false,
      reason: 'bad_scheme',
      message: 'Only http(s) URLs are allowed.',
    };
  }
  if (isBlockedHost(url.hostname)) {
    return {
      ok: false,
      reason: 'blocked_host',
      message: `Blocked host (loopback/private/link-local network): ${url.hostname}`,
    };
  }
  return { ok: true, url };
}

/** Like {@link classifyFetchUrl} but throws {@link BlockedUrlError} on a block. */
export function assertFetchUrlAllowed(raw: string): URL {
  const result = classifyFetchUrl(raw);
  if (!result.ok) throw new BlockedUrlError(result.reason, result.message);
  return result.url;
}
