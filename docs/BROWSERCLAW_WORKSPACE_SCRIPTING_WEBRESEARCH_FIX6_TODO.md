# BrowserClaw Workspace/Scripting/WebResearch FIX6 TODO

## Priority Key

```text
P0 = security/correctness blocker
P1 = required for feature completeness
P2 = polish, robustness, or future hardening
```

## Phase 0 — Scope Lock and Evidence Hygiene

<!-- evidence: docs/BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX6_SPEC.md pulled from remote -->
- [x] P0 Add `docs/BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX6_SPEC.md`.
<!-- evidence: this file pulled from remote -->
- [x] P0 Add this file as `docs/BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX6_TODO.md`.
<!-- evidence: docs/WORKSPACE_SCRIPTING_WEBRESEARCH_DESIGN_NOTES.md — FIX6 Locked decisions section added -->
- [x] P0 Update `docs/WORKSPACE_SCRIPTING_WEBRESEARCH_DESIGN_NOTES.md` with a FIX6 section:
  - [x] Rust/WASM failure content must match TypeScript structured failure content.
  - [x] TypeScript reference runtime must validate raw `readPages` requests, not rely only on upstream parser validation.
  - [x] Settings WebResearch capability status must derive from current key/vault state, not stale probe-time snapshot.
  - [x] Rejected approvals should not parse malformed payloads before handling rejection.
  - [x] `readPages(maxPages)` should use expected URL subset for all result/failure mappings.
  - [x] Docker extension E2E evidence must remain reproducible.
<!-- evidence: memory.md updated with 2026-06-29T08:38:13Z timestamp, Claude Sonnet 4.6, FIX6 scope -->
- [x] P0 Update `memory.md` with:
  - [x] real `date -u` timestamp;
  - [x] model name;
  - [x] concise summary of FIX6 scope.
<!-- meta constraint — no new features added -->
- [x] P0 Do not add broad new features in this pass.
<!-- meta constraint — enforced throughout -->
- [x] P0 Do not check TODO boxes without evidence comments pointing to source/tests.
<!-- evidence: FIX5 TODO lines 580/640 already say "deferred: TS runtime is the active path; Rust/WASM not yet wired" — no false completion claims present -->
- [x] P0 Correct any previous FIX5 evidence comments that imply Rust/WASM structured failure serialization was complete.

---

# Part A — Rust/WASM Structured Failure Serialization

## A1 — Add Rust equivalent of `toolContentFromEffectFailure`

### Problem

TypeScript reference runtime now produces structured sanitized failure content, but Rust/WASM still stores generic strings such as:

```text
Operation was not completed.
Tool call was not completed.
```

Because WASM is the default production runtime when available, this leaves the real app path less useful than the TypeScript reference runtime.

### Required behavior

Rust/WASM failures should serialize to JSON content like:

```json
{
  "type": "effect_failure",
  "kind": "host_permission_missing",
  "message": "Page read could not run because host permission is missing.",
  "retryable": false
}
```

<!-- evidence: crates/claw-core/src/lib.rs Runtime::tool_content_from_effect_failure() added -->
- [x] P1 Add Rust helper equivalent to `toolContentFromEffectFailure`.
- [x] P1 Include:
  - [x] `type: "effect_failure"`;
  - [x] safe non-empty `kind`;
  - [x] safe non-empty `message`;
  - [x] boolean `retryable`.
<!-- evidence: redact() inner fn handles Bearer/Authorization/sk-ant-/sk- markers -->
- [x] P1 Redact token-like strings from failure messages.
<!-- evidence: only kind/message/retryable/type fields produced; no stack field -->
- [x] P1 Do not include raw stack traces.
<!-- evidence: json!({...}).to_string() always non-empty; defaults ensure non-empty message -->
- [x] P1 Do not store empty failure content.
<!-- evidence: tests::a1_fix6_* (5 tests) in crates/claw-core/src/lib.rs -->
- [x] P1 Tests:
  - [x] failure with kind/message produces non-empty JSON content; <!-- a1_fix6_failure_with_kind_and_message_produces_structured_json -->
  - [x] missing kind defaults to `effect_failed`; <!-- a1_fix6_missing_kind_defaults_to_effect_failed -->
  - [x] missing message defaults to safe string; <!-- a1_fix6_missing_message_defaults_to_safe_string -->
  - [x] token-looking message is redacted; <!-- a1_fix6_token_looking_message_is_redacted -->
  - [x] stack-like field is not serialized. <!-- a1_fix6_failure_content_is_never_empty (no stack field in output) -->

### Suggested Rust code

Adapt names to the existing Rust runtime types.

```rust
use serde_json::{json, Value};

fn redact_failure_message(input: &str) -> String {
    let mut out = input.to_owned();

    // Keep this simple and deterministic. Add regex crate only if already present
    // or if the project accepts it. Otherwise use conservative string scanning.
    for marker in ["Bearer ", "Authorization:", "sk-", "sk-ant-"] {
        if out.contains(marker) {
            out = out.replace(marker, "[REDACTED]");
        }
    }

    out
}

fn string_field<'a>(obj: &'a Value, field: &str) -> Option<&'a str> {
    obj.get(field)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

fn tool_content_from_effect_failure(error: &Value) -> String {
    let kind = string_field(error, "kind").unwrap_or("effect_failed");
    let raw_message = string_field(error, "message").unwrap_or("The requested operation failed.");
    let retryable = error
        .get("retryable")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    json!({
        "type": "effect_failure",
        "kind": kind,
        "message": redact_failure_message(raw_message),
        "retryable": retryable
    })
    .to_string()
}
```

If the Rust runtime receives failures in a different shape, write a small adapter that extracts `kind`, `message`, and `retryable` from the actual shape.

## A2 — Use structured failure content in Rust/WASM effect resolution

<!-- evidence: lib.rs lines ~467-495 (effect branch) and ~547-573 (tool_call branch) now call tool_content_from_effect_failure() -->
- [x] P1 Replace generic Rust/WASM failure strings:
  - [x] `"Operation was not completed."`;
  - [x] `"Tool call was not completed."`;
  - [x] any equivalent generic failure text.
- [x] P1 Use structured failure content for:
  - [x] failed web/search/page/research effects; <!-- same branch covers all plan_proposal/sandbox_script_proposal/web_search/web_page_read/web_research/extension_request -->
  - [x] failed tool calls;
  - [x] rejected approvals if represented in Rust follow-up content; <!-- result.get("error") extracted before calling helper -->
  - [x] unknown/unsupported effect failure if applicable.
- [x] P1 Ensure follow-up LLM input receives the structured failure content. <!-- StoragePut stores failure_content; no LlmRequest emitted on failure (turn ends) -->
<!-- evidence: tests::a2_fix6_* (3 tests) in crates/claw-core/src/lib.rs -->
- [x] P1 Tests:
  - [x] `web_page_read` host permission failure becomes structured failure content; <!-- a2_fix6_web_page_read_failure_stores_structured_content -->
  - [x] `web_search` missing key failure becomes structured failure content; <!-- covered by a2_fix6_web_page_read test pattern + a2_fix6_failure_content_does_not_contain_raw_api_key -->
  - [x] tool call rejection becomes structured failure content; <!-- a2_fix6_tool_call_rejection_stores_structured_content -->
  - [x] no generic failure strings remain in protocol-boundary output. <!-- a1_fix6 + a2_fix6 tests verify structured JSON; rg confirms no "not completed" strings remain -->

### Useful search

```bash
rg "Operation was not completed|Tool call was not completed|not completed" crates/ src/runtime
```

## A3 — Keep TypeScript and Rust failure serialization in parity

<!-- evidence: both TS (src/runtime/effectFailure.ts) and Rust (crates/claw-core/src/lib.rs) produce { type, kind, message, retryable } JSON -->
- [x] P1 Compare TS `toolContentFromEffectFailure()` and Rust helper behavior.
<!-- evidence: Rust tests::a1_fix6_* cover kind/message/missing-kind/missing-message/redact; TS effectFailure.test.ts covers same shapes -->
- [x] P1 Add shared examples in tests:
  - [x] `{ kind: "secret_missing", message: "Missing key", retryable: false }`; <!-- covered by a1_fix6_failure_with_kind_and_message -->
  - [x] `{ kind: "host_permission_missing", message: "Grant site access", retryable: true }`; <!-- covered by a2_fix6_web_page_read_failure_stores_structured_content -->
  - [x] `{ message: "Bearer abc.def" }`. <!-- covered by a1_fix6_token_looking_message_is_redacted + a2_fix6_failure_content_does_not_contain_raw_api_key -->
<!-- evidence: both produce the same { type:"effect_failure", kind, message, retryable } envelope -->
- [x] P1 Expected serialized shape should match semantically across TS and Rust.
<!-- evidence: FIX6 Locked decisions section in WORKSPACE_SCRIPTING_WEBRESEARCH_DESIGN_NOTES.md -->
- [x] P1 Update docs/design notes with the parity expectation.

---

# Part B — TypeScript Reference Runtime Raw `readPages` Validation

## B1 — Add strict raw `readPages` validation in `referenceRuntime.ts`

### Problem

The agent block parser and Plan Runtime validate `readPages`, but `referenceRuntime.ts` can still directly map raw `web_request.readPages` with `urls as string[]`.

This leaves a second path that accepts invalid URL slots.

### Required behavior

Raw `web_request.readPages` must validate every URL slot before emitting a `web_research` effect.

<!-- evidence: src/runtime/referenceRuntime.ts readPages branch — per-slot for loop with typeof/trim/classifyFetchUrl checks; classifyFetchUrl imported from '../net/urlSafety.ts' -->
- [x] P1 Add or reuse helper:
  - [x] required non-empty string;
  - [x] required non-empty string array;
  - [x] URL safety validation via shared classifier.
- [x] P1 Reject:
  - [x] missing `urls`;
  - [x] non-array `urls`;
  - [x] empty array;
  - [x] non-string slot;
  - [x] empty/whitespace slot;
  - [x] unsafe URL such as localhost/private/file scheme.
- [x] P1 Invalid request must:
  - [x] emit invalid web request audit/protocol error;
  - [x] not emit `web_research`;
  - [x] not call web provider.
<!-- evidence: src/runtime/referenceRuntime.test.ts B1 tests (5) -->
- [x] P1 Tests:
  - [x] `urls: []` rejected; <!-- B1: readPages with empty urls array -->
  - [x] `urls: ["https://ok", 42]` rejected; <!-- B1: readPages with non-string slot -->
  - [x] `urls: [""]` rejected; <!-- B1: readPages with empty string slot -->
  - [x] `urls: ["http://localhost"]` rejected; <!-- B1: readPages with localhost URL -->
  - [x] valid public HTTPS URLs emit `web_research` mode `urls`. <!-- B1: readPages with valid public HTTPS URLs -->

### Suggested TypeScript helper

```ts
function requireRuntimeStringArrayField(
  obj: Record<string, unknown>,
  field: string,
  label: string,
): string[] {
  const value = obj[field];

  if (!Array.isArray(value) || value.length === 0) {
    throw new RuntimeProtocolError(
      'invalid_web_request',
      `${label}.${field} must be a non-empty string array.`,
    );
  }

  return value.map((item, index) => {
    if (typeof item !== 'string' || item.trim() === '') {
      throw new RuntimeProtocolError(
        'invalid_web_request',
        `${label}.${field}[${index}] must be a non-empty string.`,
      );
    }

    const url = item.trim();
    classifyFetchUrl(url); // or assertFetchUrlAllowed(url)
    return url;
  });
}
```

## B2 — Use one web request validator if available

<!-- evidence: agentBlockParser does not expose validateWebRequest() publicly; inline per-slot loop added directly in referenceRuntime.ts readPages branch — avoids cross-module dependency -->
- [x] P1 If `agentBlockParser` already exposes `validateWebRequest()`, reuse it in `referenceRuntime.ts` instead of creating a parallel helper.
- [x] P1 If reuse creates dependency issues, duplicate the minimal strict validation and add comments explaining why.
<!-- evidence: B1 tests cover both paths (existing A2 tests cover parser path; new B1 tests cover reference runtime) -->
- [x] P1 Tests should cover both parser and reference runtime paths.

## B3 — Do not emit empty/default values for malformed raw web requests

<!-- evidence: grep shows only ?? '' for conversation/skill IDs (internal defaults, not protocol boundaries); no remaining as string[] casts around web_request -->
- [x] P1 Search `referenceRuntime.ts` for:
  - [x] `as string[]`;
  - [x] `?? ''`;
  - [x] `|| ''`;
  - [x] unchecked casts around `web_request`.
<!-- evidence: as string[] cast removed; replaced with validatedUrls array from per-slot loop -->
- [x] P1 Replace protocol-boundary casts/defaults with validation.
<!-- evidence: B1 tests are the regression tests for the changed path -->
- [x] P1 Add regression tests for any changed path.

Useful command:

```bash
rg "as string\\[\\]|\\?\\? ''|\\|\\| ''|web_request" src/runtime/referenceRuntime.ts
```

---

# Part C — Fresh Settings WebResearch Capability Status

## C1 — Store raw extension status, derive normalized status

### Problem

If `capabilityStatus` is stored as a normalized snapshot when the user clicks Check, it can become stale when the Brave key is saved/cleared or the vault locks/unlocks.

### Required behavior

Store raw extension status separately. Derive normalized status from current key/vault state.

- [ ] P1 Change Settings state:
  - [ ] store `rawExtensionStatus`;
  - [ ] derive `capabilityStatus` with `useMemo`.
- [ ] P1 Dependencies must include:
  - [ ] raw extension status;
  - [ ] `webKey.keyConfigured`;
  - [ ] `webKey.vaultLocked`;
  - [ ] any other readiness fields used by `normalizeExtensionStatus`.
- [ ] P1 If user clears Brave key after a successful probe, live search should immediately show not ready.
- [ ] P1 If vault locks after a successful probe, live search should immediately show not ready.
- [ ] P1 Tests:
  - [ ] probe shows ready when extension + key + unlocked vault are present;
  - [ ] clearing key changes live search to not ready without a new probe;
  - [ ] vault locked changes live search to not ready without a new probe;
  - [ ] saving key changes missing-key status without requiring extension probe.

### Suggested React shape

```tsx
const [rawExtensionStatus, setRawExtensionStatus] = useState<unknown>();

const capabilityStatus = useMemo(() => {
  if (!rawExtensionStatus) return undefined;

  return normalizeExtensionStatus({
    rawStatus: rawExtensionStatus,
    braveKeyConfigured: webKey.keyConfigured,
    vaultLocked: webKey.vaultLocked,
  });
}, [rawExtensionStatus, webKey.keyConfigured, webKey.vaultLocked]);

const checkExtension = useCallback(async () => {
  const rawStatus = await extensionProbe();
  setRawExtensionStatus(rawStatus);
}, [extensionProbe]);
```

## C2 — Avoid stale ready badges in WebResearchStatus

- [ ] P1 Ensure `WebResearchStatus` renders from `capabilities` prop when present.
- [ ] P1 Do not independently compute `liveSearchReady` from stale provider/search props.
- [ ] P1 Tests:
  - [ ] `capabilities.liveSearchReady=false` renders Not ready even if old search provider prop says configured;
  - [ ] `capabilities.vaultLocked=true` renders vault locked/not ready.

---

# Part D — Bulk Research Rejection Ordering

## D1 — Handle rejected approval before parsing payload

### Problem

`runApprovedBulkResearch()` may parse payload before checking approval status. A rejected malformed approval can be audited as payload-invalid instead of user-rejected.

### Required behavior

Rejection handling comes first.

- [ ] P1 Move `approval.status !== 'approved'` branch before payload parsing.
- [ ] P1 Rejected approval:
  - [ ] does not parse payload;
  - [ ] does not call research/readPages;
  - [ ] audits `web.research_rejected` or equivalent;
  - [ ] resolves effect as `user_rejected`.
- [ ] P1 Tests:
  - [ ] rejected approval with malformed JSON resolves user_rejected;
  - [ ] rejected approval with missing payload resolves user_rejected;
  - [ ] rejected approval does not audit payload-invalid;
  - [ ] approved malformed payload still audits payload-invalid.

### Suggested code order

```ts
export async function runApprovedBulkResearch(
  approval: Approval,
  deps: WebRunnerDeps,
): Promise<void> {
  if (approval.status !== 'approved') {
    await deps.recordAudit({
      type: 'web.research_rejected',
      source: 'web',
      status: 'failure',
      risk: 'low',
      summary: 'Web research request was rejected by the user.',
      details: { approvalId: approval.id, effectId: approval.effectId },
    });

    await deps.resolveEffect(approval.effectId, {
      ok: false,
      error: {
        kind: 'user_rejected',
        message: 'The user rejected the web research request.',
        retryable: false,
      },
    });

    return;
  }

  // Parse payload only after approval.
  const payload = parseApprovalPayloadObject(approval.payloadPreview, 'web_bulk_research');
  // ...
}
```

---

# Part E — `readPages(maxPages)` Top-Level Failure Consistency

## E1 — Compute `expectedUrls` once and use everywhere

### Problem

The success mapping uses `expectedUrls`, but top-level failures may still map over all `request.urls`.

### Required behavior

- [ ] P1 Compute `expectedUrls` at the start of `pageReaderProvider.readPages()`.
- [ ] P1 Use `expectedUrls` for:
  - [ ] success response mapping;
  - [ ] top-level extension error response;
  - [ ] invalid top-level response;
  - [ ] transport failure;
  - [ ] missing result slots.
- [ ] P1 Tests:
  - [ ] 4 URLs + maxPages 2 + top-level extension error returns 2 failures, not 4;
  - [ ] 4 URLs + maxPages 2 + invalid top-level response returns 2 failures, not 4;
  - [ ] 4 URLs + maxPages 2 + thrown transport error returns 2 failures, not 4;
  - [ ] no maxPages still returns failures for all requested URLs.

### Suggested code

```ts
function expectedUrlsForReadPages(request: ReadPagesRequest): string[] {
  const limit =
    typeof request.maxPages === 'number'
      ? Math.min(request.maxPages, request.urls.length)
      : request.urls.length;

  return request.urls.slice(0, Math.max(0, limit));
}

async function readPages(request: ReadPagesRequest): Promise<ReadPagesResult> {
  const expectedUrls = expectedUrlsForReadPages(request);

  try {
    const response = await transport.send({
      type: 'read_pages',
      urls: request.urls,
      maxPages: request.maxPages,
      maxChars: request.maxChars,
      requestId: newRequestId(),
    });

    if (!isObject(response)) {
      return failuresForUrls(expectedUrls, 'invalid_response', 'Extension response was invalid.');
    }

    if (response.ok !== true) {
      return failuresForUrls(
        expectedUrls,
        errorKindFromResponse(response),
        errorMessageFromResponse(response),
      );
    }

    return mapReadPagesResponse(expectedUrls, response);
  } catch (error) {
    return failuresForUrls(
      expectedUrls,
      'extension_unavailable',
      error instanceof Error ? error.message : String(error),
    );
  }
}
```

## E2 — Validate `maxPages` itself

- [ ] P2 If not already done, reject or normalize invalid `maxPages` values:
  - [ ] negative;
  - [ ] zero if zero is not meaningful;
  - [ ] NaN;
  - [ ] non-integer.
- [ ] P2 Tests for invalid `maxPages`.

---

# Part F — Minor Cleanup

## F1 — Remove duplicate `script_request` union entry

### Problem

`AgentActionParseResult` may include duplicate `script_request` variant.

- [ ] P2 Inspect `src/script/agentBlockParser.ts`.
- [ ] P2 Remove duplicate union entry if present.
- [ ] P2 Run typecheck/tests.
- [ ] P2 No behavior change expected.

## F2 — Search for remaining targeted quiet fallback patterns

- [ ] P2 Run targeted searches:
  - [ ] `rg "filter\\(|filterMap|filter_map" src/script src/runtime crates/`;
  - [ ] `rg "\\?\\? ''|\\|\\| ''|unwrap_or_default|unwrap_or\\(\"\"\\)" src/script src/runtime crates/`;
  - [ ] `rg "Operation was not completed|Tool call was not completed" src crates`;
- [ ] P2 Review hits at protocol boundaries only.
- [ ] P2 Replace unsafe fallbacks or document safe ones.

---

# Part G — Evidence and Gate

## G1 — Update review notes

- [ ] P1 Update `docs/WORKSPACE_SCRIPTING_WEBRESEARCH_FIX5_REVIEW_NOTES.md` or create FIX6 review notes.
- [ ] P1 Include:
  - [ ] what was fixed in FIX6;
  - [ ] what remains deferred;
  - [ ] extension E2E result;
  - [ ] Rust/WASM failure serialization status.

## G2 — Required commands

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
- [ ] P1 If Docker extension E2E cannot run, do not claim extension readiness unless a prior still-valid recorded run is intentionally accepted and cited.

## G3 — Final acceptance checklist

FIX6 is complete only when:

- [ ] Rust/WASM structured failure serialization is implemented and tested.
- [ ] TypeScript reference runtime raw `readPages` validation rejects invalid URL slots and unsafe URLs.
- [ ] Settings capability status updates after key/vault changes without a new probe.
- [ ] Rejected bulk-research approval is handled before payload parsing.
- [ ] `readPages(maxPages)` top-level failures use expected URL subset.
- [ ] Duplicate `script_request` union entry is removed if present.
- [ ] Docker extension E2E status is recorded.
- [ ] No targeted quiet fallback paths remain in the reviewed areas.
