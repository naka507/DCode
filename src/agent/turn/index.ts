/**
 * Turn lifecycle tracking (ADR-001).
 *
 * Phase A: observer-only. `TurnStateMachine` records the lifecycle of one
 * agent turn without changing runtime behavior. Events flow to `TurnEventSink`
 * implementations: `InMemoryTurnEventSink` (kept for UI/tests) and
 * `DCoreTurnEventSink` (persists to DCore's `turn_events` table, schema v20,
 * PROTOCOL_VERSION 12).
 */
export * from "./types.js";
export * from "./state-machine.js";
export * from "./sinks.js";
export * from "./dcore-sink.js";
