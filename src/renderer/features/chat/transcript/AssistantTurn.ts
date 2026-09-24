/**
 * Framework-free half of the transcript turn module.
 *
 * The module exports six names — two pure equality helpers and four rendered
 * pieces — and a `.vue` file can export neither a sibling nor a plain function,
 * so the module splits the way the activity group does:
 *
 *   - here: `compactionMarksEqual`, `transcriptEntryEqual`, the module-private
 *     `transcriptEntryKey` that sat beside them, and the comparator they are
 *     built on (`assistantTurnPropsEqual`, module-private here too);
 *   - one `.vue` per rendered component, named after it: `AssistantTurn.vue`,
 *     `CompactionRow.vue`, `TranscriptEntryView.vue`, `TranscriptHistory.vue`,
 *     `TranscriptTail.vue`. `AssistantTurn.vue` re-exports all five plus these
 * helpers, so a call site keeps one module specifier.
 *
 * The comparators exist to define when two entries render the same rows:
 * `assistantTurnPropsEqual` is what
 * `transcriptEntryEqual` uses to compare two turns. A Vue component re-renders
 * only when a value its render reads changes, so nothing calls them today — but
 * they are this module's written definition of "these two entries render the
 * same rows", and `lib/assistant-turns.ts`'s identity reuse leans on the same
 * idea, so they are kept rather than dropped.
 */
import type { AgentActivity, ContextCompactionMark } from "@dcode/shared";
import type {
  AssistantTurnEntry,
  TranscriptEntry,
} from "../../../lib/assistant-turns";
import { activityItemsEqual } from "./activity-group";

type AssistantTurnProps = {
  entry: AssistantTurnEntry;
  isActive: boolean;
  runtimeActivity?: AgentActivity;
};

/** The earlier version's `assistantTurnPropsEqual`, unchanged. */
function assistantTurnPropsEqual(
  previous: AssistantTurnProps,
  next: AssistantTurnProps,
) {
  if (
    previous.isActive !== next.isActive ||
    previous.runtimeActivity !== next.runtimeActivity ||
    previous.entry.anchorId !== next.entry.anchorId ||
    previous.entry.parts.length !== next.entry.parts.length
  ) {
    return false;
  }
  return previous.entry.parts.every((part, index) => {
    const nextPart = next.entry.parts[index];
    if (part.kind !== nextPart.kind) return false;
    if (part.kind === "message" && nextPart.kind === "message") {
      return part.message === nextPart.message;
    }
    if (part.kind === "activity" && nextPart.kind === "activity") {
      return (
        part.endedAt === nextPart.endedAt &&
        part.items.length === nextPart.items.length &&
        part.items.every((item, itemIndex) =>
          activityItemsEqual(item, nextPart.items[itemIndex]),
        )
      );
    }
    return false;
  });
}

export function compactionMarksEqual(
  previous: ContextCompactionMark,
  next: ContextCompactionMark,
): boolean {
  return (
    previous.id === next.id &&
    previous.throughMessageId === next.throughMessageId &&
    previous.generation === next.generation &&
    previous.summaryTokens === next.summaryTokens &&
    previous.summarized === next.summarized &&
    previous.fallback === next.fallback
  );
}

/** Compare the data that can change a transcript row's rendered output. */
export function transcriptEntryEqual(
  previous: TranscriptEntry,
  next: TranscriptEntry,
): boolean {
  if (previous === next) return true;
  if (previous.kind !== next.kind) return false;
  if (previous.kind === "message" && next.kind === "message") {
    return previous.message === next.message;
  }
  if (previous.kind === "compaction" && next.kind === "compaction") {
    return compactionMarksEqual(previous.mark, next.mark);
  }
  if (previous.kind === "assistant-turn" && next.kind === "assistant-turn") {
    return assistantTurnPropsEqual(
      { entry: previous, isActive: false },
      { entry: next, isActive: false },
    );
  }
  return false;
}

/**
 * The `key` given each rendered row: a compaction has no message of its
 * own, a turn is keyed by its first message, and a plain row by its message.
 */
export function transcriptEntryKey(entry: TranscriptEntry): string {
  if (entry.kind === "compaction") return entry.mark.id;
  if (entry.kind === "assistant-turn") return entry.id;
  return entry.message.id;
}

