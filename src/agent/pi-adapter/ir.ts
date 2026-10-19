/**
 * ADR-006 (P1-4): Agent Intermediate Representation.
 *
 * DCode's own model of the agent loop, independent of `@earendil-works/pi-*`
 * types. Today the loop is pi-agent-core's `Agent` class; this IR is the
 * target data model a replacement backend must speak. It is deliberately
 * structural (plain data, no behavior) so both the pi-backed adapter and a
 * future internal loop can produce and consume it.
 *
 * Design notes:
 * - Message shapes mirror what `runtime.ts` actually reads/writes on
 *   `agent.state` (messages, tools, systemPrompt, streaming flags).
 * - Event shapes mirror the `AgentEvent` union DCode subscribes to, minus
 *   pi-specific payload details.
 * - The two patch-preserved behaviors (hosted search passthrough, hosted
 *   search block capture — see `backend.ts`) are represented as first-class
 *   IR concepts so a rewrite cannot drop them silently.
 */

/** A single message in the agent transcript. */
export type IrMessageRole = "user" | "assistant" | "toolResult" | "system";

export interface IrTextContent {
  kind: "text";
  text: string;
}

export interface IrThinkingContent {
  kind: "thinking";
  thinking: string;
}

export interface IrToolCallContent {
  kind: "toolCall";
  toolCallId: string;
  toolName: string;
  args: unknown;
}

export interface IrToolResultContent {
  kind: "toolResult";
  toolCallId: string;
  toolName: string;
  result: unknown;
  isError?: boolean;
}

/**
 * Server-side (hosted) search block, captured from the provider wire format.
 * Patch-preserved behavior #2: any backend must surface these into the
 * message model, or search results are lost from history.
 */
export interface IrHostedSearchContent {
  kind: "hostedSearch";
  query?: string;
  results?: unknown;
}

export type IrMessageContent =
  | IrTextContent
  | IrThinkingContent
  | IrToolCallContent
  | IrToolResultContent
  | IrHostedSearchContent;

export interface IrMessage {
  role: IrMessageRole;
  content: IrMessageContent[];
  /** Provider usage for this message, when reported. */
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
  /** Opaque provider-specific metadata (model id, etc.). */
  meta?: Record<string, unknown>;
}

/** A tool the agent may call. */
export interface IrToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the tool's parameters. */
  parameters: unknown;
}

/** Mutable agent state, mirroring `Agent.state`. */
export interface IrAgentState {
  messages: IrMessage[];
  tools: IrToolDefinition[];
  systemPrompt: string;
  isStreaming: boolean;
  /** True while a model request is in flight. */
  pendingModelRequest: boolean;
  /** Active model identifier, when set. */
  model?: string;
  /** Thinking level/budget, provider-specific. */
  thinkingLevel?: unknown;
}

/** Events the loop emits, mirroring the subscribed `AgentEvent` surface. */
export type IrAgentEvent =
  | { type: "turn.started"; turnId: string }
  | { type: "turn.ended"; turnId: string }
  | { type: "message.delta"; deltaText?: string; deltaThinking?: string }
  | { type: "message.completed"; message: IrMessage }
  | { type: "tool.callStarted"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool.callCompleted"; toolCallId: string; result: unknown; isError?: boolean }
  | {
      type: "hostedSearch.update";
      /** Patch-preserved behavior #1: provider-stream hosted search progress. */
      update: unknown;
    }
  | { type: "error"; error: { code: string; message: string } };

/** Result of executing one tool call. */
export interface IrToolResult {
  toolCallId: string;
  result: unknown;
  isError?: boolean;
}

/** Hooks the loop calls around tool execution. */
export interface IrToolHooks {
  beforeToolCall?: (call: {
    toolCallId: string;
    toolName: string;
    args: unknown;
  }) => Promise<{ allow: boolean; reason?: string } | undefined>;
  afterToolCall?: (call: {
    toolCallId: string;
    toolName: string;
    result: unknown;
    isError?: boolean;
  }) => Promise<void>;
}

/**
 * The loop backend contract, refined from `AgentBackend` in `backend.ts`.
 *
 * A backend owns the turn loop (prompt → model → tools → repeat until idle)
 * and speaks only IR types at its boundary. DCode owns everything around
 * it: the tool catalog, permissions, delegation, session persistence.
 */
export interface IrAgentBackend {
  readonly name: string;
  /** Current IR state. Mutations go through the backend's methods. */
  readonly state: IrAgentState;
  /** Subscribe to loop events. Returns an unsubscribe function. */
  subscribe(listener: (event: IrAgentEvent) => void): () => void;
  /** Start a turn with a user message. Resolves when the turn settles. */
  prompt(text: string): Promise<void>;
  /** Continue the current turn (e.g. after a silent model response). */
  continue(): Promise<void>;
  /** Abort the in-flight turn. */
  abort(): void;
  /** Replace the tool catalog. */
  setTools(tools: IrToolDefinition[]): void;
  /** Replace the system prompt. */
  setSystemPrompt(prompt: string): void;
}
