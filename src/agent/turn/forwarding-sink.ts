import type { TurnEvent, TurnEventSink } from "./types.js";

/**
 * Turn event sink that forwards events to a callback (ADR-001 Phase C).
 *
 * The sidecar wires this to the runtime's event emitter so turn lifecycle
 * events travel the existing `agent.event` envelope path: sidecar →
 * Electron main → renderer, where the UI subscribes to them. The callback
 * must not throw; a broken forwarder must not break the turn it observes.
 */
export class ForwardingTurnEventSink implements TurnEventSink {
  private readonly forward: (event: TurnEvent) => void;

  constructor(forward: (event: TurnEvent) => void) {
    this.forward = forward;
  }

  append(event: TurnEvent): void {
    try {
      this.forward(event);
    } catch (error) {
      // Match TurnStateMachine's defensive posture: log and continue.
      const detail =
        error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      process.stderr.write(
        `[turn-tracker] forwarding sink failed (turn=${event.turnId} event=${event.type}): ${detail}\n`,
      );
    }
  }
}
