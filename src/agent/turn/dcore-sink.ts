import type { TurnEvent, TurnEventSink } from "./types.js";

/** Matches the DCore `turn.appendEvent` payload cap (host-core sessions.rs). */
export const TURN_EVENT_MAX_PAYLOAD_BYTES = 64 * 1024;

/**
 * Minimal transport surface for the DCore RPC sink. The runtime injects
 * `(method, params) => this.host.call(method, params)`; tests inject a fake.
 */
export interface TurnEventTransport {
  call(method: string, params: Record<string, unknown>): Promise<unknown>;
}

function rpcErrorCode(error: unknown): string | undefined {
  const candidate = error as {
    code?: unknown;
    data?: { errorCode?: unknown };
    errorCode?: unknown;
  } | null;
  if (candidate?.code === 1007) return "TURN_NOT_FOUND";
  const nested = candidate?.data?.errorCode;
  if (typeof nested === "string") return nested;
  const flat = candidate?.errorCode;
  return typeof flat === "string" ? flat : undefined;
}

/**
 * DCore RPC turn event sink (ADR-001 Phase B).
 *
 * Persists turn lifecycle events to DCore's `turn_events` table via
 * `turn.appendEvent`. Fire-and-forget by design: a persistence failure must
 * never break the turn being observed, so every failure is logged and
 * swallowed. A missing turn row (1007 TURN_NOT_FOUND — e.g. non-host flows
 * that never created a DCore turn) warns once per turn and then stays quiet.
 */
export class DCoreTurnEventSink implements TurnEventSink {
  private readonly missingTurnWarned = new Set<string>();

  constructor(private readonly transport: TurnEventTransport) {}

  append(event: TurnEvent): void {
    // Observer principle: never let the sink break the turn it observes.
    void this.send(event).catch((error) => {
      console.error(
        `[dcore-turn-sink] failed to persist ${event.type} ` +
          `for turn ${event.turnId}:`,
        error,
      );
    });
  }

  private async send(event: TurnEvent): Promise<void> {
    // turnId/type ride as top-level RPC params; sessionId is redundant
    // (DCore resolves it from the turn row). Everything else, including the
    // DCode-side timestamp `at`, goes into the payload.
    const payload: Record<string, unknown> = { ...event };
    delete payload.turnId;
    delete payload.type;
    delete payload.sessionId;
    const serialized = JSON.stringify(payload);
    const finalPayload =
      serialized.length > TURN_EVENT_MAX_PAYLOAD_BYTES
        ? {
            _truncated: true,
            byteLength: serialized.length,
            at: payload.at,
          }
        : payload;
    try {
      await this.transport.call("turn.appendEvent", {
        turnId: event.turnId,
        type: event.type,
        payload: finalPayload,
      });
    } catch (error) {
      if (rpcErrorCode(error) === "TURN_NOT_FOUND") {
        if (!this.missingTurnWarned.has(event.turnId)) {
          this.missingTurnWarned.add(event.turnId);
          console.warn(
            `[dcore-turn-sink] turn ${event.turnId} has no DCore turn row; ` +
              `events for this turn will not be persisted.`,
          );
        }
        return;
      }
      throw error;
    }
  }
}
