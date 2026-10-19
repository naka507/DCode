/**
 * ADR-006 (P1-4): DCode's adapter seam for `@earendil-works/pi-*`.
 *
 * - `types.ts`: every pi-* type DCode uses — the only import surface for
 *   type-only consumers.
 * - `functions.ts`: thin wrappers for the pure function surface.
 * - `schema.ts`: TypeBox schema re-exports.
 * - `backend.ts`: the documented `AgentBackend` seam + patch-preserved
 *   behaviors a replacement must keep.
 * - `ir.ts`: the Agent Intermediate Representation — DCode's own loop data
 *   model, the target a replacement backend must speak.
 */
export * from "./types.js";
export * from "./functions.js";
export * from "./schema.js";
export * from "./backend.js";
export * from "./ir.js";
