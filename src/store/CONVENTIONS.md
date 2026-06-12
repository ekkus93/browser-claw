# Redux control-plane conventions

Scope rules and naming for the Redux layer. See `BROWSERCLAW_UI_SPEC.md` for
the authoritative state-ownership boundaries.

## What belongs in Redux

Transient UI/session/run state only: active run state, provider health, model
download progress, the approval queue, selected records, and the recent audit
feed. Durable data belongs in Dexie/IndexedDB; the deterministic state machine
belongs in Rust/WASM.

**Never** put decrypted API keys or OAuth tokens in Redux (state, actions, or
listener payloads). The `secrets` slice holds metadata only — key id, label,
storage mode, locked/unlocked status — never plaintext. Decrypted secrets live
only in the in-memory SecretVault.

## Slices

One slice per domain: `app`, `runtime`, `chat`, `approvals`, `providers`,
`models`, `skills`, `memories`, `storage`, `audit`, `secrets` (metadata only).

## Action naming

- Action types are `domain/action`, produced by `createSlice` (slice `name` +
  reducer key). Keep reducer keys verb-led and past-tense for events that
  record something happened (`runtimeReady`, `onboardingCompleted`) and
  imperative for direct setters (`activeWorkspaceSet`).
- Runtime lifecycle actions live under the `runtime/` prefix and mirror the
  Rust/WASM runtime events (`runtime/runtimeReady`, `runtime/runtimeErrored`).

## Side effects

Side effects run in listener middleware (`listenerMiddleware.ts`), never in
components or reducers. Use `startAppListening` for typed listeners.
