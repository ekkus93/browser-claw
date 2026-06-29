import { describe, expect, it } from 'vitest';
import { toolContentFromEffectFailure } from './effectFailure.ts';

describe('toolContentFromEffectFailure (G1 FIX5)', () => {
  it('G1: failure with kind/message produces non-empty JSON with type=effect_failure', () => {
    const result = toolContentFromEffectFailure(
      Object.assign(new Error('Host permission is missing.'), {
        kind: 'host_permission_missing',
      }),
    );
    const parsed = JSON.parse(result) as Record<string, unknown>;
    expect(parsed.type).toBe('effect_failure');
    expect(parsed.kind).toBe('host_permission_missing');
    expect(parsed.message).toBe('Host permission is missing.');
    expect(result.length).toBeGreaterThan(0);
  });

  it('G1: token-like sk- string in message is redacted', () => {
    const result = toolContentFromEffectFailure(
      new Error('Auth failed with key sk-abc123DEFghijklmno'),
    );
    const parsed = JSON.parse(result) as { message: string };
    expect(parsed.message).not.toContain('sk-abc123DEFghijklmno');
    expect(parsed.message).toContain('[REDACTED]');
  });

  it('G1: Anthropic sk-ant- key in message is redacted', () => {
    const result = toolContentFromEffectFailure(
      new Error('key=sk-ant-api03-testkey1234567890'),
    );
    const parsed = JSON.parse(result) as { message: string };
    expect(parsed.message).not.toContain('sk-ant-api03-testkey1234567890');
    expect(parsed.message).toContain('[REDACTED]');
  });

  it('G1: Bearer token in message is redacted', () => {
    const result = toolContentFromEffectFailure(
      new Error('got Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig'),
    );
    const parsed = JSON.parse(result) as { message: string };
    expect(parsed.message).not.toContain('Bearer');
    expect(parsed.message).toContain('[REDACTED]');
  });

  it('G1: missing message produces safe default', () => {
    const result = toolContentFromEffectFailure({ kind: 'some_error' });
    const parsed = JSON.parse(result) as { message: string };
    expect(parsed.message).toBe('The requested operation failed.');
  });

  it('G1: non-object error produces safe defaults', () => {
    const result = toolContentFromEffectFailure(null);
    const parsed = JSON.parse(result) as { kind: string; message: string };
    expect(parsed.kind).toBe('effect_failed');
    expect(parsed.message).toBe('The requested operation failed.');
  });

  it('G1: does not include raw stack traces', () => {
    const err = new Error('something went wrong');
    const result = toolContentFromEffectFailure(err);
    expect(result).not.toContain('at Object.');
    expect(result).not.toContain('.test.ts');
  });

  it('G1: no empty failure content — result always has content', () => {
    for (const input of [undefined, null, 0, false, '', [], {}]) {
      const result = toolContentFromEffectFailure(input);
      expect(result.length).toBeGreaterThan(0);
      const parsed = JSON.parse(result) as { type: string };
      expect(parsed.type).toBe('effect_failure');
    }
  });
});
