# BrowserClaw Workspace/Scripting/WebResearch FIX13 TODO

## Priority Key

```text
P0 = security/correctness blocker
P1 = required for feature completeness
P2 = polish, robustness, or future hardening
```

## Phase 0 — Scope Lock and Evidence Hygiene

- [ ] P0 Add `docs/BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX13_SPEC.md`.
- [ ] P0 Add this file as `docs/BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX13_TODO.md`.
- [ ] P0 Update `docs/WORKSPACE_SCRIPTING_WEBRESEARCH_DESIGN_NOTES.md` with a FIX13 section:
  - [ ] central `web_search` schema validation should classify malformed `maxResults` before missing `apiKey`;
  - [ ] invalid request shape should be `invalid_request`;
  - [ ] valid request shape with missing credential should be `permission_denied`;
  - [ ] direct `handleWebSearch()` validation must remain.
- [ ] P0 Update `memory.md` with:
  - [ ] real `date -u` timestamp;
  - [ ] model name;
  - [ ] concise summary of FIX13 scope.
- [ ] P0 Do not add broad new features in this pass.
- [ ] P0 Do not implement `site` or `format` support.
- [ ] P0 Do not change search-provider behavior.
- [ ] P0 Do not check TODO boxes without evidence comments pointing to source/tests.

---

# Part A — Reorder Central `web_search` Schema Validation

## A1 — Validate `maxResults` before `apiKey`

### Problem

In `extension/chrome-web-research/service-worker.js`, `validateMessageSchema()` currently validates `apiKey` before `maxResults` in the `web_search` branch.

That means malformed `maxResults` can be masked as `permission_denied` when `apiKey` is missing.

### Required behavior

- [ ] P2 In the `web_search` branch of `validateMessageSchema()`:
  - [ ] validate `query` first;
  - [ ] validate optional `maxResults` second;
  - [ ] validate `apiKey` third.
- [ ] P2 Invalid `maxResults` must return `invalid_request`, even if `apiKey` is missing.
- [ ] P2 Missing/empty `apiKey` must return `permission_denied` only when `query` and `maxResults` are valid.
- [ ] P2 Tests:
  - [ ] missing `apiKey` + `maxResults: -1` returns `invalid_request`;
  - [ ] missing `apiKey` + `maxResults: 0` returns `invalid_request`;
  - [ ] missing `apiKey` + `maxResults: 1.5` returns `invalid_request`;
  - [ ] missing `apiKey` + `maxResults: "5"` returns `invalid_request`;
  - [ ] missing `apiKey` + `maxResults: 21` returns `invalid_request`;
  - [ ] missing `apiKey` + `maxResults: 5` returns `permission_denied`;
  - [ ] missing `apiKey` + missing `maxResults` returns `permission_denied`.

### Suggested service-worker patch

Use the existing helper names from the current file. The important part is the order:

```js
} else if (type === 'web_search') {
  if (
    typeof message.query !== 'string' ||
    message.query.trim().length === 0
  ) {
    return errorResponse(
      'invalid_request',
      'web_search requires a non-empty string query',
      id,
    );
  }

  const maxResultsError = validateOptionalMaxResults(message.maxResults);
  if (maxResultsError) {
    return errorResponse('invalid_request', maxResultsError, id);
  }

  if (
    typeof message.apiKey !== 'string' ||
    message.apiKey.trim().length === 0
  ) {
    return errorResponse(
      'permission_denied',
      'web_search requires a non-empty string apiKey',
      id,
    );
  }
}
```

Do not remove `validateOptionalMaxResults()` from `handleWebSearch()`.

---

# Part B — Regression Tests

## B1 — Add central schema validation-order tests

Add tests in the existing service-worker test file that already covers `web_search` schema/handler validation.

Prefer a focused describe block:

```ts
describe('FIX13 web_search validation order', () => {
  // tests here
});
```

### Required tests

- [ ] P2 Missing `apiKey` plus invalid `maxResults: -1` returns `invalid_request`.
- [ ] P2 Missing `apiKey` plus invalid `maxResults: 0` returns `invalid_request`.
- [ ] P2 Missing `apiKey` plus invalid `maxResults: 1.5` returns `invalid_request`.
- [ ] P2 Missing `apiKey` plus invalid `maxResults: "5"` returns `invalid_request`.
- [ ] P2 Missing `apiKey` plus invalid `maxResults: 21` returns `invalid_request`.
- [ ] P2 Missing `apiKey` plus valid `maxResults: 5` returns `permission_denied`.
- [ ] P2 Missing `apiKey` plus missing `maxResults` returns `permission_denied`.
- [ ] P2 Empty/invalid `query` still returns `invalid_request`.

### Suggested test helper shape

Adapt this to the existing test helper names:

```ts
function webSearchMessage(overrides = {}) {
  return {
    type: 'web_search',
    requestId: 'fix13-web-search',
    query: 'browser agents',
    apiKey: 'test-key',
    ...overrides,
  };
}
```

### Suggested tests

```ts
it.each([
  ['negative', -1],
  ['zero', 0],
  ['non-integer', 1.5],
  ['string', '5'],
  ['above cap', 21],
])(
  'FIX13: missing apiKey + invalid maxResults %s returns invalid_request',
  async (_label, maxResults) => {
    const response = await handle({
      type: 'web_search',
      requestId: `fix13-${_label}`,
      query: 'browser agents',
      maxResults,
    });

    expect(response.ok).toBe(false);
    expect(response.error.kind).toBe('invalid_request');
  },
);

it('FIX13: missing apiKey + valid maxResults returns permission_denied', async () => {
  const response = await handle({
    type: 'web_search',
    requestId: 'fix13-valid-max-missing-key',
    query: 'browser agents',
    maxResults: 5,
  });

  expect(response.ok).toBe(false);
  expect(response.error.kind).toBe('permission_denied');
});

it('FIX13: missing apiKey + missing maxResults returns permission_denied', async () => {
  const response = await handle({
    type: 'web_search',
    requestId: 'fix13-missing-max-missing-key',
    query: 'browser agents',
  });

  expect(response.ok).toBe(false);
  expect(response.error.kind).toBe('permission_denied');
});

it('FIX13: invalid query still returns invalid_request', async () => {
  const response = await handle({
    type: 'web_search',
    requestId: 'fix13-invalid-query',
    query: '',
    maxResults: -1,
  });

  expect(response.ok).toBe(false);
  expect(response.error.kind).toBe('invalid_request');
});
```

If the existing test API uses `validateMessageSchema()` directly instead of `handle()`, use that. The behavior should be the same.

## B2 — Confirm direct handler validation still exists

- [ ] P2 Existing direct `handleWebSearch()` invalid `maxResults` tests should remain passing.
- [ ] P2 Do not delete FIX12 tests for:
  - [ ] direct `maxResults: -1`;
  - [ ] direct `maxResults: 0`;
  - [ ] direct `maxResults: 1.5`;
  - [ ] direct `maxResults: "5"`;
  - [ ] direct `maxResults: 21`;
  - [ ] missing `maxResults` defaulting to `DEFAULT_SEARCH_RESULTS`;
  - [ ] valid `maxResults: 5`.

---

# Part C — Evidence and Gate

## C1 — Update review notes

- [ ] P1 Update or create `docs/WORKSPACE_SCRIPTING_WEBRESEARCH_FIX13_REVIEW_NOTES.md`.
- [ ] P1 Include:
  - [ ] validation-order problem;
  - [ ] exact validation order chosen;
  - [ ] regression tests added;
  - [ ] direct handler validation still present;
  - [ ] exact gate command results.

## C2 — Required commands

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
- [ ] P1 If Docker extension E2E cannot run, leave its task unchecked or explicitly mark it cannot-run. Do not imply it passed.

## C3 — Final acceptance checklist

FIX13 is complete only when:

- [ ] central `web_search` schema validation checks `maxResults` before `apiKey`.
- [ ] missing `apiKey` plus invalid `maxResults` returns `invalid_request`.
- [ ] missing `apiKey` plus valid `maxResults` returns `permission_denied`.
- [ ] missing `apiKey` plus missing `maxResults` returns `permission_denied`.
- [ ] invalid query still returns `invalid_request`.
- [ ] direct `handleWebSearch()` still validates `maxResults` defensively.
- [ ] FIX12 direct handler tests still pass.
- [ ] gate evidence is honest.
