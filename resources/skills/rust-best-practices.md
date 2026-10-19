---
name: Rust Best Practices
description: Rust performance, safety, and architecture guidelines for DCore (host-core). Use when writing, reviewing, or refactoring Rust code in crates/host-core — covering error handling, async, ownership, and the module conventions this codebase follows.
---

# Rust Best Practices for DCore

Guidelines for the Rust privileged host (`crates/host-core`). DCore is a long-running JSON-RPC server over stdio with SQLite persistence — correctness and resource discipline matter more than micro-optimization.

## When to Apply

- Writing new RPC handlers, DB repositories, or permission checks
- Refactoring modules under `crates/host-core/src/`
- Reviewing Rust PRs for error handling, async safety, or ownership issues

## Error Handling

- **No `unwrap()`/`expect()` on external-failure paths.** User input, I/O, DB, and network failures are normal — return `Result` with a typed error. `expect()` is only acceptable in tests or for invariants proven by construction (document the invariant).
- **Typed errors over strings.** RPC handlers map to DCore error codes (e.g. `1007 TURN_NOT_FOUND`, `1002 INVALID_PARAMS`); define an error enum per module and convert at the RPC boundary, don't format strings deep in the call stack.
- **Don't silently swallow errors.** Log with context (`tracing`) at the point where the error is handled, not where it's created.

## Async & Resources

- **Every spawned task has an owner and a shutdown path.** No fire-and-forget `tokio::spawn` without a `JoinHandle` tracked somewhere or a clear reason documented.
- **No blocking calls on the async runtime.** File I/O, SQLite (via `rusqlite` blocking API), and subprocess waits go through `spawn_blocking` or a dedicated thread pool.
- **Timeouts on everything external.** Network calls, subprocess execution, and lock acquisitions get explicit timeouts — a hung RPC handler blocks the stdio loop for all clients.

## Ownership & Data

- **Borrow, don't clone.** `&str`/`&[u8]`/`&T` in function signatures by default; `Clone` only when ownership is genuinely needed. Large payloads (turn events, up to 64KB) must never be cloned in a loop.
- **SQLite is the source of truth.** In-memory caches are read-through and invalidated on write; never let a cache and the DB disagree silently. Schema changes require a migration + version bump + test.
- **Module size discipline.** New Rust modules stay below ~700 LOC; reconsider responsibilities around ~1000 LOC (mirrors the TS architecture ratchet). The old god-modules (`db.rs`, `plugins.rs`) were split into directories — follow that pattern, don't create new ones.

## RPC Surface

- **Additive changes only by default.** New methods are fine; changing params, error codes, or the protocol version requires a cross-repo plan (DCode's `protocol/contract.json` must stay in sync, and `app.handshake` hard-rejects version mismatches).
- **Validate at the boundary.** Every RPC handler validates its params first (types, ranges, string lengths) before touching the DB or filesystem. Unknown method names and malformed JSON get proper JSON-RPC error responses, never panics.
- **Payload limits.** Turn event payloads are capped at 64KB; apply the same discipline to any new unbounded input.

## Testing

- **Unit tests for pure logic** (permission evaluation, param validation, state transitions).
- **Integration tests against a temp SQLite DB** for repository code — never against the user's real `~/.dcode/pi.sqlite`.
- `cargo test -p host-core` is the gate; run it before every PR.
