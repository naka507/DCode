/**
 * Own transient attachment reads and preview selection, independently of drafts.
 *
 * The `useComposerImagePreview` composable. Every
 * The `useComposerImagePreview` composable. Every
 * change is mechanical:
 *   - `useState` -> `ref`, `useMemo` -> `computed`.
 * - `useEffect(., [images, workspaceRoot, generation])` -> `watch(., {
 *     immediate: true })`. The loading placeholders are published on
 *     the same tick the reads start, so the watcher has to run immediately
 *     rather than only on change.
 *   - `useAppStore((s) => …)` -> `store.appState?.…` for the two values that must
 *     re-render, and `currentAppState()` for the reads taken mid-handler
 *     (`useAppStore.getState()`), exactly as `useComposerDraft` splits them.
 *   - The returned object exposes `images` / `sources` / `preview` through
 *     getters. A hook body used to re-run on every render, so a caller reading
 *     `controller.preview` always saw the current value; a composable body runs
 *     once, so plain properties would freeze at their setup-time values and the
 *     dialog could never open. The getters read the same `computed`s that used
 *     to be recomputed per render.
 */
import { computed, ref, watch, type Ref } from "vue";
import { api } from "../../../../lib/api";
import { isImageReference } from "../image-attachments";
import type { ComposerFileReference } from "../model";
import { currentAppState, useAppStore } from "../../../../stores/app-store";

export type ComposerImageSource =
  | { status: "ready"; src: string }
  | { status: "loading" | "error"; src?: never };

type PreviewRequest = {
  id: string;
  sessionId: string;
  workspaceRoot: string | null;
  restoreFocus: () => void;
};

export function useComposerImagePreview({
  references,
  value,
  sessionId,
  editorRef,
}: {
  references: Ref<ComposerFileReference[]>;
  value: Ref<string>;
  sessionId: Ref<string>;
  editorRef: Ref<HTMLDivElement | null>;
}) {
  const store = useAppStore();
  const currentSessionId = computed(() => store.appState?.activeSessionId ?? "");
  const workspaceRoot = computed(() => store.appState?.workspace?.path ?? null);
  const images = computed(() =>
    references.value.filter(
      (reference) =>
        reference.sessionId === sessionId.value &&
        isImageReference(reference),
    ),
  );
  const request = ref<PreviewRequest | null>(null);
  const generation = ref(0);
  const loaded = ref<{
    images: ComposerFileReference[];
    workspaceRoot: string | null;
    sources: Map<string, ComposerImageSource>;
  } | null>(null);

  watch(
    [images, workspaceRoot, generation],
    (_next, _previous, onCleanup) => {
      let current = true;
      onCleanup(() => {
        current = false;
      });
      const pending = images.value;
      const sources = new Map<string, ComposerImageSource>();
      const publish = () => {
        if (current) {
          loaded.value = { images: pending, workspaceRoot: workspaceRoot.value, sources: new Map(sources) };
        }
      };
      publish();
      for (const reference of pending) {
        void api.fsReadImageDataUrl(reference.path, reference.mimeType).then(
          (result) => {
            sources.set(
              reference.id,
              result.kind === "image" && result.dataUrl
                ? { status: "ready", src: result.dataUrl }
                : { status: "error" },
            );
            publish();
          },
          () => {
            sources.set(reference.id, { status: "error" });
            publish();
          },
        );
      }
    },
    { immediate: true },
  );

  /*
   Identity, not deep equality: `loaded.images === images` is compared
    so a still-running read for the previous session could not publish its map
    into the new one. `computed` caches until a dependency changes, so the two
    sides stay reference-equal exactly while the reads are in flight.
  */
  const sources = computed(() =>
    loaded.value?.images === images.value &&
    loaded.value.workspaceRoot === workspaceRoot.value
      ? loaded.value.sources
      : undefined,
  );
  const visibleImages = computed(() =>
    images.value.filter((image) => !image.token || value.value.includes(image.token)),
  );
  const valid = computed(
    () =>
      request.value != null &&
      request.value.sessionId === currentSessionId.value &&
      request.value.sessionId === sessionId.value &&
      request.value.workspaceRoot === workspaceRoot.value &&
      visibleImages.value.some((image) => image.id === request.value?.id),
  );
  watch(valid, (isValid) => {
    if (!isValid) request.value = null;
  });

  const open = (reference: ComposerFileReference) => {
    const state = currentAppState();
    if (reference.sessionId !== (state.activeSessionId ?? "")) return;
    const editor = editorRef.value;
    if (!editor) return;
    const focused = document.activeElement;
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    const openingWorkspace = state.workspace?.path ?? null;
    request.value = {
      id: reference.id,
      sessionId: reference.sessionId,
      workspaceRoot: openingWorkspace,
      restoreFocus: () => {
        const current = currentAppState();
        if (
          !editor.isConnected ||
          (current.activeSessionId ?? "") !== reference.sessionId ||
          (current.workspace?.path ?? null) !== openingWorkspace
        ) {
          return;
        }
        if (
          focused instanceof HTMLElement &&
          focused.isConnected &&
          (editor.contains(focused) || focused.closest(".composer-image-attachments"))
        ) {
          focused.focus();
        } else {
          editor.focus();
        }
        if (range && editor.contains(range.commonAncestorContainer)) {
          const live = window.getSelection();
          live?.removeAllRanges();
          live?.addRange(range);
        }
      },
    };
  };
  const close = () => {
    request.value = null;
  };
  const select = (id: string) => {
    if (request.value) request.value = { ...request.value, id };
  };
  const retry = () => {
    generation.value += 1;
  };
  return {
    get images() {
      return visibleImages.value;
    },
    get sources() {
      return sources.value;
    },
    open,
    close,
    select,
    retry,
    get preview() {
      if (!valid.value || !request.value) return null;
      return {
        ...request.value,
        images: visibleImages.value,
        source: sources.value?.get(request.value.id) ?? ({ status: "loading" } as ComposerImageSource),
      };
    },
  };
}

export type ComposerImagePreviewController = ReturnType<typeof useComposerImagePreview>;
