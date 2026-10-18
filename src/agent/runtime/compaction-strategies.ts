/**
 * ADR-004 (P1-5): pluggable compaction strategies.
 *
 * The strategy contract and registry live here; `runtime.ts` keeps the
 * shared preparation phase and dispatches to the registered strategy.
 * Adding a strategy is a new `CompactionStrategyDef` + `registerCompactionStrategy`,
 * with no `runtime.ts` edits.
 */
import type { Entry } from "@earendil-works/pi-agent-core";
import type { Usage } from "@earendil-works/pi-ai";
import type {
  CheckpointBuild,
  CompactionRetentionMode,
  ContextBudget,
  ShapedPreparation,
} from "./runtime.js";
import type { ContextCompactionRecord } from "@dcode/shared";

/** Strategy name. Open for registration (was a closed union). */
export type CompactionStrategyName = string;

/** What a strategy needs from the runtime to build its checkpoint. */
export interface CompactionStrategyBuildContext {
  entries: Entry[];
  budget: ContextBudget;
  preparation: ShapedPreparation;
  signal: AbortSignal;
  retentionMode: CompactionRetentionMode;
  fullEntries: Entry[];
  fitSummaryInputToBudget(
    preparation: ShapedPreparation,
    budget: { hardLimit: number; requestHeadroom: number },
  ): ShapedPreparation | undefined;
  generateCompaction(
    preparation: ShapedPreparation,
    signal: AbortSignal,
  ): Promise<
    | { ok: true; value: { summary: string; usage?: Usage; details?: unknown; tokensBefore: number } }
    | { ok: false; error: { message: string; code: string } }
  >;
  createCheckpoint(
    preparation: ShapedPreparation,
    throughMessageId: string,
    summary: string,
    usage: Usage | undefined,
    details?: unknown,
  ): ContextCompactionRecord;
  checkpointDetails(
    preparation: ShapedPreparation,
  ): Record<string, unknown>;
  retainedReasoningForCheckpoint(preparation: ShapedPreparation): {
    retainedReasoning?: unknown;
  };
}

export interface CompactionStrategyDef {
  readonly name: string;
  /** Model-facing reply when the `new_context` tool runs. */
  readonly toolReply: string;
  build(ctx: CompactionStrategyBuildContext): Promise<CheckpointBuild>;
}

const registry = new Map<string, CompactionStrategyDef>();

export function registerCompactionStrategy(def: CompactionStrategyDef): void {
  if (registry.has(def.name)) {
    throw new Error(`compaction strategy "${def.name}" is already registered`);
  }
  registry.set(def.name, def);
}

export function getCompactionStrategy(
  name: string,
): CompactionStrategyDef | undefined {
  return registry.get(name);
}

export function compactionStrategyNames(): string[] {
  return [...registry.keys()];
}

/**
 * Resolve the strategy name: explicit option wins, else the
 * `DCODE_COMPACTION_STRATEGY` env var, else `"summary"`. Unknown names are
 * returned as-is so the caller can fail loudly instead of silently
 * falling back.
 */
export function resolveCompactionStrategyName(option?: string): string {
  if (option) return option;
  return process.env.DCODE_COMPACTION_STRATEGY === "fresh_window"
    ? "fresh_window"
    : "summary";
}

/**
 * Stands in for the summary a rollover deliberately does not generate. The
 * host rejects an empty checkpoint summary, and a silent placeholder would
 * leave the model guessing why its context changed, so the rollover says so.
 */
const CONTEXT_ROLLOVER_SUMMARY = [
  "[context rollover: a new context window was started without summarizing conversation history]",
  "Earlier messages in this session are not part of this request. The complete transcript is still available to the user, and the environment is unchanged.",
  "Ask before assuming anything about work that is not visible here.",
].join("\n\n");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function buildSummaryCheckpoint(
  ctx: CompactionStrategyBuildContext,
): Promise<CheckpointBuild> {
  const { entries, budget, preparation, signal, retentionMode } = ctx;
  const summaryInput = ctx.fitSummaryInputToBudget(preparation, budget);
  if (!summaryInput) {
    return {
      ok: false,
      entries,
      budget,
      preparation,
      tokensBefore: preparation.tokensBefore,
      message: "Compaction summary input exceeds the safe model budget",
      recoverable: true,
    };
  }

  let result: Awaited<ReturnType<CompactionStrategyBuildContext["generateCompaction"]>>;
  try {
    result = await ctx.generateCompaction(summaryInput, signal);
  } catch (error) {
    return {
      ok: false,
      entries,
      budget,
      preparation,
      tokensBefore: preparation.tokensBefore,
      message: error instanceof Error ? error.message : String(error),
      recoverable: !signal.aborted,
    };
  }
  if (!result.ok) {
    return {
      ok: false,
      entries,
      budget,
      preparation,
      tokensBefore: preparation.tokensBefore,
      message: result.error.message,
      recoverable: result.error.code !== "aborted",
    };
  }

  const throughMessageId = ctx.fullEntries.at(-1)?.id;
  if (!throughMessageId) {
    return {
      ok: false,
      entries,
      budget,
      preparation,
      message: "Compaction has no durable transcript boundary",
      recoverable: false,
    };
  }
  return {
    ok: true,
    entries,
    budget,
    preparation,
    checkpoint: ctx.createCheckpoint(
      preparation,
      throughMessageId,
      result.value.summary,
      result.value.usage,
      {
        ...(isRecord(result.value.details) ? result.value.details : {}),
        strategy: "summary",
        retainedTailMode: retentionMode,
        ...ctx.retainedReasoningForCheckpoint(preparation),
      },
    ),
  };
}

/**
 * Roll the context over without summarizing it, the way Codex's token-budget
 * compaction does. No model request, so nothing here can fail on the provider.
 * The rest of the lifecycle is shared with the summary family: this still
 * produces a durable checkpoint, a `compaction_end`, and everything the user sees.
 */
async function buildRolloverCheckpoint(
  ctx: CompactionStrategyBuildContext,
): Promise<CheckpointBuild> {
  const { entries, budget, preparation } = ctx;
  const throughMessageId = ctx.fullEntries.at(-1)?.id;
  if (!throughMessageId) {
    return {
      ok: false,
      entries,
      budget,
      preparation,
      tokensBefore: preparation.tokensBefore,
      message: "Compaction has no durable transcript boundary",
      recoverable: false,
    };
  }
  // Codex clears history outright. Retaining nothing is the point of this
  // family: it buys the whole window back instead of a summary's worth.
  const rollover: ShapedPreparation = { ...preparation, retainedTail: [] };
  return {
    ok: true,
    entries,
    budget,
    preparation: rollover,
    checkpoint: ctx.createCheckpoint(
      rollover,
      throughMessageId,
      CONTEXT_ROLLOVER_SUMMARY,
      undefined,
      {
        ...ctx.checkpointDetails(rollover),
        strategy: "fresh_window",
        retainedTailMode: "completed_turn" satisfies CompactionRetentionMode,
      },
    ),
  };
}

registerCompactionStrategy({
  name: "summary",
  toolReply:
    "A new context window will start with a summary of the conversation history.",
  build: buildSummaryCheckpoint,
});

registerCompactionStrategy({
  name: "fresh_window",
  toolReply:
    "A new context window will start without summarizing conversation history.",
  build: buildRolloverCheckpoint,
});
