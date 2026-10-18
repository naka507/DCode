/**
 * ADR-006 (P1-4): thin wrappers for the pure-ish pi-* function surface.
 *
 * Callers use these instead of importing `@earendil-works/pi-agent-core`
 * directly. The signatures are DCode's own; a future backend reimplements
 * them without touching call sites.
 */
import {
  convertToLlm as piConvertToLlm,
  createBranchSummaryMessage as piCreateBranchSummaryMessage,
  createCompactionSummaryMessage as piCreateCompactionSummaryMessage,
  estimateContextTokens as piEstimateContextTokens,
  estimateTokens as piEstimateTokens,
  serializeConversation as piSerializeConversation,
} from "@earendil-works/pi-agent-core";

/** Approximate token count, using the backend's tokenizer. */
export function estimateTokens(
  ...args: Parameters<typeof piEstimateTokens>
): ReturnType<typeof piEstimateTokens> {
  return piEstimateTokens(...args);
}

/** Token estimate for a full agent context. */
export function estimateContextTokens(
  ...args: Parameters<typeof piEstimateContextTokens>
): ReturnType<typeof piEstimateContextTokens> {
  return piEstimateContextTokens(...args);
}

/** Convert agent messages to the LLM wire format. */
export function convertToLlm(
  ...args: Parameters<typeof piConvertToLlm>
): ReturnType<typeof piConvertToLlm> {
  return piConvertToLlm(...args);
}

/** Serialize a conversation for compaction input shaping. */
export function serializeConversation(
  ...args: Parameters<typeof piSerializeConversation>
): ReturnType<typeof piSerializeConversation> {
  return piSerializeConversation(...args);
}

/** Build the summary message that anchors a compacted branch. */
export function createBranchSummaryMessage(
  ...args: Parameters<typeof piCreateBranchSummaryMessage>
): ReturnType<typeof piCreateBranchSummaryMessage> {
  return piCreateBranchSummaryMessage(...args);
}

/** Build the summary message that anchors a compaction checkpoint. */
export function createCompactionSummaryMessage(
  ...args: Parameters<typeof piCreateCompactionSummaryMessage>
): ReturnType<typeof piCreateCompactionSummaryMessage> {
  return piCreateCompactionSummaryMessage(...args);
}
