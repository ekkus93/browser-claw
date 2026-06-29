# BrowserClaw Workspace/Scripting/WebResearch FIX9 TODO

## Priority Key

```text
P0 = security/correctness blocker
P1 = required for feature completeness
P2 = polish, robustness, or future hardening
```

## Phase 0 — Scope Lock and Evidence Hygiene

- [ ] P0 Add `docs/BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX9_SPEC.md`.
- [ ] P0 Add this file as `docs/BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX9_TODO.md`.
- [ ] P0 Update `docs/WORKSPACE_SCRIPTING_WEBRESEARCH_DESIGN_NOTES.md` with a FIX9 section:
  - [ ] runtime web options must be validated by one helper;
  - [ ] no web op may validate options and then drop them;
  - [ ] `maxResults` and `maxChars` must be validated like `maxPages`;
  - [ ] approved bulk-research invalid options must be payload-invalid;
  - [ ] Rust `sk-ant` / `sk` redaction overlap must be resolved or documented.
- [ ] P0 Update `memory.md` with:
  - [ ] real `date -u` timestamp;
  - [ ] model name;
  - [ ] concise summary of FIX9 scope.
- [ ] P0 Do not add broad new features in this pass.
- [ ] P0 Do not check TODO boxes without evidence comments pointing to source/tests.
- [ ] P0 Correct any FIX8 evidence comments that overclaim full options-forwarding parity.

---

# Part A — Shared Runtime Web Options Validator

## A1 — Add `validateRuntimeWebOptions()`

### Problem

`referenceRuntime.ts` validates some options in some branches, but does not have one complete validator. This causes options to be accepted or checked in one place and then dropped elsewhere.

### Required behavior

Add one runtime web-options validator for model-authored `web_request.options`.

- [ ] P1 Add `validateRuntimeWebOptions(raw: unknown)`.
- [ ] P1 Behavior:
  - [ ] `undefined` returns `undefined`;
  - [ ] non-object rejected;
  - [ ] array rejected;
  - [ ] unknown fields rejected unless explicitly supported;
  - [ ] `maxPages` validated with `normalizeOptionalPositiveIntegerLimit`;
  - [ ] `maxResults` validated with `normalizeOptionalPositiveIntegerLimit`;
  - [ ] `maxChars` validated with `normalizeOptionalPositiveIntegerLimit`;
  - [ ] optional `site` validated if supported;
  - [ ] optional `format` validated if supported.
- [ ] P1 Tests:
  - [ ] `options: undefined` accepted;
  - [ ] `options: []` rejected;
  - [ ] `options: "bad"` rejected;
  - [ ] `options: { unknown: true }` rejected;
  - [ ] valid `maxPages/maxResults/maxChars` accepted.

### Suggested TypeScript implementation

```ts
import {
  MAX_BATCH_PAGE_READS,
  MAX_PAGE_CHARS,
  MAX_SEARCH_RESULTS,
  normalizeOptionalPositiveIntegerLimit,
} from '../webresearch/limits';

type RuntimeWebOptions = {
  maxPages?: number;
  maxResults?: number;
  maxChars?: number;
  site?: string;
  format?: 'text' | 'markdown';
};

const RUNTIME_WEB_OPTION_FIELDS = new Set([
  'maxPages',
  'maxResults',
  'maxChars',
  'site',
  'format',
]);

function validateRuntimeWebOptions(raw: unknown): RuntimeWebOptions | undefined {
  if (raw === undefined) return undefined;

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new RuntimeProtocolError(
      'invalid_web_request',
      'web_request.options must be an object.',
    );
  }

  const input = raw as Record<string, unknown>;

  for (const key of Object.keys(input)) {
    if (!RUNTIME_WEB_OPTION_FIELDS.has(key)) {
      throw new RuntimeProtocolError(
        'invalid_web_request',
        `Unknown web_request.options field: ${key}`,
      );
    }
  }

  const output: RuntimeWebOptions = {};

  if (input.maxPages !== undefined) {
    output.maxPages = normalizeOptionalPositiveIntegerLimit(
      input.maxPages,
      'maxPages',
      { max: MAX_BATCH_PAGE_READS },
    );
  }

  if (input.maxResults !== undefined) {
    output.maxResults = normalizeOptionalPositiveIntegerLimit(
      input.maxResults,
      'maxResults',
      { max: MAX_SEARCH_RESULTS },
    );
  }

  if (input.maxChars !== undefined) {
    output.maxChars = normalizeOptionalPositiveIntegerLimit(
      input.maxChars,
      'maxChars',
      { max: MAX_PAGE_CHARS },
    );
  }

  if (input.site !== undefined) {
    if (typeof input.site !== 'string' || input.site.trim() === '') {
      throw new RuntimeProtocolError(
        'invalid_web_request',
        'web_request.options.site must be a non-empty string.',
      );
    }
    output.site = input.site.trim();
  }

  if (input.format !== undefined) {
    if (input.format !== 'text' && input.format !== 'markdown') {
      throw new RuntimeProtocolError(
        'invalid_web_request',
        'web_request.options.format must be "text" or "markdown".',
      );
    }
    output.format = input.format;
  }

  return Object.keys(output).length > 0 ? output : undefined;
}
```

If `site` or `format` is not actually used downstream, remove it from the supported set and reject it.

## A2 — Validate `maxResults`

- [ ] P1 Add/confirm `MAX_SEARCH_RESULTS`.
- [ ] P1 Validate:
  - [ ] string rejected;
  - [ ] zero rejected;
  - [ ] negative rejected;
  - [ ] non-integer rejected;
  - [ ] above max rejected;
  - [ ] valid positive integer accepted.
- [ ] P1 Apply validation in:
  - [ ] `agentBlockParser` canonical web options;
  - [ ] `referenceRuntime` options;
  - [ ] web runner/search options if present.
- [ ] P1 Tests for each invalid case.

## A3 — Validate `maxChars`

- [ ] P1 Add/confirm `MAX_PAGE_CHARS` or use existing `DEFAULT_MAX_PAGE_CHARS` as cap if appropriate.
- [ ] P1 Validate:
  - [ ] string rejected;
  - [ ] zero rejected, unless zero has explicitly documented meaning;
  - [ ] negative rejected;
  - [ ] non-integer rejected;
  - [ ] above max rejected;
  - [ ] valid positive integer accepted.
- [ ] P1 Apply validation in:
  - [ ] `agentBlockParser` canonical web options;
  - [ ] `referenceRuntime` options;
  - [ ] web runner/page read options if present;
  - [ ] page reader provider if not already.
- [ ] P1 Tests for each invalid case.

---

# Part B — Reference Runtime Option Forwarding

## B1 — Forward options for `search`

- [ ] P1 Update `referenceRuntime.ts` search branch.
- [ ] P1 Validate options with `validateRuntimeWebOptions`.
- [ ] P1 Emit `options` if present.
- [ ] P1 Tests:
  - [ ] search with `options.maxResults: 1` emits `web_search.options.maxResults === 1`;
  - [ ] search with invalid `maxResults: 0` emits invalid web request audit;
  - [ ] search with unknown option rejected.

### Suggested patch shape

```ts
const options = validateRuntimeWebOptions(webRequest.options);

return [
  {
    type: 'web_search',
    id: proposalId,
    query,
    ...(options ? { options } : {}),
  },
];
```

## B2 — Forward options for `readPage`

- [ ] P1 Update `referenceRuntime.ts` readPage branch.
- [ ] P1 Validate options with `validateRuntimeWebOptions`.
- [ ] P1 Emit `options` if present.
- [ ] P1 Tests:
  - [ ] readPage with `options.maxChars: 1000` emits `web_page_read.options.maxChars === 1000`;
  - [ ] readPage with invalid `maxChars: -1` emits invalid web request audit;
  - [ ] readPage with unknown option rejected.

## B3 — Forward options for `research`

- [ ] P1 Update `referenceRuntime.ts` research query branch.
- [ ] P1 Validate options with `validateRuntimeWebOptions`.
- [ ] P1 Emit `options` if present.
- [ ] P1 Tests:
  - [ ] research with `options.maxPages: 2` emits `web_research.options.maxPages === 2`;
  - [ ] research with `options.maxResults: 5` emits `web_research.options.maxResults === 5`;
  - [ ] research with invalid option emits invalid web request audit.

## B4 — Forward full options for `readPages`

- [ ] P1 Update `referenceRuntime.ts` readPages branch.
- [ ] P1 Preserve:
  - [ ] `maxPages`;
  - [ ] `maxChars`.
- [ ] P1 Tests:
  - [ ] readPages with `options.maxPages: 1` preserves maxPages;
  - [ ] readPages with `options.maxChars: 20000` preserves maxChars;
  - [ ] readPages with invalid maxChars rejected.

---

# Part C — Parser / Canonical Options Completion

## C1 — Validate top-level and nested `maxResults`

### Problem

`maxResults` may be copied only if it is a number, meaning malformed strings can be silently dropped and invalid numeric values can slip through.

- [ ] P1 In `agentBlockParser`, validate canonical `maxResults`.
- [ ] P1 Reject:
  - [ ] string;
  - [ ] zero;
  - [ ] negative;
  - [ ] non-integer;
  - [ ] above cap.
- [ ] P1 Valid top-level `maxResults` becomes `options.maxResults`.
- [ ] P1 Valid nested `options.maxResults` remains `options.maxResults`.
- [ ] P1 Conflicting top-level/nested values rejected.
- [ ] P1 Tests for all cases.

## C2 — Validate top-level and nested `maxChars`

- [ ] P1 In `agentBlockParser`, validate canonical `maxChars`.
- [ ] P1 Reject:
  - [ ] string;
  - [ ] zero unless explicitly allowed;
  - [ ] negative;
  - [ ] non-integer;
  - [ ] above cap.
- [ ] P1 Valid top-level `maxChars` becomes `options.maxChars`.
- [ ] P1 Valid nested `options.maxChars` remains `options.maxChars`.
- [ ] P1 Conflicting top-level/nested values rejected.
- [ ] P1 Tests for all cases.

## C3 — Do not silently drop unsupported option fields

- [ ] P1 If raw `options` contains unknown field, reject the request.
- [ ] P1 If top-level unsupported limit-like field appears, reject or ignore only with explicit documented reason.
- [ ] P1 Tests:
  - [ ] `options: { unknown: true }` rejected;
  - [ ] top-level unknown option-like field rejected or documented.

---

# Part D — Approved Bulk Research Payload Classification

## D1 — Sanitize options inside payload-validation block

### Problem

Approved bulk-research payloads with invalid `options` can be classified as `web.research_failed` because options sanitization occurs after `web.research_started`.

### Required behavior

Invalid options in approval payload are payload-invalid, not provider failure.

- [ ] P1 In `runApprovedBulkResearch()`:
  - [ ] handle rejection before parsing payload, as already fixed;
  - [ ] parse payload;
  - [ ] sanitize/validate `parsed.options`;
  - [ ] validate query/urls;
  - [ ] on any payload/options validation error, audit `web.bulk_research_payload_invalid`;
  - [ ] resolve effect `ok:false`;
  - [ ] do not audit `web.research_started`;
  - [ ] do not call provider.
- [ ] P1 Tests:
  - [ ] approved payload with `options.maxPages: 0` audits payload-invalid;
  - [ ] approved payload with `options.maxPages: -1` audits payload-invalid;
  - [ ] approved payload with `options.maxResults: 0` audits payload-invalid;
  - [ ] invalid options do not audit `web.research_failed`;
  - [ ] invalid options do not call provider.

### Suggested code order

```ts
export async function runApprovedBulkResearch(...) {
  if (approval.status !== 'approved') {
    // user rejected path
    return;
  }

  let parsed: Record<string, unknown>;
  let options: ResearchOptions;

  try {
    parsed = parseApprovalPayloadObject(approval.payloadPreview, 'web_bulk_research');
    options = sanitizeResearchOptions(parsed.options);

    // Validate urls/query here too.
    if (Array.isArray(parsed.urls)) {
      const urls = requireStringArrayField(parsed, 'urls', 'web_bulk_research');
      for (const url of urls) assertFetchUrlAllowed(url);
    } else {
      requireStringField(parsed, 'query', 'web_bulk_research');
    }
  } catch (error) {
    await failInvalidBulkResearchPayload(deps, approval, error);
    return;
  }

  await deps.recordAudit({ type: 'web.research_started', ... });

  try {
    // provider call
  } catch (error) {
    // provider failure only
  }
}
```

---

# Part E — Rust `sk-ant` / `sk` Redaction Overlap

## E1 — Decide overlap policy

### Problem

The generic `sk-` redaction pass can redact `sk-ant-*` tokens that the `sk-ant-` pass would not redact. This is safe from a leak standpoint, but it makes the prefix-specific policy inconsistent.

Choose one:

### Option A — precise ownership

- [ ] P2 `sk-ant-` tokens are handled only by the `sk-ant-` rule.
- [ ] P2 generic `sk-` rule skips tokens starting with `sk-ant-`.
- [ ] P2 Tests:
  - [ ] short `sk-ant-short` is not redacted if below min length;
  - [ ] long `sk-ant-123456789012` is redacted;
  - [ ] normal `sk-123456789012` is redacted.

### Option B — conservative overlap

- [ ] P2 Document that generic `sk-` intentionally redacts `sk-ant-*` tokens if they look long enough.
- [ ] P2 Tests prove and document this behavior.
- [ ] P2 Safe-word tests remain passing.

Recommended: **Option A** for policy clarity.

### Suggested Option A code

```rust
fn should_redact_sk_token(input: &str, start: usize, prefix: &str) -> bool {
    if prefix == "sk-" && input[start..].starts_with("sk-ant-") {
        return false;
    }

    is_token_boundary_before(input, start)
        && secret_token_len_after_prefix(input, start + prefix.len()) >= 12
}
```

---

# Part F — Evidence and Gate

## F1 — Update review notes

- [ ] P1 Update or create `docs/WORKSPACE_SCRIPTING_WEBRESEARCH_FIX9_REVIEW_NOTES.md`.
- [ ] P1 Include:
  - [ ] runtime options validator behavior;
  - [ ] option forwarding behavior;
  - [ ] parser/canonical validation behavior;
  - [ ] bulk approval invalid-option classification behavior;
  - [ ] Rust redaction overlap decision;
  - [ ] Docker extension E2E result.

## F2 — Required commands

Run and record actual results:

```bash
pnpm run typecheck
pnpm run lint
pnpm run format:check
pnpm run test
pnpm run test:e2e
pnpm run test:extension:e2e
pnpm run test:extension:e2e:docker
pnpm run build
pnpm run build:wasm
cargo test
cargo clippy
```

- [ ] P0 Record command results in TODO evidence comments.
- [ ] P0 If a command cannot run, record:
  - [ ] exact command;
  - [ ] exact error;
  - [ ] environment reason;
  - [ ] whether it blocks all acceptance or only scoped feature acceptance;
  - [ ] follow-up task.
- [ ] P0 Do not mark failed/cannot-run commands as passed.
- [ ] P1 If Docker extension E2E cannot run, do not claim extension readiness for FIX9.

## F3 — Final acceptance checklist

FIX9 is complete only when:

- [ ] `referenceRuntime` validates `web_request.options` with one shared helper.
- [ ] `referenceRuntime` forwards validated options for `search`, `readPage`, `research`, and `readPages`.
- [ ] `maxResults` is validated in parser/runtime/web runner paths.
- [ ] `maxChars` is validated in parser/runtime/web runner paths.
- [ ] Unknown model-authored option fields are rejected or explicitly documented.
- [ ] Approved bulk-research invalid options are classified as payload-invalid.
- [ ] Rust `sk-ant` / `sk` overlap is fixed or explicitly documented and tested.
- [ ] Gate results are recorded honestly.
