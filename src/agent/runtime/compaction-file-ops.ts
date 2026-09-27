/**
 * File operations a compaction checkpoint records.
 *
 * pi attributes file operations by matching the tool names `read`, `write`
 * and `edit` exactly. DCode's tools are `Read`, `Write` and `Edit`, so every
 * checkpoint recorded empty `readFiles` / `modifiedFiles` and its summary lost
 * the file list. pi's accumulator still carries the previous checkpoint's
 * lists forward; this adds the paths DCode's own calls touched.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";

/** pi's `FileOperations` accumulator, structurally. */
export type CompactionFileOps = {
  read: Set<string>;
  written: Set<string>;
  edited: Set<string>;
};

const FILE_OP_BY_TOOL = new Map<string, keyof CompactionFileOps>([
  ["Read", "read"],
  ["Write", "written"],
  ["Edit", "edited"],
]);

/**
 * Return a copy of `fileOps` extended with the `path` of every DCode file tool
 * call in `messages`. The input accumulator is left untouched.
 */
export function withDcodeFileOps(
  fileOps: CompactionFileOps,
  messages: readonly AgentMessage[],
): CompactionFileOps {
  const next: CompactionFileOps = {
    read: new Set(fileOps.read),
    written: new Set(fileOps.written),
    edited: new Set(fileOps.edited),
  };
  for (const message of messages) {
    if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (block.type !== "toolCall") continue;
      const op = FILE_OP_BY_TOOL.get(block.name);
      const path = (block.arguments as { path?: unknown } | undefined)?.path;
      if (op && typeof path === "string" && path) next[op].add(path);
    }
  }
  return next;
}
