/**
 * Composer input history: recall a previously sent prompt with ArrowUp/Down.
 *
 * The decisions that are not mechanical:
 *
 * 1. **The history is derived, not stored.** Entries come from the active
 *     session's user messages, oldest first. No new store field, cache, or
 *     persistence is introduced, so history follows a session switch for
 *     free and survives a reload exactly as far as the transcript does.
 *     Sending inserts the optimistic user message immediately, so the prompt
 *     just sent is recallable right away.
 * 2. **Only fresh prompts count.** Mid-turn steering inputs (`steering`)
 *     and empty messages are excluded; a prompt the model saw is what gets
 *     recalled, which for plain text is exactly what was typed.
 * 3. **Navigation is pure.** The state machine below takes the entries, the
 *     current state, and the direction, and returns the next state and text
 *     (or `null` when nothing changes). The Composer owns the side effects:
 *     painting the text and saving/restoring the draft's attachments.
 * 4. **The in-progress draft is never lost.** The first ArrowUp stashes the
 *     current input; ArrowDown past the newest entry restores it verbatim
 *     and ends navigation. ArrowUp at the oldest entry stays put.
 */
import type { UiMessage } from "@dcode/shared";

/** Sent prompts for one session, oldest first, consecutive duplicates collapsed. */
export function promptHistoryFromMessages(messages: readonly UiMessage[]): string[] {
  const entries: string[] = [];
  for (const message of messages) {
    if (message.role !== "user" || message.steering) continue;
    const text = message.content.trim();
    if (!text) continue;
    if (entries[entries.length - 1] === text) continue;
    entries.push(text);
  }
  return entries;
}

export type InputHistoryDirection = "up" | "down";

/**
 * `index` points into the entries (0 is oldest); `null` means the user is
 * not navigating and the input holds their own draft. `savedDraft` is only
 * meaningful while navigating.
 */
export type InputHistoryState = {
  index: number | null;
  savedDraft: string | null;
};

export const INITIAL_INPUT_HISTORY_STATE: InputHistoryState = {
  index: null,
  savedDraft: null,
};

export type InputHistoryStep = {
  state: InputHistoryState;
  text: string;
};

/**
 * One history step. Returns `null` when the keypress changes nothing:
 * no entries, ArrowDown while not navigating, or ArrowUp already at the
 * oldest entry.
 */
export function navigateInputHistory(
  state: InputHistoryState,
  entries: readonly string[],
  direction: InputHistoryDirection,
  currentText: string,
): InputHistoryStep | null {
  if (entries.length === 0) return null;
  // Entries can shrink while navigating (e.g. the session changed under
  // us); clamp rather than indexing out of range.
  const current = state.index === null ? null : Math.min(state.index, entries.length - 1);
  if (direction === "up") {
    if (current === null) {
      const index = entries.length - 1;
      return { state: { index, savedDraft: currentText }, text: entries[index] };
    }
    if (current === 0) return null;
    const index = current - 1;
    return { state: { index, savedDraft: state.savedDraft }, text: entries[index] };
  }
  if (current === null) return null;
  if (current === entries.length - 1) {
    return { state: INITIAL_INPUT_HISTORY_STATE, text: state.savedDraft ?? "" };
  }
  const index = current + 1;
  return { state: { index, savedDraft: state.savedDraft }, text: entries[index] };
}
