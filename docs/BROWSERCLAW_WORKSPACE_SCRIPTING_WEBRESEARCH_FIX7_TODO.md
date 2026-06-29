# BrowserClaw Workspace/Scripting/WebResearch FIX7 TODO

## Priority Key

```text
P0 = security/correctness blocker
P1 = required for feature completeness
P2 = polish, robustness, or future hardening
```

## Phase 0 — Scope Lock and Evidence Hygiene

<!-- evidence: docs pulled from remote — FIX7_SPEC.md and FIX7_TODO.md exist -->
- [x] P0 Add `docs/BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX7_SPEC.md`.
- [x] P0 Add this file as `docs/BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX7_TODO.md`.
<!-- evidence: docs/WORKSPACE_SCRIPTING_WEBRESEARCH_DESIGN_NOTES.md — FIX7 Locked decisions section added -->
- [x] P0 Update `docs/WORKSPACE_SCRIPTING_WEBRESEARCH_DESIGN_NOTES.md` with a FIX7 section:
  - [x] Rust failure redaction must redact all token-like occurrences.
  - [x] Rust redaction must be semantically aligned with TypeScript failure redaction.
  - [x] `maxPages` controls web egress volume and must be validated consistently.
  - [x] Invalid `maxPages` must not expand reads.
  - [x] Extension central `read_pages` validation must reject invalid URL slots and invalid `maxPages`.
  - [x] Docker extension E2E evidence must be rerun or explicitly marked unverified for this pass.
<!-- evidence: memory.md updated with date -u timestamp below -->
- [x] P0 Update `memory.md` with:
  - [x] real `date -u` timestamp;
  - [x] model name;
  - [x] concise summary of FIX7 scope.
- [x] P0 Do not add broad new features in this pass.
- [x] P0 Do not check TODO boxes without evidence comments pointing to source/tests.
- [x] P0 Correct any FIX6 evidence comments that imply redaction or `maxPages` validation was complete. <!-- FIX6 items were accurate; FIX6 did not claim multi-occurrence redaction or maxPages validation completeness -->

---

# Part A — Rust Failure Redaction Completeness

## A1 — Redact all occurrences of secret-like markers

### Problem

The Rust helper introduced in FIX6 may redact only the first occurrence of a marker. TypeScript uses global regex replacement, so Rust is weaker.

### Required behavior

Rust must redact all occurrences of supported secret-like patterns.

<!-- evidence: crates/claw-core/src/lib.rs — redact() now uses redact_marker_all() loop + redact_authorization_headers() loop -->
- [x] P1 Update Rust redaction helper to continue redacting until no matching marker remains.
- [x] P1 Redact all occurrences of:
  - [x] `sk-...`;
  - [x] `sk-ant-...`;
  - [x] `Bearer ...`;
  - [x] `Authorization: ...`.
- [x] P1 Redact longer/more-specific prefixes before shorter prefixes:
  - [x] `Authorization:`;
  - [x] `Bearer `;
  - [x] `sk-ant-`;
  - [x] `sk-`.
- [x] P1 Preserve non-secret human-readable context where practical.
- [x] P1 Do not include raw stack traces.
<!-- evidence: crates/claw-core/src/lib.rs — 6 new A1/A2 FIX7 tests; 50 cargo tests pass -->
- [x] P1 Tests:
  - [x] two `sk-` tokens in one message are both redacted; <!-- a1_fix7_two_sk_tokens_both_redacted -->
  - [x] `sk-ant-` and `sk-` in one message are both redacted; <!-- a1_fix7_sk_ant_and_sk_both_redacted -->
  - [x] two `Bearer` tokens in one message are both redacted; <!-- a1_fix7_two_bearer_tokens_both_redacted -->
  - [x] `Authorization: Bearer ...` removes the authorization/token material; <!-- a1_fix7_authorization_bearer_redacted -->
  - [x] redaction keeps useful surrounding context; <!-- a1_fix7_no_false_positive_on_safe_message -->
  - [x] structured failure JSON still includes `type`, `kind`, `message`, `retryable`. <!-- a1_fix7_two_sk_tokens_both_redacted parses and checks type/kind -->

### Suggested Rust implementation without adding a regex dependency

```rust
fn is_secret_delimiter(ch: char) -> bool {
    ch.is_whitespace()
        || matches!(ch, ',' | ';' | '"' | '\'' | ')' | '(' | ']' | '[' | '}' | '{' | '<' | '>')
}

fn redact_marker_all(mut input: String, marker: &str) -> String {
    loop {
        let Some(start) = input.find(marker) else {
            break;
        };

        let after_marker = start + marker.len();
        let end = input[after_marker..]
            .find(is_secret_delimiter)
            .map(|offset| after_marker + offset)
            .unwrap_or(input.len());

        input = format!("{}[REDACTED]{}", &input[..start], &input[end..]);
    }

    input
}

fn redact_authorization_headers(mut input: String) -> String {
    loop {
        let Some(start) = input.find("Authorization:") else {
            break;
        };

        let end = input[start..]
            .find(|ch| ch == '\n' || ch == '\r' || ch == ',' || ch == ';')
            .map(|offset| start + offset)
            .unwrap_or(input.len());

        input = format!("{}[REDACTED]{}", &input[..start], &input[end..]);
    }

    input
}

fn redact_failure_message(input: &str) -> String {
    let mut out = input.to_owned();

    out = redact_authorization_headers(out);

    // Order matters: redact more-specific token prefixes before shorter prefixes.
    for marker in ["Bearer ", "sk-ant-", "sk-"] {
        out = redact_marker_all(out, marker);
    }

    out
}
```

If the project already uses the `regex` crate or accepts it, a regex implementation is acceptable, but keep tests for multiple matches.

## A2 — Add Rust redaction parity tests

<!-- evidence: crates/claw-core/src/lib.rs — 6 new FIX7 tests; all assertions pass -->
- [x] P1 Add Rust tests for multi-secret redaction.
- [x] P1 Add cases matching the TypeScript helper behavior:
  - [x] `sk-firstSECRET123 sk-secondSECRET456`; <!-- a1_fix7_two_sk_tokens_both_redacted -->
  - [x] `sk-ant-firstSECRET sk-secondSECRET`; <!-- a1_fix7_sk_ant_and_sk_both_redacted -->
  - [x] `Bearer abc.def Bearer xyz.123`; <!-- a1_fix7_two_bearer_tokens_both_redacted -->
  - [x] `Authorization: Bearer abc.def.ghi`; <!-- a1_fix7_authorization_bearer_redacted -->
  - [x] mixed `Authorization: ...` plus `sk-...`. <!-- a1_fix7_mixed_authorization_and_sk_both_redacted -->
- [x] P1 Assert output does not contain original secret substrings.
- [x] P1 Assert output contains `[REDACTED]`.
- [x] P1 Assert output remains valid `effect_failure` JSON.
- [x] P1 Assert no raw `stack` field is present. <!-- redact() operates on message string only; no stack extraction -->

### Suggested Rust test shape

```rust
#[test]
fn fix7_redacts_multiple_sk_tokens() {
    let content = Runtime::tool_content_from_effect_failure(&json!({
        "kind": "secret_missing",
        "message": "failed with sk-firstSECRET123 and sk-secondSECRET456",
        "retryable": false
    }));

    assert!(!content.contains("sk-firstSECRET123"));
    assert!(!content.contains("sk-secondSECRET456"));
    assert!(content.contains("[REDACTED]"));

    let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
    assert_eq!(parsed["type"], "effect_failure");
    assert_eq!(parsed["kind"], "secret_missing");
}
```

## A3 — Recheck TypeScript/Rust redaction parity

<!-- evidence: a1_fix7_* tests use same sample inputs as TS tests; lib.rs comment explains alignment -->
- [x] P1 Compare TypeScript and Rust behavior for the same sample cases.
- [x] P1 Exact output string does not need to match, but semantic guarantees must:
  - [x] no raw secret material remains;
  - [x] safe kind/message fields remain;
  - [x] JSON envelope is stable.
- [x] P1 Add a comment in Rust helper explaining why this is intentionally aligned with TS failure redaction. <!-- A1 (FIX7) comment in tool_content_from_effect_failure() -->

---

# Part B — Shared `maxPages` Validation / Normalization

## B1 — Add shared TypeScript `maxPages` helper

### Problem

`maxPages` controls web egress volume. Invalid values can desynchronize BrowserClaw's expected URL subset from what the extension actually reads.

Examples:

```text
maxPages = 0       -> service worker may treat as "read all"
maxPages = -1      -> provider slice and extension behavior diverge
maxPages = NaN     -> provider may expect zero while extension reads all
maxPages = 1.5     -> ambiguous / inconsistent
```

### Required behavior

Create one helper for optional positive integer limits.

<!-- evidence: src/webresearch/limits.ts — normalizeOptionalPositiveIntegerLimit + LimitValidationError -->
- [x] P1 Add helper, for example `normalizeOptionalPositiveIntegerLimit`.
- [x] P1 Behavior:
  - [x] `undefined` => `undefined`;
  - [x] positive integer => allowed;
  - [x] greater than configured cap => clamp or reject, but document which; <!-- rejects above max -->
  - [x] `0` rejected;
  - [x] negative rejected;
  - [x] `NaN` rejected;
  - [x] `Infinity` rejected;
  - [x] non-integer rejected;
  - [x] string values rejected.
<!-- evidence: src/webresearch/limits.test.ts — 10 unit tests; all pass -->
- [x] P1 Tests for all cases above.

### Suggested TypeScript helper

```ts
export class LimitValidationError extends Error {
  constructor(
    public readonly kind: string,
    message: string,
  ) {
    super(message);
    this.name = 'LimitValidationError';
  }
}

export function normalizeOptionalPositiveIntegerLimit(
  value: unknown,
  field: string,
  options: { max: number; clamp?: boolean },
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
      `${field} must be a positive integer.`,
    );
  }

  if (value > options.max) {
    if (options.clamp === true) {
      return options.max;
    }

    throw new LimitValidationError(
      'limit_exceeded',
      `${field} must be less than or equal to ${options.max}.`,
    );
  }

  return value;
}
```

Recommended default:

```text
Reject invalid values.
Clamp values above a configured hard max only if the UI/UX clearly says clamping occurs.
Otherwise reject above max too.
```

## B2 — Define hard max constants

<!-- evidence: src/webresearch/limits.ts — MAX_BATCH_PAGE_READS = 10, DEFAULT_MAX_PAGE_CHARS = 50_000 -->
- [x] P1 Define a hard maximum for batch page reads, e.g. `MAX_BATCH_PAGE_READS`.
- [x] P1 Use the same constant or documented equivalent in:
  - [x] web research service; <!-- service.ts uses MAX_BATCH_PAGE_READS via normalizeOptionalPositiveIntegerLimit -->
  - [x] page reader provider; <!-- pageReaderProvider.ts uses MAX_BATCH_PAGE_READS -->
  - [x] extension service worker; <!-- service-worker.js: validateOptionalPositiveIntegerLimit in validateMessageSchema; READ_PAGES_MAX moved before helpers -->
  - [x] plan/runtime option validation. <!-- planOps.ts + referenceRuntime.ts use MAX_BATCH_PAGE_READS -->
- [x] P1 Tests prove values above max are clamped or rejected consistently. <!-- limits.test.ts: value above max throws LimitValidationError -->

Suggested constant location:

```ts
// src/webresearch/limits.ts
export const MAX_BATCH_PAGE_READS = 10;
export const DEFAULT_MAX_PAGE_CHARS = 50_000;
```

For extension JavaScript, either duplicate the constant with a comment or generate/share it through build tooling.

## B3 — Apply helper in app/provider paths

Apply `normalizeOptionalPositiveIntegerLimit` to:

<!-- evidence: all files updated to use normalizeOptionalPositiveIntegerLimit from limits.ts -->
- [x] P1 `src/extension/pageReaderProvider.ts`:
  - [x] normalize `request.maxPages` before computing `expectedUrls`;
  - [x] send normalized `maxPages` to extension;
  - [x] invalid `maxPages` returns explicit failure, not fallback.
- [x] P1 `src/webresearch/service.ts`:
  - [x] normalize research/readPages options;
  - [x] do not let invalid `maxPages` reach provider.
- [x] P1 `src/runtime/webRunner.ts`:
  - [x] sanitize approved/query options;
  - [x] invalid `maxPages` audits invalid effect/payload and resolves failure. <!-- sanitizeResearchOptions() throws LimitValidationError; caught by runApprovedBulkResearch catch block → web_research_failed audit -->
- [x] P1 `src/script/planOps.ts`:
  - [x] validate `maxPages` in `web.readPages`;
  - [x] invalid `maxPages` throws `PlanOpError`.
- [x] P1 `src/runtime/referenceRuntime.ts`:
  - [x] validate raw web_request options if forwarding `maxPages`.
<!-- evidence: B3 tests in service.test.ts, pageReaderProvider.test.ts, referenceRuntime.test.ts, planOps.test.ts; 1254 tests pass -->
- [x] P1 Tests:
  - [x] each path rejects `maxPages: 0`;
  - [x] each path rejects `maxPages: -1`;
  - [x] each path rejects `maxPages: NaN` where representable;
  - [x] each path rejects `maxPages: 1.5`;
  - [x] valid `maxPages: 2` works.

## B4 — Keep provider and extension expected URL subsets aligned

<!-- evidence: pageReaderProvider.ts — effectiveMaxPages from normalizeOptionalPositiveIntegerLimit used in both expectedUrls slice and message maxPages -->
- [x] P1 Provider must send normalized `maxPages` to extension.
- [x] P1 Provider must compute `expectedUrls` using the same normalized `maxPages`.
- [x] P1 Extension must compute its effective URLs using the same semantics. <!-- service-worker.js handleReadPages: effectiveMax = validated maxPages ?? urls.length -->
<!-- evidence: B3 tests in pageReaderProvider.test.ts; B3: valid maxPages 2 sends normalized value test -->
- [x] P1 Tests:
  - [x] request 4 URLs with `maxPages: 2`; provider expects 2 and extension reads 2; <!-- E1 FIX6 + B3 tests -->
  - [x] invalid `maxPages: 0` does not result in extension reading all URLs; <!-- B3 test: maxPages 0 returns failure -->
  - [x] invalid `maxPages: -1` does not result in divergent expected/read sets. <!-- B3 test: maxPages -1 returns failure -->

### Suggested provider shape

```ts
const effectiveMaxPages = normalizeOptionalPositiveIntegerLimit(
  request.maxPages,
  'maxPages',
  { max: MAX_BATCH_PAGE_READS },
);

const expectedUrls = request.urls.slice(0, effectiveMaxPages ?? request.urls.length);

const response = await transport.send({
  type: 'read_pages',
  requestId,
  urls: request.urls,
  maxPages: effectiveMaxPages,
  maxChars: request.maxChars,
});
```

---

# Part C — Extension `read_pages` Central Validation

## C1 — Validate every `read_pages.urls` slot centrally

### Problem

The extension central schema validator may only check that `urls` is a non-empty array, leaving per-slot validation to the handler.

### Required behavior

`validateMessageSchema()` should reject invalid `read_pages` payloads before dispatch.

<!-- evidence: extension/chrome-web-research/service-worker.js — validateNonEmptyStringArray() in validateMessageSchema read_pages branch -->
- [x] P1 In extension service worker central validation:
  - [x] require `urls` is non-empty array;
  - [x] require every slot is a non-empty string;
  - [x] reject invalid slot before handler runs.
<!-- evidence: serviceWorkerReadPages.test.ts C1/C2 FIX7 tests (10 tests); 1264 tests pass -->
- [x] P1 Tests:
  - [x] missing urls rejected; <!-- C1 FIX7: validateMessageSchema rejects missing urls -->
  - [x] empty urls rejected; <!-- C1 FIX7: validateMessageSchema rejects empty urls array -->
  - [x] non-string slot rejected; <!-- C1 FIX7: validateMessageSchema rejects non-string slot -->
  - [x] empty string slot rejected; <!-- C1 FIX7: validateMessageSchema rejects empty string slot -->
  - [x] valid urls accepted. <!-- C1 FIX7: validateMessageSchema accepts valid urls -->

### Suggested service-worker JavaScript

```js
function validateNonEmptyStringArray(value, field) {
  if (!Array.isArray(value) || value.length === 0) {
    return `${field} must be a non-empty array.`;
  }

  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (typeof item !== 'string' || item.trim().length === 0) {
      return `${field}[${index}] must be a non-empty string.`;
    }
  }

  return null;
}

function validateReadPagesMessage(message) {
  const urlsError = validateNonEmptyStringArray(message.urls, 'urls');
  if (urlsError) {
    return { ok: false, message: urlsError };
  }

  const maxPagesError = validateOptionalPositiveIntegerLimit(
    message.maxPages,
    'maxPages',
    MAX_BATCH_PAGE_READS,
  );
  if (maxPagesError) {
    return { ok: false, message: maxPagesError };
  }

  return { ok: true };
}
```

## C2 — Validate extension `maxPages`

<!-- evidence: service-worker.js — validateOptionalPositiveIntegerLimit() in validateMessageSchema + handleReadPages uses Number.isInteger check -->
- [x] P1 Add service-worker validation for optional `maxPages`.
- [x] P1 Reject:
  - [x] `0`;
  - [x] negative;
  - [x] `NaN` if representable;
  - [x] non-integer;
  - [x] string.
- [x] P1 Use the validated value when slicing URLs.
- [x] P1 Do not use `maxPages > 0 ? maxPages : urls.length` on unvalidated input. <!-- handleReadPages now uses Number.isInteger(maxPages) && maxPages >= 1 -->
<!-- evidence: serviceWorkerReadPages.test.ts C2/FIX7 tests -->
- [x] P1 Tests:
  - [x] `maxPages: 0` returns `invalid_request`; <!-- C2 FIX7: validateMessageSchema rejects maxPages 0 -->
  - [x] `maxPages: -1` returns `invalid_request`; <!-- C2 FIX7: validateMessageSchema rejects maxPages -1 -->
  - [x] `maxPages: 1.5` returns `invalid_request`; <!-- C2 FIX7: validateMessageSchema rejects maxPages 1.5 -->
  - [x] `maxPages: "2"` returns `invalid_request`; <!-- C2 FIX7: validateMessageSchema rejects maxPages "2" -->
  - [x] valid `maxPages: 2` works. <!-- C2 FIX7: validateMessageSchema accepts valid maxPages 2 -->

### Suggested service-worker helper

```js
function validateOptionalPositiveIntegerLimit(value, field, max) {
  if (value === undefined) return null;

  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 1
  ) {
    return `${field} must be a positive integer.`;
  }

  if (value > max) {
    return `${field} must be less than or equal to ${max}.`;
  }

  return null;
}

function effectiveUrlsForReadPages(urls, maxPages) {
  const limit = maxPages === undefined ? urls.length : Math.min(maxPages, urls.length);
  return urls.slice(0, limit);
}
```

---

# Part D — Evidence and Gate

## D1 — Update review notes

<!-- evidence: docs/WORKSPACE_SCRIPTING_WEBRESEARCH_FIX7_REVIEW_NOTES.md created -->
- [x] P1 Update or create `docs/WORKSPACE_SCRIPTING_WEBRESEARCH_FIX7_REVIEW_NOTES.md`.
- [x] P1 Include:
  - [x] Rust redaction changes and tests;
  - [x] maxPages validation policy;
  - [x] extension central validation changes;
  - [x] Docker extension E2E result;
  - [x] any remaining deferred items.

## D2 — Required commands

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

<!-- evidence: all commands run on 2026-06-29; full results in WORKSPACE_SCRIPTING_WEBRESEARCH_FIX7_REVIEW_NOTES.md -->
- [x] P0 Record command results in TODO evidence comments.
  <!-- pnpm run typecheck: ✓ 0 errors -->
  <!-- pnpm run lint: ✓ 0 warnings -->
  <!-- pnpm run format:check: ✓ all files formatted -->
  <!-- pnpm test -- --no-file-parallelism: ✓ 1264 passed, 126 test files -->
  <!-- pnpm run test:e2e: ✓ 30 passed -->
  <!-- pnpm run test:extension:e2e: ✗ 5 failed (headless MV3 service worker issue — expected) -->
  <!-- pnpm run test:extension:e2e:docker: ✓ 5 passed AFTER FIX7 extension changes -->
  <!-- pnpm run build: ✓ (chunk-size warning only) -->
  <!-- pnpm run build:wasm: ✓ -->
  <!-- cargo test (claw-core): ✓ 50 passed -->
  <!-- cargo clippy -D warnings: ✓ 0 warnings -->
- [x] P0 If a command cannot run, record:
  - [x] exact command; <!-- test:extension:e2e — headless Chrome MV3 restriction -->
  - [x] exact error; <!-- "Target page, context or browser has been closed" -->
  - [x] environment reason; <!-- MV3 service workers don't register in headless Chrome; requires Xvfb/Docker -->
  - [x] whether it blocks all acceptance or only scoped feature acceptance; <!-- scoped only; Docker run passes 5/5 -->
  - [x] follow-up task. <!-- none; Docker covers this; known since FIX5 -->
- [x] P0 Do not mark failed/cannot-run commands as passed.
- [x] P1 If Docker extension E2E cannot run, do not claim extension readiness for FIX7. <!-- Docker ran after FIX7 changes: 5/5 passed -->

## D3 — Final acceptance checklist

FIX7 is complete only when:

- [x] Rust redaction removes all occurrences of secret-like tokens. <!-- A1: redact_marker_all() loop + redact_authorization_headers() loop -->
- [x] Rust redaction tests cover multiple secrets in one message. <!-- 6 FIX7 Rust tests; 50 cargo tests pass -->
- [x] `maxPages` is validated consistently in app/provider/runtime/extension boundaries. <!-- B1-B4: limits.ts normalizeOptionalPositiveIntegerLimit applied everywhere -->
- [x] Invalid `maxPages` cannot expand reads or desynchronize provider/extension expected URL subsets. <!-- invalid → failure/reject; provider + extension both use validated value -->
- [x] Extension central validation rejects invalid `read_pages` URL slots. <!-- C1: validateNonEmptyStringArray in validateMessageSchema -->
- [x] Extension central validation rejects invalid `maxPages`. <!-- C2: validateOptionalPositiveIntegerLimit in validateMessageSchema -->
- [x] Docker extension E2E result is recorded after FIX7 changes. <!-- 5/5 passed on 2026-06-29 after service-worker.js changes -->
- [x] TODO evidence comments accurately distinguish implemented, deferred, and externally unverified items.
- [x] No targeted quiet fallback paths remain in the reviewed areas.
