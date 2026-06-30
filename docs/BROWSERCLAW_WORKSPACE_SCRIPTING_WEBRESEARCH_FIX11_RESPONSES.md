# FIX11 Pre-Implementation Responses
# Spec: docs/BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX11_SPEC.md
# TODO: docs/BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX11_TODO.md

---

1. Q: **`ResearchOptions` type cleanup** — Should `site` and `format` be removed from the `ResearchOptions` TypeScript type itself in FIX11, or only rejected at the sanitizer boundary (leaving them in the type for a future feature pass to re-enable)?

   A: Remove `site` and `format` from the active/sanitized `ResearchOptions` type for FIX11.

   Do not leave them in the normalized runtime/web-runner type if the sanitizer rejects them. Keeping them in `ResearchOptions` invites future accidental pass-through and makes it look like they are supported. The goal of FIX11 is to make unsupported options impossible to represent after validation.

   Preferred shape:

   ```ts
   export type ResearchOptions = {
     maxPages?: number;
     maxResults?: number;
     maxChars?: number;
   };
   ```

   If the codebase has some broader/raw type that represents untrusted model or approval payload input, that can remain `unknown` / `Record<string, unknown>` near the boundary. But the trusted post-sanitizer type should not include `site` or `format`.

   If removing these fields causes compile errors, treat those errors as useful evidence of hidden/legacy paths that were still assuming unsupported options. Update those paths to reject or remove the fields. Do not suppress the errors and do not keep dead fields just to make the compiler quiet.

   Future feature pass rule: `site` and `format` can be reintroduced only when they are implemented end-to-end in parser/runtime/webRunner/provider/extension/approval copy/tests.

---

2. Q: **`ERROR_KIND_MAP` behavior change for extension `invalid_request`** — When the extension returns `invalid_request` (e.g., bad URL or bad maxPages), should that now surface as `invalid_request` in `PageReadResult`? Or should only **locally-detected** invalid `maxChars` use `invalid_request`, meaning the `ERROR_KIND_MAP` entry stays as `invalid_request: 'internal_error'`?

   A: Extension `invalid_request` should surface as `invalid_request` in `PageReadResult`.

   Update `ERROR_KIND_MAP` so extension-side `invalid_request` does **not** become `internal_error`.

   The point of FIX11 Part C is to stop misclassifying caller/request validation failures as internal failures. That should apply consistently whether the invalid request was detected locally in `pageReaderProvider` or defensively by the extension.

   Required behavior:

   ```ts
   ERROR_KIND_MAP.invalid_request === 'invalid_request'
   ```

   Also update the page-read error kind union if needed:

   ```ts
   export type PageReadErrorKind =
     | 'invalid_request'
     | 'permission_denied'
     | 'not_found'
     | 'timeout'
     | 'network_error'
     | 'internal_error';
   ```

   Use `internal_error` only for unexpected provider/extension/runtime failures, malformed extension responses, or bugs. Do not use it for invalid caller-controlled inputs like bad URL, bad `maxPages`, or bad `maxChars`.

   Add or update tests to verify:

   ```text
   extension invalid_request -> PageReadResult.error.kind === 'invalid_request'
   local invalid maxChars -> PageReadResult.error.kind === 'invalid_request'
   unexpected/malformed extension failure -> internal_error still possible
   ```

---

3. Q: **`protocol.ts` validation style** — The TODO suggests a new helper function for D1/D2. The existing `parseExtensionRequest()` uses inline `return { ok: false, reason }` checks (no helper). Should I follow the existing inline style (consistent with the file), or add a helper? The inline approach is simpler and already established in the file.

   A: Follow the existing inline style in `protocol.ts`.

   Do not add a broad new helper just because the TODO sketch included one. The TODO snippet was illustrative, not a requirement to change local style.

   Required behavior matters more than helper shape:

   ```text
   read_page.maxChars string -> rejected
   read_page.maxChars 0 -> rejected
   read_page.maxChars negative -> rejected
   read_page.maxChars non-integer -> rejected
   read_page.maxChars above 50_000 -> rejected
   read_page.maxChars valid positive integer -> accepted

   read_pages.maxChars same behavior
   ```

   Inline style is acceptable:

   ```ts
   if (request.maxChars !== undefined) {
     if (
       typeof request.maxChars !== 'number' ||
       !Number.isFinite(request.maxChars) ||
       !Number.isInteger(request.maxChars) ||
       request.maxChars < 1 ||
       request.maxChars > DEFAULT_MAX_CHARS
     ) {
       return {
         ok: false,
         reason: 'maxChars must be a positive integer no greater than 50000.',
       };
     }
   }
   ```

   If you find yourself duplicating this exact block three or more times in the same file, a tiny private helper is okay. But keep it local to `protocol.ts`; do not create a new cross-module abstraction for this.

---

4. Q: **`DEFAULT_SEARCH_RESULTS = 10` constant** — The spec suggests introducing this constant in `service-worker.js`. Should this be a new named export (for testability) or just an internal constant?

   A: Make it an internal constant, not a named export.

   Add it near `SEARCH_MAX_RESULTS`:

   ```js
   const DEFAULT_SEARCH_RESULTS = 10;
   const SEARCH_MAX_RESULTS = 20;
   ```

   Do not export it just for tests. Tests should verify externally observable behavior:

   ```text
   missing maxResults defaults to 10
   valid maxResults: 5 uses 5
   invalid maxResults: -1 returns invalid_request
   invalid maxResults: 0 returns invalid_request
   invalid maxResults: 1.5 returns invalid_request
   invalid maxResults: "5" returns invalid_request
   above-cap maxResults returns invalid_request
   ```

   Exporting constants just for tests increases API surface and makes later internal refactors more annoying. Keep it private unless the service-worker module already has an established pattern of exporting constants.

---

# Final decisions summary

| # | Decision |
|---|---|
| 1 | Remove `site` and `format` from the active/sanitized `ResearchOptions` type in FIX11. Keep only `maxPages`, `maxResults`, and `maxChars`. |
| 2 | Map extension `invalid_request` to `PageReadResult.error.kind === 'invalid_request'`. Do not map it to `internal_error`. |
| 3 | Use the existing inline validation style in `protocol.ts`; a tiny local helper is optional only if duplication gets ugly. |
| 4 | Add `DEFAULT_SEARCH_RESULTS = 10` as an internal service-worker constant, not a named export. |
