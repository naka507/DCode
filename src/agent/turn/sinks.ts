import type { TurnEvent, TurnEventSink } from "./types.js";

/**
 * In-memory turn event sink (ADR-001 Phase A).
 *
 * Keeps every event in process memory. Used by unit tests and as the default
 * sink until the DCore RPC sink lands with the `turn_events` migration
 * (schema v20, PROTOCOL_VERSION 12).
 */
export class InMemoryTurnEventSink implements TurnEventSink {
  private readonly events: TurnEvent[] = [];

  append(event: TurnEvent): void {
    this.events.push(event);
  }

  getEvents(): readonly TurnEvent[] {
    return this.events;
  }

  eventsOfType<T extends TurnEvent["type"]>(
    type: T,
  ): Extract<TurnEvent, { type: T }>[] {
    return this.events.filter(
      (event): event is Extract<TurnEvent, { type: T }> => event.type === type,
    );
  }

  clear(): void {
    this.events.length = 0;
  }
}
