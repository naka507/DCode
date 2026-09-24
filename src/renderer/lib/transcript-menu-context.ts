/**
 * The transcript's right-click menu: one surface per conversation, fed by
 * whichever row the pointer asked from.
 *
 * The menu lives at the transcript level because a row cannot own a floating
 * layer that has to outlive it — deleting a message removes its row, and the
 * transcript scroller measures every row for the minimap. Rows therefore
 * publish a request through provide/inject (the same shape
 * `lib/transcript-search-context.ts` and `lib/disclosure-anchor-context.ts`
 * use) and the provider renders exactly one `<ContextMenu>`.
 *
 * The `transcript-menu-context` module. A context object plus a `useContext`
 * hook becomes the provide/inject pair below;
 * `useChatTextActions()` is a composable, so it is unchanged.
 *
 * The store read is `store.appState?.showToast`, the tracked form of
 * the `useAppStore((state) => state.showToast)`.
 */
import { inject, provide, type InjectionKey } from "vue";
import { useI18n } from "vue-i18n";
import { copySelectionOrFallback } from "./chat-transcript-text";
import type { ContextMenuRequest } from "./context-menu-state";
import { useAppStore } from "../stores/app-store";

export type OpenTranscriptMenu = (
  event: MouseEvent,
  request: ContextMenuRequest,
) => void;

/**
 * A row rendered outside the provider (tests, a focused single-row view) keeps
 * a working handler that opens nothing rather than throwing mid-render.
 */
const NO_MENU: OpenTranscriptMenu = () => {};

const TRANSCRIPT_MENU_KEY: InjectionKey<OpenTranscriptMenu> =
  Symbol("transcript-menu");

export function provideTranscriptMenu(open: OpenTranscriptMenu): void {
  provide(TRANSCRIPT_MENU_KEY, open);
}

export function useTranscriptMenu(): OpenTranscriptMenu {
  return inject(TRANSCRIPT_MENU_KEY, NO_MENU);
}

/**
 * The clipboard and selection half of a menu item.
 *
 * A menu disappears the moment an item runs, so an item cannot report its
 * outcome through its own state the way the hover copy chips do (see
 * `useCopy`); the toast host carries the outcome instead.
 */
export function useChatTextActions() {
  const { t } = useI18n();
  const store = useAppStore();

  async function copyText(text: string, selection?: string): Promise<void> {
    const payload = copySelectionOrFallback(selection, text);
    if (!payload) return;
    try {
      await navigator.clipboard.writeText(payload);
      store.appState?.showToast(t("chat.copied"), { variant: "success" });
    } catch {
      store.appState?.showToast(t("chat.copyFailed"), { variant: "error" });
    }
  }

  /*
    Selecting the row's rendered text hands a partial copy back to the platform:
    dragging across a long answer is the only way to take a sentence out of it,
    and the row is already on screen, so nothing needs measuring.
  */
  function selectText(element: HTMLElement | null): void {
    const selection = window.getSelection();
    if (!element || !selection) return;
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  return { copyText, selectText };
}
