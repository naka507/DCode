/**
 * `window.__DCODE__`: the tiny renderer automation surface used by the
 * capture suite (electron/main) and the e2e plan runner (scripts/e2e-plan-ui).
 *
 * Only the navigation/toast shims are installed unconditionally. The
 * screenshot fixtures (seed* methods, `api.*` monkey-patches) live in
 * `capture-rig.ts` and are `import()`ed the first time one of them is called
 * with `window.__PI_CAPTURE__` set, so production bundles never evaluate them.
 * Once the rig has loaded, its methods replace the lazy stubs on the same
 * object, so later capture calls stay synchronous as before.
 */
import { useAppStore } from "../stores/app-store";
import type { AppState, ToastOptions } from "../stores/app-state";
import type { CaptureRig, CaptureRigMethods } from "./capture-rig";

/** Non-reactive read of the composed state. */
function appState(): AppState {
  const state = useAppStore().appState;
  if (!state) throw new Error("app store read before the initial state was committed");
  return state;
}

type CaptureRigMethod = keyof CaptureRigMethods;

/** Lazy stubs: resolve with the rig method's result once the rig has loaded. */
type CaptureRigStubs = {
  [K in CaptureRigMethod]: (
    ...args: Parameters<CaptureRigMethods[K]>
  ) => Promise<Awaited<ReturnType<CaptureRigMethods[K]>> | undefined>;
};

export type RendererApi = {
  setPage: (page: AppState["page"]) => void;
  refreshProviders: () => Promise<void>;
  selectSession: (id: string) => Promise<void>;
  setSettingsTab: (tab: AppState["settingsTab"]) => void;
  setThemeAttr: (theme: "light" | "dark") => void;
  clearProject: () => Promise<void>;
  showToast: (message: string, opts?: ToastOptions) => void;
} & (CaptureRigStubs | CaptureRigMethods);

declare global {
  interface Window {
    __DCODE__?: RendererApi;
    /** Set by the capture suite before it calls any fixture method. */
    __PI_CAPTURE__?: unknown;
  }
}

const CAPTURE_RIG_METHODS = [
  "openWorkPanelArtifact",
  "collapseWorkPanel",
  "openWorkPanel",
  "openNewWorkPanelTab",
  "setWorkPanelWidth",
  "seedTranscript",
  "seedReviewChanges",
  "seedRunRows",
  "seedDelegationRows",
  "seedPlugins",
  "seedExtensions",
  "seedPluginThemes",
  "seedNotifications",
  "seedSidebarStatuses",
  "ensureVisualFixtures",
] as const satisfies readonly CaptureRigMethod[];

export function installRendererApi(): () => void {
  let rigLoad: Promise<CaptureRig> | null = null;
  let rig: CaptureRig | null = null;
  let disposed = false;

  const loadRig = (): Promise<CaptureRig> => {
    rigLoad ??= import("./capture-rig").then((module) => {
      const installed = module.installCaptureRig();
      if (disposed) {
        installed.dispose();
        return installed;
      }
      rig = installed;
      if (window.__DCODE__ === surface) {
        for (const name of CAPTURE_RIG_METHODS) {
          (surface as Record<string, unknown>)[name] = installed[name];
        }
      }
      return installed;
    });
    return rigLoad;
  };

  const stubs = Object.fromEntries(
    CAPTURE_RIG_METHODS.map((name) => [
      name,
      async (...args: unknown[]) => {
        if (!window.__PI_CAPTURE__) return undefined;
        const loaded = await loadRig();
        const method = loaded[name] as (...params: unknown[]) => unknown;
        return method(...args);
      },
    ]),
  ) as CaptureRigStubs;

  const surface: RendererApi = {
    setPage: (page) => appState().setPage(page),
    refreshProviders: () => appState().refreshProviders(),
    selectSession: (id) => appState().selectSession(id),
    setSettingsTab: (tab) => appState().setSettingsTab(tab),
    setThemeAttr: (theme) => {
      document.documentElement.dataset.theme = theme;
    },
    clearProject: () => appState().clearProject(),
    showToast: (message, opts) => appState().showToast(message, opts),
    ...stubs,
  };
  window.__DCODE__ = surface;

  return () => {
    disposed = true;
    rig?.dispose();
    rig = null;
    if (window.__DCODE__ === surface) delete window.__DCODE__;
  };
}
