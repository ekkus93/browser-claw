import { describe, expect, it } from 'vitest';
import {
  ApprovalPayloadError,
  parseApprovalPayloadObject,
  requireStringField,
  tryParseApprovalPayload,
} from './approvalPayload.ts';

describe('F1 — parseApprovalPayloadObject', () => {
  it('F1: throws approval_payload_missing for undefined payload', () => {
    expect(() => parseApprovalPayloadObject(undefined, 'Test')).toThrowError(
      expect.objectContaining({ kind: 'approval_payload_missing' }),
    );
  });

  it('F1: throws approval_payload_missing for empty string payload', () => {
    expect(() => parseApprovalPayloadObject('', 'Test')).toThrowError(
      expect.objectContaining({ kind: 'approval_payload_missing' }),
    );
  });

  it('F1: throws approval_payload_invalid_json for malformed JSON', () => {
    expect(() => parseApprovalPayloadObject('{not json}', 'Test')).toThrowError(
      expect.objectContaining({ kind: 'approval_payload_invalid_json' }),
    );
  });

  it('F1: throws approval_payload_not_object for JSON array', () => {
    expect(() => parseApprovalPayloadObject('["a","b"]', 'Test')).toThrowError(
      expect.objectContaining({ kind: 'approval_payload_not_object' }),
    );
  });

  it('F1: throws approval_payload_not_object for JSON null', () => {
    expect(() => parseApprovalPayloadObject('null', 'Test')).toThrowError(
      expect.objectContaining({ kind: 'approval_payload_not_object' }),
    );
  });

  it('F1: returns parsed object for valid JSON object', () => {
    const result = parseApprovalPayloadObject(
      '{"url":"https://x.com/","opts":{}}',
      'Test',
    );
    expect(result).toEqual({ url: 'https://x.com/', opts: {} });
  });

  it('F1: error is an instance of ApprovalPayloadError', () => {
    try {
      parseApprovalPayloadObject(undefined, 'Test');
    } catch (err) {
      expect(err).toBeInstanceOf(ApprovalPayloadError);
    }
  });
});

describe('F1 — requireStringField', () => {
  it('F1: returns value for non-empty string field', () => {
    expect(requireStringField({ url: 'https://x.com/' }, 'url', 'Test')).toBe(
      'https://x.com/',
    );
  });

  it('F1: throws approval_payload_missing_field for missing field', () => {
    expect(() => requireStringField({ query: '' }, 'url', 'Test')).toThrowError(
      expect.objectContaining({ kind: 'approval_payload_missing_field' }),
    );
  });

  it('F1: throws approval_payload_missing_field for empty string field', () => {
    expect(() =>
      requireStringField({ url: '   ' }, 'url', 'Test'),
    ).toThrowError(
      expect.objectContaining({ kind: 'approval_payload_missing_field' }),
    );
  });

  it('F1: throws for non-string field type', () => {
    expect(() => requireStringField({ url: 42 }, 'url', 'Test')).toThrowError(
      ApprovalPayloadError,
    );
  });
});

describe('F1 — tryParseApprovalPayload', () => {
  it('F1: returns undefined for bad JSON (no throw)', () => {
    expect(tryParseApprovalPayload('{bad}')).toBeUndefined();
  });

  it('F1: returns undefined for missing payload', () => {
    expect(tryParseApprovalPayload(undefined)).toBeUndefined();
  });

  it('F1: returns object for valid payload', () => {
    expect(tryParseApprovalPayload('{"q":"test"}')).toEqual({ q: 'test' });
  });
});
