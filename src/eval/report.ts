/**
 * ADR-005: prints the eval score table. Exit code is non-zero when any
 * task fails.
 */
import type { EvalTaskResult } from "./types.js";

export function printReport(results: EvalTaskResult[]): void {
  console.log("\nEval results");
  console.log("=".repeat(72));
  for (const result of results) {
    const status = result.passed ? "PASS" : "FAIL";
    const secs = (result.durationMs / 1000).toFixed(1);
    console.log(
      `${status}  ${result.taskId}  (${secs}s, ${result.trajectory.turns} turns, ${result.trajectory.toolCalls.length} tool calls)`,
    );
    if (result.error) {
      console.log(`      error: ${result.error}`);
    }
    for (const assertion of result.assertions) {
      if (!assertion.passed) {
        console.log(`      ✗ ${assertion.message}`);
      }
    }
  }
  console.log("=".repeat(72));
  const passed = results.filter((r) => r.passed).length;
  console.log(`${passed}/${results.length} tasks passed`);
}
