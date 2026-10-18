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
  AgentTool,
  AgentToolResult,
  CompactionPreparation,
  Entry,
  JsonValue,
} from "@earendil-works/pi-agent-core";
export type {
  Api,
  AssistantMessage,
  Context,
  FetchFunction,
  Message,
  Model,
  ModelAuth,
  ProviderHeaders,
  RetryPolicy,
  SimpleStreamOptions,
  Usage,
} from "@earendil-works/pi-ai";
export type { SessionManager } from "@earendil-works/pi-coding-agent";
