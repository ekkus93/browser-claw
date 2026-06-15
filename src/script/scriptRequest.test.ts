import { describe, expect, it } from 'vitest';
import {
  SCRIPT_REQUEST_TYPE,
  SCRIPT_REQUEST_VERSION,
  validateScriptRequest,
} from './scriptRequest.ts';
import { SANDBOXED_SCRIPT_RUNTIME } from './scriptPolicy.ts';

function baseRequest(
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    type: SCRIPT_REQUEST_TYPE,
    version: SCRIPT_REQUEST_VERSION,
    runtime: SANDBOXED_SCRIPT_RUNTIME,
    title: 'Aggregate fallback mentions',
    reason: 'Need custom aggregation across multiple markdown files.',
    capabilities: {
      fsRead: ['/workspace/docs/**'],
      fsWrite: ['/workspace/reports/**'],
      webSearch: false,
      webRead: [],
      network: 'deny',
      secrets: 'deny',
    },
    limits: {
      timeoutMs: 5000,
      maxOutputBytes: 262144,
      maxFileReads: 100,
      maxFileWrites: 10,
    },
    code: 'const x = 1;',
    ...over,
  };
}

describe('validateScriptRequest (D2)', () => {
  it('accepts a well-formed request and reports its risk', () => {
    const result = validateScriptRequest(baseRequest());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request.runtime).toBe(SANDBOXED_SCRIPT_RUNTIME);
      expect(result.risk).toBe('medium'); // bounded write
    }
  });

  it('rejects a wrong type/version/runtime', () => {
    expect(validateScriptRequest(baseRequest({ type: 'x' })).ok).toBe(false);
    expect(validateScriptRequest(baseRequest({ version: 2 })).ok).toBe(false);
    expect(validateScriptRequest(baseRequest({ runtime: 'plan_dsl' })).ok).toBe(
      false,
    );
  });

  it('rejects a request with no reason', () => {
    const result = validateScriptRequest(baseRequest({ reason: '   ' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join()).toMatch(/reason/);
  });

  it('rejects a request with no code', () => {
    expect(validateScriptRequest(baseRequest({ code: '' })).ok).toBe(false);
  });

  it('rejects a request that omits limits', () => {
    const req = baseRequest();
    delete req.limits;
    const result = validateScriptRequest(req);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join()).toMatch(/limits/);
  });

  it('rejects a request missing a required limit field', () => {
    const result = validateScriptRequest(
      baseRequest({
        limits: { timeoutMs: 5000, maxOutputBytes: 1000, maxFileReads: 10 },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join()).toMatch(/maxFileWrites/);
  });

  it('rejects limits that exceed the maximum', () => {
    const result = validateScriptRequest(
      baseRequest({
        limits: {
          timeoutMs: 10_000_000,
          maxOutputBytes: 262144,
          maxFileReads: 100,
          maxFileWrites: 10,
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join()).toMatch(/timeoutMs/);
  });

  it('rejects a request that asks for secrets', () => {
    const result = validateScriptRequest(
      baseRequest({
        capabilities: { network: 'deny', secrets: 'allow' },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join()).toMatch(/secrets/);
  });

  it('rejects mediated network with no web capability', () => {
    const result = validateScriptRequest(
      baseRequest({
        capabilities: { network: 'mediated', secrets: 'deny' },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join()).toMatch(/network/);
  });

  it('accepts mediated network when a web capability is present', () => {
    const result = validateScriptRequest(
      baseRequest({
        capabilities: { network: 'mediated', webSearch: true, secrets: 'deny' },
      }),
    );
    expect(result.ok).toBe(true);
  });

  it('rejects an invalid path scope', () => {
    const result = validateScriptRequest(
      baseRequest({
        capabilities: {
          fsWrite: ['/etc/passwd'],
          network: 'deny',
          secrets: 'deny',
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join()).toMatch(/scope/);
  });

  it('rejects a traversal path scope', () => {
    const result = validateScriptRequest(
      baseRequest({
        capabilities: {
          fsRead: ['/workspace/../secrets/**'],
          network: 'deny',
          secrets: 'deny',
        },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('marks a broad workspace write scope as high risk (accepted)', () => {
    const result = validateScriptRequest(
      baseRequest({
        capabilities: {
          fsWrite: ['/workspace/**'],
          network: 'deny',
          secrets: 'deny',
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.risk).toBe('high');
  });
});
