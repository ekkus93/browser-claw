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

- [ ] P1 Add helper, for example `normalizeOptionalPositiveIntegerLimit`.
- [ ] P1 Behavior:
  - [ ] `undefined` => `undefined`;
  - [ ] positive integer => allowed;
  - [ ] greater than configured cap => clamp or reject, but document which;
  - [ ] `0` rejected;
  - [ ] negative rejected;
  - [ ] `NaN` rejected;
  - [ ] `Infinity` rejected;
  - [ ] non-integer rejected;
  - [ ] string values rejected.
- [ ] P1 Tests for all cases above.

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

- [ ] P1 Define a hard maximum for batch page reads, e.g. `MAX_BATCH_PAGE_READS`.
- [ ] P1 Use the same constant or documented equivalent in:
  - [ ] web research service;
  - [ ] page reader provider;
  - [ ] extension service worker;
  - [ ] plan/runtime option validation.
- [ ] P1 Tests prove values above max are clamped or rejected consistently.

Suggested constant location:

```ts
// src/webresearch/limits.ts
export const MAX_BATCH_PAGE_READS = 10;
export const DEFAULT_MAX_PAGE_CHARS = 50_000;
```

For extension JavaScript, either duplicate the constant with a comment or generate/share it through build tooling.

## B3 — Apply helper in app/provider paths

Apply `normalizeOptionalPositiveIntegerLimit` to:

- [ ] P1 `src/extension/pageReaderProvider.ts`:
  - [ ] normalize `request.maxPages` before computing `expectedUrls`;
  - [ ] send normalized `maxPages` to extension;
  - [ ] invalid `maxPages` returns explicit failure, not fallback.
- [ ] P1 `src/webresearch/service.ts`:
  - [ ] normalize research/readPages options;
  - [ ] do not let invalid `maxPages` reach provider.
- [ ] P1 `src/runtime/webRunner.ts`:
  - [ ] sanitize approved/query options;
  - [ ] invalid `maxPages` audits invalid effect/payload and resolves failure.
- [ ] P1 `src/script/planOps.ts`:
  - [ ] validate `maxPages` in `web.readPages`;
  - [ ] invalid `maxPages` throws `PlanOpError`.
- [ ] P1 `src/runtime/referenceRuntime.ts`:
  - [ ] validate raw web_request options if forwarding `maxPages`.
- [ ] P1 Tests:
  - [ ] each path rejects `maxPages: 0`;
  - [ ] each path rejects `maxPages: -1`;
  - [ ] each path rejects `maxPages: NaN` where representable;
  - [ ] each path rejects `maxPages: 1.5`;
  - [ ] valid `maxPages: 2` works.

## B4 — Keep provider and extension expected URL subsets aligned

- [ ] P1 Provider must send normalized `maxPages` to extension.
- [ ] P1 Provider must compute `expectedUrls` using the same normalized `maxPages`.
- [ ] P1 Extension must compute its effective URLs using the same semantics.
- [ ] P1 Tests:
  - [ ] request 4 URLs with `maxPages: 2`; provider expects 2 and extension reads 2;
  - [ ] invalid `maxPages: 0` does not result in extension reading all URLs;
  - [ ] invalid `maxPages: -1` does not result in divergent expected/read sets.

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

- [ ] P1 In extension service worker central validation:
  - [ ] require `urls` is non-empty array;
  - [ ] require every slot is a non-empty string;
  - [ ] reject invalid slot before handler runs.
- [ ] P1 Tests:
  - [ ] missing urls rejected;
  - [ ] empty urls rejected;
  - [ ] non-string slot rejected;
  - [ ] empty string slot rejected;
  - [ ] valid urls accepted.

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

- [ ] P1 Add service-worker validation for optional `maxPages`.
- [ ] P1 Reject:
  - [ ] `0`;
  - [ ] negative;
  - [ ] `NaN` if representable;
  - [ ] non-integer;
  - [ ] string.
- [ ] P1 Use the validated value when slicing URLs.
- [ ] P1 Do not use `maxPages > 0 ? maxPages : urls.length` on unvalidated input.
- [ ] P1 Tests:
  - [ ] `maxPages: 0` returns `invalid_request`;
  - [ ] `maxPages: -1` returns `invalid_request`;
  - [ ] `maxPages: 1.5` returns `invalid_request`;
  - [ ] `maxPages: "2"` returns `invalid_request`;
  - [ ] valid `maxPages: 2` works.

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

- [ ] P1 Update or create `docs/WORKSPACE_SCRIPTING_WEBRESEARCH_FIX7_REVIEW_NOTES.md`.
- [ ] P1 Include:
  - [ ] Rust redaction changes and tests;
  - [ ] maxPages validation policy;
  - [ ] extension central validation changes;
  - [ ] Docker extension E2E result;
  - [ ] any remaining deferred items.

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

- [ ] P0 Record command results in TODO evidence comments.
- [ ] P0 If a command cannot run, record:
  - [ ] exact command;
  - [ ] exact error;
  - [ ] environment reason;
  - [ ] whether it blocks all acceptance or only scoped feature acceptance;
  - [ ] follow-up task.
- [ ] P0 Do not mark failed/cannot-run commands as passed.
- [ ] P1 If Docker extension E2E cannot run, do not claim extension readiness for FIX7.

## D3 — Final acceptance checklist

FIX7 is complete only when:

- [ ] Rust redaction removes all occurrences of secret-like tokens.
- [ ] Rust redaction tests cover multiple secrets in one message.
- [ ] `maxPages` is validated consistently in app/provider/runtime/extension boundaries.
- [ ] Invalid `maxPages` cannot expand reads or desynchronize provider/extension expected URL subsets.
- [ ] Extension central validation rejects invalid `read_pages` URL slots.
- [ ] Extension central validation rejects invalid `maxPages`.
- [ ] Docker extension E2E result is recorded after FIX7 changes.
- [ ] TODO evidence comments accurately distinguish implemented, deferred, and externally unverified items.
- [ ] No targeted quiet fallback paths remain in the reviewed areas.
