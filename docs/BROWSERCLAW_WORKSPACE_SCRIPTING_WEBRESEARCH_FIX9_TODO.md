# BrowserClaw Workspace/Scripting/WebResearch FIX9 TODO

## Priority Key

```text
P0 = security/correctness blocker
P1 = required for feature completeness
P2 = polish, robustness, or future hardening
```

## Phase 0 — Scope Lock and Evidence Hygiene

- [x] P0 Add `docs/BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX9_SPEC.md`. <!-- already present from commit b1b6c50 -->
- [x] P0 Add this file as `docs/BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX9_TODO.md`. <!-- already present from commit b1b6c50 -->
- [x] P0 Update `docs/WORKSPACE_SCRIPTING_WEBRESEARCH_DESIGN_NOTES.md` with a FIX9 section: <!-- FIX9 Locked decisions section appended -->
  - [x] runtime web options must be validated by one helper;
  - [x] no web op may validate options and then drop them;
  - [x] `maxResults` and `maxChars` must be validated like `maxPages`;
  - [x] approved bulk-research invalid options must be payload-invalid;
  - [x] Rust `sk-ant` / `sk` redaction overlap must be resolved or documented.
- [x] P0 Update `memory.md` with: <!-- 2026-06-29T21:56:27Z entry added -->
  - [x] real `date -u` timestamp;
  - [x] model name;
  - [x] concise summary of FIX9 scope.
- [x] P0 Do not add broad new features in this pass.
- [x] P0 Do not check TODO boxes without evidence comments pointing to source/tests.
- [x] P0 Correct any FIX8 evidence comments that overclaim full options-forwarding parity. <!-- FIX8 TODO line 495 corrected: B1 only covered readPages; FIX9 completes parity -->

---

# Part A — Shared Runtime Web Options Validator

## A1 — Add `validateRuntimeWebOptions()`

### Problem

`referenceRuntime.ts` validates some options in some branches, but does not have one complete validator. This causes options to be accepted or checked in one place and then dropped elsewhere.

### Required behavior

Add one runtime web-options validator for model-authored `web_request.options`.

- [x] P1 Add `validateRuntimeWebOptions(raw: unknown)`. <!-- src/runtime/runtimeWebOptions.ts -->
- [x] P1 Behavior:
  - [x] `undefined` returns `undefined`;
  - [x] non-object rejected;
  - [x] array rejected;
  - [x] unknown fields rejected unless explicitly supported;
  - [x] `maxPages` validated with `normalizeOptionalPositiveIntegerLimit`;
  - [x] `maxResults` validated with `normalizeOptionalPositiveIntegerLimit`;
  - [x] `maxChars` validated with `normalizeOptionalPositiveIntegerLimit`;
  - [x] optional `site` validated if supported; <!-- site rejected as unsupported (per replies3.md) -->
  - [x] optional `format` validated if supported. <!-- format rejected as unsupported (per replies3.md) -->
- [x] P1 Tests: <!-- src/runtime/runtimeWebOptions.test.ts — 29 tests -->
  - [x] `options: undefined` accepted;
  - [x] `options: []` rejected;
  - [x] `options: "bad"` rejected;
  - [x] `options: { unknown: true }` rejected;
  - [x] valid `maxPages/maxResults/maxChars` accepted.

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

- [x] P1 Add/confirm `MAX_SEARCH_RESULTS`. <!-- moved from braveSearch.ts to limits.ts; braveSearch.ts re-exports it -->
- [x] P1 Validate:
  - [x] string rejected;
  - [x] zero rejected;
  - [x] negative rejected;
  - [x] non-integer rejected;
  - [x] above max rejected;
  - [x] valid positive integer accepted.
- [ ] P1 Apply validation in:
  - [ ] `agentBlockParser` canonical web options; <!-- Part C1 -->
  - [x] `referenceRuntime` options; <!-- via validateRuntimeWebOptions in Part B -->
  - [ ] web runner/search options if present. <!-- Part C -->
- [x] P1 Tests for each invalid case. <!-- runtimeWebOptions.test.ts A2 tests -->

## A3 — Validate `maxChars`

- [x] P1 Add/confirm `MAX_PAGE_CHARS` or use existing `DEFAULT_MAX_PAGE_CHARS` as cap if appropriate. <!-- MAX_WEB_PAGE_CHARS=50_000 added to limits.ts; DEFAULT_MAX_PAGE_CHARS aliased -->
- [x] P1 Validate:
  - [x] string rejected;
  - [x] zero rejected, unless zero has explicitly documented meaning;
  - [x] negative rejected;
  - [x] non-integer rejected;
  - [x] above max rejected;
  - [x] valid positive integer accepted.
- [ ] P1 Apply validation in:
  - [ ] `agentBlockParser` canonical web options; <!-- Part C2 -->
  - [x] `referenceRuntime` options; <!-- via validateRuntimeWebOptions in Part B -->
  - [ ] web runner/page read options if present; <!-- Part C -->
  - [ ] page reader provider if not already. <!-- Part C -->
- [x] P1 Tests for each invalid case. <!-- runtimeWebOptions.test.ts A3 tests -->

---

# Part B — Reference Runtime Option Forwarding

## B1 — Forward options for `search`

- [x] P1 Update `referenceRuntime.ts` search branch. <!-- validateRuntimeWebOptions in search op -->
- [x] P1 Validate options with `validateRuntimeWebOptions`.
- [x] P1 Emit `options` if present.
- [x] P1 Tests: <!-- referenceRuntime.test.ts B1 FIX9 tests -->
  - [x] search with `options.maxResults: 1` emits `web_search.options.maxResults === 1`;
  - [x] search with invalid `maxResults: 0` emits invalid web request audit;
  - [x] search with unknown option rejected.

## B2 — Forward options for `readPage`

- [x] P1 Update `referenceRuntime.ts` readPage branch. <!-- validateRuntimeWebOptions in readPage op -->
- [x] P1 Validate options with `validateRuntimeWebOptions`.
- [x] P1 Emit `options` if present.
- [x] P1 Tests: <!-- referenceRuntime.test.ts B2 FIX9 tests -->
  - [x] readPage with `options.maxChars: 1000` emits `web_page_read.options.maxChars === 1000`;
  - [x] readPage with invalid `maxChars: -1` emits invalid web request audit;
  - [x] readPage with unknown option rejected.

## B3 — Forward options for `research`

- [x] P1 Update `referenceRuntime.ts` research query branch. <!-- validateRuntimeWebOptions in research op -->
- [x] P1 Validate options with `validateRuntimeWebOptions`.
- [x] P1 Emit `options` if present.
- [x] P1 Tests: <!-- referenceRuntime.test.ts B3 FIX9 tests -->
  - [x] research with `options.maxPages: 2` emits `web_research.options.maxPages === 2`;
  - [x] research with `options.maxResults: 5` emits `web_research.options.maxResults === 5`;
  - [x] research with invalid option emits invalid web request audit.

## B4 — Forward full options for `readPages`

- [x] P1 Update `referenceRuntime.ts` readPages branch. <!-- replaced ad-hoc maxPages check with validateRuntimeWebOptions -->
- [x] P1 Preserve:
  - [x] `maxPages`;
  - [x] `maxChars`.
- [x] P1 Tests: <!-- referenceRuntime.test.ts B4 FIX9 tests -->
  - [x] readPages with `options.maxPages: 1` preserves maxPages;
  - [x] readPages with `options.maxChars: 20000` preserves maxChars;
  - [x] readPages with invalid maxChars rejected.

---

# Part C — Parser / Canonical Options Completion

## C1 — Validate top-level and nested `maxResults`

### Problem

`maxResults` may be copied only if it is a number, meaning malformed strings can be silently dropped and invalid numeric values can slip through.

- [x] P1 In `agentBlockParser`, validate canonical `maxResults`. <!-- validateField() in canonicalizeWebRequestOptions -->
- [x] P1 Reject:
  - [x] string;
  - [x] zero;
  - [x] negative;
  - [x] non-integer;
  - [x] above cap.
- [x] P1 Valid top-level `maxResults` becomes `options.maxResults`.
- [x] P1 Valid nested `options.maxResults` remains `options.maxResults`.
- [x] P1 Conflicting top-level/nested values rejected.
- [x] P1 Tests for all cases. <!-- agentBlockParser.test.ts C1 FIX9 tests -->

## C2 — Validate top-level and nested `maxChars`

- [x] P1 In `agentBlockParser`, validate canonical `maxChars`. <!-- validateField() in canonicalizeWebRequestOptions -->
- [x] P1 Reject:
  - [x] string;
  - [x] zero unless explicitly allowed;
  - [x] negative;
  - [x] non-integer;
  - [x] above cap.
- [x] P1 Valid top-level `maxChars` becomes `options.maxChars`.
- [x] P1 Valid nested `options.maxChars` remains `options.maxChars`.
- [x] P1 Conflicting top-level/nested values rejected.
- [x] P1 Tests for all cases. <!-- agentBlockParser.test.ts C2 FIX9 tests -->

## C3 — Do not silently drop unsupported option fields

- [x] P1 If raw `options` contains unknown field, reject the request. <!-- KNOWN_WEB_OPTION_FIELDS check in canonicalizeWebRequestOptions -->
- [x] P1 If top-level unsupported limit-like field appears, reject or ignore only with explicit documented reason. <!-- top-level fields not in maxPages/maxChars/maxResults are not merged; only named fields are read -->
- [x] P1 Tests: <!-- agentBlockParser.test.ts C3 FIX9 tests -->
  - [x] `options: { unknown: true }` rejected;
  - [x] top-level unknown option-like field rejected or documented.

---

# Part D — Approved Bulk Research Payload Classification

## D1 — Sanitize options inside payload-validation block

### Problem

Approved bulk-research payloads with invalid `options` can be classified as `web.research_failed` because options sanitization occurs after `web.research_started`.

### Required behavior

Invalid options in approval payload are payload-invalid, not provider failure.

- [x] P1 In `runApprovedBulkResearch()`: <!-- src/runtime/webRunner.ts — options validated in payload try/catch -->
  - [x] handle rejection before parsing payload, as already fixed;
  - [x] parse payload;
  - [x] sanitize/validate `parsed.options`; <!-- sanitizeResearchOptions moved before url/query validation -->
  - [x] validate query/urls;
  - [x] on any payload/options validation error, audit `web.bulk_research_payload_invalid`;
  - [x] resolve effect `ok:false`;
  - [x] do not audit `web.research_started`;
  - [x] do not call provider.
- [x] P1 Tests: <!-- webRunner.test.ts D1 FIX9 block -->
  - [x] approved payload with `options.maxPages: 0` audits payload-invalid;
  - [x] approved payload with `options.maxPages: -1` audits payload-invalid;
  - [x] approved payload with `options.maxResults: 0` audits payload-invalid;
  - [x] invalid options do not audit `web.research_failed`;
  - [x] invalid options do not call provider.

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

### Option A — precise ownership ← CHOSEN

- [x] P2 `sk-ant-` tokens are handled only by the `sk-ant-` rule. <!-- redact_sk_tokens skips sk-ant- when prefix == "sk-" -->
- [x] P2 generic `sk-` rule skips tokens starting with `sk-ant-`.
- [x] P2 Tests: <!-- claw-core/src/lib.rs e1_fix9_* tests (3 new) -->
  - [x] short `sk-ant-short` is not redacted if below min length;
  - [x] long `sk-ant-123456789012` is redacted;
  - [x] normal `sk-123456789012` is redacted.

### Option B — conservative overlap ← NOT CHOSEN

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
