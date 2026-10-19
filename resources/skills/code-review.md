---
name: Code Review
description: Systematic code review checklist for DCode/DCore pull requests. Use when reviewing a PR — covers correctness, the architecture boundaries in AGENTS.md, protocol compatibility, and the landing gates that must pass before merge.
---

# Code Review Checklist

A systematic pass for DCode (TypeScript/Electron) and DCore (Rust) pull requests. Review in priority order; stop at the first blocking issue.

## 1. Correctness (blocking)

- Does the change do what the PR description claims? Read the diff, not just the description.
- Are error paths handled, or only the happy path? Check: invalid input, I/O failure, timeout, cancellation, concurrent modification.
- For async code: is state re-validated after every `await`? (Stale closures over `this.sessionId`, `this.turnId`, etc.)
- Are there new `as any`, `@ts-ignore`, `unwrap()`, or `expect()` on external-failure paths?

## 2. Architecture Boundaries (blocking)

Per `AGENTS.md` §4 — the frozen process model:

- Renderer must not touch SQLite, Electron Main internals, or agent execution.
- `src/shared/` must not import main-process implementation code.
- New TS files ≤800 LOC; `src/main/index.ts` ≤1500, `app-store.ts` ≤1000 (checked by `scripts/check-architecture.mjs`).
- Plugin SDK contracts are backward-compatible by default — any break needs explicit justification.
- Cross-repo change? DCore and DCode land separately, each passing its own gates. Protocol version bumps ship together (handshake hard-rejects mismatches).

## 3. Protocol & Data Compatibility (blocking)

- New RPC methods: additive only? Params validated at the boundary? Error codes from the existing set?
- `protocol/contract.json` updated? (`npm run check:protocol` must pass.)
- Persisted format changes: migration + schema version bump + upgrade test? (SQLite is owned by DCore.)
- i18n: every user-visible string in both `en` and `zh-CN` locales?

## 4. Tests (blocking unless justified)

- New behavior has tests; bug fixes have regression tests (per `AGENTS.md` §12).
- Tests assert observable behavior, not implementation details. No mocks of internal collaborators.
- Actually run the relevant suites — don't take "tests pass" on faith for a diff you haven't run.

## 5. Scope & Hygiene (non-blocking, comment)

- One PR = one coherent purpose. Flag unrelated refactors or drive-by cleanups.
- No `git add -A`, no `Co-Authored-By` unless requested, commit message is subject + body (why, not what).
- Dead code removed? Temporary adapters or flags cleaned up?
- Docs: `docs/ARCHITECTURE.md` updated for behavior changes? `scripts/README.md` for new scripts?

## Landing Gates

A PR is mergeable only when all of these pass:

- `npm run typecheck`, `npm test`, `npm run test:unit`, `npm run lint`
- `node scripts/check-architecture.mjs`, `node scripts/check-agent-policy-sync.mjs`
- `npm run check:protocol` (when the RPC surface changed)
- DCore: `cargo test -p host-core` (in the DCore checkout)
- No merge conflicts; CI green on the PR branch (not just locally)

**Merge discipline:** verify each PR's `merged` status individually after merging — a green CI on the branch is not proof it landed (lesson from PR #23).
