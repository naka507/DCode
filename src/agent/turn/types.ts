/**
 * Turn lifecycle types (ADR-001).
 *
 * Backward-compatibility re-export: the canonical definitions moved to
 * `src/shared/types/turn.ts` (ADR-001 Phase C) because turn events cross the
 * sidecar → Electron main → renderer boundary for UI subscription.
 */
export * from "../../shared/types/turn.js";
