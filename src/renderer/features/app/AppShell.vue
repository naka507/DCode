<script setup lang="ts">
/**
 * The application shell.
 *
 * The `AppShell` component: the
 * three-column frame (sidebar, main pane, work panel), the titlebar chrome, and
 * the global overlays every route shares.
 *
 * Two structural choices, both forced by Vue:
 *
 *   1. Route destinations load lazily through `defineAsyncComponent`. The
 *      fallback is the same `RoutePending`, and the chunk boundary is preserved,
 *      so a destination page still loads on demand.
 *
 *   2. The runtime returns `showSplash` / `splashExiting` instead of markup,
 *      so the shell renders `<StartupSplash>` itself. A Vue composable cannot
 *      return markup.
 *
 * The route split, the panel presentation rules and every class name are
 * unchanged. The runtime returns `workPanelExitGeneration` as a Vue ref. It is
 * passed to
 * `finishWorkPanelExit` bare: the compiler marks a ref destructured from a
 * composable `setup-maybe-ref` and emits `_unref(...)` around it, so `.value`
 * would unwrap twice and hand the guard `undefined`.
 */
import { computed, defineAsyncComponent } from "vue";
import { useI18n } from "vue-i18n";
import { api } from "../../lib/api";
import { cx } from "../../lib/cx";
import { IconNewSession, IconPanel, IconPanelOpen } from "../../lib/icons";
import ChatSurface from "../../components/ChatSurface.vue";
import ConversationTopbar from "../../components/ConversationTopbar.vue";
import ExtensionPromptDialog from "../../components/ExtensionPromptDialog.vue";
import ProjectCreateDialog from "../../components/ProjectCreateDialog.vue";
import SearchDialog from "../../components/SearchDialog.vue";
import Sidebar from "../../components/Sidebar.vue";
import StartupSplash from "../../components/StartupSplash.vue";
import ToastHost from "../../components/Toast.vue";
import TooltipButton from "../../components/TooltipButton.vue";
import UpdateBanner from "../../components/UpdateBanner.vue";
import WindowControls from "../../components/WindowControls.vue";
import WorkPanel from "../../components/workpanel/WorkPanel.vue";
import CollapsedTitlebarActions from "./chrome/CollapsedTitlebarActions.vue";
import RoutePending from "./chrome/RoutePending.vue";
import { useAppShellRuntime } from "./useAppShellRuntime";

const SettingsPage = defineAsyncComponent(() => import("../../pages/SettingsPage.vue"));
const PullRequestsPage = defineAsyncComponent(() => import("../../pages/PullRequestsPage.vue"));
const ScheduledPage = defineAsyncComponent(() => import("../../pages/ScheduledPage.vue"));
const PluginsPage = defineAsyncComponent(() => import("../../pages/PluginsPage.vue"));

const { t, te } = useI18n();

const {
  ready,
  page,
  activeSessionId,
  subagentPanel,
  subagentPanelOpen,
  closeSubagentPanel,
  workPanelOpen,
  searchOpen,
  setSearchOpen,
  sidebarCollapsed,
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
  setArchMismatch,
  showSplash,
  splashExiting,
  sidebarToggleShortcut,
  workPanelToggleTooltip,
} = useAppShellRuntime();

/**
 * Localized CPU name for the arch-mismatch banner.
 *
 * The arch-name lookup asks for `status.archNames.<platform>.<arch>` with a
 * `defaultValue` fallback. vue-i18n has no `defaultValue` option, so the same
 * behaviour is spelled out: `te()` probes the key and the raw arch name is the
 * answer when the catalog has no entry for that platform/arch pair.
 */
function archName(platform: string, arch: string): string {
  const key = `status.archNames.${platform}.${arch}`;
  return te(key) ? t(key) : arch;
}

/**
 * The sidebar is kept mounted through `sidebar-out` so the stylesheet's exit
 * animation can play; `sidebarExiting` is what keeps it in the tree once
 * `sidebarCollapsed` is already true.
 */
const sidebarMounted = computed(() => !sidebarCollapsed.value || sidebarExiting.value);

const shellClass = computed(() => ({
  "app-shell-boot": !ready.value,
  "settings-mode": page.value === "settings" && ready.value,
  "sidebar-collapsed": sidebarCollapsed.value,
  "work-panel-maximized": workPanelMaximized.value,
  "is-booting": showSplash.value,
}));

const sidebarClass = computed(() => ({
  "is-entering": sidebarEntering.value,
  "is-exiting": sidebarExiting.value,
}));

const shellStyle = computed(() => ({
  "--ds-sidebar-width": `${sidebarWidth.value}px`,
}));
</script>

<template>
  <div ref="appShellRef" class="app-shell" :class="shellClass" :style="shellStyle">
    <div class="app-scenic-backdrop" aria-hidden="true" />

    <template v-if="ready">
      <!-- Settings owns the whole window: no sidebar, no work panel. -->
      <template v-if="page === 'settings'">
        <Suspense>
          <SettingsPage />
          <template #fallback><RoutePending /></template>
        </Suspense>
        <SearchDialog :open="searchOpen" @close="setSearchOpen(false)" />
        <ToastHost />
        <ExtensionPromptDialog />
        <UpdateBanner />
      </template>

      <template v-else>
        <Sidebar
          v-if="sidebarMounted"
          :class="sidebarClass"
          :sidebar-toggle-shortcut="sidebarToggleShortcut"
          :sidebar-width="sidebarWidth"
          :width-max="sidebarWidthMax"
          @toggle-sidebar="toggleSidebar"
          @width-change="handleSidebarWidthChange"
          @width-commit="handleSidebarWidthCommit"
          @resize-collapse="handleSidebarResizeCollapse"
          @animationend="handleSidebarAnimationEnd"
        />

        <!--
          Maximized preview: MainChat is absent, so the panel header owns
          dragging and this pass-through row keeps the shell controls available.
        -->
        <div
          v-if="workPanelMaximized"
          class="window-chrome-row"
          :class="{ 'sidebar-expanded': !sidebarCollapsed }"
        >
          <CollapsedTitlebarActions
            v-if="sidebarCollapsed"
            :sidebar-toggle-shortcut="sidebarToggleShortcut"
            @toggle-sidebar="toggleSidebar"
            @new-task="void runMenuCommand('newTask')"
          />
          <TooltipButton
            v-if="!sidebarCollapsed"
            type="button"
            class="title-nav-btn"
            :label="t('nav.newTask')"
            :aria-label="t('nav.newTask')"
            data-nav="new-task"
            @click="void runMenuCommand('newTask')"
          >
            <IconNewSession :size="15" />
          </TooltipButton>
          <div class="window-chrome-drag" aria-hidden="true" />
        </div>

        <section v-if="!workPanelMaximized" class="main-pane">
          <ConversationTopbar
            v-if="page === 'chat'"
            :sidebar-collapsed="sidebarCollapsed"
            :work-panel-open="presentedWorkPanelOpen"
            @toggle-sidebar="toggleSidebar"
            @new-task="void runMenuCommand('newTask')"
            @open-search="setSearchOpen(true)"
          />
          <div
            v-else
            class="main-titlebar"
            :class="{ 'work-panel-open': presentedWorkPanelOpen }"
          >
            <div v-if="sidebarCollapsed" class="main-titlebar-left no-drag">
              <CollapsedTitlebarActions
                :sidebar-toggle-shortcut="sidebarToggleShortcut"
                @toggle-sidebar="reopenSidebar"
                @new-task="void runMenuCommand('newTask')"
              />
            </div>
          </div>
          <UpdateBanner />

          <div
            v-if="backendDown"
            class="backend-banner no-drag"
            :class="backendDown.fatal ? 'fatal' : 'warn'"
            role="status"
          >
            <span class="backend-dot" aria-hidden="true" />
            <span>
              <template v-if="backendDown.fatal">
                <template v-if="backendDown.message === 'GLIBC_UNSUPPORTED'">
                  {{ t("status.unsupportedGlibc") }}
                </template>
                <template v-else-if="backendDown.message === 'DB_SCHEMA_TOO_NEW'">
                  {{
                    t("status.dbSchemaTooNew", {
                      found: backendDown.schema?.found ?? "?",
                      supported: backendDown.schema?.supported ?? "?",
                    })
                  }}
                </template>
                <template v-else>{{ t("status.fatal") }}</template>
              </template>
              <template v-else>{{ t("status.restarting") }}</template>
            </span>
            <button
              v-if="backendDown.fatal"
              type="button"
              class="backend-action"
              @click="void api.openLogs()"
            >
              {{ t("status.openLogs") }}
            </button>
          </div>

          <div v-if="archMismatch" class="backend-banner no-drag warn" role="status">
            <span class="backend-dot" aria-hidden="true" />
            <span>
              {{
                t("status.archMismatch", {
                  buildArch: archName(archMismatch.platform, archMismatch.processArch),
                  machineArch: archName(archMismatch.platform, archMismatch.machineArch),
                })
              }}
            </span>
            <button type="button" class="backend-action" @click="setArchMismatch(null)">
              {{ t("status.dismissArchMismatch") }}
            </button>
          </div>

          <Suspense>
            <div v-if="page === 'pulls'" class="route-surface route-page">
              <PullRequestsPage />
            </div>
            <div v-else-if="page === 'scheduled'" class="route-surface route-page">
              <ScheduledPage />
            </div>
            <div v-else-if="page === 'plugins'" class="route-surface route-page">
              <PluginsPage />
            </div>
            <ChatSurface v-else />
            <template #fallback><RoutePending /></template>
          </Suspense>
        </section>

        <WorkPanel
          v-if="presentedWorkPanelOpen || workPanelExiting"
          :panel-blocked="searchOpen"
          :exiting="workPanelExiting"
          :subagent-panel="subagentPanelOpen ? subagentPanel : null"
          :container-width="shellWidth"
          :sidebar-width="sidebarWidth"
          :sidebar-collapsed="sidebarCollapsed"
          :sidebar-exiting="sidebarExiting"
          :maximized="workPanelMaximized"
          @exit-animation-end="finishWorkPanelExit(workPanelExitGeneration)"
          @close-subagent-panel="closeSubagentPanel"
          @auto-collapse-sidebar="autoCollapseSidebar"
          @toggle-maximize="toggleWorkPanelMaximize"
        />

        <TooltipButton
          type="button"
          class="app-work-panel-toggle no-drag"
          :label="workPanelToggleTooltip"
          :aria-label="workPanelToggleTooltip"
          :aria-pressed="workPanelOpen || presentedWorkPanelOpen"
          :disabled="!activeSessionId && !presentedWorkPanelOpen && !workPanelExiting"
          @click="togglePresentedWorkPanel"
        >
          <span class="app-work-panel-toggle-icon" aria-hidden="true">
            <IconPanel :size="15" />
            <IconPanelOpen :size="15" />
          </span>
        </TooltipButton>

        <SearchDialog :open="searchOpen" @close="setSearchOpen(false)" />
        <ToastHost />
        <ExtensionPromptDialog />
      </template>
    </template>

    <!--
      Outside pane stacking; skip splash so the band cannot cover boot chrome.
      One band only: it stays a direct child of `.app-shell` so opening or
      maximizing the work panel cannot cover native window actions.
    -->
    <WindowControls v-if="ready && !showSplash" />

    <ProjectCreateDialog />
    <StartupSplash v-if="showSplash" :exiting="splashExiting" />
  </div>
</template>
