/**
 * Turn lifecycle tracking (ADR-001).
 *
 * Phase A: observer-only. `TurnStateMachine` records the lifecycle of one
 * agent turn without changing runtime behavior. Events flow to `TurnEventSink`
 * implementations; persistence to DCore (`turn_events` table) arrives with
 * the DCore migration and is consumed through the same sink interface.
 */
export * from "./types.js";
export * from "./state-machine.js";
export * from "./sinks.js";
