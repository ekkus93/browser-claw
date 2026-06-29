/**
 * G1 (FIX5): structured sanitized failure content for runtime effect errors.
 * Replaces opaque "Operation was not completed" strings with structured JSON
 * the model/user can recover from.
 */

const SECRET_LIKE_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\bsk-ant-[A-Za-z0-9_-]{12,}\b/g,
  /\bBearer\s+[A-Za-z0-9._-]+\b/gi,
  /\bAuthorization:\s*[^,\n\r]+/gi,
];

function redactFailureMessage(message: string): string {
  return SECRET_LIKE_PATTERNS.reduce(
    (current, pattern) => current.replace(pattern, '[REDACTED]'),
    message,
  );
}

export function toolContentFromEffectFailure(error: unknown): string {
  const obj =
    error && typeof error === 'object' && !Array.isArray(error)
      ? (error as Record<string, unknown>)
      : {};

  const kind =
    typeof obj.kind === 'string' && obj.kind.trim()
      ? obj.kind.trim()
      : 'effect_failed';

  const rawMessage =
    typeof obj.message === 'string' && obj.message.trim()
      ? obj.message.trim()
      : 'The requested operation failed.';

  return JSON.stringify({
    type: 'effect_failure',
    kind,
    message: redactFailureMessage(rawMessage),
    retryable: obj.retryable === true,
  });
}
