/**
 * Turn lifecycle types (ADR-001).
 *
 * A "turn" is one user-initiated unit of agent work: everything between
 * `DesktopAgentRuntime.prompt()` being called and the runtime settling
 * (completed / failed / aborted). The underlying model loop lives inside
 * pi-agent-core, so DCode tracks the turn as an *observer* — it never drives
 * the loop, it only records what happened.
 *
 * These types live in `src/shared/` (not `src/agent/turn/`) because turn
 * events cross the sidecar → Electron main → renderer boundary (ADR-001
 * Phase C): the UI subscribes to them. `src/agent/turn/types.ts` re-exports
 * everything here for backward compatibility.
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
 * Destination for turn events. Implementations: in-memory (tests/UI),
 * DCore RPC (persists to `turn_events`), and the sidecar forwarding sink
 * (streams to Electron main → renderer for live UI subscription).
 */
export interface TurnEventSink {
  append(event: TurnEvent): void | Promise<void>;
}

export function emptyTurnUsage(): TurnUsage {
  return { inputTokens: 0, outputTokens: 0, compactionTokens: 0 };
}
