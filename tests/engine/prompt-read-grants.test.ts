import { describe, expect, it, vi } from "vitest";
import { grantPromptReadPaths } from "../../src/engine/prompt-read-grants.js";

describe("trusted prompt read grants", () => {
  it.each(["Read `/tmp/a file.txt`", "Read E:\\Code\\Other", "Read \\\\server\\share\\file"])("forwards raw input for host validation: %s", async (content) => {
    const host = { call: vi.fn().mockResolvedValue({ ok: true }) };
    await grantPromptReadPaths(host, "s", content, "turn");
    expect(host.call).toHaveBeenCalledWith("permissions.grantPromptReadPaths", { sessionId: "s", content, expectedTurnId: "turn" });
  });
  it("skips ordinary text and preserves old-host permission behavior", async () => {
    const host = { call: vi.fn().mockRejectedValue({ code: -32601 }) };
    await grantPromptReadPaths(host, "s", "hello", "turn");
    expect(host.call).not.toHaveBeenCalled();
    await expect(grantPromptReadPaths(host, "s", "Read /tmp/file", "turn")).resolves.toBeUndefined();
  });
  it("does not swallow unexpected host failures", async () => {
    const error = new Error("host disconnected");
    await expect(grantPromptReadPaths({ call: vi.fn().mockRejectedValue(error) }, "s", "Read /tmp/file", "turn")).rejects.toBe(error);
  });
});
