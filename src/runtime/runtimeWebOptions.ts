import {
  MAX_BATCH_PAGE_READS,
  MAX_SEARCH_RESULTS,
  MAX_WEB_PAGE_CHARS,
  normalizeOptionalPositiveIntegerLimit,
  LimitValidationError,
} from '../webresearch/limits.ts';

export type RuntimeWebOptions = {
  maxPages?: number;
  maxResults?: number;
  maxChars?: number;
};

export class RuntimeWebOptionsValidationError extends Error {
  readonly eventType = 'runtime.invalid_web_request' as const;
  constructor(message: string) {
    super(message);
    this.name = 'RuntimeWebOptionsValidationError';
  }
}

const RUNTIME_WEB_OPTION_FIELDS = new Set([
  'maxPages',
  'maxResults',
  'maxChars',
]);

function invalidOption(message: string): never {
  throw new RuntimeWebOptionsValidationError(message);
}

function validateIntegerOption(
  input: Record<string, unknown>,
  field: 'maxPages' | 'maxResults' | 'maxChars',
  max: number,
): number | undefined {
  if (input[field] === undefined) return undefined;
  try {
    return normalizeOptionalPositiveIntegerLimit(input[field], field, { max });
  } catch (err) {
    invalidOption(
      err instanceof LimitValidationError
        ? err.message
        : `${field} is invalid.`,
    );
  }
}

/**
 * Validates model-authored web_request.options for the reference runtime.
 *
 * undefined → undefined (no options)
 * non-object or array → throws RuntimeWebOptionsValidationError
 * unknown field → throws RuntimeWebOptionsValidationError
 * invalid limit value → throws RuntimeWebOptionsValidationError
 * valid options → returns RuntimeWebOptions (omitting undefined fields)
 *
 * Supported fields: maxPages, maxResults, maxChars only.
 * site and format are not supported in the current execution path and are
 * rejected as unknown fields.
 */
export function validateRuntimeWebOptions(
  raw: unknown,
): RuntimeWebOptions | undefined {
  if (raw === undefined) return undefined;

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    invalidOption('web_request.options must be a plain object.');
  }

  const input = raw as Record<string, unknown>;

  for (const key of Object.keys(input)) {
    if (!RUNTIME_WEB_OPTION_FIELDS.has(key)) {
      invalidOption(`Unknown web_request.options field: ${key}.`);
    }
  }

  const output: RuntimeWebOptions = {};

  const maxPages = validateIntegerOption(
    input,
    'maxPages',
    MAX_BATCH_PAGE_READS,
  );
  if (maxPages !== undefined) output.maxPages = maxPages;

  const maxResults = validateIntegerOption(
    input,
    'maxResults',
    MAX_SEARCH_RESULTS,
  );
  if (maxResults !== undefined) output.maxResults = maxResults;

  const maxChars = validateIntegerOption(input, 'maxChars', MAX_WEB_PAGE_CHARS);
  if (maxChars !== undefined) output.maxChars = maxChars;

  return Object.keys(output).length > 0 ? output : undefined;
}
