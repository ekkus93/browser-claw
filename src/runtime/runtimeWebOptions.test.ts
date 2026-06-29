import { describe, expect, it } from 'vitest';
import {
  validateRuntimeWebOptions,
  RuntimeWebOptionsValidationError,
} from './runtimeWebOptions.ts';

describe('validateRuntimeWebOptions (FIX9-A1)', () => {
  // --- undefined / absent options ---

  it('A1: undefined options returns undefined', () => {
    expect(validateRuntimeWebOptions(undefined)).toBeUndefined();
  });

  it('A1: empty object returns undefined', () => {
    expect(validateRuntimeWebOptions({})).toBeUndefined();
  });

  // --- non-object types rejected ---

  it('A1: array options rejected', () => {
    expect(() => validateRuntimeWebOptions([])).toThrow(
      RuntimeWebOptionsValidationError,
    );
  });

  it('A1: string options rejected', () => {
    expect(() => validateRuntimeWebOptions('bad')).toThrow(
      RuntimeWebOptionsValidationError,
    );
  });

  it('A1: number options rejected', () => {
    expect(() => validateRuntimeWebOptions(42)).toThrow(
      RuntimeWebOptionsValidationError,
    );
  });

  it('A1: null options rejected', () => {
    expect(() => validateRuntimeWebOptions(null)).toThrow(
      RuntimeWebOptionsValidationError,
    );
  });

  // --- unknown fields rejected ---

  it('A1: unknown field rejected', () => {
    expect(() => validateRuntimeWebOptions({ unknown: true })).toThrow(
      RuntimeWebOptionsValidationError,
    );
  });

  it('A1: site field rejected (not supported)', () => {
    expect(() => validateRuntimeWebOptions({ site: 'example.com' })).toThrow(
      RuntimeWebOptionsValidationError,
    );
  });

  it('A1: format field rejected (not supported)', () => {
    expect(() => validateRuntimeWebOptions({ format: 'text' })).toThrow(
      RuntimeWebOptionsValidationError,
    );
  });

  // --- maxPages validation ---

  it('A2: valid maxPages accepted', () => {
    const result = validateRuntimeWebOptions({ maxPages: 3 });
    expect(result?.maxPages).toBe(3);
  });

  it('A2: maxPages 0 rejected', () => {
    expect(() => validateRuntimeWebOptions({ maxPages: 0 })).toThrow(
      RuntimeWebOptionsValidationError,
    );
  });

  it('A2: maxPages -1 rejected', () => {
    expect(() => validateRuntimeWebOptions({ maxPages: -1 })).toThrow(
      RuntimeWebOptionsValidationError,
    );
  });

  it('A2: maxPages 1.5 rejected', () => {
    expect(() => validateRuntimeWebOptions({ maxPages: 1.5 })).toThrow(
      RuntimeWebOptionsValidationError,
    );
  });

  it('A2: maxPages string rejected', () => {
    expect(() => validateRuntimeWebOptions({ maxPages: '3' })).toThrow(
      RuntimeWebOptionsValidationError,
    );
  });

  it('A2: maxPages above cap rejected', () => {
    expect(() => validateRuntimeWebOptions({ maxPages: 999 })).toThrow(
      RuntimeWebOptionsValidationError,
    );
  });

  // --- maxResults validation ---

  it('A2: valid maxResults accepted', () => {
    const result = validateRuntimeWebOptions({ maxResults: 5 });
    expect(result?.maxResults).toBe(5);
  });

  it('A2: maxResults 0 rejected', () => {
    expect(() => validateRuntimeWebOptions({ maxResults: 0 })).toThrow(
      RuntimeWebOptionsValidationError,
    );
  });

  it('A2: maxResults -1 rejected', () => {
    expect(() => validateRuntimeWebOptions({ maxResults: -1 })).toThrow(
      RuntimeWebOptionsValidationError,
    );
  });

  it('A2: maxResults 1.5 rejected', () => {
    expect(() => validateRuntimeWebOptions({ maxResults: 1.5 })).toThrow(
      RuntimeWebOptionsValidationError,
    );
  });

  it('A2: maxResults string rejected', () => {
    expect(() => validateRuntimeWebOptions({ maxResults: '5' })).toThrow(
      RuntimeWebOptionsValidationError,
    );
  });

  it('A2: maxResults above cap (20) rejected', () => {
    expect(() => validateRuntimeWebOptions({ maxResults: 21 })).toThrow(
      RuntimeWebOptionsValidationError,
    );
  });

  // --- maxChars validation ---

  it('A3: valid maxChars accepted', () => {
    const result = validateRuntimeWebOptions({ maxChars: 1000 });
    expect(result?.maxChars).toBe(1000);
  });

  it('A3: maxChars 0 rejected', () => {
    expect(() => validateRuntimeWebOptions({ maxChars: 0 })).toThrow(
      RuntimeWebOptionsValidationError,
    );
  });

  it('A3: maxChars -1 rejected', () => {
    expect(() => validateRuntimeWebOptions({ maxChars: -1 })).toThrow(
      RuntimeWebOptionsValidationError,
    );
  });

  it('A3: maxChars 1.5 rejected', () => {
    expect(() => validateRuntimeWebOptions({ maxChars: 1.5 })).toThrow(
      RuntimeWebOptionsValidationError,
    );
  });

  it('A3: maxChars string rejected', () => {
    expect(() => validateRuntimeWebOptions({ maxChars: '2000' })).toThrow(
      RuntimeWebOptionsValidationError,
    );
  });

  it('A3: maxChars above cap (50000) rejected', () => {
    expect(() => validateRuntimeWebOptions({ maxChars: 50_001 })).toThrow(
      RuntimeWebOptionsValidationError,
    );
  });

  // --- combined valid options ---

  it('A1: all valid fields accepted together', () => {
    const result = validateRuntimeWebOptions({
      maxPages: 2,
      maxResults: 10,
      maxChars: 20_000,
    });
    expect(result).toEqual({ maxPages: 2, maxResults: 10, maxChars: 20_000 });
  });

  it('A1: error eventType is runtime.invalid_web_request', () => {
    try {
      validateRuntimeWebOptions({ unknown: true });
    } catch (err) {
      expect(err).toBeInstanceOf(RuntimeWebOptionsValidationError);
      if (err instanceof RuntimeWebOptionsValidationError) {
        expect(err.eventType).toBe('runtime.invalid_web_request');
      }
    }
  });
});
