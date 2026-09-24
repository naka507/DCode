import { describe, expect, it } from "vitest";
import {
  MCP_PRESETS,
  rewriteMcpServerForRemoteHost,
  type McpServerInput,
} from "../../src/shared/mcp-presets.js";

describe("mcp presets", () => {
  it("ships a populated list of curated presets", () => {
    expect(MCP_PRESETS.length).toBeGreaterThanOrEqual(8);
    const ids = MCP_PRESETS.map((p) => p.id);
    expect(ids).toContain("filesystem");
    expect(ids).toContain("fetch");
    expect(ids).toContain("sqlite");
    expect(ids).toContain("github");
    expect(ids).toContain("postgres");
    expect(ids).toContain("brave-search");
    expect(ids).toContain("puppeteer");
    expect(ids).toContain("memory");
    expect(ids).toContain("sequential-thinking");
  });

  it("every preset contains required fields and valid transport", () => {
    for (const preset of MCP_PRESETS) {
      expect(preset.id).toBeTruthy();
      expect(preset.name).toBeTruthy();
      expect(preset.description).toBeTruthy();
      expect(["utility", "database", "developer", "browser"]).toContain(preset.category);
      expect(preset.server.id).toBe(preset.id);
      expect(["stdio", "http"]).toContain(preset.server.transport);
      if (preset.server.transport === "stdio") {
        expect(preset.server.command).toBeTruthy();
      } else {
        expect(preset.server.url).toBeTruthy();
      }
    }
  });

  it("rewrites command extension for remote Unix targets", () => {
    const localServer: McpServerInput = {
      id: "test",
      transport: "stdio",
      command: "npx.cmd",
      args: ["-y", "@test/mcp"],
    };

    const linuxRewritten = rewriteMcpServerForRemoteHost(localServer, {
      targetOs: "linux",
    });
    expect(linuxRewritten.command).toBe("npx");

    const winRewritten = rewriteMcpServerForRemoteHost(localServer, {
      targetOs: "windows",
    });
    expect(winRewritten.command).toBe("npx.cmd");
  });

  it("rewrites paths in args and env across OS boundaries", () => {
    const localServer: McpServerInput = {
      id: "filesystem",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@mcp/fs", "E:\\Code\\Project\\docs"],
      env: {
        DATA_DIR: "E:\\Code\\Project\\data",
      },
    };

    const rewritten = rewriteMcpServerForRemoteHost(localServer, {
      localRoot: "E:\\Code\\Project",
      remoteRoot: "/home/ubuntu/app",
      targetOs: "linux",
    });

    expect(rewritten.args?.[2]).toBe("/home/ubuntu/app/docs");
    expect(rewritten.env?.DATA_DIR).toBe("/home/ubuntu/app/data");
  });
});
