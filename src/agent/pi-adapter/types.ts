/**
 * ADR-006 (P1-4): DCode's boundary with `@earendil-works/pi-*`.
 *
 * Every pi-* *type* DCode uses is re-exported here. Type-only consumers
 * import from this module, never from `@earendil-works/*` directly, so a
 * future backend swap touches one import surface instead of 26 files.
 *
 * Value imports (functions, classes) live behind `functions.ts` and the
 * documented `AgentBackend` seam in `backend.ts`.
 */
export type {
  AgentMessage,
  AgentOptions,
  AgentState,
  AgentTool,
  AgentToolResult,
  AfterToolCallContext,
  AfterToolCallResult,
  AgentEvent,
  AgentLoopTurnUpdate,
  BeforeToolCallContext,
  BeforeToolCallResult,
  CompactionEntry,
  CompactionPreparation,
  CompactionSettings,
  Entry,
  JsonValue,
  MessageEntry,
  PrepareNextTurnContext,
} from "@earendil-works/pi-agent-core";
export type {
  Api,
  AssistantMessage,
  AssistantMessageEventStream,
  Context,
  FetchFunction,
  ImageContent,
  Message,
  Model,
  ModelAuth,
  Models,
  ModelsSimpleStreamOptions,
  ProviderHeaders,
  RetryPolicy,
  SimpleStreamOptions,
  ToolResultMessage,
  TSchema,
  Usage,
  UserMessage,
} from "@earendil-works/pi-ai";
import type { AssistantMessage } from "@earendil-works/pi-ai";
export type { SessionManager } from "@earendil-works/pi-coding-agent";

/**
 * DCode's view of a pi-ai AssistantMessage, extended with the fields DCode's
 * pi patches add (hosted search passthrough). Use this instead of `as any`
 * when accessing message fields in the event handler.
 */
export type DCodeAssistantMessage = AssistantMessage & {
  /** Added by DCode's pi patch: citations from hosted search results. */
  hostedSearchCitations?: unknown;
};
