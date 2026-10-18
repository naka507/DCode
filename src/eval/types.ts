/**
 * ADR-005: eval harness types.
 */

export type EvalAssertion =
  | { type: "fileExists"; path: string }
  | { type: "fileContains"; path: string; contains: string }
  | { type: "fileNotContains"; path: string; contains: string }
  | { type: "commandSucceeds"; command: string; timeoutMs?: number }
  | { type: "maxTurns"; max: number }
  | { type: "maxToolCalls"; max: number; tool?: string };

export interface EvalTask {
  /** Unique id, also the directory name under evals/tasks/. */
  id: string;
  description: string;
  /** The prompt given to the agent. */
  prompt: string;
  /** Fixture directory; copied to a temp workspace per run. */
  workspaceDir: string;
  /** Per-task timeout. Default 10 minutes. */
  timeoutMs?: number;
  assertions: EvalAssertion[];
}

export interface EvalToolCall {
  toolName: string;
  args: unknown;
  ok: boolean;
}

export interface EvalTrajectory {
  turns: number;
  toolCalls: EvalToolCall[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

export interface EvalAssertionResult {
  assertion: EvalAssertion;
  passed: boolean;
  message: string;
}

export interface EvalTaskResult {
  taskId: string;
  passed: boolean;
  assertions: EvalAssertionResult[];
  trajectory: EvalTrajectory;
  durationMs: number;
  error?: string;
}
