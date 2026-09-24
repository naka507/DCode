/**
 * Verified chat text: file-like prose keeps its literal text until a real
 * filesystem lookup confirms a file.
 *
 * The composable. (sha
 * f3843754, then a1db7e99 "fix(chat): pin file-chip verification to workspace
 * path"). The two commits land as one composable here.
 *
 * The decisions that are not mechanical:
 *
 *  1. **`useMemo` is a `computed`, and its identity is the staleness check.**
 * `result.request === request` is compared because a new memo object
 *     meant the text, workspace, session, or attachments had changed. A cached
 *     `computed` gives the same identity semantics, so a stale lookup result is
 *     still discarded when the message scope moves.
 * 2. **`useEffect` is a `watch` with `onCleanup`.** The cleanup aborted
 *     the controller; `onCleanup` does the same, and `{ immediate: true }` runs
 *     the effect for the first message exactly as a mount effect would.
 *  3. **`useAppStore((s) => s.workspace?.path)` reads `appState`.** `appState`
 *     is the store's `shallowRef`; `getState()` is not part of its
 *     surface. The selector is pinned to the workspace *path* (a1db7e99) so a
 *     rename, which replaces the workspace object, does not rebuild every
 *     visible user-message lookup.
 *  4. **The arguments are getters.** `LinkifiedText` reads `props`, and a plain
 *     string argument would freeze the first render's text.
 */
import type { MessageAttachment } from "@dcode/shared";
import { computed, onScopeDispose, ref, watch, type ComputedRef } from "vue";
import { api } from "../lib/api";
import { splitChatText, type ChatTextSegment } from "../lib/chat-links";
import {
  chatFileCandidates,
  createChatFileVerificationQueue,
  verifiedChatSegments,
  verifyChatFiles,
} from "../lib/verified-chat-files";
import { useAppStore } from "../stores/app-store";

const scheduleVerification = createChatFileVerificationQueue();
const EMPTY: ReadonlySet<string> = new Set();

type VerificationRequest = {
  segments: ChatTextSegment[];
  trusted: ReadonlySet<string>;
  sessionId: string | undefined;
  paths: string[];
};

/** Confirmation belongs to this text and workspace path/session, never the next one. */
export function useVerifiedChatText(
  text: () => string,
  attachments: () => readonly MessageAttachment[] | undefined,
): ComputedRef<ChatTextSegment[]> {
  const store = useAppStore();
  const workspacePath = computed(() => store.appState?.workspace?.path);
  const sessionId = computed(() => store.appState?.activeSessionId);

  const request = computed<VerificationRequest>(() => {
    const segments = splitChatText(text(), workspacePath.value);
    const trusted = new Set(attachments()?.map((attachment) => attachment.ref));
    return {
      segments,
      trusted,
      sessionId: sessionId.value,
      paths: chatFileCandidates(segments, trusted),
    };
  });

  const result = ref<{ request: VerificationRequest; verified: ReadonlySet<string> } | null>(
    null,
  );

  watch(
    request,
    (current, _previous, onCleanup) => {
      if (current.paths.length === 0) return;
      const controller = new AbortController();
      void verifyChatFiles(
        current.paths,
        (path) =>
          scheduleVerification(
            async () =>
              (await api.fsResolveRef(path, current.sessionId ?? undefined)).match != null,
            controller.signal,
          ),
        controller.signal,
        // Avoid logging the message, path, or an arbitrary IPC error payload.
        () => console.warn("Chat file reference verification failed"),
      ).then((verified) => {
        if (!controller.signal.aborted) result.value = { request: current, verified };
      });
      onCleanup(() => controller.abort());
    },
    { immediate: true },
  );

  // The lookup is speculative and outlives this row's scope; a late abort only
  // means the promise resolves to `false` for a path nobody reads any more.
  onScopeDispose(() => {
    result.value = null;
  });

  return computed(() => {
    const current = request.value;
    const verified = new Set([
      ...current.trusted,
      ...(result.value?.request === current ? result.value.verified : EMPTY),
    ]);
    return verifiedChatSegments(current.segments, verified);
  });
}
