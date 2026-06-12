import type { ProviderHealth } from '../store/slices/providersSlice.ts';

/**
 * Provider errors normalized into a small set of kinds so the UI can show a
 * consistent status regardless of which provider failed.
 */
export type ProviderErrorKind =
  | 'cors'
  | 'auth'
  | 'model_not_found'
  | 'unreachable'
  | 'unknown';

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;

  constructor(kind: ProviderErrorKind, message: string) {
    super(message);
    this.name = 'ProviderError';
    this.kind = kind;
  }
}

/** Map an HTTP status to a provider error kind. */
export function httpStatusToKind(status: number): ProviderErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'model_not_found';
  return 'unknown';
}

/** A short, user-facing explanation for each provider error kind. */
export function providerErrorMessage(kind: ProviderErrorKind): string {
  switch (kind) {
    case 'cors':
      return 'The request was blocked by the browser (CORS). This provider must allow browser requests.';
    case 'auth':
      return 'Authentication failed. Check the API key for this provider.';
    case 'model_not_found':
      return 'The requested model was not found for this provider.';
    case 'unreachable':
      return 'The provider could not be reached (a possible CORS or network issue).';
    case 'unknown':
      return 'The provider could not respond.';
  }
}

/**
 * Normalize any thrown value into a kind + user-facing message for the chat
 * error card. Never include secrets — messages are generic by kind.
 */
export function describeProviderError(error: unknown): {
  kind: ProviderErrorKind;
  message: string;
} {
  const kind = error instanceof ProviderError ? error.kind : 'unknown';
  return { kind, message: providerErrorMessage(kind) };
}

/** Map a provider error kind to the health status shown in the UI. */
export function kindToHealth(kind: ProviderErrorKind): ProviderHealth {
  switch (kind) {
    case 'cors':
      return 'cors_error';
    case 'auth':
      return 'auth_failed';
    case 'model_not_found':
      return 'model_not_found';
    case 'unreachable':
    case 'unknown':
      return 'unreachable';
  }
}

/**
 * Run a fetch and convert a thrown network error into a ProviderError. In the
 * browser a CORS failure and a network failure both surface as a TypeError, so
 * these are reported as `unreachable` (the most actionable kind).
 */
export async function fetchOrThrow(
  run: () => Promise<Response>,
): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(
      'unreachable',
      error instanceof Error ? error.message : 'Network request failed',
    );
  }
}
