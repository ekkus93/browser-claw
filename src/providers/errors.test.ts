import { describe, expect, it } from 'vitest';
import { isFailoverEligible, httpStatusToKind } from './errors.ts';

describe('isFailoverEligible', () => {
  it('allows failover for reachability/transient kinds', () => {
    expect(isFailoverEligible('cors')).toBe(true);
    expect(isFailoverEligible('unreachable')).toBe(true);
    expect(isFailoverEligible('unknown')).toBe(true);
  });

  it('never fails over for config errors', () => {
    // A second provider can't fix a bad key or a wrong model, and silently
    // trying another key on an auth failure would mask the real problem.
    expect(isFailoverEligible('auth')).toBe(false);
    expect(isFailoverEligible('model_not_found')).toBe(false);
  });

  it('treats 429/5xx (mapped to unknown) as failover-eligible', () => {
    expect(isFailoverEligible(httpStatusToKind(429))).toBe(true);
    expect(isFailoverEligible(httpStatusToKind(503))).toBe(true);
    // ...but a 401 maps to auth, which is not eligible.
    expect(isFailoverEligible(httpStatusToKind(401))).toBe(false);
  });
});
