/**
 * ADR-006 (P1-4): the documented seam for the agent loop backend.
 *
 * Today the loop is pi-agent-core's `Agent` class (runtime.ts, subagent.ts).
 * Replacing it with an internal Agent IR is future work; this interface
 * records the contract a replacement must satisfy so the rewrite has a
 * target to aim at.
 *
 * ## Patch-preserved behaviors (load-bearing)
 *
 * `patches/@earendil-works__pi-agent-core@0.85.1.patch` and
 * `patches/@earendil-works__pi-ai@0.85.1.patch` (applied by
 * `scripts/apply-patches.mjs` on every install) add two behaviors on top of
 * upstream pi-*. Any backend — pi-based or internal — MUST preserve both:
 *
 * 1. **Hosted search event passthrough**: the agent loop forwards
 *    `hosted_search_update` events from the provider stream to DCode's
 *    `onEvent` channel. Dropping it silently loses server-side web-search
 *    progress in the UI.
 * 2. **Server-side web-search block capture**: pi-ai's anthropic-messages
 *    adapter captures `hostedSearch` blocks from the wire format into the
 *    message model. Dropping it loses search results from history.
 *
 * ## AgentBackend contract (target)
 *
 * A backend owns: the turn loop (prompt → model → tools → repeat until
 * idle), streaming event emission (`AgentEvent`), tool-call dispatch with
 * approval hooks, and compaction input preparation. DCode owns everything
 * around it: the tool catalog, permissions, delegation, session persistence.
 */
export interface AgentBackend {
  readonly name: string;
}

/** Names of the pi-* packages this seam currently delegates to. */
export const PI_PACKAGES = [
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-coding-agent",
] as const;

/** Pinned versions (package.json, exact — no caret). */
export const PI_PINNED_VERSION = "0.85.1" as const;
