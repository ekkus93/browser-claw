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

/**
 * Whether a failed primary request should be retried on the fallback provider.
 * Only reachability/transient failures qualify (cors, unreachable, and unknown
 * — where 429/5xx land). Config errors (auth, model_not_found) are NOT eligible:
 * a second provider won't fix a bad key or a wrong model, and silently shifting
 * to another key on an auth failure would mask the real problem.
 */
export function isFailoverEligible(kind: ProviderErrorKind): boolean {
  return kind === 'cors' || kind === 'unreachable' || kind === 'unknown';
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
      return 'The request was blocked by the browser — most likely a CORS restriction. This provider may not allow direct browser requests.';
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
 * Classify a thrown fetch failure for a given request URL. In the browser a CORS
 * rejection and a genuine network failure both surface as a bare TypeError with
 * no further detail, so they can only be distinguished heuristically by origin:
 * a request to a *cross-origin* URL that throws is most likely blocked by CORS
 * (the provider did not send the headers a browser requires), while a
 * *same-origin* failure — or any failure outside a browser, where there is no
 * page origin to compare against — is reported as an ordinary network problem.
 */
export function classifyFetchFailure(url: string): ProviderErrorKind {
  const origin = globalThis.location?.origin;
  if (!origin) return 'unreachable';
  try {
    return new URL(url, origin).origin === origin ? 'unreachable' : 'cors';
  } catch {
    return 'unreachable';
  }
}

/**
 * Run a fetch and convert a thrown network error into a ProviderError, using the
 * request URL to tell a likely CORS block from a plain network failure (see
 * `classifyFetchFailure`).
 */
export async function fetchOrThrow(
  url: string,
  run: () => Promise<Response>,
): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(
      classifyFetchFailure(url),
      error instanceof Error ? error.message : 'Network request failed',
    );
  }
}
