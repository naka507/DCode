import { onScopeDispose, watch } from "vue";
import { api } from "../../lib/api";
import { useAppStore } from "../../stores/app-store";

/**
 * Keep local organization mirrored to Main while Main reads durable
 * session/inbox state.
 *
 * The store is subscribed to with
 * `useAppStore.subscribe((state, previous) => ...)`; it
 * is Vue-reactive, so the same four fields are watched instead.
 * The `queueMicrotask` coalescing is preserved verbatim: a burst of commits
 * inside one task must produce exactly one IPC write.
 */
export function useTraySessions({
  setSearchOpen,
  reopenSidebar,
}: {
  setSearchOpen: (open: boolean) => void;
  reopenSidebar: () => void;
}) {
  let disposed = false;
  let scheduled = false;

  const activate = (sessionId: string | null) => {
    const store = useAppStore();
    setSearchOpen(false);
    if (sessionId === null) {
      store.appState?.setPage("chat");
      reopenSidebar();
      return;
    }
    void store.appState?.selectSession(sessionId).catch((error: unknown) => {
      if (!disposed) {
        store.appState?.showToast(
          error instanceof Error ? error.message : String(error),
          { variant: "error" },
        );
      }
    });
  };

  const sync = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (disposed) return;
      const state = useAppStore().appState;
      if (!state?.ready) return;
      void api
        .setTraySessionPreferences({
          sessionMeta: state.sessionMeta,
          archivedProjectPaths: Object.entries(state.projectMeta)
            .filter(([, meta]) => meta.archived)
            .map(([path]) => path),
          // The sidebar presents its legacy manual setting using recent order.
          sort: state.sessionView.sort === "manual" ? "recent" : state.sessionView.sort,
        })
        .catch((error) => console.error("Tray session synchronization failed", error));
    });
  };

  // Main waits for the shell's post-bootstrap menuRendererReady acknowledgement.
  const offActivation = api.onTraySessionActivated(activate);
  const stopWatch = watch(
    () => {
      const state = useAppStore().appState;
      return [
        state?.ready,
        state?.sessionMeta,
        state?.projectMeta,
        state?.sessionView,
      ] as const;
    },
    sync,
  );

  sync();

  onScopeDispose(() => {
    disposed = true;
    offActivation();
    stopWatch();
  });
}
