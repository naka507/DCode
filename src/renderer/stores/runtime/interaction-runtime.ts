/**
 * Interaction runtime: ephemeral coordination for user interactions.
 *
 * Its only import is the `PlanResolutionResult` type from `@dcode/shared`.
 */
import type { PlanResolutionResult } from "@dcode/shared";

export type InteractionRuntime = {
  planResolutionRequests: Map<string, Promise<PlanResolutionResult>>;
  nextToastId: () => number;
};

/** Ephemeral coordination for user interactions; durable state stays in Pinia. */
export function createInteractionRuntime(): InteractionRuntime {
  let toastSequence = 0;
  return {
    planResolutionRequests: new Map<string, Promise<PlanResolutionResult>>(),
    nextToastId: () => ++toastSequence,
  };
}
