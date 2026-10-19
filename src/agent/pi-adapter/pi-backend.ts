/**
 * ADR-006 (P1-4): pi-backed agent backend.
 *
 * `PiAgentBackend` is a thin wrapper around `@earendil-works/pi-agent-core`'s
 * `Agent`. It is the ONLY place in DCode (outside `pi-adapter/` itself) that
 * imports pi-agent-core's `Agent` class. `runtime.ts` and `subagent.ts` use
 * this wrapper instead of importing pi directly.
 *
 * The wrapper deliberately mirrors pi's `Agent` API (methods, state shape,
 * event types) — all via `pi-adapter` re-exported types — so the migration
 * is mechanical. The `IrAgentBackend` interface in `ir.ts` remains the
 * target for the future native loop; when it lands, callers switch from
 * `PiAgentBackend` to the native backend without pi in the middle.
 *
 * Patch-preserved behaviors (hosted search passthrough + block capture)
 * live inside pi-agent-core and are inherited automatically.
 */
import { Agent } from "@earendil-works/pi-agent-core";
import type {
  AgentEvent,
  AgentMessage,
  AgentOptions,
  AgentState,
  ImageContent,
} from "./types.js";

export type { AgentEvent, AgentMessage, AgentOptions, AgentState, ImageContent };

/**
 * Thin wrapper around pi-agent-core's `Agent`.
 *
 * Construction takes pi's `AgentOptions` (via the adapter's re-exported
 * types). All methods delegate directly; no behavior is added or changed.
 */
export class PiAgentBackend {
  readonly name = "pi-agent-core" as const;
  private readonly agent: Agent;

  constructor(options: AgentOptions) {
    this.agent = new Agent(options);
  }

  /** Current agent state (mutable reference; assigning `state.tools` or `state.messages` copies the array per pi semantics). */
  get state(): AgentState {
    return this.agent.state;
  }

  /** Start a turn with a user message. Resolves when the turn settles. */
  prompt(text: string, images?: ImageContent[]): Promise<void> {
    return this.agent.prompt(text, images);
  }

  /** Continue the current turn (e.g. after a silent model response). */
  continue(): Promise<void> {
    return this.agent.continue();
  }

  /** Abort the in-flight turn. */
  abort(): void {
    this.agent.abort();
  }

  /** Subscribe to agent lifecycle events. Returns an unsubscribe function. */
  subscribe(
    listener: (event: AgentEvent, signal: AbortSignal) => Promise<void> | void,
  ): () => void {
    return this.agent.subscribe(listener);
  }

  /** Queue a steering message for the running turn. */
  steer(message: AgentMessage): void {
    this.agent.steer(message);
  }

  /** Drop queued steering messages. */
  clearSteeringQueue(): void {
    this.agent.clearSteeringQueue();
  }

  /** Resolve when the agent becomes idle. */
  waitForIdle(): Promise<void> {
    return this.agent.waitForIdle();
  }

  /** Direct access to the wrapped pi Agent for escape hatches. Prefer the wrapper methods. */
  get piAgent(): Agent {
    return this.agent;
  }

  /** Stream function (settable, mirrors pi Agent). */
  get streamFunction(): Agent["streamFunction"] {
    return this.agent.streamFunction;
  }

  set streamFunction(fn: Agent["streamFunction"]) {
    this.agent.streamFunction = fn;
  }

  /** API key provider (settable, mirrors pi Agent). */
  get getApiKey(): Agent["getApiKey"] {
    return this.agent.getApiKey;
  }

  set getApiKey(fn: Agent["getApiKey"]) {
    this.agent.getApiKey = fn;
  }

  // -- Callback passthroughs (mirrors pi Agent; used by tests and runtime) --

  get beforeToolCall(): Agent["beforeToolCall"] {
    return this.agent.beforeToolCall;
  }

  get afterToolCall(): Agent["afterToolCall"] {
    return this.agent.afterToolCall;
  }

  get shouldStopAfterTurn(): Agent["shouldStopAfterTurn"] {
    return this.agent.shouldStopAfterTurn;
  }

  get prepareNextTurn(): Agent["prepareNextTurn"] {
    return this.agent.prepareNextTurn;
  }

  /** Listener set (mirrors pi Agent internals; used by tests). */
  get listeners(): Agent["listeners"] {
    return (this.agent as unknown as { listeners: Agent["listeners"] }).listeners;
  }
}
