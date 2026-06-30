# FIX11 Pre-Implementation Responses
# Spec: docs/BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX11_SPEC.md
# TODO: docs/BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX11_TODO.md

---

1. Q: **`ResearchOptions` type cleanup** — Should `site` and `format` be removed from the `ResearchOptions` TypeScript type itself in FIX11, or only rejected at the sanitizer boundary (leaving them in the type for a future feature pass to re-enable)?

   A:

2. Q: **`ERROR_KIND_MAP` behavior change for extension `invalid_request`** — When the extension returns `invalid_request` (e.g., bad URL or bad maxPages), should that now surface as `invalid_request` in `PageReadResult`? Or should only **locally-detected** invalid `maxChars` use `invalid_request`, meaning the `ERROR_KIND_MAP` entry stays as `invalid_request: 'internal_error'`?

   A:

3. Q: **`protocol.ts` validation style** — The TODO suggests a new helper function for D1/D2. The existing `parseExtensionRequest()` uses inline `return { ok: false, reason }` checks (no helper). Should I follow the existing inline style (consistent with the file), or add a helper? The inline approach is simpler and already established in the file.

   A:

4. Q: **`DEFAULT_SEARCH_RESULTS = 10` constant** — The spec suggests introducing this constant in `service-worker.js`. Should this be a new named export (for testability) or just an internal constant?

   A:

---

Fill in the `A:` lines above and share the file back (or paste your answers) when ready.
