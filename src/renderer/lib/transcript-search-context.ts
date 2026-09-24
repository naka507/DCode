/**
 * The transcript's active search target, provided by the scroller and read by
 * the rows that can reveal themselves for it.
 *
 * A provide/inject pair: `provideTranscriptSearch(x)` supplies the target and
 * `useTranscriptSearchTarget()` reads it.
 */
import { inject, provide, type InjectionKey, type Ref } from "vue";
import type { TranscriptSearchTarget } from "./transcript-reading";

const TRANSCRIPT_SEARCH_KEY: InjectionKey<Ref<TranscriptSearchTarget | null>> =
  Symbol("transcript-search");

export function provideTranscriptSearch(
  target: Ref<TranscriptSearchTarget | null>,
): void {
  provide(TRANSCRIPT_SEARCH_KEY, target);
}

/** `null` outside a transcript, which is the inject default. */
export function useTranscriptSearchTarget(): TranscriptSearchTarget | null {
  return inject(TRANSCRIPT_SEARCH_KEY, null)?.value ?? null;
}
