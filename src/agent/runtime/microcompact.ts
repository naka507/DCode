/**
 * Microcompact policy and silent trimmer for model context.
 *
 * Silently clears bulky text payloads from older historical tool results
 * in the model context projection (`buildSessionContext`) while preserving
 * toolCallIds, tool names, error flags, and call arguments.
 *
 * This keeps the multi-turn context valid for provider APIs while preventing
 * old file reads, directory scans, or compiler logs from clogging the context window.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ToolResultMessage } from "@earendil-works/pi-ai";

export const MICROCOMPACT_CLEARED_TOOL_RESULT = "[Old tool result content cleared]";
export const DEFAULT_MICROCOMPACT_KEEP_RECENT = 5;
export const DEFAULT_MICROCOMPACT_MIN_CHARS = 100;

export const DEFAULT_COMPACTABLE_TOOLS = new Set([
  "ReadFile",
  "read_file",
  "Read",
  "Bash",
  "bash",
  "run_command",
  "Grep",
  "grep",
  "search_code",
  "Glob",
  "glob",
  "view_file",
  "WebFetch",
  "webfetch",
  "read_url_content",
  "WebSearch",
  "websearch",
  "search_web",
  "EditFile",
  "replace_file_content",
  "WriteFile",
  "write_to_file",
]);

export interface MicrocompactOptions {
  enabled?: boolean;
  keepRecent?: number;
  minCharsToClear?: number;
  compactableTools?: Set<string>;
  clearErrorResults?: boolean;
}

export interface MicrocompactStats {
  clearedCount: number;
  charactersSaved: number;
}

/**
 * Silently compacts older tool result messages in the model context by replacing
 * bulky outputs with a compact marker (`[Old tool result content cleared]`).
 */
export function applyMicrocompact(
  messages: AgentMessage[],
  options: MicrocompactOptions = {},
): AgentMessage[] {
  if (options.enabled === false) {
    return messages;
  }

  const keepRecent = options.keepRecent ?? DEFAULT_MICROCOMPACT_KEEP_RECENT;
  const minChars = options.minCharsToClear ?? DEFAULT_MICROCOMPACT_MIN_CHARS;
  const compactableTools = options.compactableTools ?? DEFAULT_COMPACTABLE_TOOLS;
  const clearError = options.clearErrorResults ?? false;

  // 1. Identify indices of all tool result messages
  const toolResultIndices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg && msg.role === "toolResult") {
      toolResultIndices.push(i);
    }
  }

  // If total tool results are within the retention window, keep all untouched
  if (toolResultIndices.length <= keepRecent) {
    return messages;
  }

  // The last `keepRecent` tool results are kept untouched
  const candidatesToCompact = toolResultIndices.slice(
    0,
    toolResultIndices.length - keepRecent,
  );
  const candidateSet = new Set(candidatesToCompact);

  return messages.map((msg, index) => {
    if (!candidateSet.has(index)) {
      return msg;
    }

    const toolMsg = msg as ToolResultMessage;
    if (toolMsg.isError && !clearError) {
      return msg;
    }

    if (toolMsg.toolName && !compactableTools.has(toolMsg.toolName)) {
      return msg;
    }

    // Measure text content
    const textBlocks = toolMsg.content.filter(
      (block): block is { type: "text"; text: string } => block.type === "text",
    );
    const totalChars = textBlocks.reduce(
      (sum, block) => sum + (block.text?.length || 0),
      0,
    );

    const alreadyCleared = textBlocks.some(
      (block) => block.text === MICROCOMPACT_CLEARED_TOOL_RESULT,
    );
    if (alreadyCleared || totalChars < minChars) {
      return msg;
    }

    // Keep any non-text blocks (e.g. images) if present, but replace text with cleared marker
    const nonTextBlocks = toolMsg.content.filter((block) => block.type !== "text");
    const newContent = [
      { type: "text" as const, text: MICROCOMPACT_CLEARED_TOOL_RESULT },
      ...nonTextBlocks,
    ];

    return {
      ...toolMsg,
      content: newContent,
    };
  });
}
