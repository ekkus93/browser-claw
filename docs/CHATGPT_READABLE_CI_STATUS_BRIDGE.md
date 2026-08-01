# BrowserClaw ChatGPT-Readable CI Status Bridge

## Purpose

BrowserClaw publishes the latest authoritative GitHub Actions `CI` state to a persistent GitHub issue so a ChatGPT GitHub session can discover the exact workflow run, commit, jobs, steps, failures, timings, and artifacts without depending on local `gh` access.

The issue is a discovery and indexing bridge. GitHub Actions, job logs, check runs, artifacts, and release gates remain the underlying sources of truth.

## Configuration

| Setting | Value |
| --- | --- |
| Repository | `ekkus93/browser-claw` |
| Default branch | `master` |
| Monitored workflow | `CI` |
| Monitored workflow file | `.github/workflows/ci.yml` |
| Monitored branch | `master` |
| Status issue | `#1` — `CI Status: BrowserClaw CI — master` |
| Publisher workflow | `.github/workflows/publish-ci-status.yml` |
| Publisher activities | `requested`, `in_progress`, `completed` |

One issue is sufficient because BrowserClaw currently has one authoritative CI workflow and one long-lived branch.

## Authoritative CI coverage

The monitored `CI` workflow is the release-quality gate for:

- TypeScript type checking;
- lint and formatting checks;
- Vitest unit tests;
- Playwright Chromium and Firefox E2E tests;
- Rust workspace tests and Clippy with warnings denied;
- Rust/WASM and TypeScript application builds;
- Docker-based Chrome extension E2E tests;
- tagged release packaging after all required jobs succeed.

The status publisher does not alter these jobs or their pass/fail semantics.

## Security model

The publisher uses only:

```yaml
permissions:
  actions: read
  contents: read
  issues: write
```

The publisher:

- does not check out the triggering commit;
- does not execute repository code or artifacts from the triggering run;
- reads only GitHub Actions run, job, step, and artifact metadata;
- does not publish raw logs, secrets, or environment variables;
- verifies the destination issue contains its ownership marker before replacing the body;
- ignores workflow runs whose canonical `head_branch` is not `master`;
- compares both run ID and run attempt with the newest applicable run before publishing;
- uses a workflow/branch-specific concurrency group to cancel superseded publisher executions.

All workflow metadata must be treated as untrusted text. The inline publisher normalizes Markdown-facing strings and emits JSON through Python's JSON encoder.

## Published data

Issue `#1` is overwritten in place and contains:

- workflow name and numeric workflow ID;
- run ID, attempt, URL, event, status, and conclusion;
- exact `head_sha` and branch;
- creation, update, and observation timestamps;
- every returned job ID, name, status, conclusion, runner, and timing;
- every returned step number, name, status, conclusion, and timing;
- a separate list of failed or abnormal steps;
- artifact IDs, names, sizes, expiry state, and timestamps after completion;
- explicit collection-state metadata when jobs or artifacts are pending or unavailable;
- valid machine-readable JSON using schema version `1`.

Abnormal conclusions include:

```text
failure
cancelled
timed_out
action_required
startup_failure
stale
```

## Pagination and issue-size behavior

Jobs and artifacts are fetched with GitHub API pagination rather than assuming one page.

The publisher targets a maximum issue body of 60,000 UTF-8 bytes. If necessary, it compacts step details only for jobs that are not implicated in an abnormal result. It preserves:

- the human-readable summary;
- workflow and exact-SHA metadata;
- every job ID and final state;
- all abnormal jobs and steps;
- artifact metadata;
- valid JSON.

The JSON payload sets:

```json
{
  "details_compacted": true,
  "compaction_reason": "issue_body_size_limit"
}
```

when compaction occurs. If the body remains too large without discarding required failure evidence, the publisher fails instead of writing truncated or invalid JSON.

## Installation validation evidence

The bridge was exercised through real `CI` runs on `master`.

### Successful run

- Commit: `a4ad981d6db1debe4352fff567193dd5a5782600`
- Run ID: `30716133172`
- Attempt: `1`
- Final result: `completed` / `success`
- Jobs published: eight, including the skipped non-tag release job
- Problem steps: none
- Artifact API: queried successfully; the non-tag run produced zero artifacts
- State transitions observed in issue `#1`: pending, in progress, and completed

### Controlled failure run

A disposable TypeScript source file was committed to force an unambiguous failure and was removed immediately after validation.

- Probe commit: `3380161b5c30d380fb318f42d5c38e26780f1983`
- Run ID: `30716270179`
- Attempt: `1`
- Final result: `completed` / `failure`
- TypeScript job ID: `91412228152`
- Failed TypeScript step: `Run pnpm run typecheck`
- Build job ID: `91412228146`
- Failed build step: `Run pnpm run build`
- Retrieved diagnostic: `TS2322`, assigning a number to a string
- Probe-removal commit: `45c2c99c976694311b19abff38ccaa1b575604de`

The temporary failure source is not present in the repository after validation.

### Supersession test

The probe-removal run was deliberately superseded by this documentation-only commit while it was active. The publisher must keep issue `#1` pointed at the newest run and reject any late event for the superseded SHA. The final result of the newest clean commit remains the authoritative installation signoff in issue `#1`.

## Ralph Loop operating procedure

For each BrowserClaw Ralph Loop iteration:

1. Record the exact candidate commit SHA.
2. Read issue `#1`.
3. Compare `workflow.head_sha` in the JSON block with the candidate SHA.
4. Do not use the issue as evidence when the SHA differs.
5. When the run is queued or in progress, use the published run and job identifiers to follow the exact run.
6. When a job fails, fetch the log for that exact job ID.
7. Diagnose and fix the first meaningful failure rather than guessing.
8. Commit the fix and repeat.
9. Claim CI success only when issue `#1` reports `completed` / `success` for the exact candidate SHA.
10. Keep manual browser and extension acceptance evidence separate from automated CI evidence.

## Maintenance rules

- Keep issue `#1` open.
- Do not remove or alter the ownership marker.
- Update the publisher when the authoritative workflow's top-level `name:` changes.
- Create a separate issue and branch-specific publisher configuration if another long-lived branch requires simultaneous status visibility.
- Create a separate issue for any future independent authoritative workflow rather than merging unrelated statuses into issue `#1`.
- Do not add triggering-branch checkout or artifact execution to the publisher.
- Do not weaken CI gates to make the status bridge green.
