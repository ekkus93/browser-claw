export const MAX_BATCH_PAGE_READS = 10;
export const DEFAULT_MAX_PAGE_CHARS = 50_000;

export class LimitValidationError extends Error {
  readonly kind: string;
  constructor(kind: string, message: string) {
    super(message);
    this.name = 'LimitValidationError';
    this.kind = kind;
  }
}

/**
 * Validates an optional positive integer page limit.
 * undefined → no limit at this layer.
 * Positive integer ≤ max → returned as-is.
 * Anything else → throws LimitValidationError.
 */
export function normalizeOptionalPositiveIntegerLimit(
  value: unknown,
  field: string,
  options: { max: number },
): number | undefined {
  if (value === undefined) return undefined;

  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 1
  ) {
    throw new LimitValidationError(
      'invalid_positive_integer_limit',
      `${field} must be a positive integer, got ${String(value)}.`,
    );
  }

  if (value > options.max) {
    throw new LimitValidationError(
      'limit_exceeded',
      `${field} must be less than or equal to ${options.max}, got ${String(value)}.`,
    );
  }

  return value;
}
