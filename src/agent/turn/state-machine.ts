import {
  emptyTurnUsage,
  type TurnError,
  type TurnEvent,
  type TurnEventSink,
  type TurnOutcome,
  type TurnPhase,
  type TurnRecord,
  type TurnStatus,
  type TurnUsage,
} from "./types.js";

/**
 * Legal status transitions for the turn lifecycle.
 * Terminal states (`completed` / `failed` / `aborted`) have no outgoing edges.
 */
const LEGAL_TRANSITIONS: Record<TurnStatus, readonly TurnStatus[]> = {
  pending: ["active", "aborted"],
  active: ["awaiting_approval", "suspended", "completed", "failed", "aborted"],
  awaiting_approval: ["active", "aborted"],
  suspended: ["active", "aborted"],
  completed: [],
  failed: [],
  aborted: [],
};

export interface TurnStateMachineOptions {
  turnId: string;
  sessionId: string;
  parentTurnId?: string;
  sinks?: TurnEventSink[];
}

function describeEventFailure(event: TurnEvent, error: unknown): string {
  const detail =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return (
    `[turn-tracker] sink failed (turn=${event.turnId} event=${event.type}): ` +
    `${detail}\n`
  );
}

/**
 * Observer state machine for one agent turn (ADR-001 Phase A).
 *
 * The real agentic loop lives inside pi-agent-core; this class only records
 * what happened. It is intentionally defensive: illegal transitions and sink
 * failures are logged to stderr and ignored, never thrown — a broken
 * observer must not break the agent loop it observes.
 *
 * Phase A is purely additive: it changes no runtime behavior, it only emits
 * `TurnEvent`s to the configured sinks.
 */
export class TurnStateMachine {
  private readonly record: TurnRecord;
  private readonly sinks: TurnEventSink[];
  private finished = false;

  constructor(opts: TurnStateMachineOptions) {
    const now = Date.now();
    this.record = {
      turnId: opts.turnId,
      sessionId: opts.sessionId,
      parentTurnId: opts.parentTurnId,
      status: "pending",
      phase: "starting",
      startedAt: now,
      usage: emptyTurnUsage(),
      toolCallCount: 0,
      delegationIds: [],
    };
    this.sinks = [...(opts.sinks ?? [])];
    this.emit({
      type: "turn.started",
      turnId: opts.turnId,
      sessionId: opts.sessionId,
      at: now,
      ...(opts.parentTurnId ? { parentTurnId: opts.parentTurnId } : {}),
    });
  }

  /** pending -> active. Called once the runtime starts executing the turn. */
  begin(): void {
    this.transition("active");
  }

  /** Observable sub-phase while active. No-op when unchanged. */
  setPhase(phase: TurnPhase): void {
    if (this.finished || this.record.phase === phase) return;
    const from = this.record.phase;
    this.record.phase = phase;
    this.emit({
      type: "turn.phase_changed",
      turnId: this.record.turnId,
      sessionId: this.record.sessionId,
      at: Date.now(),
      from,
      to: phase,
    });
  }

  /** One completed tool execution (not streaming updates). */
  notifyToolCompleted(toolName: string, durationMs: number, ok: boolean): void {
    if (this.finished) return;
    this.record.toolCallCount += 1;
    this.emit({
      type: "turn.tool_completed",
      turnId: this.record.turnId,
      sessionId: this.record.sessionId,
      at: Date.now(),
      toolName,
      durationMs: Math.max(0, Math.round(durationMs)),
      ok,
    });
  }

  notifyDelegation(
    delegationId: string,
    kind: "spawned" | "completed" | "failed",
  ): void {
    if (this.finished) return;
    if (kind === "spawned" && !this.record.delegationIds.includes(delegationId)) {
      this.record.delegationIds.push(delegationId);
    }
    this.emit({
      type: "turn.delegation",
      turnId: this.record.turnId,
      sessionId: this.record.sessionId,
      at: Date.now(),
      delegationId,
      kind,
    });
  }

  notifyCompaction(strategy: string, reclaimedTokens: number): void {
    if (this.finished) return;
    this.record.usage.compactionTokens += Math.max(0, Math.round(reclaimedTokens));
    this.emit({
      type: "turn.compaction",
      turnId: this.record.turnId,
      sessionId: this.record.sessionId,
      at: Date.now(),
      strategy,
      reclaimedTokens: Math.max(0, Math.round(reclaimedTokens)),
    });
  }

  notifyApproval(kind: "requested" | "resolved", approved?: boolean): void {
    if (this.finished) return;
    if (kind === "requested") this.transition("awaiting_approval");
    if (kind === "resolved") this.transition("active");
    this.emit({
      type: "turn.approval",
      turnId: this.record.turnId,
      sessionId: this.record.sessionId,
      at: Date.now(),
      kind,
      ...(approved !== undefined ? { approved } : {}),
    });
  }

  /** Merge partial usage figures (wired to real accounting in Phase B). */
  recordUsage(usage: Partial<TurnUsage>): void {
    if (this.finished) return;
    const current = this.record.usage;
    if (usage.inputTokens !== undefined) current.inputTokens = usage.inputTokens;
    if (usage.outputTokens !== undefined) current.outputTokens = usage.outputTokens;
    if (usage.compactionTokens !== undefined) {
      current.compactionTokens = usage.compactionTokens;
    }
  }

  suspend(): void {
    this.transition("suspended");
  }

  resume(): void {
    this.transition("active");
  }

  /**
   * Move the turn to a terminal state and emit `turn.ended`.
   * Idempotent: only the first call takes effect.
   */
  end(outcome: TurnOutcome, error?: TurnError): void {
    if (this.finished) return;
    this.finished = true;
    const terminal: TurnStatus =
      outcome === "completed"
        ? "completed"
        : outcome === "failed"
          ? "failed"
          : "aborted";
    // Bypass transition() so a turn stuck in a non-terminal state (e.g. a
    // missed event) still reaches a terminal state exactly once.
    this.record.status = terminal;
    this.record.endedAt = Date.now();
    this.record.outcome = outcome;
    if (error) this.record.error = { ...error };
    this.emit({
      type: "turn.ended",
      turnId: this.record.turnId,
      sessionId: this.record.sessionId,
      at: this.record.endedAt,
      outcome,
      usage: { ...this.record.usage },
      ...(error ? { error: { ...error } } : {}),
    });
  }

  getRecord(): Readonly<TurnRecord> {
    return this.record;
  }

  get finishedTurn(): boolean {
    return this.finished;
  }

  private transition(to: TurnStatus): boolean {
    const from = this.record.status;
    if (from === to) return true;
    if (!LEGAL_TRANSITIONS[from].includes(to)) {
      process.stderr.write(
        `[turn-tracker] illegal transition ignored (turn=${this.record.turnId} ${from} -> ${to})\n`,
      );
      return false;
    }
    this.record.status = to;
    return true;
  }

  private emit(event: TurnEvent): void {
    for (const sink of this.sinks) {
      try {
        const result = sink.append(event);
        if (result instanceof Promise) {
          result.catch((error: unknown) => {
            process.stderr.write(describeEventFailure(event, error));
          });
        }
      } catch (error) {
        process.stderr.write(describeEventFailure(event, error));
      }
    }
  }
}
