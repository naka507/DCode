import type { EvalTask } from "../../../src/eval/types.js";

export const task: EvalTask = {
  id: "fix-typo",
  description: "Fix a typo in a greeting function.",
  prompt:
    "In src/greet.ts there is a typo in the greeting string (\"Helo\" should be \"Hello\"). Fix it. Do not change anything else.",
  workspaceDir: new URL("./workspace", import.meta.url).pathname,
  timeoutMs: 5 * 60_000,
  assertions: [
    { type: "fileContains", path: "src/greet.ts", contains: "Hello, ${name}!" },
    { type: "fileNotContains", path: "src/greet.ts", contains: "Helo" },
    { type: "maxTurns", max: 8 },
  ],
};
