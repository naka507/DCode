import type { EvalTask } from "../../../src/eval/types.js";

export const task: EvalTask = {
  id: "add-function",
  description: "Add a subtract function next to add.",
  prompt:
    "In src/math.ts there is an `add(a, b)` function. Add an exported `subtract(a, b)` function right after it that returns `a - b`. Do not change `add`.",
  workspaceDir: new URL("./workspace", import.meta.url).pathname,
  timeoutMs: 5 * 60_000,
  assertions: [
    {
      type: "fileContains",
      path: "src/math.ts",
      contains: "export function subtract",
    },
    { type: "fileContains", path: "src/math.ts", contains: "return a - b;" },
    { type: "maxTurns", max: 8 },
  ],
};
