---
name: Debugging
description: Systematic debugging workflow for DCode/DCore. Use when investigating a bug, test failure, CI issue, or unexpected behavior — covers reproduction, bisection, hypothesis testing, and the specific tooling for the Electron main / renderer / Rust host split.
---

# Systematic Debugging

A disciplined workflow for finding root causes in DCode (TypeScript/Electron) and DCore (Rust). The goal is to replace guessing with evidence.

## 1. Reproduce First

- **Get a minimal repro** before touching code. A failing test, a script, or exact UI steps.
- **Is it deterministic?** Run 3 times. Flaky failures point to races, timeouts, or shared state — not logic bugs.
- **Bisect the change.** `git bisect` or manual binary search through recent commits. The DCode/DCore history is linear enough for this to work well.

## 2. Localize the Layer

DCode's process model tells you where to look:

| Symptom | Check first |
| ------- | ----------- |
| UI doesn't update | Renderer: Pinia store (`app-store.ts`), `ipcRenderer.invoke` boundary, `structuredClone` limits |
| IPC call fails | Preload bridge, `src/main/ipc/` handlers, payload serialization |
| Agent misbehaves | `src/agent/runtime/runtime.ts` event handler, tool definitions, provider stream |
| Data wrong after restart | DCore SQLite: schema version, migration, repository query |
| Protocol error (10xx) | `protocol/contract.json` vs DCore's `rpc/mod.rs`; version mismatch = 1011 |

## 3. Instrument, Don't Guess

- **Logs over breakpoints** for async flows. `process.stderr.write` in the sidecar, `tracing` in Rust, devtools console in renderer.
- **Add a failing test first** (per AGENTS.md §12). If you can't write one, you don't understand the bug yet.
- **Check the obvious.** Recent lessons: a CI `token:` line missing `${{}}` (literal string as secret), a regex `[a-z]` silently dropping camelCase methods, a `tools` variable computed but never assigned. The bug is usually dumber than you think.

## 4. Hypothesis Testing

1. State the hypothesis in one sentence: "X fails because Y."
2. Design the cheapest test that would disprove it.
3. Run it. If disproved, write down what you learned and form the next hypothesis.
4. **One variable at a time.** Don't change the code and the test and the config simultaneously.

## 5. Common Traps in This Codebase

- **Stale async state.** Never assume state is unchanged across an `await` (session switched, runtime restarted, mode changed).
- **Case sensitivity.** Linux paths are case-sensitive (`DCore` vs `dcore` bit us in the eval harness).
- **Cached builds.** Electron `out/`, `node_modules/.cache`, Rust `target/` — when in doubt, clean and rebuild.
- **Environment differences.** CI runs Linux; dev is often Windows/macOS. Path separators, shell dialects, and line endings differ.
- **The mock is wrong, not the code.** When a test fails after a refactor, check whether the test's mock still matches the real interface.

## 6. Closing Out

- The fix gets a regression test that fails on the old code.
- If the bug was a process failure (missed gate, wrong merge order), update the checklist or skill that should have caught it — don't just fix the instance.
- Delete debug logging before committing. `git diff` should show only the fix and its test.
