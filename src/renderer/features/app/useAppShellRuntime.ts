/**
 * The application shell's runtime: every effect the shell needs that
 * is not markup — the sidebar's collapse/expand transition, the work panel's
 * presentation handshake with the native reservation, the global keyboard
 * shortcuts, the host-event subscriptions, the theme and font application, and
 * the startup-splash timeline.
 *
 * Two structural choices, both forced by Vue:
 *
 *   1. State that used to be mirrored into `useRef` cells so that listeners
 *      registered once could still read a fresh value now lives in plain refs. A
 *      Vue `ref` is already fresh when read, so those mirror cells are gone: the
 *      effects read the state refs directly, and the keydown listener registers
 *      once instead of re-registering on every dependency change. The one mirror
 *      that was load-bearing for more than freshness — `workPanelOpenRef`, which
 *      held `workPanelVisible` (the panel *or* the subagent dock) — is kept as the
 *      `workPanelVisible` projection, so `reopenSidebar` still yields the width
 *      when only the dock is open.
 *
 *   2. The composable does not return `t` and a `splash` node. The shell calls `useI18n`
 *      itself and renders `<StartupSplash :exiting="splashExiting" />` from
 *      `showSplash` / `splashExiting`, because a composable cannot return markup.
 *
 * The sidebar width is shell-owned: the column resizes through the right-edge
 * handle, the live three-column budget caps it so MainChat keeps its floor, and
 * only a committed width is persisted.
 */
import { computed, onMounted, onScopeDispose, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  KEYBOARD_SHORTCUTS,
  isActiveInProject,
  isThemeColorScheme,
  keybindingDisplayParts,
  keybindingMatchesEvent,
  resolveFontScale,
  resolveKeybinding,
  type AppMenuCommand,
  type KeyboardShortcutId,
  type ShortcutPlatform,
} from "@dcode/shared";
import { installRendererApi } from "../../capture/renderer-api";
import { api } from "../../lib/api";
import {
  clampSidebarWidth,
  loadSidebarWidth,
  saveSidebarWidth,
} from "../../lib/sidebar-preferences";
import { sidebarWidthBudget } from "../../lib/sidebar-resize";
import { commitWorkPanelPresentation } from "../../lib/work-panel-presentation";
import {
  MAIN_PANE_MIN_WIDTH,
  WORK_PANEL_DEFAULT_WIDTH,
  workPanelWidthForSidebarReopen,
} from "../../lib/work-panel-resize";
import { browserPluginTab } from "../../lib/work-panel-tabs";
import { useAppStore } from "../../stores/app-store";
import { useSidebarTransition } from "./useSidebarTransition";
import { useTraySessions } from "./useTraySessions";

/** Keys that are a modifier on their own: a shortcut never fires on them. */
const MODIFIER_ONLY_KEYS = new Set([
  "Alt",
  "AltGraph",
  "Control",
  "Meta",
  "Shift",
]);

const PLUGIN_THEME_STYLE_ID = "pi-plugin-theme";

export function useAppShellRuntime() {
  const { t } = useI18n();
  const store = useAppStore();
  const platform = (window.dcode?.platform ?? "darwin") as ShortcutPlatform;

  // Tracked projections of the composed state. A component re-renders because
  // one of these changed, not because the whole shallow ref was replaced.
  const ready = computed(() => store.appState?.ready ?? false);
  const page = computed(() => store.appState?.page ?? "chat");
  const activeSessionId = computed(() => store.appState?.activeSessionId);
  const settings = computed(() => store.appState?.settings);
  const plugins = computed(() => store.appState?.plugins ?? []);
  const pluginThemes = computed(() => store.appState?.pluginThemes ?? []);
  const projectPath = computed(() => store.appState?.workspace?.path ?? null);
  const subagentPanel = computed(() => store.appState?.subagentPanel ?? null);
  const workPanelOpen = computed(() => store.appState?.workPanelOpen ?? false);
  const workPanelWidth = computed(
    () => store.appState?.workPanelWidth ?? WORK_PANEL_DEFAULT_WIDTH,
  );
  const subagentPanelOpen = computed(
    () =>
      page.value === "chat" &&
      subagentPanel.value !== null &&
      subagentPanel.value.sessionId === activeSessionId.value,
  );
  const workPanelVisible = computed(
    () => workPanelOpen.value || subagentPanelOpen.value,
  );

  const searchOpen = ref(false);
  const setSearchOpen = (open: boolean) => {
    searchOpen.value = open;
  };
  const sidebarCollapsed = ref(false);
  const sidebarWidth = ref(loadSidebarWidth());
  /**
   * The last width the user actually committed. A drag preview never writes
   * it, so a drag that collapses the sidebar and a later reopen return the
   * preferred column instead of the narrow preview the gesture stopped at.
   */
  const sidebarPreferredWidthRef = ref(sidebarWidth.value);

  const { sidebarEntering, sidebarExiting, handleSidebarAnimationEnd } =
    useSidebarTransition(
      sidebarCollapsed,
      computed(() => ready.value && page.value !== "settings"),
    );
  const shellWidth = ref(0);
  const appShellRef = ref<HTMLDivElement | null>(null);

  // The shell is a fixed client area: the three-column budget needs its real
  // measured width, not the native window bounds, because the reservation seam
  // stays at zero.
  onMounted(() => {
    const shell = appShellRef.value;
    if (!shell) return;
    const update = () => {
      shellWidth.value = Math.round(shell.clientWidth);
    };
    update();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update);
      onScopeDispose(() => window.removeEventListener("resize", update));
      return;
    }
    const observer = new ResizeObserver(update);
    observer.observe(shell);
    onScopeDispose(() => observer.disconnect());
  });

  // `autoCollapsedSidebar` remembers that the layout, not the user, collapsed
  // the sidebar, so closing the panel can give it back. It is deliberately not
  // reactive: nothing renders from it.
  let autoCollapsedSidebar = false;

  /**
   * The live upper bound the sidebar may resize into: the three-column
   * remainder after MainChat's floor and an occupying work panel. A user-chosen
   * width therefore can never trip the sidebar yield.
   */
  function resolveSidebarMax(): number {
    return sidebarWidthBudget({
      containerWidth: appShellRef.value?.clientWidth || shellWidth.value,
      workPanelOpen: workPanelVisible.value,
      workPanelWidth: workPanelWidth.value,
      workPanelMaximized: workPanelMaximized.value,
    });
  }
  /** A drag preview: clamped to the live budget and deliberately not persisted. */
  function handleSidebarWidthChange(width: number): void {
    sidebarWidth.value = clampSidebarWidth(width, resolveSidebarMax());
  }
  /** A committed width: persisted, and the width a reopen restores. */
  function handleSidebarWidthCommit(width: number): void {
    const nextWidth = clampSidebarWidth(width, resolveSidebarMax());
    sidebarPreferredWidthRef.value = nextWidth;
    sidebarWidth.value = nextWidth;
    saveSidebarWidth(nextWidth);
  }
  /** A drag below the collapse threshold yields the column as a user action. */
  function handleSidebarResizeCollapse(): void {
    autoCollapsedSidebar = false;
    sidebarCollapsed.value = true;
  }

  /**
   * Reopening prefers the right column: the work panel gives up width first so
   * the main pane keeps the width it already had, and only a would-be breach of
   * the 450px floor falls back to the 460px reopen target. The column comes back
   * at the user's preferred width, which a collapsing drag never overwrites.
   */
  function reopenSidebar(): void {
    if (!sidebarCollapsed.value) return;
    const preferredWidth = clampSidebarWidth(sidebarPreferredWidthRef.value);
    if (workPanelVisible.value && !workPanelMaximized.value) {
      const currentPanelWidth = workPanelWidth.value;
      const width =
        appShellRef.value?.clientWidth ||
        shellWidth.value ||
        currentPanelWidth + MAIN_PANE_MIN_WIDTH;
      const nextPanelWidth = workPanelWidthForSidebarReopen({
        containerWidth: width,
        sidebarWidth: preferredWidth,
        currentPanelWidth,
      });
      store.appState?.setWorkPanelWidth(nextPanelWidth);
    }
    autoCollapsedSidebar = false;
    sidebarWidth.value = preferredWidth;
    sidebarCollapsed.value = false;
  }

  /** Every invocation is a user action, so it clears the automatic record. */
  function toggleSidebar(): void {
    autoCollapsedSidebar = false;
    if (sidebarCollapsed.value) reopenSidebar();
    else sidebarCollapsed.value = true;
  }

  // Main mirrors the user's sidebar organization into the tray menu and pushes
  // back which row was clicked. `setSearchOpen` and `reopenSidebar` are the
  // shell's own, so a tray activation lands exactly like the in-app gesture.
  useTraySessions({ setSearchOpen, reopenSidebar });

  /**
   * The layout, not the user, yields the sidebar when the panel would push the
   * main pane under its floor. The record is remembered only until the panel
   * closes.
   */
  function autoCollapseSidebar(): void {
    if (sidebarCollapsed.value) return;
    autoCollapsedSidebar = true;
    sidebarCollapsed.value = true;
  }

  const presentedWorkPanelOpen = ref(false);
  const workPanelMaximized = ref(false);
  const workPanelExiting = ref(false);
  let workPanelReservationRequest = 0;
  /** Bumped on every exit; the panel's `animationend` reports its generation. */
  const workPanelExitGeneration = ref(0);
  let workPanelExitClosing = false;

  // Boot-time notices: a dead backend, and a build that is not native to this
  // CPU (it runs, just slower, so the arch hint is dismissible).
  const backendDown = ref<{
    fatal: boolean;
    component?: string;
    message?: string;
    schema?: { found: number; supported: number };
  } | null>(null);
  const archMismatch = ref<{
    platform: string;
    processArch: string;
    machineArch: string;
  } | null>(null);

  watch([activeSessionId, page, subagentPanel], () => {
    const panel = subagentPanel.value;
    if (
      panel &&
      (page.value !== "chat" || panel.sessionId !== activeSessionId.value)
    ) {
      store.appState?.closeSubagentPanel();
    }
  });

  // Destination pages own the center pane. Leaving Chat while previewing must
  // restore that pane before the destination is presented; otherwise the
  // sidebar can change `page` successfully while the route stays unmounted.
  watch(page, (next) => {
    if (workPanelMaximized.value && next !== "chat") {
      workPanelMaximized.value = false;
    }
  });

  // Preview mode: the main pane is not rendered and the panel takes its width as
  // well, so the user can read a wide plugin view or preview. Transient: it is
  // never persisted and it ends with the panel.
  function toggleWorkPanelMaximize(): void {
    workPanelMaximized.value = !workPanelMaximized.value;
  }

  function togglePresentedWorkPanel(): void {
    const state = store.appState;
    if (!state) return;
    if (workPanelExiting.value) {
      state.openWorkPanel();
      return;
    }
    // Close a visible subagent dock through the same path as Cmd/Ctrl+J.
    if (state.subagentPanel) {
      state.toggleWorkPanel();
      return;
    }
    // Prefer the visible presentation over a briefly stale session projection:
    // a second click on the same button must always collapse a panel the user
    // can currently see instead of routing through openWorkPanel again.
    if (state.workPanelOpen || presentedWorkPanelOpen.value) {
      state.collapseWorkPanel();
      if (presentedWorkPanelOpen.value && !workPanelExiting.value) {
        workPanelExitGeneration.value += 1;
        workPanelExiting.value = true;
      }
      return;
    }
    state.openWorkPanel();
  }

  function finishWorkPanelExit(generation: number): void {
    if (generation !== workPanelExitGeneration.value) return;
    if (workPanelExitClosing) return;
    if (!workPanelExiting.value) return;
    workPanelExitClosing = true;
    const request = ++workPanelReservationRequest;
    void commitWorkPanelPresentation({
      reservation: api.setWorkPanelReservation(0),
      isCurrent: () =>
        request === workPanelReservationRequest &&
        generation === workPanelExitGeneration.value,
      commit: () => {
        presentedWorkPanelOpen.value = false;
        workPanelMaximized.value = false;
        workPanelExiting.value = false;
        workPanelExitClosing = false;
        if (autoCollapsedSidebar) {
          autoCollapsedSidebar = false;
          sidebarCollapsed.value = false;
        }
      },
    }).then((committed) => {
      // Reservation failed or was superseded — allow a later exit retry.
      if (!committed) workPanelExitClosing = false;
    });
  }

  watch([ready, page, subagentPanelOpen, workPanelOpen], () => {
    const shouldPresent =
      ready.value && page.value !== "settings" && workPanelVisible.value;
    const request = ++workPanelReservationRequest;

    if (shouldPresent) {
      // The panel is an internal flex column. Keep the reservation seam
      // explicitly at zero so opening it can only reflow the existing client
      // area; it must never grow the native window before mounting.
      workPanelExitGeneration.value += 1;
      workPanelExitClosing = false;
      workPanelExiting.value = false;
      void commitWorkPanelPresentation({
        reservation: api.setWorkPanelReservation(0),
        isCurrent: () => request === workPanelReservationRequest,
        commit: () => {
          presentedWorkPanelOpen.value = shouldPresent;
        },
      });
      return;
    }

    // Close: keep the dock mounted through the exit animation. The zero
    // reservation is already native-window-neutral, so only the flex column
    // collapses and returns its space to the main pane.
    if (presentedWorkPanelOpen.value || workPanelExiting.value) {
      if (presentedWorkPanelOpen.value && !workPanelExiting.value) {
        workPanelExitGeneration.value += 1;
        workPanelExiting.value = true;
      }
      return;
    }

    void commitWorkPanelPresentation({
      reservation: api.setWorkPanelReservation(0),
      isCurrent: () => request === workPanelReservationRequest,
      commit: () => {
        presentedWorkPanelOpen.value = shouldPresent;
      },
    });
  });

  // Fallback if `animationend` is skipped (display:none mid-flight, etc.).
  watch(workPanelExiting, (exiting, _previous, onCleanup) => {
    if (!exiting) return;
    const generation = workPanelExitGeneration.value;
    const timer = window.setTimeout(() => {
      finishWorkPanelExit(generation);
    }, 220);
    onCleanup(() => window.clearTimeout(timer));
  });

  // If the panel disappears without an exit commit (the active session closed
  // it, or the route changed), restore a sidebar this layout mechanism
  // collapsed — but never one the user collapsed manually.
  watch(workPanelVisible, (visible, previous) => {
    if (
      previous &&
      !visible &&
      !presentedWorkPanelOpen.value &&
      autoCollapsedSidebar
    ) {
      autoCollapsedSidebar = false;
      sidebarCollapsed.value = false;
    }
    if (!visible) workPanelMaximized.value = false;
  });

  async function runMenuCommand(command: AppMenuCommand): Promise<void> {
    try {
      const state = store.appState;
      if (!state) return;
      switch (command) {
        case "newTask":
          if (workPanelMaximized.value) workPanelMaximized.value = false;
          await state.newSession();
          requestAnimationFrame(() =>
            document
              .querySelector<HTMLTextAreaElement>(".composer-input")
              ?.focus(),
          );
          break;
        case "openProject":
          await state.openProject();
          break;
        case "openSettings":
          state.setSettingsTab("general");
          break;
        case "openSearch":
          setSearchOpen(true);
          break;
        case "openCommandPalette":
          setSearchOpen(true);
          break;
        case "toggleSidebar":
          toggleSidebar();
          break;
        case "openHelp":
          state.setSettingsTab("about");
          break;
        case "openLogs":
          await api.openLogs();
          break;
        case "checkForUpdates": {
          const updateState = await api.updatesCheck();
          if (updateState.status === "up-to-date") {
            state.showToast(t("updates.upToDate"), { variant: "success" });
          }
          break;
        }
      }
    } catch (menuError) {
      store.appState?.showToast(
        menuError instanceof Error ? menuError.message : String(menuError),
        { variant: "error" },
      );
    }
  }

  // The menu, the window state and the plugin catalogs are registered once: a
  // Vue listener reads the live refs instead of capturing them.
  watch(
    () => ready.value,
    (isReady, _previous, onCleanup) => {
      if (!isReady) return;
      void refreshPluginThemes();
      const off = api.onPluginChanged(() => void refreshPluginThemes());
      onCleanup(off);
    },
    { immediate: true },
  );

  function refreshPluginThemes(): Promise<void> {
    return store.appState?.refreshPluginThemes() ?? Promise.resolve();
  }

  watch(
    () => ready.value,
    (isReady, _previous, onCleanup) => {
      if (!isReady) return;
      // Host-originated settings writes (plugin `app.setTheme`) must reach the
      // renderer store or the shell keeps painting the previous preference.
      const off = api.onSettingsChanged((patch) => {
        if (patch.theme === undefined) return;
        const current = store.appState?.settings;
        if (!current) return;
        store.setState({
          settings: {
            ...current,
            theme: String(patch.theme) as typeof current.theme,
          },
        });
      });
      onCleanup(off);
    },
    { immediate: true },
  );

  watch(
    () => ready.value,
    (isReady, _previous, onCleanup) => {
      if (!isReady) return;
      void store.appState?.refreshPlugins();
      const off = api.onPluginChanged(
        () => void store.appState?.refreshPlugins(),
      );
      onCleanup(off);
    },
    { immediate: true },
  );

  // Work panel views are filtered by activation scope, so opening a different
  // project changes the list as much as installing a plugin does.
  watch(
    [() => ready.value, () => projectPath.value],
    ([isReady], _previous, onCleanup) => {
      if (!isReady) return;
      const refresh = () => void store.appState?.refreshPluginViews();
      refresh();
      const off = api.onPluginChanged(refresh);
      onCleanup(off);
    },
    { immediate: true },
  );

  watch(
    [() => settings.value?.theme, pluginThemes],
    (_value, _previous, onCleanup) => {
      const preference = settings.value?.theme ?? "system";
      const pluginTheme = preference.startsWith("plugin:")
        ? pluginThemes.value.find((entry) => entry.id === preference)
        : undefined;
      // A plugin theme whose provider was disabled or uninstalled falls back to
      // `system` instead of leaving the shell on a half-applied palette.
      const base: "system" | "light" | "dark" = pluginTheme
        ? pluginTheme.base
        : isThemeColorScheme(preference)
          ? preference
          : "system";

      let style = document.getElementById(
        PLUGIN_THEME_STYLE_ID,
      ) as HTMLStyleElement | null;
      if (pluginTheme) {
        if (!style) {
          style = document.createElement("style");
          style.id = PLUGIN_THEME_STYLE_ID;
          // Appended last so plugin overrides win over the base token sheet.
          document.head.append(style);
        }
        style.textContent = `${pluginTheme.css}\n${pluginTheme.variablesCss ?? ""}`;
        document.documentElement.dataset.pluginTheme = pluginTheme.id;
      } else {
        style?.remove();
        delete document.documentElement.dataset.pluginTheme;
      }

      const mq = window.matchMedia("(prefers-color-scheme: light)");
      const apply = () => {
        const resolvedTheme =
          base === "system" ? (mq.matches ? "light" : "dark") : base;
        document.documentElement.dataset.theme = resolvedTheme;
        // A contributed theme may name the native window background for this
        // palette. Deriving it here (rather than remembering an applied value)
        // is what restores the host default on a switch, a disable, or an
        // uninstall: the plugin theme is gone from the catalog, so there is
        // nothing left to pass and the host colour wins.
        void api
          .setWindowBackgroundColor(
            resolvedTheme,
            pluginTheme?.windowBackground?.[resolvedTheme],
          )
          .catch(() => undefined);
      };
      apply();
      if (base !== "system") return;
      const onChange = () => apply();
      mq.addEventListener("change", onChange);
      onCleanup(() => mq.removeEventListener("change", onChange));
    },
    { immediate: true },
  );

  // Global UI font: the Settings picker stores a CSS `font-family` stack in
  // `AppSettings.fontFamily`; absent means the built-in token stack.
  watch(
    () => settings.value?.fontFamily,
    (fontFamily) => {
      const root = document.documentElement;
      if (fontFamily) root.style.setProperty("--font-sans", fontFamily);
      else root.style.removeProperty("--font-sans");
    },
    { immediate: true },
  );

  // Global type scale: Settings persists a multiplier in
  // `AppSettings.fontScale`; the `--text-*` ramp multiplies from `--font-scale`.
  watch(
    [() => settings.value?.fontScale, () => settings.value?.fontSize],
    () => {
      document.documentElement.style.setProperty(
        "--font-scale",
        String(resolveFontScale(settings.value ?? {})),
      );
    },
    { immediate: true },
  );

  // The boot sequence runs exactly once, whatever re-renders follow.
  let bootstrapStarted = false;
  watch(
    () => store.appState?.bootstrap,
    (bootstrap) => {
      if (bootstrapStarted || !bootstrap) return;
      bootstrapStarted = true;
      void bootstrap();
    },
    { immediate: true },
  );

  // The Host owns the prompt queue (D375); mirror it whenever the visible
  // session changes so a reload or a switch shows the durable entries.
  watch(activeSessionId, (sessionId) => {
    if (!sessionId) return;
    void store.appState?.refreshQueuedPrompts(sessionId);
  });

  // The startup splash: a minimum dwell so the first paint is not a flash, then
  // the exit animation. Both are skipped under reduced motion.
  const splashPhase = ref<"loading" | "exiting" | "done">("loading");
  const splashStartedAt =
    typeof performance !== "undefined" ? performance.now() : 0;
  watch(
    () => ready.value,
    (isReady, _previous, onCleanup) => {
      if (!isReady) return;
      const reduceMotion =
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const minMs = reduceMotion ? 0 : 420;
      const exitMs = reduceMotion ? 0 : 280;
      const wait = Math.max(0, minMs - (performance.now() - splashStartedAt));

      let cancelled = false;
      let endTimer: number | undefined;
      const startTimer = window.setTimeout(() => {
        if (cancelled) return;
        if (exitMs === 0) {
          splashPhase.value = "done";
          return;
        }
        splashPhase.value = "exiting";
        endTimer = window.setTimeout(() => {
          if (!cancelled) splashPhase.value = "done";
        }, exitMs);
      }, wait);

      onCleanup(() => {
        cancelled = true;
        window.clearTimeout(startTimer);
        if (endTimer !== undefined) window.clearTimeout(endTimer);
      });
    },
    { immediate: true },
  );

  const showSplash = computed(() => splashPhase.value !== "done");
  const splashExiting = computed(() => splashPhase.value === "exiting");


  onMounted(() => {
    const offMenu = api.onMenuCommand((command) => void runMenuCommand(command));
    void api.menuRendererReady().catch(() => undefined);

    // Fullscreen hides the macOS traffic lights; CSS shifts titlebar controls
    // left via this attribute.
    const offFullScreen = api.onWindowFullScreen(({ fullScreen }) => {
      document.documentElement.dataset.fullscreen = fullScreen
        ? "true"
        : "false";
    });

    onScopeDispose(() => {
      offMenu();
      offFullScreen();
    });
  });

  /**
   * `window.__DCODE__` — the automation surface the capture suite and the
   * e2e runners drive. Installed after mount, and torn down with the component,
 * exactly like the mount/unmount pair above.
   */
  onMounted(() => {
    onScopeDispose(installRendererApi());
  });

  // Which session the notification centre should treat as on-screen.
  watch([activeSessionId, page], () => {
    const viewingSessionId =
      page.value === "chat" ? (activeSessionId.value ?? null) : null;
    void api
      .setNotificationViewingSession(viewingSessionId)
      .catch(() => undefined);
  });

  // Host events, the global keydown listener, and the notifications the shell
  // raises natively. Registered once; every read inside the handlers is live.
  onMounted(() => {
    const offEvent = api.onAgentEvent((event) => {
      store.appState?.handleAgentEvent(event);
    });
    const offQueueChanged = api.onAgentQueueChanged((event) => {
      store.appState?.applyQueueChanged(event);
    });
    const offPlansChanged = api.onPlansChanged((event) => {
      store.appState?.handlePlansChanged(event);
    });
    // Host-pushed toasts (plugin runtime etc.) are informational.
    const offToast = api.onToast((message) => {
      store.appState?.showToast(message);
    });
    // Agent-driven HTML preview: surface the browser tab when the agent opens a
    // workspace file in the embedded browser (BrowserPreview tool).
    const offBrowserPreview = api.onBrowserPreview((event) => {
      store.appState?.openWorkPanelTabForSession(event.sessionId, {
        ...browserPluginTab(event.path ?? event.url),
      });
    });
    const offHostStatus = api.onHostStatus((status) => {
      if (status.archMismatch) archMismatch.value = status.archMismatch;
      if (status.ok) {
        backendDown.value = null;
        if (status.restarted) {
          store.appState?.showToast(t("status.restored"), {
            variant: "success",
          });
          void store.appState?.refreshPlanCheckpoints();
        }
      } else {
        backendDown.value = {
          fatal: status.fatal === true,
          component: status.component,
          message: status.message,
          schema: status.schema,
        };
        // A dead sidecar cannot finish the turn; unstick the composer.
        store.setState({ isRunning: false });
      }
    });
    const offNotificationChanged = api.onNotificationChanged((notification) => {
      store.appState?.receiveNotification(notification);
      const failed = notification.kind === "task.failed";
      const title = t(
        failed ? "notifications.failedTitle" : "notifications.completedTitle",
        { sessionTitle: notification.sessionTitle },
      );
      const body = failed
        ? notification.errorCode
          ? t("notifications.failedBodyWithCode", { code: notification.errorCode })
          : t("notifications.failedBody")
        : t("notifications.completedBody");
      void api
        .showNativeNotification({
          id: notification.id,
          sessionId: notification.sessionId,
          kind: "task",
          title,
          body,
        })
        .catch(() => undefined);
    });
    const offSessionsChanged = api.onSessionsChanged((event) => {
      const state = store.appState;
      if (!state) return;
      const revealImportedProjects =
        event.reason === "plugin.session.import" ||
        event.reason === "plugin.session.importBatch";
      void state
        .refreshSessions(
          revealImportedProjects ? { revealImportedProjects: true } : undefined,
        )
        .then(async () => {
          if (event.projectPath) {
            await store.appState?.openProjectPath(event.projectPath);
          } else if (event.projectPath === null && !event.selectSessionId) {
            await store.appState?.clearProject();
          }
          if (event.selectSessionId) {
            await store.appState?.selectSession(event.selectSessionId);
          }
        })
        .catch(() => undefined);
    });
    const offNotificationActivated = api.onNotificationActivated(
      ({ id, sessionId }) => {
        const state = store.appState;
        if (!state) return;
        const matched = state.notifications.find((item) => item.id === id);
        const report = (activationError: unknown) =>
          store.appState?.showToast(
            activationError instanceof Error
              ? activationError.message
              : String(activationError),
            { variant: "error" },
          );
        if (matched) {
          void state.openNotification(id).catch(report);
        } else if (sessionId) {
          void state.selectSession(sessionId).catch(report);
        }
      },
    );

    const onKey = (e: KeyboardEvent) => {
      const modifierOnly = MODIFIER_ONLY_KEYS.has(e.key);
      if (modifierOnly || e.isComposing || e.keyCode === 229) return;
      const shortcut = KEYBOARD_SHORTCUTS.find((candidate) =>
        keybindingMatchesEvent(
          resolveKeybinding(
            candidate,
            settings.value?.keybindings,
            platform,
          ),
          e,
          platform,
        ),
      );
      if (!shortcut) {
        const pluginShortcut = plugins.value
          .filter((plugin) => isActiveInProject(plugin, projectPath.value))
          .flatMap((plugin) =>
            (plugin.settings ?? []).map((setting) => ({ plugin, setting })),
          )
          .find(
            ({ setting }) =>
              setting.type === "shortcut" &&
              typeof setting.command === "string" &&
              keybindingMatchesEvent(
                String(setting.value ?? setting.default ?? ""),
                e,
                platform,
              ),
          );
        if (!pluginShortcut) return;
        e.preventDefault();
        void api.executeCommand(pluginShortcut.setting.command!);
        return;
      }
      if (
        e.repeat &&
        (shortcut.id === "navigateBack" || shortcut.id === "navigateForward")
      ) {
        return;
      }
      e.preventDefault();

      const runShortcut = (id: KeyboardShortcutId) => {
        const state = store.appState;
        if (!state) return;
        switch (id) {
          case "navigateBack":
            state.navBack();
            break;
          case "navigateForward":
            state.navForward();
            break;
          case "newTask":
          case "openProject":
          case "openSettings":
            void runMenuCommand(id);
            break;
          case "openSearch":
            setSearchOpen(true);
            break;
          case "openCommandPalette":
            setSearchOpen(true);
            break;
          case "openPluginLauncher":
            void api.togglePluginLauncher();
            break;
          case "toggleSidebar":
            toggleSidebar();
            break;
          case "openWorkPanel":
            if (state.page !== "settings") state.toggleWorkPanel();
            break;
          case "abort":
            void state.abort();
            break;
          case "toggleWindow":
            // The same native action the menu item runs (D438): hide the window
            // the user is looking at, or bring it back. The window's own close
            // button stays the only path into the close behaviour.
            void api.nativeMenuAction("toggleMainWindow");
            break;
          case "resetZoom":
          case "zoomIn":
          case "zoomOut":
          case "toggleFullScreen":
            void api.nativeMenuAction(id);
            break;
        }
      };
      runShortcut(shortcut.id);
    };
    window.addEventListener("keydown", onKey);

    onScopeDispose(() => {
      offEvent();
      offQueueChanged();
      offPlansChanged();
      offToast();
      offBrowserPreview();
      offHostStatus();
      offNotificationChanged();
      offSessionsChanged();
      offNotificationActivated();
      window.removeEventListener("keydown", onKey);
    });
  });

  /**
 * The two shell shortcut hints. Both are recomputed on every render, so
   * they follow a keybinding override; a `computed` keeps that, which a plain
   * setup-time read would not.
   */
  const sidebarToggleShortcut = computed(() => {
    const definition = KEYBOARD_SHORTCUTS.find(
      (shortcut) => shortcut.id === "toggleSidebar",
    );
    if (!definition) return "";
    return keybindingDisplayParts(
      resolveKeybinding(definition, settings.value?.keybindings, platform),
      platform,
    ).join(platform === "darwin" ? "" : "+");
  });
  const workPanelToggleTooltip = computed(() => {
    const label = t("nav.toggleWorkPanel");
    const definition = KEYBOARD_SHORTCUTS.find(
      (shortcut) => shortcut.id === "openWorkPanel",
    );
    const shortcut = definition
      ? keybindingDisplayParts(
          resolveKeybinding(definition, settings.value?.keybindings, platform),
          platform,
        ).join(platform === "darwin" ? "" : "+")
      : "";
    return shortcut ? `${label} ${shortcut}` : label;
  });

  /**
   * The live budget handed to the sidebar handle: the shell's measured width
   * minus MainChat's floor and the occupying work panel. Computed so the
   * handle's ARIA range follows a window or panel resize.
   */
  const sidebarWidthMax = computed(() =>
    sidebarWidthBudget({
      containerWidth: shellWidth.value,
      workPanelOpen: workPanelVisible.value || presentedWorkPanelOpen.value,
      workPanelWidth: workPanelWidth.value,
      workPanelMaximized: workPanelMaximized.value,
    }),
  );

  return {
    ready,
    page,
    activeSessionId,
    subagentPanel,
    subagentPanelOpen,
    closeSubagentPanel: () => store.appState?.closeSubagentPanel(),
    workPanelOpen,
    searchOpen,
    setSearchOpen,
    sidebarCollapsed,
    setSidebarCollapsed: (collapsed: boolean) => {
      sidebarCollapsed.value = collapsed;
    },
    sidebarEntering,
    sidebarExiting,
    sidebarWidth,
    sidebarWidthMax,
    handleSidebarWidthChange,
    handleSidebarWidthCommit,
    handleSidebarResizeCollapse,
    toggleSidebar,
    reopenSidebar,
    autoCollapseSidebar,
    appShellRef,
    shellWidth,
    workPanelWidth,
    runMenuCommand,
    handleSidebarAnimationEnd,
    presentedWorkPanelOpen,
    workPanelExiting,
    workPanelExitGeneration,
    finishWorkPanelExit,
    togglePresentedWorkPanel,
    workPanelMaximized,
    toggleWorkPanelMaximize,
    backendDown,
    archMismatch,
    setArchMismatch: (value: typeof archMismatch.value) => {
      archMismatch.value = value;
    },
    showSplash,
    splashExiting,
    sidebarToggleShortcut,
    workPanelToggleTooltip,
  };
}
