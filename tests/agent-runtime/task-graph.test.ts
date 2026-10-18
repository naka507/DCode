/**
 * ADR-003: subagent task dependency graph. A Task with `dependsOn` waits
 * until its dependencies settle successfully, then starts with their
 * reports injected into its brief. Failed dependencies fail the waiter
 * fast instead of hanging it.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { DesktopAgentRuntime } from "../../src/agent/runtime/runtime.js";
import type { SubagentDefinition } from "../../src/agent/runtime/runtime.js";
import type { RuntimeProviderConfig } from "../../src/agent/runtime/runtime.js";
import type { CommandShellOption } from "../../src/shared/command-shells.js";

const runs: Array<{
  options: { task: string; definition: { name: string } };
  resolve: (result: unknown) => void;
}> = [];

vi.mock("../../src/agent/runtime/subagent.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/agent/runtime/subagent.js")>();
  return {
    ...actual,
    SubagentRun: class {
      options: { task: string; definition: { name: string } };
      constructor(options: { task: string; definition: { name: string } }) {
        this.options = options;
        runs.push({ options, resolve: () => {} });
      }
      run() {
        return new Promise((resolve) => {
          runs[runs.length - 1].resolve = resolve as (result: unknown) => void;
        });
      }
    },
  };
});

const provider: RuntimeProviderConfig = {
  id: "local",
  name: "Local",
  baseUrl: "http://127.0.0.1:11434/v1",
  modelId: "local-model",
  apiKey: "",
  authKind: "none",
  supportsReasoning: true,
  supportedThinkingLevels: ["off", "low", "medium", "high"],
  modelConfig: {
    source: "generic",
    name: "Local Catalog Model",
    baseUrl: "https://catalog.invalid/v1",
    reasoning: true,
    thinkingLevelMap: { minimal: null, xhigh: null, max: null },
    input: ["text", "image"],
    cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.2 },
    contextWindow: 256_000,
    maxTokens: 32_000,
  },
};

const commandShell: CommandShellOption = {
  id: "bash",
  label: "Bash",
  dialect: "posix",
  available: true,
  isDefault: true,
};

const explorer: SubagentDefinition = {
  name: "explorer",
  description: "Search the workspace and report findings.",
  tools: ["Read", "Glob", "Grep"],
  prompt: "Report file paths and line numbers.",
  source: "builtin",
};

function createRuntime() {
  return new DesktopAgentRuntime({
    host: {
      call: vi.fn(async () => ({})),
      onNotification: () => () => {},
    } as never,
    sessionId: "session-task-graph",
    mode: "agent",
    provider,
    commandShell,
    thinkingLevel: "medium",
    subagents: [explorer],
    onEvent: () => {},
  });
}

function taskTool(runtime: DesktopAgentRuntime) {
  const tool = (runtime as any).toolCatalog.get("Task");
  expect(tool).toBeDefined();
  return tool;
}

function delegations(runtime: DesktopAgentRuntime) {
  return (runtime as any).delegations as Map<string, { status: string }>;
}

async function startTask(
  runtime: DesktopAgentRuntime,
  params: Record<string, unknown>,
) {
  const result = await taskTool(runtime).execute(`call-${Math.random()}`, {
    agent: "explorer",
    task: "Do the thing.",
    ...params,
  });
  return result as {
    content: Array<{ text: string }>;
    details: { delegationId: string; status: string };
  };
}

function settle(
  runtime: DesktopAgentRuntime,
  delegationId: string,
  status: "completed" | "failed",
  report: string,
) {
  const record = (runtime as any).delegations.get(delegationId);
  expect(record).toBeDefined();
  (runtime as any).settleDelegation(record, {
    agentName: "explorer",
    modelId: "local-model",
    thinkingLevel: "medium",
    status,
    report,
    turns: 1,
    toolCalls: 0,
  });
}

beforeEach(() => {
  runs.length = 0;
});

describe("Task dependsOn", () => {
  it("registers a waiter without starting its SubagentRun", async () => {
    const runtime = createRuntime();
    const a = await startTask(runtime, {});
    expect(a.details.status).toBe("running");
    expect(runs).toHaveLength(1);

    const b = await startTask(runtime, { dependsOn: [a.details.delegationId] });
    expect(b.details.status).toBe("waiting");
    expect(b.content[0].text).toContain("waiting for 1 dependency");
    expect(delegations(runtime).get(b.details.delegationId)?.status).toBe(
      "waiting",
    );
    // No SubagentRun for the waiter yet.
    expect(runs).toHaveLength(1);

    await runtime.dispose();
  });

  it("starts the waiter with upstream reports when dependencies complete", async () => {
    const runtime = createRuntime();
    const a = await startTask(runtime, {});
    const b = await startTask(runtime, { dependsOn: [a.details.delegationId] });

    settle(runtime, a.details.delegationId, "completed", "Found three files.");

    expect(delegations(runtime).get(b.details.delegationId)?.status).toBe(
      "running",
    );
    expect(runs).toHaveLength(2);
    expect(runs[1].options.task).toContain("Found three files.");
    expect(runs[1].options.task).toContain("Upstream results");

    await runtime.dispose();
  });

  it("fails the waiter fast when a dependency fails", async () => {
    const runtime = createRuntime();
    const a = await startTask(runtime, {});
    const b = await startTask(runtime, { dependsOn: [a.details.delegationId] });

    settle(runtime, a.details.delegationId, "failed", "Exploded.");

    const record = delegations(runtime).get(b.details.delegationId);
    expect(record?.status).toBe("failed");
    // Never started.
    expect(runs).toHaveLength(1);

    await runtime.dispose();
  });

  it("rejects unknown dependency ids", async () => {
    const runtime = createRuntime();
    const result = await taskTool(runtime).execute("call-x", {
      agent: "explorer",
      task: "Do the thing.",
      dependsOn: ["delegation-nope"],
    });
    expect(result.content[0].text).toContain('Unknown dependency "delegation-nope"');
    expect(result.details).toMatchObject({ error: expect.any(String) });

    await runtime.dispose();
  });

  it("rejects dependsOn pointing at an already-failed delegation", async () => {
    const runtime = createRuntime();
    const a = await startTask(runtime, {});
    settle(runtime, a.details.delegationId, "failed", "Exploded.");

    const result = await taskTool(runtime).execute("call-y", {
      agent: "explorer",
      task: "Do the thing.",
      dependsOn: [a.details.delegationId],
    });
    expect(result.content[0].text).toContain("already failed");
    expect(result.details).toMatchObject({ error: expect.any(String) });
    // No doomed delegation was created.
    expect(delegations(runtime).size).toBe(1);

    await runtime.dispose();
  });

  it("starts immediately with upstream reports when dependencies already completed", async () => {
    const runtime = createRuntime();
    const a = await startTask(runtime, {});
    settle(runtime, a.details.delegationId, "completed", "Found three files.");

    const b = await startTask(runtime, { dependsOn: [a.details.delegationId] });
    expect(b.details.status).toBe("running");
    expect(runs).toHaveLength(2);
    expect(runs[1].options.task).toContain("Found three files.");

    await runtime.dispose();
  });

  it("TaskStop on a waiting delegation fails it fast", async () => {
    const runtime = createRuntime();
    const a = await startTask(runtime, {});
    const b = await startTask(runtime, { dependsOn: [a.details.delegationId] });
    expect(delegations(runtime).get(b.details.delegationId)?.status).toBe(
      "waiting",
    );

    const stopTool = (runtime as any).toolCatalog.get("TaskStop");
    await stopTool.execute("stop-1", { delegationIds: [b.details.delegationId] });

    expect(delegations(runtime).get(b.details.delegationId)?.status).toBe(
      "failed",
    );
    expect(runs).toHaveLength(1);

    await runtime.dispose();
  });

  it("chains: C waits on B waits on A", async () => {
    const runtime = createRuntime();
    const a = await startTask(runtime, {});
    const b = await startTask(runtime, { dependsOn: [a.details.delegationId] });
    const c = await startTask(runtime, { dependsOn: [b.details.delegationId] });
    expect(runs).toHaveLength(1);

    settle(runtime, a.details.delegationId, "completed", "A done.");
    expect(delegations(runtime).get(b.details.delegationId)?.status).toBe(
      "running",
    );
    expect(delegations(runtime).get(c.details.delegationId)?.status).toBe(
      "waiting",
    );
    expect(runs).toHaveLength(2);

    settle(runtime, b.details.delegationId, "completed", "B done.");
    expect(delegations(runtime).get(c.details.delegationId)?.status).toBe(
      "running",
    );
    expect(runs).toHaveLength(3);
    expect(runs[2].options.task).toContain("B done.");

    await runtime.dispose();
  });
});
