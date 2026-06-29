import { describe, expect, it } from 'vitest';
import {
  LimitValidationError,
  MAX_BATCH_PAGE_READS,
  normalizeOptionalPositiveIntegerLimit,
} from './limits.ts';

describe('normalizeOptionalPositiveIntegerLimit', () => {
  const opts = { max: MAX_BATCH_PAGE_READS };

  it('undefined returns undefined', () => {
    expect(
      normalizeOptionalPositiveIntegerLimit(undefined, 'maxPages', opts),
    ).toBeUndefined();
  });

  it('positive integer within max is returned', () => {
    expect(normalizeOptionalPositiveIntegerLimit(1, 'maxPages', opts)).toBe(1);
    expect(normalizeOptionalPositiveIntegerLimit(5, 'maxPages', opts)).toBe(5);
    expect(
      normalizeOptionalPositiveIntegerLimit(
        MAX_BATCH_PAGE_READS,
        'maxPages',
        opts,
      ),
    ).toBe(MAX_BATCH_PAGE_READS);
  });

  it('0 throws LimitValidationError', () => {
    expect(() =>
      normalizeOptionalPositiveIntegerLimit(0, 'maxPages', opts),
    ).toThrow(LimitValidationError);
  });

  it('negative throws LimitValidationError', () => {
    expect(() =>
      normalizeOptionalPositiveIntegerLimit(-1, 'maxPages', opts),
    ).toThrow(LimitValidationError);
  });

  it('NaN throws LimitValidationError', () => {
    expect(() =>
      normalizeOptionalPositiveIntegerLimit(NaN, 'maxPages', opts),
    ).toThrow(LimitValidationError);
  });

  it('Infinity throws LimitValidationError', () => {
    expect(() =>
      normalizeOptionalPositiveIntegerLimit(Infinity, 'maxPages', opts),
    ).toThrow(LimitValidationError);
  });

  it('non-integer (1.5) throws LimitValidationError', () => {
    expect(() =>
      normalizeOptionalPositiveIntegerLimit(1.5, 'maxPages', opts),
    ).toThrow(LimitValidationError);
  });

  it('string "2" throws LimitValidationError', () => {
    expect(() =>
      normalizeOptionalPositiveIntegerLimit('2', 'maxPages', opts),
    ).toThrow(LimitValidationError);
  });

  it('value above max throws LimitValidationError', () => {
    expect(() =>
      normalizeOptionalPositiveIntegerLimit(
        MAX_BATCH_PAGE_READS + 1,
        'maxPages',
        opts,
      ),
    ).toThrow(LimitValidationError);
  });

  it('error has kind field', () => {
    try {
      normalizeOptionalPositiveIntegerLimit(0, 'maxPages', opts);
    } catch (e) {
      expect(e).toBeInstanceOf(LimitValidationError);
      expect((e as LimitValidationError).kind).toBe(
        'invalid_positive_integer_limit',
      );
    }
  });
});
