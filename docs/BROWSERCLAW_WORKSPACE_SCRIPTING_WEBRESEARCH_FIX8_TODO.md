# BrowserClaw Workspace/Scripting/WebResearch FIX8 TODO

## Priority Key

```text
P0 = security/correctness blocker
P1 = required for feature completeness
P2 = polish, robustness, or future hardening
```

## Phase 0 — Scope Lock and Evidence Hygiene

<!-- evidence: files added by git pull from remote -->
- [x] P0 Add `docs/BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX8_SPEC.md`.
- [x] P0 Add this file as `docs/BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX8_TODO.md`.
<!-- evidence: WORKSPACE_SCRIPTING_WEBRESEARCH_DESIGN_NOTES.md — FIX8 section appended -->
- [x] P0 Update `docs/WORKSPACE_SCRIPTING_WEBRESEARCH_DESIGN_NOTES.md` with a FIX8 section:
  - [x] `browserclaw-web` top-level limit fields must be normalized into canonical `options`.
  - [x] Invalid top-level `maxPages` must be rejected before effect emission.
  - [x] `referenceRuntime` must not validate options and then drop them.
  - [x] Web effect handlers must audit/resolve invalid option payloads instead of throwing.
  - [x] `handleReadPages()` must validate `maxPages` even when called directly.
  - [x] Rust failure redaction must avoid obvious safe-word false positives while preserving secret redaction.
<!-- evidence: memory.md updated with Phase 0 entry -->
- [x] P0 Update `memory.md` with:
  - [x] real `date -u` timestamp;
  - [x] model name;
  - [x] concise summary of FIX8 scope.
- [x] P0 Do not add broad new features in this pass.
- [x] P0 Do not check TODO boxes without evidence comments pointing to source/tests.
<!-- evidence: FIX7 B3 note added — browserclaw-web top-level maxPages was not covered in FIX7 -->
- [x] P0 Correct any FIX7 evidence comments that imply `browserclaw-web` top-level `maxPages` handling was complete.

---

# Part A — Canonical `browserclaw-web` Options

## A1 — Normalize top-level limit fields into `options`

### Problem

`browserclaw-web` request objects support top-level fields like `maxPages`, but runtime/web effects expect nested `options.maxPages`. This can silently drop limits.

Example bad flow:

```json
{
  "op": "readPages",
  "urls": ["https://a.example", "https://b.example"],
  "maxPages": 1
}
```

is accepted but emitted without `options.maxPages`.

### Required behavior

Normalize top-level fields into `options` during parse/validation.

- [ ] P1 Add helper to build canonical web request options.
- [ ] P1 Move/merge:
  - [ ] top-level `maxPages` -> `options.maxPages`;
  - [ ] top-level `maxChars` -> `options.maxChars`;
  - [ ] top-level `maxResults` -> `options.maxResults`, where applicable.
- [ ] P1 If both top-level and nested option exist:
  - [ ] either reject conflict; or
  - [ ] define deterministic precedence.
- [ ] P1 Recommended: reject conflict to avoid ambiguity.
- [ ] P1 Tests:
  - [ ] top-level `maxPages` becomes `options.maxPages`;
  - [ ] top-level `maxChars` becomes `options.maxChars`;
  - [ ] top-level `maxResults` becomes `options.maxResults`;
  - [ ] nested `options.maxPages` remains preserved;
  - [ ] conflicting top-level/nested values are rejected.

### Suggested TypeScript helper

```ts
type CanonicalWebOptions = {
  maxPages?: number;
  maxChars?: number;
  maxResults?: number;
};

function mergeOptionField(
  out: Record<string, unknown>,
  raw: Record<string, unknown>,
  field: keyof CanonicalWebOptions,
): void {
  const topLevel = raw[field];
  const nested = raw.options && typeof raw.options === 'object' && !Array.isArray(raw.options)
    ? (raw.options as Record<string, unknown>)[field]
    : undefined;

  if (topLevel !== undefined && nested !== undefined && topLevel !== nested) {
    throw new Error(`Conflicting web request option: ${field}`);
  }

  const value = nested !== undefined ? nested : topLevel;
  if (value !== undefined) {
    out[field] = value;
  }
}

function canonicalizeWebRequestOptions(raw: Record<string, unknown>): CanonicalWebOptions | undefined {
  const options: Record<string, unknown> = {};

  mergeOptionField(options, raw, 'maxPages');
  mergeOptionField(options, raw, 'maxChars');
  mergeOptionField(options, raw, 'maxResults');

  return Object.keys(options).length > 0 ? (options as CanonicalWebOptions) : undefined;
}
```

## A2 — Validate top-level and nested `maxPages`

- [ ] P1 Use `normalizeOptionalPositiveIntegerLimit()` on the canonical `maxPages`.
- [ ] P1 Reject invalid values:
  - [ ] `0`;
  - [ ] negative;
  - [ ] non-integer;
  - [ ] `NaN` where representable;
  - [ ] `Infinity` where representable;
  - [ ] string values.
- [ ] P1 Invalid request must be malformed/protocol error.
- [ ] P1 Invalid request must not emit a web effect.
- [ ] P1 Tests:
  - [ ] top-level `maxPages: 0` rejected;
  - [ ] top-level `maxPages: -1` rejected;
  - [ ] top-level `maxPages: 1.5` rejected;
  - [ ] top-level `maxPages: "2"` rejected;
  - [ ] nested `options.maxPages: 0` rejected;
  - [ ] valid top-level `maxPages: 1` accepted and propagated.

### Suggested validation shape

```ts
const options = canonicalizeWebRequestOptions(raw);

if (options?.maxPages !== undefined) {
  options.maxPages = normalizeOptionalPositiveIntegerLimit(
    options.maxPages,
    'maxPages',
    { max: MAX_BATCH_PAGE_READS },
  );
}
```

## A3 — Emit only canonical request shape

- [ ] P1 After parsing, `BrowserClawWebRequest` should contain canonical `options` and should not need top-level `maxPages` for runtime.
- [ ] P1 Update types if needed:
  - [ ] keep top-level fields only in raw parse type; or
  - [ ] deprecate top-level fields from normalized type.
- [ ] P1 Ensure `llmRunner` passes canonical request to runtime.
- [ ] P1 Tests:
  - [ ] parsed `browserclaw-web` block with top-level limits emits canonical `web_request.options`;
  - [ ] runtime receives canonical options;
  - [ ] no top-level `maxPages` is silently ignored.

---

# Part B — Reference Runtime Option Forwarding

## B1 — Forward options in `readPages`

### Problem

`referenceRuntime.ts` validates `webRequest.options.maxPages`, but the emitted `web_research` effect can omit `options`.

### Required behavior

Validated options must be included in emitted effects.

- [ ] P1 Update `readPages` branch.
- [ ] P1 Emit:
  - [ ] `mode: 'urls'`;
  - [ ] `urls: validatedUrls`;
  - [ ] `options: validatedOptions`, if present.
- [ ] P1 Tests:
  - [ ] raw `readPages` with `options.maxPages: 1` emits `web_research.options.maxPages === 1`;
  - [ ] raw `readPages` with `options.maxChars` preserves `maxChars`;
  - [ ] raw `readPages` with invalid options rejects and emits invalid request audit.

### Suggested code

```ts
const validatedOptions = validateRuntimeWebOptions(webRequest.options);

return [
  {
    type: 'web_research',
    id: proposalId,
    mode: 'urls',
    urls: validatedUrls,
    ...(validatedOptions ? { options: validatedOptions } : {}),
  },
];
```

## B2 — Forward options for all web ops

- [ ] P1 Audit and update:
  - [ ] `search`;
  - [ ] `readPage`;
  - [ ] `readPages`;
  - [ ] `research`;
  - [ ] `readCurrentTab`, if it accepts options.
- [ ] P1 Do not validate/accept options then drop them.
- [ ] P1 Tests:
  - [ ] `search` preserves `maxResults`;
  - [ ] `readPage` preserves `maxChars`;
  - [ ] `research` preserves `maxPages`/`maxResults`;
  - [ ] `readPages` preserves `maxPages`/`maxChars`.

## B3 — Shared runtime web-options validator

- [ ] P1 Add `validateRuntimeWebOptions()` or reuse existing helper.
- [ ] P1 Validate:
  - [ ] `maxPages`;
  - [ ] `maxResults`, if used;
  - [ ] `maxChars`, if used.
- [ ] P1 Unknown option fields:
  - [ ] either preserve if harmless; or
  - [ ] reject to keep schema tight.
- [ ] P1 Recommended: reject unknown fields for model-authored runtime requests.
- [ ] P1 Tests for unknown option field behavior.

---

# Part C — WebRunner Invalid Option Handling

## C1 — Catch `sanitizeResearchOptions()` failures

### Problem

`createWebEffectHandler()` may call `sanitizeResearchOptions(effect.options)` before entering a try/catch. Invalid options can throw out of the handler and skip audit/resolve.

### Required behavior

Invalid options should fail visibly and consistently.

- [ ] P1 Wrap option sanitization in try/catch.
- [ ] P1 On error:
  - [ ] audit `web.effect_payload_invalid`;
  - [ ] resolve effect as `ok:false`;
  - [ ] do not dispatch approval;
  - [ ] do not call provider.
- [ ] P1 Tests:
  - [ ] `web_research` query mode with `options.maxPages: 0` resolves failure;
  - [ ] `web_research` urls mode with `options.maxPages: -1` resolves failure;
  - [ ] invalid options do not dispatch approval card;
  - [ ] invalid options audit `web.effect_payload_invalid`.

### Suggested code

```ts
let options: ResearchOptions;

try {
  options = sanitizeResearchOptions(effect.options);
} catch (error) {
  await failInvalidWebEffect(deps, effect.id, error);
  return;
}
```

## C2 — Apply same pattern to other option sanitizers

- [ ] P1 Review handlers for:
  - [ ] `web_search`;
  - [ ] `web_page_read`;
  - [ ] `web_research`;
  - [ ] extension requests if they sanitize options.
- [ ] P1 No user/model-supplied malformed options should throw out of the handler.
- [ ] P1 Tests for each handler with invalid limit options.

---

# Part D — Extension Handler Defense-in-Depth

## D1 — `handleReadPages()` must validate `maxPages` directly

### Problem

Central validation rejects invalid `maxPages`, but direct calls to `handleReadPages()` can still treat invalid values as "read all".

### Required behavior

`handleReadPages()` must validate `maxPages` itself.

- [ ] P1 Add validation at the start of `handleReadPages()`.
- [ ] P1 Invalid direct-call `maxPages` returns structured `invalid_request`.
- [ ] P1 Do not read any page on invalid `maxPages`.
- [ ] P1 Tests:
  - [ ] direct `handleReadPages({ maxPages: 0 })` returns `invalid_request`;
  - [ ] direct `handleReadPages({ maxPages: -1 })` returns `invalid_request`;
  - [ ] direct `handleReadPages({ maxPages: 1.5 })` returns `invalid_request`;
  - [ ] direct `handleReadPages({ maxPages: "2" })` returns `invalid_request`;
  - [ ] valid direct `maxPages: 2` reads only two URLs.

### Suggested service-worker patch

```js
async function handleReadPages(message) {
  const urlsError = validateNonEmptyStringArray(message.urls, 'urls');
  if (urlsError) {
    return errorResponse('invalid_request', urlsError, message.requestId);
  }

  const maxPagesError = validateOptionalPositiveIntegerLimit(
    message.maxPages,
    'maxPages',
    READ_PAGES_MAX,
  );
  if (maxPagesError) {
    return errorResponse('invalid_request', maxPagesError, message.requestId);
  }

  const maxPages = message.maxPages;
  const effectiveUrls = effectiveUrlsForReadPages(message.urls, maxPages);

  // continue...
}
```

## D2 — Direct handler should match central validation semantics

- [ ] P1 Ensure central validation and direct handler validation use the same helper.
- [ ] P1 Ensure above-max behavior matches:
  - [ ] both reject above max; or
  - [ ] both clamp above max.
- [ ] P1 Recommended: both reject above max.
- [ ] P1 Update any older direct-handler tests that expected capping if the chosen policy is rejection.

---

# Part E — Rust Redaction Precision

## E1 — Avoid obvious safe-word false positives

### Problem

The FIX7 Rust redaction is leak-safe but may redact ordinary words containing `sk-`, such as:

```text
risk-level
task-id
ask-for-help
disk-cache
```

### Required behavior

Keep secret redaction while avoiding obvious safe-word false positives.

Choose one:

### Option A — regex parity

- [ ] P2 Use Rust `regex` crate if acceptable.
- [ ] P2 Match TypeScript semantics closely:
  - [ ] `\bsk-[A-Za-z0-9_-]{12,}\b`;
  - [ ] `\bsk-ant-[A-Za-z0-9_-]{12,}\b`;
  - [ ] `\bBearer\s+[A-Za-z0-9._-]+\b`;
  - [ ] `\bAuthorization:\s*[^,\n\r]+`.
- [ ] P2 Tests for multiple secrets and safe words.

### Option B — boundary/min-length no-dependency logic

- [ ] P2 Keep no-dependency implementation.
- [ ] P2 Only redact `sk-` / `sk-ant-` if:
  - [ ] marker is at token boundary;
  - [ ] token after prefix has at least 12 secret-like chars.
- [ ] P2 Only redact `Bearer` when it starts at token boundary.
- [ ] P2 Tests for multiple secrets and safe words.

### Required tests regardless of option

- [ ] P2 `risk-level` is not redacted.
- [ ] P2 `task-id` is not redacted.
- [ ] P2 `ask-for-help` is not redacted.
- [ ] P2 `disk-cache` is not redacted.
- [ ] P2 `sk-123456789012` is redacted.
- [ ] P2 `sk-ant-123456789012` is redacted.
- [ ] P2 two secrets in one message are both redacted.

### Suggested no-dependency helper idea

```rust
fn is_token_boundary_before(input: &str, start: usize) -> bool {
    if start == 0 {
        return true;
    }

    input[..start]
        .chars()
        .next_back()
        .map(|ch| !ch.is_ascii_alphanumeric() && ch != '_' && ch != '-')
        .unwrap_or(true)
}

fn secret_token_len_after_prefix(input: &str, start: usize) -> usize {
    input[start..]
        .chars()
        .take_while(|ch| ch.is_ascii_alphanumeric() || *ch == '_' || *ch == '-')
        .count()
}

fn should_redact_sk_token(input: &str, start: usize, prefix_len: usize) -> bool {
    is_token_boundary_before(input, start)
        && secret_token_len_after_prefix(input, start + prefix_len) >= 12
}
```

---

# Part F — Evidence and Gate

## F1 — Update review notes

- [ ] P1 Update or create `docs/WORKSPACE_SCRIPTING_WEBRESEARCH_FIX8_REVIEW_NOTES.md`.
- [ ] P1 Include:
  - [ ] canonical web options behavior;
  - [ ] option forwarding behavior;
  - [ ] invalid option audit/resolve behavior;
  - [ ] direct `handleReadPages()` validation behavior;
  - [ ] Rust redaction precision decision;
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
- [ ] P1 If Docker extension E2E cannot run, do not claim extension readiness for FIX8.

## F3 — Final acceptance checklist

FIX8 is complete only when:

- [ ] `browserclaw-web` top-level `maxPages` is validated and propagated into canonical `options`.
- [ ] Invalid top-level `maxPages` cannot silently expand or remove limits.
- [ ] `referenceRuntime` forwards validated options for all web ops that accept options.
- [ ] `createWebEffectHandler()` catches invalid option errors and resolves/audits them.
- [ ] Direct `handleReadPages()` calls reject invalid `maxPages`.
- [ ] Rust redaction avoids obvious safe-word false positives while preserving multi-secret redaction.
- [ ] Docker extension E2E result is recorded after FIX8 changes, or explicitly marked unverified.
- [ ] TODO evidence comments accurately distinguish implemented, deferred, and externally unverified items.
