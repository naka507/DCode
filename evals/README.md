# Eval Harness (ADR-005)

Scores the agent's behavior on coding tasks against a real DCore binary —
no mocks.

## Layout

- `evals/tasks/<id>/task.ts` — task definition (prompt + assertions).
- `evals/tasks/<id>/workspace/` — fixture files, copied to an isolated temp
  dir per run.
- `evals/provider.json` — **gitignored**. Your `RuntimeProviderConfig`
  (or set `DCODE_EVAL_PROVIDER_JSON`).
- `src/eval/` — harness implementation.

## Running

```bash
# 1. Build DCore once:
(cd ~/workspace/repos/DCore && cargo build)

# 2. Configure your model in evals/provider.json, e.g.:
# {"id":"anthropic","name":"Anthropic","modelId":"claude-sonnet-4-20250514",
#  "apiKey":"...","authKind":"api-key","supportsReasoning":true,
#  "supportedThinkingLevels":["off","low","medium","high"]}

# 3. Run:
npm run eval
npm run eval -- --task fix-typo
npm run eval -- --dcore /path/to/DCore
```

`--dcore` / `DCODE_EVAL_DCORE` overrides the binary path (default:
`~/workspace/repos/DCore/target/debug/DCore`).

## Writing a task

```ts
import type { EvalTask } from "../../../src/eval/types.js";

export const task: EvalTask = {
  id: "my-task",
  description: "What it measures.",
  prompt: "Instructions for the agent.",
  workspaceDir: new URL("./workspace", import.meta.url).pathname,
  assertions: [
    { type: "fileContains", path: "src/x.ts", contains: "expected" },
    { type: "maxTurns", max: 10 },
  ],
};
```

Assertion types: `fileExists`, `fileContains`, `fileNotContains`,
`commandSucceeds`, `maxTurns`, `maxToolCalls` (optionally per tool).

Assertions are outcome-based, not trajectory-based: improving the prompt or
model must not break the eval.

## CI

Not run in CI — it needs API keys and a DCore build. Run it locally before
and after architecture changes as a behavioral regression gate.
