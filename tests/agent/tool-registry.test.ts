/**
 * ADR-002 Phase A CI assertions: every tool the runtime can produce must
 * have a permission declaration in the registry, so a tool added without
 * one fails the build instead of silently inheriting a default.
 */
import { describe, expect, it } from "vitest";
import {
  AGENT_MODE_BUILTIN_TOOLS,
  CONTRACT_MODE_BUILTIN_TOOLS,
  isCoreToolInMode,
  isPathMutatingTool,
  MissingToolPermissionError,
  toMcpToolContract,
  toPluginToolContract,
  TOOL_PERMISSION_DECLARATIONS,
  toToolContract,
  validateToolDeclarations,
} from "../../src/agent/tools/registry.js";
import { ASK_TOOL_NAME } from "../../src/agent/runtime/runtime.js";
import { SKILL_TOOL_NAME } from "../../src/agent/runtime/plugin-skills-prompt.js";
import {
  SUBAGENT_LIST_TOOL_NAME,
  SUBAGENT_STOP_TOOL_NAME,
  SUBAGENT_TOOL_NAME,
  SUBAGENT_WAIT_TOOL_NAME,
} from "../../src/agent/runtime/subagent.js";

// Tool names produced by buildToolDefinitions() outside the builtin lists.
const MODE_TRANSITION_TOOLS = [
  "EnterPlanMode",
  "EnterGoalMode",
  "SubmitPlan",
  "SubmitGoal",
];
const CONTEXT_COMPACTION_TOOL = "new_context";

const ALL_STATIC_TOOLS = [
  ...AGENT_MODE_BUILTIN_TOOLS,
  ...CONTRACT_MODE_BUILTIN_TOOLS,
  ASK_TOOL_NAME,
  SKILL_TOOL_NAME,
  ...MODE_TRANSITION_TOOLS,
  SUBAGENT_TOOL_NAME,
  SUBAGENT_WAIT_TOOL_NAME,
  SUBAGENT_LIST_TOOL_NAME,
  SUBAGENT_STOP_TOOL_NAME,
  CONTEXT_COMPACTION_TOOL,
];

describe("tool registry (ADR-002 Phase A)", () => {
  it("declares a permission for every statically-known tool", () => {
    expect(validateToolDeclarations(ALL_STATIC_TOOLS)).toEqual([]);
  });

  it("rejects tools without a declaration instead of defaulting", () => {
    expect(() => toToolContract({
      name: "SomeFutureTool",
      source: "builtin",
      description: "x",
      inputSchema: {},
    })).toThrow(MissingToolPermissionError);
    expect(validateToolDeclarations(["Read", "Nope"])).toEqual(["Nope"]);
  });

  it("derives the path-mutating set from declarations", () => {
    // Guards the Phase C rewiring: isPathMutatingTool must agree with the
    // historical PATH_MUTATING_TOOLS = {"Write", "Edit"} set.
    const mutating = ALL_STATIC_TOOLS.filter(isPathMutatingTool);
    expect(new Set(mutating)).toEqual(new Set(["Write", "Edit"]));
  });

  it("rates mutating and executing tools at medium risk or higher", () => {
    for (const name of ["Write", "Edit", "Bash", "SubmitPlan", "SubmitGoal"]) {
      const { risk } = TOOL_PERMISSION_DECLARATIONS[name];
      expect(["medium", "high"]).toContain(risk);
    }
  });

  it("keeps read-only tools at low risk", () => {
    for (const name of ["Read", "Glob", "Grep", "BrowserPreview", "asktool", "Skill"]) {
      const { scope, risk } = TOOL_PERMISSION_DECLARATIONS[name];
      expect(scope).toBe("read");
      expect(risk).toBe("low");
    }
  });

  it("builds contracts from declarations", () => {
    const contract = toToolContract({
      name: "Bash",
      source: "builtin",
      description: "Run a shell command.",
      inputSchema: { type: "object" },
    });
    expect(contract.permission).toEqual({
      scope: "execute",
      risk: "high",
      paths: "any",
    });
    expect(contract.idempotent).toBe(false);
    expect(contract.supportsDryRun).toBe(false);
    expect(contract.source).toBe("builtin");
  });
});

describe("tool registry (ADR-002 Phase C)", () => {
  it("derives core tools per mode from the registry", () => {
    // Guards the Phase C rewiring: isCoreToolInMode must agree with the
    // deleted CHAT_CORE_TOOL_NAMES / AGENT_CORE_TOOL_NAMES sets and the
    // contract-mode inline set in runtime.ts.
    const agentCore = ["Read", "Write", "Edit", "Bash", "asktool", "Skill"];
    const chatCore = ["Read", "Glob", "Grep", "asktool"];
    const contractCore = ["Read", "Glob", "Grep", "Bash", "BrowserPreview", "asktool"];
    for (const name of agentCore) expect(isCoreToolInMode(name, "agent")).toBe(true);
    for (const name of chatCore) expect(isCoreToolInMode(name, "chat")).toBe(true);
    for (const name of contractCore) expect(isCoreToolInMode(name, "contract")).toBe(true);
    // Spot-check exclusions: Write/Edit are agent-only, Glob/Grep are not.
    expect(isCoreToolInMode("Write", "chat")).toBe(false);
    expect(isCoreToolInMode("Write", "contract")).toBe(false);
    expect(isCoreToolInMode("Glob", "agent")).toBe(false);
    expect(isCoreToolInMode("BrowserPreview", "agent")).toBe(false);
    expect(isCoreToolInMode("BrowserPreview", "chat")).toBe(false);
    expect(isCoreToolInMode("Nope", "agent")).toBe(false);
  });

  it("converts plugin manifest tools to the contract", () => {
    const contract = toPluginToolContract("demo", {
      name: "echo_text",
      description: "Echo text back.",
      risk: "low",
      schema: { type: "object", properties: { text: { type: "string" } } },
    });
    expect(contract.name).toBe("plugin_demo_echo_text");
    expect(contract.source).toBe("plugin");
    expect(contract.permission).toEqual({ scope: "execute", risk: "low" });
    expect(contract.inputSchema).toEqual({
      type: "object",
      properties: { text: { type: "string" } },
    });
    // Untrusted third-party code: conservative defaults.
    expect(contract.idempotent).toBe(false);
    expect(contract.supportsDryRun).toBe(false);
  });

  it("defaults plugin tool scope/risk when the manifest omits them", () => {
    const contract = toPluginToolContract("demo", {
      name: "do_thing",
      description: "Does a thing.",
    });
    expect(contract.permission).toEqual({ scope: "execute", risk: "medium" });
    expect(contract.inputSchema).toEqual({});
  });

  it("converts MCP tools to the contract with medium default risk", () => {
    const contract = toMcpToolContract("github", "create_issue", {
      description: "Create an issue.",
      schema: { type: "object" },
    });
    expect(contract.name).toBe("mcp_github_create_issue");
    expect(contract.source).toBe("mcp");
    expect(contract.permission).toEqual({ scope: "execute", risk: "medium" });
    expect(contract.idempotent).toBe(false);
    expect(contract.supportsDryRun).toBe(false);
  });

  it("honors the MCP per-tool risk override", () => {
    const low = toMcpToolContract("github", "get_issue", {
      description: "Get an issue.",
      riskOverride: "low",
    });
    expect(low.permission.risk).toBe("low");
    const high = toMcpToolContract("github", "delete_repo", {
      description: "Delete a repo.",
      riskOverride: "high",
    });
    expect(high.permission.risk).toBe("high");
  });
});
