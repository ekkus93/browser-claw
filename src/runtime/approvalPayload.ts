/**
 * F1: Shared helpers for parsing approval payload JSON. Every approval card
 * serialises its payload as `payloadPreview: string`. These helpers enforce
 * the contract at the boundary rather than silently coercing bad payloads to
 * empty defaults (which would silently permit mis-routed approvals).
 */

export class ApprovalPayloadError extends Error {
  readonly kind: string;
  constructor(kind: string, message: string) {
    super(message);
    this.name = 'ApprovalPayloadError';
    this.kind = kind;
  }
}

/**
 * Parse the payloadPreview string. Throws ApprovalPayloadError on:
 *   - missing/empty payload
 *   - non-JSON payload
 *   - JSON that is not a plain object
 */
export function parseApprovalPayloadObject(
  payloadPreview: string | undefined,
  label: string,
): Record<string, unknown> {
  if (!payloadPreview || payloadPreview.trim() === '') {
    throw new ApprovalPayloadError(
      'approval_payload_missing',
      `${label} approval payload is missing.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadPreview);
  } catch {
    throw new ApprovalPayloadError(
      'approval_payload_invalid_json',
      `${label} approval payload is not valid JSON.`,
    );
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ApprovalPayloadError(
      'approval_payload_not_object',
      `${label} approval payload must be a JSON object.`,
    );
  }

  return parsed as Record<string, unknown>;
}

/**
 * Return a non-empty string field from a parsed payload. Throws
 * ApprovalPayloadError if the field is missing, not a string, or blank.
 */
export function requireStringField(
  obj: Record<string, unknown>,
  field: string,
  label: string,
): string {
  const value = obj[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ApprovalPayloadError(
      'approval_payload_missing_field',
      `${label} approval payload requires a non-empty ${field}.`,
    );
  }
  return value;
}

/**
 * B2 (FIX4): Return a validated non-empty string array from a parsed payload.
 * Throws ApprovalPayloadError if the field is missing, not an array, empty,
 * or contains any non-string or blank slot.
 */
export function requireStringArrayField(
  obj: Record<string, unknown>,
  field: string,
  label: string,
): string[] {
  const value = obj[field];
  if (!Array.isArray(value) || value.length === 0) {
    throw new ApprovalPayloadError(
      'approval_payload_missing_field',
      `${label} approval payload requires a non-empty ${field} array.`,
    );
  }
  return value.map((item: unknown, index: number) => {
    if (typeof item !== 'string' || item.trim() === '') {
      throw new ApprovalPayloadError(
        'approval_payload_invalid_field',
        `${label}.${field}[${index}] must be a non-empty string.`,
      );
    }
    return item.trim();
  });
}

/**
 * Like parseApprovalPayloadObject but returns undefined instead of throwing.
 * Use this for backwards-compatible call sites that handle the undefined case.
 */
export function tryParseApprovalPayload(
  payloadPreview: string | undefined,
): Record<string, unknown> | undefined {
  try {
    return parseApprovalPayloadObject(payloadPreview, 'payload');
  } catch {
    return undefined;
  }
}
