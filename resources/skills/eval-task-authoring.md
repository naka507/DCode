---
name: Eval Task Authoring
description: Guide for writing eval tasks for DCode's eval harness (ADR-005). Use when creating a new task under evals/tasks/ — covers task structure, assertion types, workspace fixtures, and what makes a task a good agentic benchmark.
---

# Eval Task Authoring

DCode's eval harness (`evals/`, `src/eval/`) scores the agent's behavior on coding tasks against a real DCore binary — no mocks. Assertions are outcome-based: they check what the agent produced, not the trajectory it took.

## Task Layout

```
evals/tasks/<task-id>/
  task.ts            # task definition (prompt + assertions)
  workspace/         # fixture files, copied to an isolated temp dir per run
    src/...
```

## Task Definition

```typescript
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
```

## Assertion Types

| Type | Checks |
| ---- | ------ |
| `fileExists` | A file exists at `path` |
| `fileContains` | File at `path` contains string |
| `fileNotContains` | File at `path` does not contain string |
| `commandSucceeds` | Shell command exits 0 (e.g. `npm test`, `tsc --noEmit`) |
| `maxTurns` | Agent finished within N turns |
| `maxToolCalls` | Agent used at most N tool calls (optionally filtered by `tool` name) |

Prefer `fileContains`/`commandSucceeds` (outcome) over `maxTurns`/`maxToolCalls` (budget) — budgets are guardrails against runaway agents, not proof of correctness.

## What Makes a Good Task

- **Outcome-verifiable.** The assertion must be checkable from the workspace state alone. "Refactor for readability" is not eval-able; "all tests pass" is.
- **Agentic, not single-shot.** The task should require the agent to explore (Read/Glob), decide, act (Write/Edit/Bash), and verify. If it can be done with one tool call, it doesn't discriminate between models.
- **Bounded scope.** The prompt names the files and the exact change. Open-ended tasks ("improve the codebase") produce ungradeable diffs.
- **Deterministic fixtures.** The `workspace/` dir is copied fresh per run — no network, no timestamps in assertions, no reliance on the host's global state.
- **Realistic difficulty.** `fix-typo` (2 assertions, ~3 tool calls) is the smoke test. A good regression task needs 5-15 tool calls and at least one decision point (e.g. "find the right file first").

## Running

```bash
# Provider config: evals/provider.json (gitignored) or DCODE_EVAL_PROVIDER_JSON env.
# Format: {"id":"anthropic","modelId":"...","apiKey":"...","baseUrl":"...","authKind":"api-key",...}

npm run eval -- --task <id>          # single task
npm run eval                         # all tasks
npm run eval -- --dcore /path/to/DCore  # override DCore binary
```

**Model requirement:** the harness only proves something with a model capable of agentic tool use (Claude Sonnet, GPT-4o, DeepSeek-chat class). Flash/speed-optimized models complete with 0 tool calls — the harness runs, but the assertions can't pass. That's a model limitation, not a harness bug.

## Anti-patterns

- Assertions on the agent's chat text (it's not persisted to the workspace).
- `contains` strings that appear in comments or unrelated files (use `fileNotContains` on the typo, not just `fileContains` on the fix).
- Timeouts under 2 minutes (agentic loops with a real model need room).
- Tasks that require credentials, network, or the user's real `~/.dcode` state.
