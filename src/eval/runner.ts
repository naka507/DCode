/**
 * ADR-005: runs an eval task through a real DesktopAgentRuntime backed by a
 * real DCore binary, then scores outcome-based assertions.
 */
import { mkdtemp, rm, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DesktopAgentRuntime } from "../agent/runtime/runtime.js";
import type { RuntimeProviderConfig } from "../agent/runtime/runtime.js";
import type { CommandShellOption } from "../shared/command-shells.js";
import type { AgentEventEnvelope } from "../shared/types/agent.js";
import { DCoreHost } from "./dcore-host.js";
import { evaluateAssertion } from "./assertions.js";
import type {
  EvalTask,
  EvalTaskResult,
  EvalToolCall,
  EvalTrajectory,
} from "./types.js";
import { PROTOCOL_VERSION } from "../shared/protocol.js";

export interface EvalRunOptions {
  task: EvalTask;
  provider: RuntimeProviderConfig;
  commandShell: CommandShellOption;
  dcoreBinaryPath: string;
  /** Isolated data dir for DCore (SQLite). Defaults to a temp dir. */
  dcoreDataDir?: string;
}

export async function runEvalTask(
  options: EvalRunOptions,
): Promise<EvalTaskResult> {
  const { task, provider, commandShell, dcoreBinaryPath } = options;
  const startedAt = Date.now();
  const timeoutMs = task.timeoutMs ?? 10 * 60_000;

  // Isolated workspace per run.
  const workspaceDir = await mkdtemp(join(tmpdir(), `eval-${task.id}-`));
  await cp(task.workspaceDir, workspaceDir, { recursive: true });

  const dataDir = options.dcoreDataDir ?? (await mkdtemp(join(tmpdir(), `eval-dcore-`)));
  const host = new DCoreHost({
    binaryPath: dcoreBinaryPath,
    protocolVersion: PROTOCOL_VERSION,
    env: { DCODE_DATA_DIR: dataDir },
  });

  const toolCalls: EvalToolCall[] = [];
  let turns = 0;

  try {
    await host.start();
    const session = (await host.call<{ session: { id: string } }>(
      "session.create",
      {
        title: `eval/${task.id}`,
        mode: "agent",
        providerId: provider.id,
        modelId: provider.modelId,
        projectPath: workspaceDir,
      },
    )) as { session: { id: string } };
    const sessionId = session.session.id;

    // Record every tool execution for the trajectory.
    const rawCall = host.call.bind(host);
    const trackingCall = async <T>(method: string, params?: unknown): Promise<T> => {
      const result = await rawCall<T>(method, params);
      if (method === "tools.execute") {
        const p = params as { toolName?: string; args?: unknown } | undefined;
        const r = result as { ok?: boolean } | undefined;
        toolCalls.push({
          toolName: String(p?.toolName ?? "unknown"),
          args: p?.args,
          ok: r?.ok !== false,
        });
      }
      return result;
    };

    const runtime = new DesktopAgentRuntime({
      host: {
        call: trackingCall,
        onNotification: () => () => {},
        onClose: undefined,
      } as never,
      sessionId,
      mode: "agent",
      provider,
      commandShell,
      thinkingLevel: "medium",
      projectPath: workspaceDir,
      onEvent: (envelope: AgentEventEnvelope) => {
        if (envelope?.event?.type === "turn_end") turns += 1;
      },
    });

    const turnTimeout = setTimeout(() => {
      throw new Error(`eval task timed out after ${timeoutMs}ms`);
    }, timeoutMs);
    // prompt() queues the turn; wait for the agent loop to go idle.
    try {
      await runtime.prompt(task.prompt);
      await (runtime as unknown as { agent: { waitForIdle: () => Promise<void> } }).agent.waitForIdle();
    } finally {
      clearTimeout(turnTimeout);
    }

    const trajectory: EvalTrajectory = { turns, toolCalls };
    const assertions = [];
    for (const assertion of task.assertions) {
      assertions.push(await evaluateAssertion(assertion, workspaceDir, trajectory));
    }
    const passed = assertions.every((a) => a.passed);
    await runtime.dispose().catch(() => undefined);

    return {
      taskId: task.id,
      passed,
      assertions,
      trajectory,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    const trajectory: EvalTrajectory = { turns, toolCalls };
    return {
      taskId: task.id,
      passed: false,
      assertions: [],
      trajectory,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await host.stop().catch(() => undefined);
    await rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
    if (!options.dcoreDataDir) {
      await rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
