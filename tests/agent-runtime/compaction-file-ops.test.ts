import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { withDcodeFileOps } from "../../src/agent/runtime/compaction-file-ops.js";

function call(name: string, args: Record<string, unknown>): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "toolCall", id: `${name}-call`, name, arguments: args }],
    api: "openai-completions",
    provider: "p",
    model: "m",
    usage: {
      input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "toolUse",
    timestamp: 0,
  } as AgentMessage;
}

const empty = () => ({ read: new Set<string>(), written: new Set<string>(), edited: new Set<string>() });

describe("withDcodeFileOps", () => {
  it("attributes DCode's Read, Write and Edit calls", () => {
    const ops = withDcodeFileOps(empty(), [
      call("Read", { path: "src/a.ts" }),
      call("Write", { path: "src/b.ts", content: "x" }),
      call("Edit", { path: "src/c.ts", tag: "abcd", ops: "CUT 1.=1" }),
    ]);

    expect([...ops.read]).toEqual(["src/a.ts"]);
    expect([...ops.written]).toEqual(["src/b.ts"]);
    expect([...ops.edited]).toEqual(["src/c.ts"]);
  });

  it("keeps the carried-forward lists and never mutates them", () => {
    const carried = { read: new Set(["old.ts"]), written: new Set<string>(), edited: new Set(["kept.ts"]) };
    const ops = withDcodeFileOps(carried, [call("Read", { path: "new.ts" })]);

    expect([...ops.read]).toEqual(["old.ts", "new.ts"]);
    expect([...ops.edited]).toEqual(["kept.ts"]);
    expect([...carried.read]).toEqual(["old.ts"]);
  });

  it("ignores other tools, missing paths and non-assistant messages", () => {
    const ops = withDcodeFileOps(empty(), [
      call("Grep", { path: "src", pattern: "x" }),
      call("Bash", { command: "cat src/a.ts" }),
      call("Read", {}),
      call("Read", { path: "" }),
      { role: "user", content: "Read src/a.ts", timestamp: 0 } as AgentMessage,
    ]);

    expect(ops.read.size + ops.written.size + ops.edited.size).toBe(0);
  });
});
