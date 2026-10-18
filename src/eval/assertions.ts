/**
 * ADR-005: outcome-based assertion evaluators. Assertions check what the
 * agent produced, not how it got there, so prompt/model improvements don't
 * break the eval.
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  EvalAssertion,
  EvalAssertionResult,
  EvalTrajectory,
} from "./types.js";

export async function evaluateAssertion(
  assertion: EvalAssertion,
  workspaceDir: string,
  trajectory: EvalTrajectory,
): Promise<EvalAssertionResult> {
  const fail = (message: string): EvalAssertionResult => ({
    assertion,
    passed: false,
    message,
  });
  const pass = (message: string): EvalAssertionResult => ({
    assertion,
    passed: true,
    message,
  });

  switch (assertion.type) {
    case "fileExists": {
      try {
        await readFile(join(workspaceDir, assertion.path));
        return pass(`file exists: ${assertion.path}`);
      } catch {
        return fail(`file missing: ${assertion.path}`);
      }
    }
    case "fileContains": {
      let content: string;
      try {
        content = await readFile(join(workspaceDir, assertion.path), "utf8");
      } catch {
        return fail(`file missing: ${assertion.path}`);
      }
      return content.includes(assertion.contains)
        ? pass(`${assertion.path} contains expected text`)
        : fail(`${assertion.path} does not contain: ${assertion.contains}`);
    }
    case "fileNotContains": {
      let content: string;
      try {
        content = await readFile(join(workspaceDir, assertion.path), "utf8");
      } catch {
        return fail(`file missing: ${assertion.path}`);
      }
      return content.includes(assertion.contains)
        ? fail(`${assertion.path} unexpectedly contains: ${assertion.contains}`)
        : pass(`${assertion.path} does not contain forbidden text`);
    }
    case "commandSucceeds": {
      const timeoutMs = assertion.timeoutMs ?? 60_000;
      try {
        await new Promise<void>((resolve, reject) => {
          const child = execFile(
            "sh",
            ["-c", assertion.command],
            { cwd: workspaceDir, timeout: timeoutMs },
            (error) => (error ? reject(error) : resolve()),
          );
          child.on("error", reject);
        });
        return pass(`command succeeded: ${assertion.command}`);
      } catch (error) {
        return fail(
          `command failed: ${assertion.command}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    case "maxTurns": {
      return trajectory.turns <= assertion.max
        ? pass(`turns ${trajectory.turns} <= ${assertion.max}`)
        : fail(`turns ${trajectory.turns} > ${assertion.max}`);
    }
    case "maxToolCalls": {
      const count = assertion.tool
        ? trajectory.toolCalls.filter((c) => c.toolName === assertion.tool).length
        : trajectory.toolCalls.length;
      const label = assertion.tool ?? "total";
      return count <= assertion.max
        ? pass(`${label} tool calls ${count} <= ${assertion.max}`)
        : fail(`${label} tool calls ${count} > ${assertion.max}`);
    }
  }
}
