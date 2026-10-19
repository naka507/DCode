---
name: TypeScript Best Practices
description: TypeScript guidelines for DCode — strict typing, async safety, module boundaries, and the patterns this codebase follows. Use when writing or reviewing TypeScript in src/ (main, renderer, agent runtime, shared).
---

# TypeScript Best Practices for DCode

Guidelines for the DCode TypeScript codebase (Electron main, Vue renderer, Node agent runtime). The codebase is strict-mode TypeScript with `vue-tsc` — use the type system, don't fight it.

## When to Apply

- Writing new modules under `src/`
- Reviewing TS PRs for type safety, async correctness, or boundary violations
- Refactoring across the main/renderer/agent boundaries

## Types

- **No `any` in new code.** Use `unknown` + narrowing, or define the shape. The 13 existing `as any` in `runtime.ts` are tech debt around pi message types — don't add more.
- **No `@ts-ignore` / `@ts-nocheck`.** If the types are wrong, fix the types (usually in `src/agent/pi-adapter/`).
- **Prefer `type` over `interface`** for unions and intersections; `interface` for object shapes that may be extended.
- **Narrow unions explicitly.** `if (msg.role === "assistant")` should narrow — if it doesn't, the union needs a proper discriminant, not a cast.
- **Branded types for IDs.** `SessionId`, `TurnId`, `DelegationId` as distinct types prevent mixing them up in the 8000-line runtime.

## Async

- **Re-validate state after `await`.** The session, mode, or project may have changed. This is the #1 bug class in the agent runtime.
- **Every promise has an owner.** Unhandled rejections in the sidecar can take down the process — `.catch()` at the boundary or `await` with try/catch.
- **No floating promises in loops.** `for...of` with `await` is sequential (usually correct); `Promise.all` is parallel (only when the operations are independent). Don't mix them up.
- **AbortSignal everywhere.** Long-running operations (provider streams, tool executions, file walks) take a signal and respect it.

## Modules & Boundaries

- **New files ≤800 LOC** (enforced by `scripts/check-architecture.mjs`). Split by responsibility, not line count.
- **`src/shared/` is dependency-free.** No imports from main-process implementation code — it's the cross-boundary contract layer.
- **One import surface for pi-*.** All pi types come from `src/agent/pi-adapter/`; never import `@earendil-works/*` directly outside the adapter (grandfather list is shrinking, don't grow it).
- **No circular imports.** If two modules need each other, extract the shared part to a third module.

## IPC & Serialization

- **Everything crossing `ipcRenderer.invoke` goes through `toIpcPayload`.** Vue `ref`/`reactive` are Proxies and can't cross the boundary — serialize first.
- **Validate at the boundary.** IPC handlers validate params before acting; don't trust the renderer.
- **Structured clone limits.** No functions, no DOM nodes, no class instances across IPC — plain data only.

## Testing

- **Vitest for `*.test.ts`, node:test for `*.test.mjs`.** Don't mix runners.
- **Mock at the edges.** Real DCore binary for integration tests (via `DCoreHost`); mock only network/providers.
- **Test behavior, not implementation.** Assert on observable outcomes (files written, events emitted), not internal call counts.
