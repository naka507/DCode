/**
 * Everything the Extensions page reads and does.
 *
 * The `usePluginsPage` composable. The choices that are
 * not mechanical, each forced by the framework:
 *
 *   1. **The `useAppStore((s) => s.x)` selectors become `computed` reads off
 *      `store.appState`.** `appState` is a `shallowRef`, so a `computed` is
 *      what subscribes this page to a commit; `getState()` is deliberately
 *      absent from the store's surface (see `stores/app-store.ts`). The store's
 *      actions are wrapped in plain functions, because the panels receive this
 *      model object as one prop and call `page.refreshPlugins()`.
 *   2. **A `ref` assignment has no updater-function form.** `setter()` below
 *      is the `setState`-shaped wrapper, so the
 *      call sites (`setRowMenu((cur) => …)`, `setHeaderMenu((open) => !open)`)
 *      stay in the updater form.
 *   3. **The two "mirror" refs are gone.** The install job and
 *      the speed sample were copied into `useRef` because a closure reads the render
 *      it was created in; a Vue ref is a stable object whose `.value` is always
 *      current, so the subscription and the request's own answer already see
 *      the install as it is now. The speed sample is a plain local, since it is
 *      never rendered.
 *   4. **Every `useEffect` becomes `onMounted` or `watch`.** A dependency list of
 *      `[]` is a single mount run (`onMounted`); a dependency list of state is a
 *      `watch`, and the two effects that ran on mount *and* on a dependency
 *      change are `{ immediate: true }` so the first run is not skipped.
 *      Subscriptions are torn down in `onScopeDispose`, which is the
 *      composable's counterpart of the effect's returned cleanup.
 *   5. **`useMemo` becomes `computed`.** The derivations are pure, so they are
 *      computed values here; the page and every panel read them unwrapped.
 *   6. `i18n.language` becomes the vue-i18n `locale`, exposed as a `computed`
 *      string so the two date formatters keep taking a locale name.
 *
 * The returned object is the page model: `pages/PluginsPage.vue` passes it to
 * the panels as one `page` prop, which replaces the
 * `<InstalledPluginsPanel {...page} />` spread (the model has ~80 members, and
 * a prop per member would be a second, drifting definition of it).
 */
import { computed, onMounted, onScopeDispose, ref, type Ref } from "vue";
import { useI18n } from "vue-i18n";
import type {
  AppSettings,
  PluginPermissionReview,
  PluginServiceStatus,
  PluginSummary,
  ProjectRecord,
  ProjectWorkspace,
} from "@dcode/shared";
import { api } from "../../lib/api";
import { useAppStore, type ToastOptions } from "../../stores/app-store";
import { usePluginBrowseState } from "./browse-state";
import {
  GROUP_ORDER,
  TEMPLATE_IDS,
  type GroupId,
  type TemplateId,
  groupOf,
  matchesQuery,
  orderPermissions,
} from "./model";

/** A `useState` setter: a value, or a function of the current one. */
export type Setter<T> = (next: T | ((current: T) => T)) => void;

/** See note 2. */
function setter<T>(target: Ref<T>): Setter<T> {
  return (next) => {
    target.value =
      typeof next === "function"
        ? (next as (current: T) => T)(target.value)
        : next;
  };
}

export function usePluginsPage() {
  const { t, locale: activeLocale } = useI18n();
  const store = useAppStore();

  /* ------------------------------------------------------------------ */
  /* Store projections (note 1)                                          */
  /* ------------------------------------------------------------------ */

  const plugins = computed<PluginSummary[]>(() => store.appState?.plugins ?? []);
  const settings = computed<AppSettings | undefined>(() => store.appState?.settings);
  /**
   * The folder open in this window. Scoping something to "this project" is only
   * meaningful relative to it, so the control needs it as its default target.
   */
  const currentProjectPath = computed<string | null>(
    () => store.appState?.workspace?.path ?? null,
  );
  const locale = computed(() => activeLocale.value);

  async function refreshPlugins(): Promise<void> {
    await store.appState?.refreshPlugins();
  }

  function showToast(message: string, options?: ToastOptions): void {
    store.appState?.showToast(message, options);
  }

  async function activateProject(path: string): Promise<ProjectWorkspace | null> {
    return (await store.appState?.activateProject(path)) ?? null;
  }

  const { installedQuery, setInstalledQuery } = usePluginBrowseState();

  const projects = ref<ProjectRecord[]>([]);
  const busyId = ref<string | null>(null);
  const reloadingId = ref<string | null>(null);
  /**
   * A development plugin whose folder was chosen but not yet granted. Loading a
   * folder is a request: nothing is registered until the user answers, so the
   * declaration waits here the same way an install does.
   */
  const pendingReview = ref<PluginPermissionReview | null>(null);
  const templatePick = ref<TemplateId | null>(null);
  const creating = ref(false);
  const headerMenu = ref(false);
  const rowMenu = ref<string | null>(null);
  const services = ref<PluginServiceStatus[]>([]);
  const settingsPlugin = ref<PluginSummary | null>(null);

  const setPendingReview = setter(pendingReview);
  const setTemplatePick = setter(templatePick);
  const setHeaderMenu = setter(headerMenu);
  const setRowMenu = setter(rowMenu);
  const setSettingsPlugin = setter(settingsPlugin);


  /* ------------------------------------------------------------------ */
  /* Effects (note 4)                                                    */
  /* ------------------------------------------------------------------ */

  // Every scope control offers the same folder list, so it is fetched once here
  // and handed down rather than re-queried per row.
  onMounted(() => {
    void api
      .listProjects()
      .then((res) => {
        projects.value = res.projects ?? [];
      })
      .catch(() => {
        projects.value = [];
      });
  });

  let stopPluginChanged: (() => void) | null = null;

  onMounted(() => {
    // Service state changes arrive as pluginChanged events, so the list stays
    // truthful while the supervisor restarts a crashed worker.
    const refreshServices = () => {
      void api
        .listPluginServices()
        .then((next) => {
          services.value = next;
        })
        .catch(() => {
          services.value = [];
        });
    };
    refreshServices();
    stopPluginChanged = api.onPluginChanged(refreshServices);
  });

  onScopeDispose(() => {
    stopPluginChanged?.();
  });

  /* ------------------------------------------------------------------ */
  /* Derivations (note 5)                                                */
  /* ------------------------------------------------------------------ */

  const servicesByPlugin = computed(() => {
    const map = new Map<string, PluginServiceStatus[]>();
    for (const status of services.value) {
      const list = map.get(status.pluginId);
      if (list) list.push(status);
      else map.set(status.pluginId, [status]);
    }
    return map;
  });
  const filteredInstalled = computed(() =>
    plugins.value.filter((plugin) =>
      matchesQuery(
        installedQuery.value,
        plugin.name,
        plugin.id,
        plugin.description,
        plugin.author,
      ),
    ),
  );

  const installedGroups = computed(() => {
    const buckets = new Map<GroupId, PluginSummary[]>();
    for (const plugin of filteredInstalled.value) {
      const id = groupOf(plugin);
      const bucket = buckets.get(id);
      if (bucket) bucket.push(plugin);
      else buckets.set(id, [plugin]);
    }
    return GROUP_ORDER.flatMap((id) => {
      const rows = buckets.get(id);
      if (!rows?.length) return [];
      rows.sort(
        (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
      );
      return [{ id, rows }];
    });
  });


  /* ------------------------------------------------------------------ */
  /* Actions                                                             */
  /* ------------------------------------------------------------------ */

  async function run(action: () => Promise<unknown>): Promise<void> {
    try {
      await action();
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), { variant: "error" });
    }
  }

  function loadDev(): Promise<void> {
    return run(async () => {
      const result = await api.loadDevPlugin();
      // The folder picker reports the declaration; the review is the grant.
      if (result.canceled || !result.review) return;
      pendingReview.value = result.review;
    });
  }

  // A pi CLI extension becomes a development plugin holding `agent.extension`
  // (spec 07-plugins/16 §3); the confirm is the trust decision. Declared npm
  // dependencies are installed (scripts disabled) before the first load.
  function importExtension(): Promise<void> {
    return run(async () => {
      if (!window.confirm(t("plugins.agentExtension.importConfirm"))) return;
      const result = await api.importPiExtension();
      if (result.canceled) return;
      await refreshPlugins();
      if (result.dependencies.state === "failed") {
        showToast(
          t("plugins.importExtensionDepsFailed", {
            id: result.id,
            error: result.dependencies.error,
          }),
          { variant: "warning" },
        );
        return;
      }
      showToast(t("plugins.importExtensionDone", { id: result.id }), {
        variant: "success",
      });
    });
  }

  function reloadPlugin(id: string): Promise<void> {
    return run(async () => {
      reloadingId.value = id;
      try {
        const result = await api.reloadPlugin(id);
        // The manifest asks for more than it is running with: ask first, and
        // load only after the answer.
        if (result.review) {
          pendingReview.value = result.review;
          return;
        }
        await refreshPlugins();
        showToast(t("plugins.reloadDone"), { variant: "success" });
      } finally {
        reloadingId.value = null;
      }
    });
  }

  function installPackage(): Promise<void> {
    return run(async () => {
      await api.installPluginFromPackage();
      await refreshPlugins();
      showToast(t("plugins.installPackageDone"), { variant: "success" });
    });
  }

  async function createFromTemplate(template: TemplateId): Promise<void> {
    creating.value = true;
    try {
      const created = await api.createPluginFromTemplate(template);
      templatePick.value = null;
      // A canceled folder picker is not a failure: leave the page untouched.
      if (created.canceled) return;
      // Scaffolding writes files; loading waits for the same review a folder
      // picked by hand goes through.
      if (created.review) {
        await activateTemplateProject(created);
        pendingReview.value = created.review;
        return;
      }
      await finishTemplate(created);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), { variant: "error" });
    } finally {
      creating.value = false;
    }
  }

  /** Open the scaffolded folder so the sources land in the workspace. */
  async function activateTemplateProject(created: {
    dir?: string;
  }): Promise<ProjectWorkspace | null | unknown> {
    try {
      return created.dir ? await activateProject(created.dir) : null;
    } catch (e) {
      // The plugin exists on disk either way; a failed open is reported on its
      // own instead of replacing the result.
      return e;
    }
  }

  async function finishTemplate(created: {
    dir?: string;
    name?: string;
  }): Promise<void> {
    await refreshPlugins();
    const opened = await activateTemplateProject(created);
    showToast(
      t(
        opened && !(opened instanceof Error)
          ? "plugins.newFromTemplateOpened"
          : "plugins.newFromTemplateDone",
        { name: created.name ?? "" },
      ),
      { variant: "success" },
    );
    if (opened instanceof Error) {
      showToast(opened.message, { variant: "error" });
    }
  }

  /**
   * The answer to a development permission review. The accepted set is what the
   * user just saw, and it becomes the ceiling every later hot reload is measured
   * against — a folder or a manifest edit can never widen it on its own.
   */
  async function confirmReview(): Promise<void> {
    const review = pendingReview.value;
    if (!review) return;
    busyId.value = review.id;
    try {
      if (review.kind === "reload") {
        await api.confirmReloadPlugin({
          id: review.id,
          grantedPermissions: review.permissions,
        });
        await refreshPlugins();
        showToast(t("plugins.reloadDone"), { variant: "success" });
      } else {
        await api.confirmLoadDevPlugin({
          path: review.path,
          grantedPermissions: review.permissions,
        });
        await refreshPlugins();
        showToast(t("plugins.loadDevDone"), { variant: "success" });
      }
      pendingReview.value = null;
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), { variant: "error" });
    } finally {
      busyId.value = null;
    }
  }

  const overflowActions = [
    { key: "loadDev", run: loadDev },
    { key: "importExtension", run: importExtension },
    { key: "installPackage", run: installPackage },
    {
      key: "newFromTemplate",
      run: async () => {
        templatePick.value = TEMPLATE_IDS[0];
      },
    },
  ];

  return {
    t,
    locale,
    plugins,
    settings,
    refreshPlugins,
    showToast,
    activateProject,
    currentProjectPath,
    installedQuery,
    setInstalledQuery,
    projects,
    busyId,
    reloadingId,
    templatePick,
    setTemplatePick,
    creating,
    headerMenu,
    setHeaderMenu,
    rowMenu,
    setRowMenu,
    servicesByPlugin,
    settingsPlugin,
    setSettingsPlugin,
    filteredInstalled,
    installedGroups,
    run,
    loadDev,
    importExtension,
    reloadPlugin,
    installPackage,
    createFromTemplate,
    overflowActions,
    pendingReview,
    setPendingReview,
    confirmReview,
  };
}

export type PluginsPageModel = ReturnType<typeof usePluginsPage>;
