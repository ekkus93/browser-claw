# BrowserClaw Workspace/Scripting/WebResearch FIX5 TODO

## Priority Key

```text
P0 = security/correctness blocker
P1 = required for feature completeness
P2 = polish, robustness, or future hardening
```

## Phase 0 — Scope Lock and Evidence Hygiene

<!-- evidence: spec/TODO files present after git pull a8a2a4f; design notes FIX5 section added; memory.md updated with real timestamp 2026-06-29T04:46:01Z; FIX4 I3 last item corrected from [x] to [~] with gap list -->
- [x] P0 Add `docs/BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX5_SPEC.md`. <!-- present after git pull -->
- [x] P0 Add this file as `docs/BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX5_TODO.md`. <!-- present after git pull -->
- [x] P0 Update `docs/WORKSPACE_SCRIPTING_WEBRESEARCH_DESIGN_NOTES.md` with a FIX5 section:
  - [x] Plan Runtime `web.readPages` must not filter invalid URL slots. <!-- in FIX5 locked decisions -->
  - [x] Sandbox memory search must use the same snippet cap as Plan Runtime. <!-- in FIX5 locked decisions -->
  - [x] Settings UI must use capability-specific WebResearch status. <!-- in FIX5 locked decisions -->
  - [x] Extension E2E readiness requires a recorded successful read-page run or must be explicitly blocked. <!-- in FIX5 locked decisions -->
  - [x] `maxPages` must not create false missing-result failures. <!-- in FIX5 locked decisions -->
  - [x] effect failures should serialize sanitized kind/message content. <!-- in FIX5 locked decisions -->
- [x] P0 Update `memory.md` with:
  - [x] real `date -u` timestamp; <!-- 2026-06-29T04:46:01Z -->
  - [x] model name; <!-- Claude Sonnet 4.6 -->
  - [x] concise summary of FIX5 scope. <!-- memory.md entry added -->
- [x] P0 Do not add broad new features in this pass. <!-- confirmed: only closes quiet-fallback gaps -->
- [x] P0 Do not check TODO boxes without evidence comments pointing to source/tests. <!-- confirmed: all checks include evidence -->
- [x] P0 Reconcile any previous FIX4 evidence comments that overstate:
  - [x] extension readiness; <!-- FIX4 I3 last item changed to [~] with correction note -->
  - [x] sandbox memory snippet caps; <!-- FIX4 I3 correction note lists sandbox path as gap -->
  - [x] Settings UI capability status wiring; <!-- FIX4 I3 correction note lists Settings UI as gap -->
  - [x] "no remaining quiet fallback" claims. <!-- FIX4 I3 last item explicitly corrected -->

---

# Part A — Plan Runtime `web.readPages` Fail-Closed Validation

## A1 — Add strict Plan Runtime string-array validation

### Problem

`src/script/planOps.ts` still filters invalid URL slots in `web.readPages`, e.g. non-string slots are dropped instead of rejected.

Bad pattern:

```ts
const urls = Array.isArray(args.urls)
  ? args.urls.filter((u): u is string => typeof u === 'string')
  : [];
```

### Required behavior

Any invalid `urls` slot invalidates the whole plan step.

- [ ] P1 Add `requirePlanStringArrayField()`.
- [ ] P1 Reject:
  - [ ] missing `urls`;
  - [ ] non-array `urls`;
  - [ ] empty array;
  - [ ] non-string slot;
  - [ ] empty/whitespace string slot.
- [ ] P1 Throw `PlanOpError` or equivalent explicit plan failure.
- [ ] P1 Do not call `ctx.web.readPage` or `ctx.web.readPages` when validation fails.
- [ ] P1 Tests:
  - [ ] `urls: []` fails;
  - [ ] `urls: ["https://ok", 42]` fails;
  - [ ] `urls: [""]` fails;
  - [ ] valid URL array succeeds;
  - [ ] invalid slots are not silently dropped.

### Suggested TypeScript helper

```ts
function requirePlanStringArrayField(
  args: Record<string, unknown>,
  field: string,
  op: string,
): string[] {
  const value = args[field];

  if (!Array.isArray(value) || value.length === 0) {
    throw new PlanOpError(
      'invalid_args',
      `${op}.${field} must be a non-empty string array.`,
    );
  }

  return value.map((item, index) => {
    if (typeof item !== 'string' || item.trim() === '') {
      throw new PlanOpError(
        'invalid_args',
        `${op}.${field}[${index}] must be a non-empty string.`,
      );
    }
    return item.trim();
  });
}
```

## A2 — Plan Runtime `web.readPages` must use batch web API

### Problem

The live WebResearchService supports provider-level batch `readPages()`, but Plan Runtime may still loop over individual `readPage()` calls.

### Required behavior

`web.readPages` in Plan Runtime should call:

```text
ctx.web.readPages(urls, options)
```

not:

```text
for each url -> ctx.web.readPage(url)
```

- [ ] P1 Update `web.readPages` implementation in `planOps.ts`.
- [ ] P1 Call `ctx.web.readPages()` once.
- [ ] P1 Preserve provider per-slot failures.
- [ ] P1 Do not loop over `ctx.web.readPage()` unless batch API is unavailable and fallback is explicit/audited.
- [ ] P1 Tests:
  - [ ] valid `web.readPages` calls `ctx.web.readPages` once;
  - [ ] `ctx.web.readPage` is not called for batch-capable context;
  - [ ] per-slot failures are returned to the plan result;
  - [ ] all-page failure fails visibly.

### Suggested implementation sketch

```ts
case 'web.readPages': {
  const urls = requirePlanStringArrayField(args, 'urls', 'web.readPages');

  const options = {
    maxPages: typeof args.maxPages === 'number' ? args.maxPages : undefined,
    maxChars: typeof args.maxChars === 'number' ? args.maxChars : undefined,
    timeoutMs: typeof args.timeoutMs === 'number' ? args.timeoutMs : undefined,
  };

  if (typeof ctx.web.readPages !== 'function') {
    throw new PlanOpError(
      'unsupported_op',
      'web.readPages requires a batch-capable web research provider.',
    );
  }

  return ctx.web.readPages(urls, options);
}
```

## A3 — URL safety for Plan Runtime `web.readPages`

- [ ] P1 Validate each URL with the shared URL safety classifier before calling `ctx.web.readPages`.
- [ ] P1 Block localhost/private/link-local/metadata URLs.
- [ ] P1 Tests:
  - [ ] `http://localhost` rejected;
  - [ ] `http://127.0.0.1` rejected;
  - [ ] `file://...` rejected;
  - [ ] safe public HTTPS URL accepted.

---

# Part B — Sandbox Memory Snippet Cap

## B1 — Use shared automated memory shaping in sandbox `memory.search`

### Problem

Plan Runtime memory search caps snippets, but sandbox `memory.search` still returns full `m.text`.

### Required behavior

Sandbox `memory.search` must use the same automated memory result shaping as Plan Runtime.

- [ ] P1 Import/reuse shared helper:
  - [ ] `filterMemoriesForAutomatedAccess`;
  - [ ] `shapeMemoryForAutomatedAccess`;
  - [ ] or equivalent existing memory helper.
- [ ] P1 Exclude sensitive memories by default.
- [ ] P1 Cap text snippets to default 1500 chars or the shared policy default.
- [ ] P1 Do not include full memory text in audit.
- [ ] P1 Tests:
  - [ ] long non-sensitive memory is truncated;
  - [ ] short non-sensitive memory unchanged;
  - [ ] sensitive memory excluded;
  - [ ] sandbox receives shaped memory, not raw DB row.

### Suggested TypeScript patch shape

```ts
import {
  filterMemoriesForAutomatedAccess,
  shapeMemoryForAutomatedAccess,
} from '../memories/retrieveMemories';

async function sandboxMemorySearch(query: string, limit: number) {
  const rows = await db.memories
    .where('text')
    .startsWithIgnoreCase(query)
    .limit(limit)
    .toArray();

  return filterMemoriesForAutomatedAccess(rows)
    .slice(0, limit)
    .map((row) =>
      shapeMemoryForAutomatedAccess(row, {
        maxSnippetChars: 1500,
      }),
    );
}
```

If the actual search is not Dexie `startsWithIgnoreCase`, keep the existing search algorithm but apply the shaping before returning results.

## B2 — Shared helper should be the only automated memory output path

- [ ] P1 Search for automated memory paths returning raw `memory.text`.
- [ ] P1 Update:
  - [ ] Plan Runtime memory search, if not already;
  - [ ] Sandbox memory search;
  - [ ] any future script/web memory capability.
- [ ] P1 Add comments explaining:
  - [ ] sensitive memories excluded by default;
  - [ ] snippets capped for automated access;
  - [ ] full memory text requires explicit future high-risk capability.

Useful command:

```bash
rg "memory\.search|m\.text|row\.text|sensitivity" src/script src/runtime src/memories
```

---

# Part C — Live Settings WebResearch Status Wiring

## C1 — Wire `normalizeExtensionStatus()` into `SettingsScreen`

### Problem

The capability-specific status helper exists, but the live Settings screen may not actually use it.

### Required behavior

The live Settings UI must render capability-specific status, not generic connected/search-provider state.

- [ ] P1 Update `SettingsScreen.tsx` to gather:
  - [ ] raw extension status;
  - [ ] Brave key configured/missing;
  - [ ] vault locked/unlocked;
  - [ ] current configured search provider.
- [ ] P1 Call `normalizeExtensionStatus()`.
- [ ] P1 Pass normalized status into `WebResearchStatus`.
- [ ] P1 Remove or deprecate old ambiguous props if they no longer describe the state.
- [ ] P1 Tests:
  - [ ] Settings shows extension connected but live search not ready when key missing;
  - [ ] Settings shows live search not ready when vault locked;
  - [ ] Settings shows host permission flow unavailable when `permissionRequestSupported:false`;
  - [ ] Settings shows current-tab unsupported;
  - [ ] Settings shows live search ready only when extension handler + key + unlocked vault are present.

### Suggested UI wiring sketch

```tsx
const capabilityStatus = normalizeExtensionStatus({
  rawStatus: extensionStatus,
  braveKeyConfigured: webResearchKeyState.configured,
  vaultLocked: webResearchKeyState.vaultLocked,
});

<WebResearchStatus
  capabilities={capabilityStatus}
  onCheckExtension={checkExtension}
  onSaveBraveKey={saveBraveKey}
  onClearBraveKey={clearBraveKey}
/>
```

## C2 — Remove misleading host-permission copy

### Problem

The UI may say each new site asks for host permission, but v0.1 has no working BrowserClaw-driven permission request flow.

- [ ] P1 Replace misleading copy with truthful v0.1 copy.
- [ ] P1 Mention that page reads require pre-granted Chrome site access if no popup flow exists.
- [ ] P1 Do not imply current-tab read is available.
- [ ] P1 Tests for copy/status rendering.

### Suggested copy

```text
Page reads require Chrome site access for the target origin.
In v0.1, BrowserClaw cannot complete new host-permission grants from this page.
Grant site access through the extension/Chrome UI, then retry the page read.
```

If the app does not yet provide an extension UI to grant access, say so directly.

## C3 — Make sandbox product policy visible if relevant

If Settings has a runtime/script section:

- [ ] P1 Show:
  - [ ] QuickJS sandbox engine installed;
  - [ ] user-facing sandbox scripting disabled by policy, if Option B remains selected;
  - [ ] scripts still require approval if enabled later;
  - [ ] network/secrets policy.
- [ ] P1 Do not imply sandboxed scripting is currently user-live if policy blocks it.

---

# Part D — Extension E2E Readiness and Evidence

## D1 — Remove fragile service-worker test pattern

### Problem

At least one E2E test still uses direct `ctx.waitForEvent('serviceworker')`, while the helper was updated to check existing service workers first.

- [ ] P1 Add shared helper `getServiceWorker(context)`.
- [ ] P1 Use it in every extension E2E test.
- [ ] P1 No direct `context.waitForEvent('serviceworker')` calls outside the helper.
- [ ] P1 Tests/lint:
  - [ ] search confirms only helper calls waitForEvent;
  - [ ] service worker startup no longer times out when worker already exists.

### Suggested helper

```ts
import type { BrowserContext, Worker } from '@playwright/test';

export async function getServiceWorker(context: BrowserContext): Promise<Worker> {
  const existing = context.serviceWorkers()[0];
  if (existing) return existing;

  return context.waitForEvent('serviceworker', {
    timeout: 20_000,
  });
}
```

Useful check:

```bash
rg "waitForEvent\\('serviceworker'|waitForEvent\\(\"serviceworker\"" tests/extension-e2e
```

## D2 — Avoid symlinked service worker in unpacked extension fixture

### Problem

`tests/extension-e2e/test-extension/service-worker.js` may be a symlink outside the extension root. Chrome unpacked-extension loading can be fragile with symlinked files in Docker/headless contexts.

Choose one:

### Option A — load real built extension only

- [ ] P1 Delete or stop using `tests/extension-e2e/test-extension`.
- [ ] P1 Use `extension/chrome-web-research` or build output as `EXTENSION_PATH`.
- [ ] P1 Assert `manifest.json` and `service-worker.js` are real files.

### Option B — copy service worker into fixture

- [ ] P1 Replace symlink with an actual copied file during test setup.
- [ ] P1 Ensure copy happens before Playwright launches Chromium.
- [ ] P1 Assert `lstat().isSymbolicLink() === false`.

### Required tests/checks

- [ ] P1 Preflight fails if service worker path is missing.
- [ ] P1 Preflight warns/fails if service worker is symlink and policy disallows it.
- [ ] P1 Extension loads with real service worker.

### Suggested preflight enhancement

```ts
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function assertExtensionFixture(extensionDir: string): void {
  const manifestPath = join(extensionDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`Missing extension manifest: ${manifestPath}`);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const serviceWorker = manifest.background?.service_worker;
  if (typeof serviceWorker !== 'string') {
    throw new Error('Extension manifest does not define background.service_worker');
  }

  const serviceWorkerPath = join(extensionDir, serviceWorker);
  if (!existsSync(serviceWorkerPath)) {
    throw new Error(`Missing extension service worker: ${serviceWorkerPath}`);
  }

  const stat = lstatSync(serviceWorkerPath);
  if (stat.isSymbolicLink()) {
    throw new Error(
      `Extension service worker must be a real file for E2E fixture, not a symlink: ${serviceWorkerPath}`,
    );
  }
}
```

## D3 — Run and record Docker extension E2E

### Problem

Previous evidence says local `test:extension:e2e` failed and Docker is required, but Docker pass was not recorded.

- [ ] P1 Run Docker extension E2E command.
- [ ] P1 Record exact command.
- [ ] P1 Record pass/fail result.
- [ ] P1 If Docker fails, record:
  - [ ] exact error;
  - [ ] environment reason;
  - [ ] whether extension/page-reader readiness is blocked;
  - [ ] follow-up task.
- [ ] P1 Do not claim extension readiness unless successful read-page E2E passes in some recorded environment.

Suggested command shape:

```bash
pnpm run test:extension:e2e:docker
```

or explicitly:

```bash
docker build -f tests/extension-e2e/docker/Dockerfile -t browserclaw-extension-e2e .
docker run --rm --add-host devtest.internal:127.0.0.1 browserclaw-extension-e2e
```

## D4 — Extension successful read-page E2E acceptance

- [ ] P1 Ensure E2E proves:
  - [ ] extension loads;
  - [ ] service worker starts;
  - [ ] `get_status` schema matches current implementation;
  - [ ] `read_page` succeeds for fixture article;
  - [ ] extracted text contains unique article phrase;
  - [ ] extracted text excludes script/style content;
  - [ ] blocked private/localhost URL fails with structured error.
- [ ] P1 If any of these are not proven, mark extension/page-reader readiness incomplete.

---

# Part E — `readPages(maxPages)` Missing-Result Semantics

## E1 — Only expect results for URLs actually requested/read

### Problem

If `request.urls` has 4 URLs and `maxPages = 2`, the provider may read only 2 URLs. The mapper must not report URLs 3 and 4 as `missing_result` failures.

### Required behavior

Compute expected URLs as:

```ts
const expectedUrls = request.urls.slice(0, request.maxPages ?? request.urls.length);
```

- [ ] P1 Update `pageReaderProvider.readPages()` response mapping.
- [ ] P1 Missing-result failures should only be generated for `expectedUrls`.
- [ ] P1 Intentionally skipped URLs due to `maxPages` should not appear as failures.
- [ ] P1 If useful, include `skipped` count separately, but not as failure.
- [ ] P1 Tests:
  - [ ] 4 URLs + maxPages 2 + 2 results -> no missing failures for URLs 3/4;
  - [ ] 4 URLs + maxPages 2 + 1 result -> one missing failure for URL 2;
  - [ ] no maxPages + missing result -> missing failure.

### Suggested patch

```ts
const expectedUrls = request.urls.slice(
  0,
  typeof request.maxPages === 'number'
    ? Math.min(request.maxPages, request.urls.length)
    : request.urls.length,
);

return mapReadPagesResponse(expectedUrls, response);
```

Optional result metadata:

```ts
return {
  ok: pages.length > 0,
  contents: pages,
  failures,
  skipped: request.urls.length - expectedUrls.length,
};
```

---

# Part F — Consistent Invalid Web Effect Audits

## F1 — `web_page_read` invalid payload should audit `web.effect_payload_invalid`

### Problem

`web_search`/`web_research` invalid payloads audit `web.effect_payload_invalid`, but `web_page_read` invalid URL may use a different path.

### Required behavior

All malformed web effect payloads should share the same invalid-effect audit helper unless there is a strong reason not to.

- [ ] P1 Update `web_page_read` effect handling.
- [ ] P1 Missing/empty/unsafe URL:
  - [ ] does not call page reader;
  - [ ] audits `web.effect_payload_invalid`;
  - [ ] resolves effect as failure;
  - [ ] includes safe `kind`/message.
- [ ] P1 Tests:
  - [ ] missing URL audits `web.effect_payload_invalid`;
  - [ ] empty URL audits `web.effect_payload_invalid`;
  - [ ] blocked private URL audits `web.effect_payload_invalid`;
  - [ ] valid URL still proceeds.

### Suggested patch shape

```ts
try {
  const url = requireEffectString(effect, 'url', 'web_page_read');
  classifyFetchUrl(url); // or assertFetchUrlAllowed(url)
  // continue with approval/page read flow
} catch (error) {
  await failInvalidWebEffect(deps, effect.id, error);
  return;
}
```

---

# Part G — Sanitized Failure Result Serialization

## G1 — Replace generic failure content with structured sanitized failure content

### Problem

Runtime failure result content like "Operation was not completed" is safe but too opaque. The model/user cannot recover intelligently.

### Required behavior

Failures should produce non-empty structured content like:

```json
{
  "type": "effect_failure",
  "kind": "host_permission_missing",
  "message": "Page read could not run because host permission is missing."
}
```

- [ ] P1 Add TypeScript helper `toolContentFromEffectFailure()`.
- [ ] P1 Add Rust equivalent if Rust runtime serializes failure result content.
- [ ] P1 Include:
  - [ ] `type: "effect_failure"`;
  - [ ] safe `kind`;
  - [ ] safe `message`;
  - [ ] optional safe metadata such as `retryable`.
- [ ] P1 Redact secret-like strings from messages.
- [ ] P1 Do not include raw stack traces.
- [ ] P1 Tests:
  - [ ] failure with kind/message produces non-empty JSON content;
  - [ ] token-looking message is redacted;
  - [ ] missing message produces safe default;
  - [ ] no empty failure content stored.

### Suggested TypeScript code

```ts
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
```

## G2 — Use structured failure content in runtime follow-up path

- [ ] P1 Replace generic failure strings in TS runtime result handling.
- [ ] P1 Replace generic failure strings in Rust/WASM runtime result handling, if present.
- [ ] P1 Ensure the LLM follow-up receives the structured failure content.
- [ ] P1 Tests:
  - [ ] web page read host permission failure becomes structured tool content;
  - [ ] web search missing key failure becomes structured tool content;
  - [ ] sandbox policy denied becomes structured tool content;
  - [ ] no raw key or stack trace leaks.

---

# Part H — TODO / Evidence Reconciliation

## H1 — Fix overclaims from FIX4

- [ ] P1 Update FIX4/FIX5 TODO evidence comments to reflect:
  - [ ] extension E2E not accepted until recorded pass;
  - [ ] sandbox memory cap not complete until sandbox path uses shared helper;
  - [ ] Settings status not complete until live UI wiring exists;
  - [ ] no "no remaining quiet fallback" claim until targeted paths pass this TODO.
- [ ] P1 Add short note to design notes summarizing which features are accepted and which are blocked.

## H2 — Add reviewer-facing summary

- [ ] P2 Add `docs/WORKSPACE_SCRIPTING_WEBRESEARCH_FIX5_REVIEW_NOTES.md` or a section in design notes with:
  - [ ] what was fixed;
  - [ ] what remains blocked;
  - [ ] exact commands run;
  - [ ] extension readiness status.

---

# Part I — Acceptance Gate

## I1 — Required commands

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
  - [ ] whether it blocks all acceptance or only a scoped feature;
  - [ ] follow-up issue/task.
- [ ] P0 Do not mark failed/cannot-run command as passed.
- [ ] P1 `test:extension:e2e` and/or `test:extension:e2e:docker` failure blocks extension/page-reader readiness unless acceptance scope explicitly excludes those features.

## I2 — Silent fallback regression checklist

- [ ] P1 Plan Runtime `web.readPages` rejects invalid URL slots.
- [ ] P1 Plan Runtime `web.readPages` calls `ctx.web.readPages()` once.
- [ ] P1 Plan Runtime `web.readPages` does not call `ctx.web.readPage()` for batch-capable contexts.
- [ ] P1 Sandbox `memory.search` caps long memory text.
- [ ] P1 Sandbox `memory.search` excludes sensitive memories.
- [ ] P1 Settings UI renders capability-specific WebResearch status.
- [ ] P1 Settings UI does not overpromise host-permission request flow.
- [ ] P1 Extension E2E successful `read_page` has recorded pass or readiness is explicitly blocked.
- [ ] P1 `readPages(maxPages)` does not create failures for intentionally skipped URLs.
- [ ] P1 `web_page_read` invalid URL audits `web.effect_payload_invalid`.
- [ ] P1 Failure result content is structured, non-empty, and sanitized.
- [ ] P1 TODO evidence comments do not overstate completion.

## I3 — Final acceptance checklist

FIX5 is complete only when:

- [ ] all P0 items are implemented and tested;
- [ ] all P1 items are implemented and tested, or explicitly deferred with a clear feature-readiness impact;
- [ ] extension readiness is not claimed unless extension E2E read-page path passes in a recorded environment;
- [ ] previous overclaims are corrected;
- [ ] no remaining quiet fallback patterns are found in the targeted paths.
