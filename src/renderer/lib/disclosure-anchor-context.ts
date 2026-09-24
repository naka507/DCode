/**
 * Hands the title element of a manual disclosure to the scroll container that
 * owns it, synchronously, before the expansion state changes (#324).
 *
 * Every scroll owner
 * provides its own notifier — the transcript scroller and each nested follow
 * scroller (D302) — so the innermost owner wins: a row inside a delegate's dock
 * hands its reading position to that dock, not to the transcript behind it, and
 * a row inside the transcript hands it to the transcript. Without a provider (a
 * row rendered outside any scroller) the notification is simply a no-op.
 *
 * `DisclosureAnchorContext.Provider value={notifier}` becomes
 * `provideDisclosureAnchorNotifier(notifier)`.
 */
import { inject, provide, type InjectionKey } from "vue";

export type DisclosureAnchorNotifier = (title: HTMLElement | null) => void;

const DISCLOSURE_ANCHOR_KEY: InjectionKey<DisclosureAnchorNotifier> =
  Symbol("disclosure-anchor");

export function provideDisclosureAnchorNotifier(
  notifier: DisclosureAnchorNotifier,
): void {
  provide(DISCLOSURE_ANCHOR_KEY, notifier);
}

export function useDisclosureAnchorNotifier(): DisclosureAnchorNotifier | null {
  return inject(DISCLOSURE_ANCHOR_KEY, null);
}
