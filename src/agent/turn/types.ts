/**
 * Turn lifecycle types (ADR-001 Phase A).
 *
 * A "turn" here is one user-initiated unit of agent work: everything between
 * `DesktopAgentRuntime.prompt()` being called and the runtime settling
 * (completed / failed / aborted). The underlying model loop lives inside
 * pi-agent-core, so DCode tracks the turn as an *observer* — it never drives
 * the loop, it only records what happened.
 */

/** Durable turn status. Terminal states never transition out. */
export type TurnStatus =
  | "pending"
  | "active"
  | "awaiting_approval"
  | "suspended"
  | "completed"
  | "failed"
  | "aborted";

/**
 * Observable sub-phase while a turn is `active`.
 * Mirrors the existing `setAgentActivity` phases so UI can migrate gradually.
 */
export type TurnPhase =
  | "starting"
  | "compacting"
  | "waiting_model"
  | "executing"
  | "delegating"
  | "recovering"
  | "retrying";

export type TurnOutcome = "completed" | "failed" | "aborted";

export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  compactionTokens: number;
}

export interface TurnError {
  code: string;
  message: string;
  retriable: boolean;
}

export interface TurnRecord {
  turnId: string;
  sessionId: string;
  parentTurnId?: string;
  status: TurnStatus;
  phase: TurnPhase;
  startedAt: number;
  endedAt?: number;
  outcome?: TurnOutcome;
  usage: TurnUsage;
  toolCallCount: number;
  delegationIds: string[];
  error?: TurnError;
}

/**
 * Append-only turn lifecycle events. Deliberately coarse: per-token or
 * per-stream-chunk events are NOT recorded here (too noisy). Tool calls are
 * reported as small batches / individual completions, not streaming updates.
 */
export type TurnEvent =
  | {
      type: "turn.started";
      turnId: string;
      sessionId: string;
      at: number;
      parentTurnId?: string;
    }
  | {
      type: "turn.phase_changed";
      turnId: string;
      sessionId: string;
      at: number;
      from: TurnPhase;
      to: TurnPhase;
    }
  | {
      type: "turn.tool_completed";
      turnId: string;
      sessionId: string;
      at: number;
      toolName: string;
      durationMs: number;
      ok: boolean;
    }
  | {
      type: "turn.delegation";
      turnId: string;
      sessionId: string;
      at: number;
      delegationId: string;
      kind: "spawned" | "completed" | "failed";
    }
  | {
      type: "turn.compaction";
      turnId: string;
      sessionId: string;
      at: number;
      strategy: string;
      reclaimedTokens: number;
    }
  | {
      type: "turn.approval";
      turnId: string;
      sessionId: string;
      at: number;
      kind: "requested" | "resolved";
      approved?: boolean;
    }
  | {
      type: "turn.ended";
      turnId: string;
      sessionId: string;
      at: number;
      outcome: TurnOutcome;
      usage: TurnUsage;
      error?: TurnError;
    };

/**
 * Destination for turn events. Phase A ships an in-memory sink; the DCore
 * RPC sink (persisting to `turn_events`) lands with the DCore migration
 * (schema v20, PROTOCOL_VERSION 12).
 */
export interface TurnEventSink {
  append(event: TurnEvent): void | Promise<void>;
}

export function emptyTurnUsage(): TurnUsage {
  return { inputTokens: 0, outputTokens: 0, compactionTokens: 0 };
}
