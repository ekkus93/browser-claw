# BrowserClaw Workspace/Scripting/WebResearch FIX4 TODO

## Priority Key

```text
P0 = security/correctness blocker
P1 = required for feature completeness
P2 = polish, robustness, or future hardening
```

## Phase 0 — Scope Lock and Evidence Hygiene

<!-- evidence: spec+TODO files were pulled from remote; design notes updated; memory.md updated with real timestamp 2026-06-29T00:47:57Z -->
- [x] P0 Add `docs/BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX4_SPEC.md`. <!-- file present after git pull -->
- [x] P0 Add this file as `docs/BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX4_TODO.md`. <!-- file present after git pull -->
- [x] P0 Update `docs/WORKSPACE_SCRIPTING_WEBRESEARCH_DESIGN_NOTES.md` with a FIX4 section:
  - [x] Rust validation must reject malformed protocol data rather than filter/default it.
  - [x] Host runners must not trust runtime validation.
  - [x] `read_pages` must be genuinely live or explicitly/audited downgraded.
  - [x] Extension E2E must prove real `read_page`.
  - [x] Permission status must not overpromise.
  - [x] Sandbox product policy must be explicit.
- [x] P0 Update `memory.md` with:
  - [x] real `date -u` timestamp; <!-- 2026-06-29T00:47:57Z -->
  - [x] model name; <!-- Claude Sonnet 4.6 -->
  - [x] concise summary of FIX4 scope.
- [x] P0 Do not add broad new features in this pass.
- [x] P0 Do not check TODO boxes without evidence comments pointing to source/tests.

---

# Part A — Rust/WASM Fail-Closed Protocol Validation

## A1 — Reject invalid `readPages.urls` slots in Rust

### Problem

Rust currently validates `readPages.urls` with filtering behavior, effectively dropping invalid slots. This creates a quiet partial fallback.

Bad behavior:

```rust
arr.iter()
  .filter_map(|u| u.as_str())
  .filter(|s| !s.trim().is_empty())
  .map(str::to_string)
  .collect()
```

This silently turns:

```json
{ "op": "readPages", "urls": ["https://good.example", 42, ""] }
```

into:

```json
["https://good.example"]
```

### Required behavior

Any invalid URL slot invalidates the whole request.

- [ ] P0 Add or update Rust helper `required_string_array`.
- [ ] P0 Reject:
  - [ ] missing `urls`;
  - [ ] non-array `urls`;
  - [ ] empty array;
  - [ ] non-string slot;
  - [ ] empty/whitespace string slot.
- [ ] P0 Use this helper in `readPages` mapping.
- [ ] P0 Invalid request emits `runtime.invalid_web_request` or equivalent audit/protocol error.
- [ ] P0 Invalid request does not emit web effect.
- [ ] P0 Tests:
  - [ ] `urls: []` rejected;
  - [ ] `urls: ["https://ok", 42]` rejected;
  - [ ] `urls: [""]` rejected;
  - [ ] valid URL array accepted;
  - [ ] no invalid slots are silently dropped.

### Suggested Rust code

```rust
fn required_string_array(obj: &serde_json::Value, field: &str) -> Result<Vec<String>, RuntimeProtocolError> {
    let arr = obj
        .get(field)
        .and_then(serde_json::Value::as_array)
        .filter(|items| !items.is_empty())
        .ok_or_else(|| RuntimeProtocolError::invalid_web_request(
            format!("web_request.{field} must be a non-empty array")
        ))?;

    arr.iter()
        .enumerate()
        .map(|(idx, value)| {
            value
                .as_str()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(ToOwned::to_owned)
                .ok_or_else(|| RuntimeProtocolError::invalid_web_request(
                    format!("web_request.{field}[{idx}] must be a non-empty string")
                ))
        })
        .collect()
}
```

Usage sketch:

```rust
match op {
    "readPages" => {
        let urls = required_string_array(web_request, "urls")
            .map_err(|err| self.audit_invalid_web_request(id.clone(), err))?;

        vec![Effect::WebResearch {
            id,
            mode: "urls".to_string(),
            urls: Some(urls),
            query: None,
            options: web_request.get("options").cloned(),
        }]
    }
    // ...
}
```

## A2 — Reject missing/empty Rust `tool_call.name`

### Problem

Rust currently may default missing tool names to `""`, producing an empty-name `tool_call_proposal`.

### Required behavior

A malformed tool call must be rejected before proposal.

- [ ] P0 Require `tool_call.name` to be a non-empty trimmed string.
- [ ] P0 Reject missing/empty/whitespace name.
- [ ] P0 Emit `runtime.invalid_tool_call` or equivalent protocol audit/error.
- [ ] P0 Do not emit `tool_call_proposal` on invalid name.
- [ ] P0 Tests:
  - [ ] missing name rejected;
  - [ ] empty name rejected;
  - [ ] whitespace name rejected;
  - [ ] valid tool name still emits proposal;
  - [ ] invalid tool call does not reach host approval path.

### Suggested Rust code

```rust
fn required_tool_name(tool_call: &serde_json::Value) -> Result<String, RuntimeProtocolError> {
    tool_call
        .get("name")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| RuntimeProtocolError::invalid_tool_call(
            "tool_call.name must be a non-empty string"
        ))
}

fn effects_for_tool_call(&mut self, id: String, tool_call: serde_json::Value) -> Vec<Effect> {
    let name = match required_tool_name(&tool_call) {
        Ok(name) => name,
        Err(err) => return vec![self.audit_invalid_tool_call(id, err)],
    };

    let args = tool_call
        .get("args")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));

    vec![Effect::ToolCallProposal { id, name, args }]
}
```

## A3 — Check for other Rust `unwrap_or_default()` protocol fallbacks

- [ ] P1 Search Rust runtime/schema code for `unwrap_or_default()`, `unwrap_or("")`, `filter_map`, and similar fallback patterns.
- [ ] P1 For each protocol-boundary fallback:
  - [ ] decide whether it is safe;
  - [ ] replace with validation if it affects tool/web/script/plan/result protocol;
  - [ ] add regression test if changed.
- [ ] P1 Document any intentionally safe defaults in comments.

Useful command:

```bash
rg "unwrap_or_default|unwrap_or\\(|filter_map|as_str\\(\\).*unwrap" crates/
```

---

# Part B — Host Web Runner Fail-Closed Validation

## B1 — Remove empty-query/url fallbacks from `webRunner`

### Problem

Even if runtime validation improves, host runners must not call providers with `""` or malformed values.

Bad pattern:

```ts
const query = typeof effect.query === 'string' ? effect.query : '';
```

### Required behavior

`webRunner` validates effects before calling providers.

- [ ] P1 Add helper `requireEffectStringField`.
- [ ] P1 Add helper `requireEffectStringArrayField`.
- [ ] P1 Apply to:
  - [ ] `web_search.query`;
  - [ ] `web_page_read.url`;
  - [ ] `web_research.mode === 'query'` query;
  - [ ] `web_research.mode === 'urls'` urls.
- [ ] P1 Invalid payload:
  - [ ] does not call provider;
  - [ ] audits `web.effect_payload_invalid`;
  - [ ] resolves effect as failure.
- [ ] P1 Tests:
  - [ ] missing query does not call search;
  - [ ] empty query does not call search;
  - [ ] missing URL does not call reader;
  - [ ] invalid URL array does not call `readPages`;
  - [ ] audit contains error kind.

### Suggested TypeScript helper

```ts
class WebEffectPayloadError extends Error {
  constructor(
    public readonly kind: string,
    message: string,
  ) {
    super(message);
    this.name = 'WebEffectPayloadError';
  }
}

function requireEffectStringField(
  effect: Record<string, unknown>,
  field: string,
  label: string,
): string {
  const value = effect[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new WebEffectPayloadError(
      'web_effect_missing_field',
      `${label}.${field} must be a non-empty string.`,
    );
  }
  return value.trim();
}

function requireEffectStringArrayField(
  effect: Record<string, unknown>,
  field: string,
  label: string,
): string[] {
  const value = effect[field];

  if (!Array.isArray(value) || value.length === 0) {
    throw new WebEffectPayloadError(
      'web_effect_missing_field',
      `${label}.${field} must be a non-empty string array.`,
    );
  }

  return value.map((item, index) => {
    if (typeof item !== 'string' || item.trim() === '') {
      throw new WebEffectPayloadError(
        'web_effect_invalid_field',
        `${label}.${field}[${index}] must be a non-empty string.`,
      );
    }
    return item.trim();
  });
}
```

Suggested failure handling:

```ts
async function failInvalidWebEffect(
  deps: WebRunnerDeps,
  effectId: string,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);

  await deps.recordAudit({
    type: 'web.effect_payload_invalid',
    source: 'web',
    status: 'failure',
    risk: 'medium',
    summary: 'Web effect payload was invalid.',
    details: { effectId, message },
  });

  await deps.resolveEffect(effectId, {
    ok: false,
    error: {
      kind: 'web_effect_payload_invalid',
      message,
      retryable: false,
    },
  });
}
```

## B2 — Strict bulk research approval URL parsing

### Problem

`runApprovedBulkResearch()` may validate only that `urls` is a non-empty array, then cast it as `string[]`. It must validate every slot.

- [ ] P1 Add `requireStringArrayField()` to approval payload helpers.
- [ ] P1 Use it in bulk research approval resolver.
- [ ] P1 Validate each URL with shared URL safety policy before reading.
- [ ] P1 Invalid payload:
  - [ ] does not call research/readPages;
  - [ ] audits `web.bulk_research_payload_invalid`;
  - [ ] resolves effect as failure.
- [ ] P1 Tests:
  - [ ] malformed JSON rejected;
  - [ ] missing query and urls rejected;
  - [ ] `urls: []` rejected;
  - [ ] `urls: ["https://ok", 42]` rejected;
  - [ ] `urls: [""]` rejected;
  - [ ] blocked/private URL rejected;
  - [ ] valid URL array succeeds.

### Suggested TypeScript helper

```ts
export function requireStringArrayField(
  obj: Record<string, unknown>,
  field: string,
  label: string,
): string[] {
  const value = obj[field];

  if (!Array.isArray(value) || value.length === 0) {
    throw new ApprovalPayloadError(
      'approval_payload_missing_field',
      `${label} requires a non-empty ${field} array.`,
    );
  }

  return value.map((item, index) => {
    if (typeof item !== 'string' || item.trim() === '') {
      throw new ApprovalPayloadError(
        'approval_payload_invalid_field',
        `${label}.${field}[${index}] must be a non-empty string.`,
      );
    }
    return item.trim();
  });
}
```

Suggested resolver branch:

```ts
try {
  const payload = parseApprovalPayloadObject(approval.payloadPreview, 'web_bulk_research');

  if (Array.isArray(payload.urls)) {
    const urls = requireStringArrayField(payload, 'urls', 'web_bulk_research');
    for (const url of urls) {
      assertFetchUrlAllowed(url);
    }

    await deps.web.readPages(urls, options);
    return;
  }

  const query = requireStringField(payload, 'query', 'web_bulk_research');
  await deps.web.research(query, options);
} catch (error) {
  await failInvalidBulkResearchPayload(deps, approval, error);
}
```

---

# Part C — Live `read_pages` Service Behavior

## C1 — `WebResearchService.readPages()` must delegate to provider batch method

### Problem

The extension provider has `readPages()` that sends one `read_pages` message, but `WebResearchService.readPages()` may loop over individual `readPage()` calls. This means the live path does not use the extension batch handler.

### Required behavior

Use provider batch method if available.

- [ ] P1 If `pageReaderProvider.readPages` exists, call it.
- [ ] P1 Preserve per-slot failures.
- [ ] P1 Do not silently fall back to sequential reads.
- [ ] P1 If fallback is kept:
  - [ ] emit audit `web.read_pages_fallback_sequential`;
  - [ ] preserve failures;
  - [ ] document why fallback is needed.
- [ ] P1 Tests:
  - [ ] service calls provider `readPages()` for multiple URLs;
  - [ ] service does not call individual `readPage()` when batch method exists;
  - [ ] service preserves per-slot failures;
  - [ ] fallback path audits if used;
  - [ ] all-page failure is visible.

### Suggested TypeScript code

```ts
async function readPages(
  urls: string[],
  options: PageReadOptions = {},
): Promise<ReadPagesResult> {
  if (urls.length === 0) {
    throw new WebResearchError('invalid_request', 'readPages requires at least one URL.');
  }

  if (pageReaderProvider.readPages) {
    return pageReaderProvider.readPages({
      urls,
      maxPages: options.maxPages,
      maxChars: options.maxChars,
      timeoutMs: options.timeoutMs,
    });
  }

  await audit?.({
    type: 'web.read_pages_fallback_sequential',
    source: 'web',
    status: 'success',
    risk: 'low',
    summary: 'Provider lacks batch readPages; falling back to sequential page reads.',
    details: { requested: urls.length },
  });

  const pages: PageContent[] = [];
  const failures: PageReadFailure[] = [];

  for (const url of urls.slice(0, options.maxPages ?? urls.length)) {
    const result = await pageReaderProvider.readPage({ url, ...options });
    if (result.ok) {
      pages.push(result.content);
    } else {
      failures.push({ url, kind: result.kind, message: result.message });
    }
  }

  if (pages.length === 0 && failures.length > 0) {
    throw new WebResearchError('all_page_reads_failed', 'All pages failed to read.', {
      failures,
    });
  }

  return { ok: true, contents: pages, failures };
}
```

## C2 — `ResearchBundle` must preserve failures from batch reads

- [ ] P1 Ensure `research()` and `readPages()` include failures in returned bundle/result.
- [ ] P1 UI/audit should show partial failure count.
- [ ] P1 Tests:
  - [ ] one page success + one failure returns both;
  - [ ] all failures returns failure;
  - [ ] audit summary includes success/failure counts.

---

# Part D — Page Reader Provider Response Validation

## D1 — Reject `ok:true` empty page content

### Problem

Provider mapping may treat missing text as `''` and still return success.

### Required behavior

Successful page response must have non-empty readable content.

- [ ] P1 In `pageReaderProvider`, validate successful response:
  - [ ] `text` or `markdown` must be non-empty after trim;
  - [ ] `url`/`finalUrl` must be present enough for provenance;
  - [ ] title can be optional, but should default visibly if missing.
- [ ] P1 If invalid:
  - [ ] return `invalid_response`;
  - [ ] audit `extension.page_read_invalid_response` or equivalent;
  - [ ] do not create successful PageContent.
- [ ] P1 Tests:
  - [ ] `ok:true` with no text/markdown rejected;
  - [ ] `ok:true` with empty text rejected;
  - [ ] `ok:true` with markdown accepted;
  - [ ] invalid response does not create workspace/audit success.

### Suggested TypeScript code

```ts
function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function mapPageContentResponse(raw: unknown): PageReadResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      kind: 'invalid_response',
      message: 'Extension page read response was not an object.',
    };
  }

  const obj = raw as Record<string, unknown>;

  if (obj.ok !== true) {
    return mapPageReadError(obj);
  }

  const text = nonEmptyString(obj.text);
  const markdown = nonEmptyString(obj.markdown);

  if (!text && !markdown) {
    return {
      ok: false,
      kind: 'invalid_response',
      message: 'Extension reported success but returned no readable page content.',
    };
  }

  const url = nonEmptyString(obj.finalUrl) ?? nonEmptyString(obj.url);
  if (!url) {
    return {
      ok: false,
      kind: 'invalid_response',
      message: 'Extension page content response did not include a URL.',
    };
  }

  return {
    ok: true,
    content: {
      url,
      finalUrl: nonEmptyString(obj.finalUrl) ?? url,
      title: nonEmptyString(obj.title) ?? '(untitled)',
      text: text ?? markdown ?? '',
      markdown,
      excerpt: nonEmptyString(obj.excerpt),
      length: typeof obj.length === 'number' ? obj.length : (text ?? markdown ?? '').length,
    },
  };
}
```

## D2 — Batch response must account for every requested URL

- [ ] P1 In `readPages()` response mapping, ensure each requested URL has either:
  - [ ] success content; or
  - [ ] failure entry.
- [ ] P1 If extension returns fewer result slots than requested:
  - [ ] create failure entries for missing URLs;
  - [ ] audit invalid/partial extension response.
- [ ] P1 If extension returns success slot with empty content:
  - [ ] convert that slot to failure.
- [ ] P1 Tests:
  - [ ] fewer slots than requested creates missing-slot failure;
  - [ ] empty success slot becomes failure;
  - [ ] all requested URLs represented exactly once.

### Suggested code sketch

```ts
function mapReadPagesResponse(
  requestedUrls: string[],
  raw: unknown,
): ReadPagesResult {
  const pages: PageContent[] = [];
  const failures: PageReadFailure[] = [];

  const results = extractResultArray(raw);
  const byUrl = new Map<string, unknown>();

  for (const item of results) {
    const url = typeof item?.url === 'string' ? item.url : undefined;
    if (url) byUrl.set(url, item);
  }

  for (const url of requestedUrls) {
    const item = byUrl.get(url);
    if (!item) {
      failures.push({
        url,
        kind: 'missing_result',
        message: 'Extension did not return a result for this URL.',
      });
      continue;
    }

    const mapped = mapPageContentResponse(item);
    if (mapped.ok) {
      pages.push(mapped.content);
    } else {
      failures.push({ url, kind: mapped.kind, message: mapped.message });
    }
  }

  return { ok: pages.length > 0, contents: pages, failures };
}
```

---

# Part E — Extension E2E Repair and Success Path

## E1 — Fix E2E extension fixture/service worker

### Problem

The E2E test extension manifest references `service-worker.js`, but the fixture directory may not contain the file, causing service worker timeout.

- [ ] P1 Decide E2E strategy:
  - [ ] Preferred: load the real built extension artifact.
  - [ ] Acceptable: copy/build the real service worker into `tests/extension-e2e/test-extension/`.
- [ ] P1 Ensure manifest's background service worker path exists.
- [ ] P1 Ensure any content script/extraction files referenced by the service worker exist.
- [ ] P1 Add preflight test/assertion:
  - [ ] manifest exists;
  - [ ] service worker path exists;
  - [ ] required JS files exist.
- [ ] P1 Tests:
  - [ ] service worker starts;
  - [ ] no service worker timeout.

### Suggested preflight script

```ts
import { existsSync } from 'node:fs';
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
}
```

## E2 — Update E2E status expectations to current schema

- [ ] P1 Update `tests/extension-e2e/extension.spec.ts`.
- [ ] P1 Stop expecting legacy shape:
  - [ ] `capabilities.ping`;
  - [ ] `capabilities.getStatus`;
  - [ ] flat `readPage: true`.
- [ ] P1 Expect current nested shape:
  - [ ] `capabilities.readPage.supported`;
  - [ ] `capabilities.readPage.permissionRequestSupported`;
  - [ ] `capabilities.webSearch.supported`;
  - [ ] `capabilities.readCurrentTab.supported`.
- [ ] P1 Tests pass against real extension status.

## E3 — Add successful `read_page` E2E

- [ ] P1 Add fixture page:
  - [ ] title;
  - [ ] article content;
  - [ ] script/style content that should not appear;
  - [ ] visible text with unique phrase for assertion.
- [ ] P1 Grant/ensure host permission for fixture origin.
- [ ] P1 Send `read_page` message to extension.
- [ ] P1 Assert:
  - [ ] response `ok === true`;
  - [ ] title matches;
  - [ ] text/markdown contains unique article phrase;
  - [ ] text/markdown does not contain script/style content;
  - [ ] finalUrl/url present.
- [ ] P1 Add blocked URL E2E if not already:
  - [ ] localhost/private URL blocked;
  - [ ] blocked result is structured error.

### Suggested Playwright/Puppeteer-style test skeleton

```ts
test('read_page extracts fixture article text', async ({ context, page }) => {
  const fixtureUrl = await fixtureServer.url('/article.html');

  const extensionId = await getExtensionId(context);
  const response = await page.evaluate(
    async ({ extensionId, fixtureUrl }) => {
      return chrome.runtime.sendMessage(extensionId, {
        type: 'read_page',
        requestId: 'e2e-read-page-1',
        url: fixtureUrl,
        maxChars: 20_000,
      });
    },
    { extensionId, fixtureUrl },
  );

  expect(response.ok).toBe(true);
  expect(response.title).toContain('Fixture Article');
  expect(response.text ?? response.markdown).toContain('UNIQUE_BROWSERCLAW_ARTICLE_TEXT');
  expect(response.text ?? '').not.toContain('SHOULD_NOT_INCLUDE_SCRIPT_TEXT');
});
```

## E4 — App-level E2E or explicit deferral

- [ ] P1 Add app-level E2E:
  - [ ] BrowserClaw detects extension;
  - [ ] BrowserClaw triggers read page;
  - [ ] content reaches app;
  - [ ] workspace/audit updated.
- [ ] P1 If not feasible in this pass:
  - [ ] create a specific TODO entry;
  - [ ] do not mark extension app integration fully verified.

## E5 — Extension E2E gate policy

- [ ] P1 `pnpm run test:extension:e2e` must either pass or be documented as blocking extension readiness.
- [ ] P1 Do not write "does not block acceptance" unless the accepted scope explicitly excludes extension readiness.
- [ ] P1 If command cannot run:
  - [ ] exact error;
  - [ ] environment reason;
  - [ ] whether extension features are accepted or blocked;
  - [ ] follow-up task.

---

# Part F — Permission Flow and Status Truthfulness

## F1 — Do not overstate `permissionRequestSupported`

### Problem

A handler may exist, but Chrome may require a real extension UI/user gesture to complete permission grant.

- [ ] P1 Define exact meaning of `permissionRequestSupported`.
- [ ] P1 It should be true only if there is a tested path to complete host permission grant.
- [ ] P1 If the extension returns `permission_flow_required`, status should show:
  - [ ] permission request requires extension UI; or
  - [ ] permission flow unavailable.
- [ ] P1 Tests:
  - [ ] handler exists but cannot complete permission flow -> not "supported";
  - [ ] permission already granted -> page read ready;
  - [ ] permission missing -> permission required;
  - [ ] permission flow unavailable -> visible status.

### Suggested status model

```ts
export type HostPermissionFlowStatus =
  | 'not_needed'
  | 'already_granted'
  | 'request_supported'
  | 'requires_extension_ui'
  | 'unsupported'
  | 'unknown';

export type PageReadingCapability = {
  supported: boolean;
  hostPermission: HostPermissionFlowStatus;
  ready: boolean;
};
```

## F2 — Add real extension UI flow or mark unavailable

Choose one:

### Option A — implement real permission UI

- [ ] P1 Add extension popup/action page for pending permission requests.
- [ ] P1 BrowserClaw can open/instruct user to open extension page.
- [ ] P1 User click in extension UI calls `chrome.permissions.request`.
- [ ] P1 BrowserClaw observes granted/denied result.

### Option B — mark as not fully supported

- [ ] P1 If no popup/UI flow exists, status must not claim permission request is fully supported.
- [ ] P1 `read_page` without permission returns `host_permission_required`.
- [ ] P1 BrowserClaw displays clear manual instructions.

## F3 — `read_current_tab` status truth

- [ ] P1 If `read_current_tab` is unsupported in v0.1, status must say unsupported.
- [ ] P1 If supported:
  - [ ] ensure `activeTab` or host permission path is correct;
  - [ ] add E2E or integration test.
- [ ] P1 Do not advertise current-tab read as available unless tested.

---

# Part G — Sandbox Product Policy

## G1 — Decide and encode sandbox policy

### Problem

QuickJS sandbox exists, but if default policy disables it and no Settings path enables it, user-facing sandbox scripting is not actually live.

Choose one:

### Option A — v0.1 sandbox enabled by default

- [ ] P1 `DEFAULT_SCRIPT_POLICY.sandboxedScriptingEnabled = true`.
- [ ] P1 Sandbox always requires approval.
- [ ] P1 Network denied by default.
- [ ] P1 Secrets denied.
- [ ] P1 Settings shows sandbox enabled and approval-gated.

### Option B — v0.1 sandbox engine implemented but user-facing feature disabled

- [ ] P1 Keep disabled by default.
- [ ] P1 Settings says "Sandboxed scripting engine installed; disabled by policy."
- [ ] P1 Runtime returns `script_policy_denied`.
- [ ] P1 TODO/docs do not claim user-facing sandbox scripting is live.

- [ ] P1 Tests for chosen policy:
  - [ ] default policy behavior;
  - [ ] UI copy;
  - [ ] runtime effect behavior.

## G2 — Do not allow contradictory TODO/docs wording

- [ ] P1 Search docs/TODO for "sandbox complete", "live", "enabled", "available".
- [ ] P1 Make wording match selected policy.
- [ ] P1 Add evidence comment to this TODO with selected option.

---

# Part H — Remaining P2 Robustness

## H1 — Fix `waitForTabComplete()` race

### Problem

If a tab is already complete before the listener observes `onUpdated`, `waitForTabComplete()` can time out.

- [ ] P2 Update `waitForTabComplete(tabId, timeoutMs)`.
- [ ] P2 It should:
  - [ ] install listener;
  - [ ] call `chrome.tabs.get(tabId)`;
  - [ ] resolve immediately if already complete;
  - [ ] still handle future completion events;
  - [ ] always remove listener on resolve/reject/timeout.
- [ ] P2 Tests:
  - [ ] already-complete tab resolves;
  - [ ] future update resolves;
  - [ ] timeout rejects with `page_load_timeout`;
  - [ ] listener cleaned up on success;
  - [ ] listener cleaned up on timeout.

### Suggested service-worker code

```js
function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    let done = false;
    let timeoutId;

    const cleanup = () => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    };

    const finish = (fn, value) => {
      if (done) return;
      done = true;
      cleanup();
      fn(value);
    };

    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        finish(resolve);
      }
    };

    chrome.tabs.onUpdated.addListener(onUpdated);

    chrome.tabs.get(tabId, (tab) => {
      if (done) return;

      if (chrome.runtime.lastError) {
        finish(reject, new Error(chrome.runtime.lastError.message));
        return;
      }

      if (tab?.status === 'complete') {
        finish(resolve);
      }
    });

    timeoutId = setTimeout(() => {
      finish(reject, new Error('page_load_timeout'));
    }, timeoutMs);
  });
}
```

## H2 — Cap automated memory snippets

- [ ] P2 Add `maxSnippetChars` to automated memory search policy.
- [ ] P2 Apply to:
  - [ ] plan `memory.search`;
  - [ ] sandbox `memory.search`;
  - [ ] any shared automated memory retrieval helper.
- [ ] P2 Default max: 1,000–2,000 chars.
- [ ] P2 Tests:
  - [ ] long memory truncated;
  - [ ] short memory unchanged;
  - [ ] sensitive memory still excluded;
  - [ ] audit does not include full memory text.

### Suggested TypeScript helper

```ts
export function truncateMemorySnippet(text: string, maxChars = 1500): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}…`;
}

export function shapeMemoryForAutomatedAccess(
  row: MemoryRow,
  options: { maxSnippetChars?: number } = {},
): AutomatedMemoryResult {
  return {
    id: row.id,
    title: row.title,
    text: truncateMemorySnippet(row.text, options.maxSnippetChars ?? 1500),
    tags: row.tags,
    updatedAt: row.updatedAt,
  };
}
```

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
- [ ] P1 `test:extension:e2e` failure blocks extension/page-reader readiness unless acceptance scope explicitly excludes those features.

## I2 — Silent fallback regression checklist

- [ ] P0 Rust `readPages` rejects invalid URL slots.
- [ ] P0 Rust `tool_call` rejects missing/empty name.
- [ ] P1 `webRunner` does not call providers with empty query/url/urls.
- [ ] P1 bulk research approval rejects invalid URL arrays.
- [ ] P1 page reader provider rejects `ok:true` empty content.
- [ ] P1 `WebResearchService.readPages()` uses provider batch method when available.
- [ ] P1 extension E2E loads real service worker.
- [ ] P1 extension E2E successful `read_page` passes.
- [ ] P1 status schema in E2E matches implementation.
- [ ] P1 permission support status does not overpromise.
- [ ] P1 sandbox policy docs/UI/code agree.
- [ ] P2 `waitForTabComplete()` handles already-complete tabs.
- [ ] P2 automated memory snippets capped.

## I3 — Final acceptance checklist

FIX4 is complete only when:

- [ ] all P0 items are implemented and tested;
- [ ] all P1 items are implemented and tested, or explicitly deferred with a clear feature-readiness impact;
- [ ] open P2 items are documented honestly;
- [ ] extension readiness is not claimed unless `test:extension:e2e` successful read-page path passes;
- [ ] TODO evidence comments do not overstate completion;
- [ ] no remaining quiet fallback patterns are found in reviewed protocol boundaries.

