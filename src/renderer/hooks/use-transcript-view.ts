/**
 * Main transcript and subagent details consume the same renderer reading range.
 *
 * The `hooks/use-transcript-view.ts` surface.
 *
 * The store is read through three selector calls combined with `useMemo`,
 * which re-ran on every render. A composable's setup runs once, so each
 * returned member is a `computed` over the store instead, and `sessionId`
 * is accepted as a `MaybeRefOrGetter<string>`, because the
 * call sites pass a session id that can change when the pane is reused
 * for another session, and a plain string would freeze the reading range at the
 * first one. The returned member names are unchanged.
 *
 * `EMPTY_TRANSCRIPT` is a module-level constant, so falling back to it keeps
 * an identity-stable empty array.
 */
import { computed, toValue, type ComputedRef, type MaybeRefOrGetter } from "vue";
import type { UiMessage } from "@dcode/shared";
import {
  EMPTY_TRANSCRIPT,
  transcriptViewMessages,
  type TranscriptSearchTarget,
} from "../lib/transcript-reading";
import { useAppStore } from "../stores/app-store";

export type TranscriptViewRange = {
  messages: ComputedRef<UiMessage[]>;
  hasMoreBefore: ComputedRef<boolean>;
  hasMoreAfter: ComputedRef<boolean>;
  focus: ComputedRef<TranscriptSearchTarget | null>;
  parentMessage: ComputedRef<UiMessage | undefined>;
  historical: ComputedRef<boolean>;
  loading: ComputedRef<boolean>;
};

export function useTranscriptView(
  sessionId: MaybeRefOrGetter<string>,
): TranscriptViewRange {
  const store = useAppStore();

  const live = computed(() => {
    const id = toValue(sessionId);
    const state = store.appState;
    return state?.activeSessionId === id
      ? (state?.messages ?? EMPTY_TRANSCRIPT)
      : (state?.retainedTranscripts[id] ?? EMPTY_TRANSCRIPT);
  });
  const history = computed(() => store.appState?.sessionHistory[toValue(sessionId)]);
  const view = computed(() => store.appState?.transcriptViews[toValue(sessionId)]);
  const messages = computed(() => transcriptViewMessages(live.value, view.value));
  return {
    messages,
    hasMoreBefore: computed(
      () => view.value?.hasMoreBefore ?? history.value?.hasMoreBefore ?? false,
    ),
    hasMoreAfter: computed(() => view.value?.hasMoreAfter ?? false),
    focus: computed(() => view.value?.focus ?? null),
    parentMessage: computed(() => view.value?.parentMessage),
    historical: computed(() => Boolean(view.value?.focus)),
    loading: computed(() => Boolean(view.value?.loading)),
  };
}
