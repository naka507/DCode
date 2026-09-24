<script setup lang="ts">
/**
 * Settings destination.
 *
 * The `SettingsPage` component. It is
 * the whole destination. The rail's nav structure comes from the shared
 * index in `lib/settings-search`, which the global search dialog reads too.
 *
 * Deliberate choices:
 *
 * 1. **Store selectors become `store.appState` reads.** `settingsTab`,
 *     `setSettingsTab`, `settingsAnchor`, `setSettingsAnchor`,
 *     `setPage`, `settings`, `version` and `refreshProviders` are destructured out of
 *     `useAppStore`; here they are `computed(() => store.appState?.field)` or
 *     `store.appState?.action()` calls, which is the tracked form. `getState()`
 *     is deliberately absent from the store.
 *  2. **`useAppStore.setState({ settings })` is `store.setState({ settings })`**,
 *     the same commit shape through the Pinia store.
 *  3. **The two mount effects are `onMounted` / `onUnmounted`.** The
 *     `listPluginScenicThemesDestinations` + `onPluginChanged` effect has an
 *     empty dependency array, so it is a single mount run with the
 *     listener torn down on unmount; the `activeExtension` reconciliation is a
 *     `watch` over the same tuple.
 *     dependency list is `[settingsAnchor, tab, t, setSettingsAnchor]`, and an
 *     anchor can already be pending when the page mounts (a search hit sets it
 *     before the destination switches), so the first run matters. Its returned
 *     cleanup is the watch's `onCleanup`. The `t` dependency is watched as
 *     `locale`: i18next returns a *new* `t` identity when the language
 *     changes, which is what restarts the search with the new translation, while
 *     vue-i18n's `t` is stable and `locale` is the ref that changes. Without it a
 *     language switch inside the ~960 ms retry window (8 × 120 ms) would keep
 *     comparing row text against the previous language's target and silently miss
 *     the flash. `setSettingsAnchor` is a store action and therefore stable, so
 *     it needs no watch entry — the same reasoning as note 3.
 *  5. **The recovery effect is a `watch` on `settings` with `immediate: true`**,
 *     the same shape as `useEffect(., [settings, recoverSettings])`.
 * 6. **The nav table is a plain module-scope `const`.** `useMemo` with an empty
 *     dependency list used to wrap it; nothing about it depends on a
 *     reactive value, so no memo is needed here. The
 *     per-tab icon is a component reference rendered through `<component :is>`
 *     rather than a node stored in the record.
 *  7. **`t(key, { defaultValue })` is `t(key)`.** The keys ship in both catalogs,
 * so the fallback text is unreachable.
 *  8. **The extension filter is a computed** (`visibleExtensions`) because a Vue
 * template cannot declare a local inside the `v-for` the way an
 *     inline `.filter(...).map(...)` did.
 *
 * Class names: `settings-permission-select` is a literal in the
 * markup that no stylesheet defines, and `font-medium`,
 * `text-xs-plus` and `text-text-muted` are Tailwind utilities applied
 * to the About meta block — all four are allowlisted for this file in
 * `tests/helpers/class-contract.mjs`.
 */
import { computed, onMounted, onUnmounted, ref, watch, type Component } from "vue";
import { useI18n } from "vue-i18n";
import type {
  AppSettings,
  GlobalPermissionMode,
  PluginScenicThemesDestinationMeta,
  ShortcutPlatform,
} from "@dcode/shared";
import { useAppStore } from "../stores/app-store";
import { api } from "../lib/api";
import {
  isSettingsDestinationHidden,
  SETTINGS_NAV_GROUP_LABELS,
  visibleSettingsNav,
  type SettingsNavGroupId,
  type SettingsTabId,
} from "../lib/settings-search";
import {
  IconArchive,
  IconBookOpen,
  IconBot,
  IconChevronLeft,
  IconDownload,
  IconFileText,
  IconGlobe,
  IconInfo,
  IconKeyboard,
  IconPalette,
  IconSearch,
  IconServer,
  IconSliders,
  IconSparkles,
} from "../lib/icons";
import { pluginViewIcon } from "../lib/plugin-view-icons";
import Badge from "../components/ui/Badge.vue";
import Button from "../components/ui/Button.vue";
import ModelConfigPage from "../components/settings/ModelConfigPage.vue";
import KeyboardShortcutsSection from "../components/settings/KeyboardShortcutsSection.vue";
import FontFamilyRow from "../components/settings/FontFamilyRow.vue";
import ThinkingDisplayModeRow from "../components/settings/ThinkingDisplayModeRow.vue";
import FontSizeRow from "../components/settings/FontSizeRow.vue";
import LanguageRow from "../components/settings/LanguageRow.vue";
import SettingsMenuSelect from "../components/settings/SettingsMenuSelect.vue";
import ThemeRow from "../components/settings/ThemeRow.vue";
import NetworkProxySection from "../components/settings/NetworkProxySection.vue";
import AgentSkillsPage from "../components/settings/AgentSkillsPage.vue";
import AgentMcpPage from "../components/settings/AgentMcpPage.vue";
import AgentSubagentsPage from "../components/settings/AgentSubagentsPage.vue";
import RemoteHostsPage from "../components/settings/RemoteHostsPage.vue";
import PluginScenicThemesDestination from "../components/settings/PluginScenicThemesDestination.vue";
import CommandShellRow from "../features/settings/primitives/CommandShellRow.vue";
import ContextUsageDisplayRow from "../features/settings/primitives/ContextUsageDisplayRow.vue";
import LargePasteThresholdRow from "../features/settings/primitives/LargePasteThresholdRow.vue";
import LinkOpenTargetRow from "../features/settings/primitives/LinkOpenTargetRow.vue";
import SettingsCard from "../features/settings/primitives/SettingsCard.vue";
import SettingsRow from "../features/settings/primitives/SettingsRow.vue";
import AgentInstructionsSection from "../features/settings/AgentInstructionsSection.vue";
import ImportSection from "../features/settings/ImportSection.vue";
import UpdatesRow from "../features/settings/UpdatesRow.vue";
import PromptEnhancementCard from "../features/settings/PromptEnhancementCard.vue";
import CloseBehaviorSection from "../features/settings/CloseBehaviorSection.vue";
import DeveloperSection from "../features/settings/DeveloperSection.vue";
import ProjectsPage from "./ProjectsPage.vue";

/** One rail destination: the shared index entry plus the view-level icon. */
type NavItem = {
  id: SettingsTabId;
  labelKey: string;
  titleKey: string;
  icon: Component;
  group: SettingsNavGroupId;
  /** i18n keys of the rows inside the tab; search matches their translations. */
  keywordKeys: string[];
};

/** Semantic Lucide glyphs for the settings destinations. */
const ICON_BY_TAB: Record<SettingsTabId, Component> = {
  general: IconSliders,
  ai: IconSparkles,
  shortcuts: IconKeyboard,
  instructions: IconFileText,
  agent: IconBot,
  skills: IconBookOpen,
  mcp: IconServer,
  subagents: IconBot,
  import: IconDownload,
  projects: IconArchive,
  remoteHosts: IconGlobe,
  about: IconInfo,
};

/** Tabs whose rows read `settings`; they show the recovery block without it. */
const TABS_NEEDING_SETTINGS: readonly SettingsTabId[] = [
  "general",
  "ai",
  "shortcuts",
  "agent",
];

/* See note 4: `locale` carries the `t` dependency. */
const { t, locale } = useI18n();
const store = useAppStore();

const tab = computed(() => store.appState?.settingsTab ?? "general");
const settingsAnchor = computed(() => store.appState?.settingsAnchor ?? null);
const settings = computed(() => store.appState?.settings);
const version = computed(() => store.appState?.version);
const platform = (window.dcode?.platform ?? "darwin") as ShortcutPlatform;

const query = ref("");
const recoveringSettings = ref(!settings.value);
const settingsRecoveryFailed = ref(false);
const extensions = ref<PluginScenicThemesDestinationMeta[]>([]);
const activeExtension = ref<PluginScenicThemesDestinationMeta | null>(null);

let stopPluginChanged: (() => void) | null = null;

/* See note 3: an empty dependency list is a single mount run. */
onMounted(() => {
  const refresh = () => {
    void api.listPluginScenicThemesDestinations().then(
      (next) => {
        extensions.value = next;
      },
      () => {
        extensions.value = [];
      },
    );
  };
  refresh();
  stopPluginChanged = api.onPluginChanged(refresh);
});

onUnmounted(() => {
  stopPluginChanged?.();
});

/* A destination whose plugin went away cannot stay selected. */
watch([activeExtension, extensions], () => {
  const current = activeExtension.value;
  if (current && !extensions.value.some((entry) => entry.ref === current.ref)) {
    activeExtension.value = null;
    store.appState?.setSettingsTab("general");
  }
});

async function recoverSettings(): Promise<void> {
  recoveringSettings.value = true;
  settingsRecoveryFailed.value = false;
  try {
    const recovered = await api.getSettings();
    store.setState({ settings: recovered });
  } catch {
    settingsRecoveryFailed.value = true;
  } finally {
    recoveringSettings.value = false;
  }
}

/* See note 5: the first run covers a store that never loaded its settings. */
watch(
  settings,
  (value) => {
    if (value) return;
    void recoverSettings();
  },
  { immediate: true },
);

/*
  Arriving from the global search dialog: scroll to and flash the row whose
  title matches the pending anchor key. Rows are located by their translated
  title so async tab content (providers, import) needs no per-row wiring; a
  short retry window covers late mounts.
*/
watch(
  [settingsAnchor, tab, locale],
  (_next, _previous, onCleanup) => {
    const anchor = settingsAnchor.value;
    if (!anchor) return;
    const target = t(anchor).trim();
    let cancelled = false;
    let timer: number | undefined;
    const tryFind = (attempt: number) => {
      if (cancelled) return;
      const titles = document.querySelectorAll<HTMLElement>(
        ".settings-content .settings-row-title, .settings-content .settings-card-heading",
      );
      const match = [...titles].find((node) => node.textContent?.trim() === target);
      if (match) {
        const row =
          match.closest<HTMLElement>(".settings-row") ??
          match.closest<HTMLElement>(".settings-card-block") ??
          match;
        row.scrollIntoView({ block: "center" });
        row.classList.add("settings-anchor-flash");
        window.setTimeout(() => row.classList.remove("settings-anchor-flash"), 1800);
        store.appState?.setSettingsAnchor(null);
        return;
      }
      if (attempt < 8) timer = window.setTimeout(() => tryFind(attempt + 1), 120);
      else store.appState?.setSettingsAnchor(null);
    };
    tryFind(0);
    onCleanup(() => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    });
  },
  { immediate: true },
);

async function saveSettings(patch: Partial<AppSettings>): Promise<void> {
  const current = settings.value;
  if (!current) return;
  const nextSettings = { ...current, ...patch };
  await api.setSettings(nextSettings);
  store.setState({ settings: nextSettings });
  await store.appState?.refreshProviders();
}

async function selectPluginTheme(theme: string): Promise<void> {
  await saveSettings({ theme: theme as AppSettings["theme"] });
}

/*
  Developer-only destinations (Remote Hosts) exist only while developer mode
  is on; the rail, the page, and settings search drop them together.
*/
const developerMode = computed(() => settings.value?.developerMode === true);
const tabHidden = computed(() => isSettingsDestinationHidden(tab.value, developerMode.value));
const navItems = computed<NavItem[]>(() =>
  visibleSettingsNav(developerMode.value).map((entry) => ({
    id: entry.id,
    labelKey: entry.labelKey,
    titleKey: entry.titleKey,
    icon: ICON_BY_TAB[entry.id],
    group: entry.group,
    keywordKeys: entry.keywordKeys,
  })),
);

/*
  Search matches the tab label and the titles of the rows inside it, so typing
  e.g. "theme" or "主题" surfaces Basics even though the tab is named
  differently.
*/
const filteredItems = computed<NavItem[]>(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return navItems.value;
  return navItems.value.filter((item) =>
    [t(item.labelKey), ...item.keywordKeys.map((key) => t(key))].some((text) =>
      text.toLowerCase().includes(q),
    ),
  );
});

/*
  Keep the destination index flat for search, while giving the rail titled
  visual clusters so the eight rows do not read as one dense block.
*/
const filteredGroups = computed(() => {
  const groups = new Map<SettingsNavGroupId, NavItem[]>();
  for (const item of filteredItems.value) {
    const items = groups.get(item.group) ?? [];
    items.push(item);
    groups.set(item.group, items);
  }
  return [...groups.entries()].map(([id, items]) => ({ id, items }));
});

/* See note 8: the extension rows the query keeps. */
const visibleExtensions = computed(() => {
  const q = query.value.trim().toLowerCase();
  return extensions.value.filter(
    (entry) =>
      !q ||
      [entry.label, ...entry.keywords].some((value) =>
        value.toLowerCase().includes(q),
      ),
  );
});

const activeTitleKey = computed(
  () => navItems.value.find((item) => item.id === tab.value)?.titleKey ?? "settings.title",
);
const tabNeedsSettings = computed(() => TABS_NEEDING_SETTINGS.includes(tab.value));

// A hidden destination must not keep rendering: leave the page the rail no
// longer offers (for example Remote Hosts once developer mode is switched off)
// and fall back to General.
watch([settings, tabHidden], ([next, hidden]) => {
  if (!next || !hidden) return;
  store.appState?.setSettingsTab("general");
});
</script>

<template>
  <div class="settings-shell settings-shell-full">
    <div class="settings-titlebar" aria-hidden="true" />
    <aside class="settings-nav sidebar-surface" :aria-label="t('settings.title')">
      <div class="settings-nav-top drag">
        <div class="settings-search-wrap no-drag">
          <IconSearch :size="14" />
          <input
            class="settings-search"
            :value="query"
            :placeholder="t('settings.searchPlaceholder')"
            :aria-label="t('settings.search')"
            spellcheck="false"
            autocorrect="off"
            autocapitalize="off"
            @input="query = ($event.target as HTMLInputElement).value"
          />
        </div>
      </div>

      <div class="settings-nav-scroll no-drag">
        <div v-if="filteredGroups.length === 0" class="settings-nav-empty">
          {{ t("settings.noResults") }}
        </div>
        <template v-else>
          <div v-for="group in filteredGroups" :key="group.id" class="settings-nav-group">
            <div class="settings-nav-group-label">
              {{ t(SETTINGS_NAV_GROUP_LABELS[group.id]) }}
            </div>
            <button
              v-for="item in group.items"
              :key="item.id"
              class="settings-nav-item"
              :class="{ active: tab === item.id }"
              @click="
                activeExtension = null;
                store.appState?.setSettingsTab(item.id);
              "
            >
              <span class="settings-nav-icon">
                <component :is="item.icon" :size="14" />
              </span>
              <span class="settings-nav-label">{{ t(item.labelKey) }}</span>
              <Badge
                v-if="item.id === 'remoteHosts'"
                tone="warning"
                class="settings-nav-experimental"
              >
                {{ t("settings.remoteHosts.experimental") }}
              </Badge>
            </button>
          </div>
        </template>
        <div v-if="extensions.length > 0" class="settings-nav-group">
          <div class="settings-nav-group-label">{{ t("settings.groupExtensions") }}</div>
          <button
            v-for="entry in visibleExtensions"
            :key="entry.ref"
            class="settings-nav-item"
            :class="{ active: activeExtension?.ref === entry.ref }"
            @click="activeExtension = entry"
          >
            <span class="settings-nav-icon">
              <component :is="pluginViewIcon(entry.icon) ?? IconPalette" :size="14" />
            </span>
            <span class="settings-nav-label">{{ entry.label }}</span>
          </button>
        </div>
      </div>

 <!-- Pinned to the rail's bottom so it lands on the same line as the
           main shell's sidebar footer icon row. Both the band and the control
           stay explicitly non-draggable, like the rail's other controls. -->
      <div class="settings-nav-footer no-drag">
        <button
          type="button"
          class="settings-back no-drag"
          data-nav="back-to-app"
          @click="store.appState?.setPage('chat')"
        >
          <IconChevronLeft :size="15" />
          <span>{{ t("settings.backToApp") }}</span>
        </button>
      </div>
    </aside>

    <div class="settings-content">
      <div class="settings-content-inner">
        <div class="settings-content-enter">
          <h1 class="settings-section-title">
            <span>{{ activeExtension?.label ?? t(activeTitleKey) }}</span>
            <Badge
              v-if="!activeExtension && tab === 'remoteHosts' && !tabHidden"
              tone="warning"
            >
              {{ t("settings.remoteHosts.experimental") }}
            </Badge>
          </h1>

          <PluginScenicThemesDestination
            v-if="activeExtension"
            :destination="activeExtension"
            :select-theme="selectPluginTheme"
          />
          <template v-else>
            <div
              v-if="tabNeedsSettings && !settings"
              class="settings-recovery"
              role="status"
              aria-live="polite"
            >
              <template v-if="recoveringSettings">
                <span class="route-pending-indicator" aria-hidden="true" />
                <span>{{ t("common.loading") }}</span>
              </template>
              <template v-else-if="settingsRecoveryFailed">
                <span>{{ t("errors.HOST_UNAVAILABLE") }}</span>
                <Button variant="secondary" @click="void recoverSettings()">
                  {{ t("errors.action.retry") }}
                </Button>
              </template>
            </div>

            <div v-if="tab === 'general' && settings" class="settings-stack">
              <SettingsCard :title="t('settings.appearance')">
                <ThemeRow :settings="settings" :save-settings="saveSettings" />
                <LanguageRow :settings="settings" :save-settings="saveSettings" />
                <FontFamilyRow :settings="settings" :save-settings="saveSettings" />
                <FontSizeRow :settings="settings" :save-settings="saveSettings" />
              </SettingsCard>

              <NetworkProxySection :settings="settings" :save-settings="saveSettings" />

              <CloseBehaviorSection v-if="platform !== 'darwin'" />
            </div>

            <div v-if="tab === 'ai' && settings" class="settings-stack">
              <SettingsCard :title="t('settings.permissions')">
                <SettingsRow
                  :title="t('settings.permissionMode')"
                  :description="t('settings.permissionModeDesc')"
                >
                  <SettingsMenuSelect
                    class="settings-permission-select"
                    :label="t('settings.permissionMode')"
                    :value="settings.defaultPermissionMode ?? 'ask'"
                    :options="[
                      { id: 'ask', label: t('settings.permissionModeAsk') },
                      {
                        id: 'accept-edits',
                        label: t('settings.permissionModeAcceptEdits'),
                      },
                      { id: 'auto', label: t('settings.permissionModeAuto') },
                    ]"
                    @change="
                      (mode) =>
                        void saveSettings({
                          defaultPermissionMode: mode as GlobalPermissionMode,
                        })
                    "
                  />
                </SettingsRow>
              </SettingsCard>
              <SettingsCard :title="t('settings.defaultsTitle')">
                <SettingsRow :title="t('settings.mode')" :description="t('settings.modeDesc')">
                  <div class="settings-segment" role="group" :aria-label="t('settings.mode')">
                    <button
                      v-for="[value, labelKey] in ([
                        ['agent', 'settings.modeAgent'],
                        ['plan', 'settings.modePlan'],
                        ['goal', 'settings.modeGoal'],
                      ] as const)"
                      :key="value"
                      type="button"
                      class="settings-segment-item"
                      :class="{ active: settings.defaultMode === value }"
                      :aria-pressed="settings.defaultMode === value"
                      @click="void saveSettings({ defaultMode: value })"
                    >
                      {{ t(labelKey) }}
                    </button>
                  </div>
                </SettingsRow>
                <CommandShellRow :settings="settings" :save-settings="saveSettings" />
                <LinkOpenTargetRow :settings="settings" :save-settings="saveSettings" />
                <ThinkingDisplayModeRow
                  :settings="settings"
                  :save-settings="saveSettings"
                />
                <ContextUsageDisplayRow
                  :settings="settings"
                  :save-settings="saveSettings"
                />
                <SettingsRow
                  :title="t('settings.enterToSend')"
                  :description="t('settings.enterToSendDesc')"
                >
                  <button
                    type="button"
                    class="settings-toggle"
                    :class="{ on: settings.enterToSend }"
                    role="switch"
                    :aria-checked="settings.enterToSend"
                    :aria-label="t('settings.enterToSend')"
                    @click="void saveSettings({ enterToSend: !settings.enterToSend })"
                  >
                    <span class="settings-toggle-thumb" />
                  </button>
                </SettingsRow>
                <LargePasteThresholdRow
                  :settings="settings"
                  :save-settings="saveSettings"
                />
              </SettingsCard>

              <PromptEnhancementCard
                :settings="settings"
                :save-settings="saveSettings"
              />
            </div>

            <div v-if="tab === 'shortcuts' && settings" class="settings-stack">
              <KeyboardShortcutsSection
                :settings="settings"
                :platform="platform"
                :save-settings="saveSettings"
              />
            </div>

            <ModelConfigPage v-if="tab === 'agent'" />

            <AgentSkillsPage v-if="tab === 'skills'" />

            <AgentMcpPage v-if="tab === 'mcp'" />

            <AgentSubagentsPage v-if="tab === 'subagents'" />

            <AgentInstructionsSection v-if="tab === 'instructions'" />

            <ImportSection v-if="tab === 'import'" />

            <ProjectsPage v-if="tab === 'projects'" />

            <RemoteHostsPage v-if="tab === 'remoteHosts' && !tabHidden" />

            <div v-if="tab === 'about'" class="settings-stack">
              <SettingsCard>
                <SettingsRow :title="t('settings.application')">
                  <div class="settings-about-meta">
                    <div class="font-medium">
                      {{ version?.name || "DCode" }} {{ version?.version }}
                    </div>
                    <div class="font-mono text-xs-plus text-text-muted">
                      protocol {{ version?.protocolVersion }} · host
                      {{ version?.hostVersion }}
                    </div>
                  </div>
                </SettingsRow>
                <SettingsRow :title="t('settings.logs')">
                  <Button variant="secondary" @click="void api.openLogs()">
                    {{ t("settings.openLogs") }}
                  </Button>
                </SettingsRow>
                <UpdatesRow :current-version="version?.version" />
              </SettingsCard>

              <DeveloperSection
                v-if="settings"
                :settings="settings"
                :save-settings="saveSettings"
              />
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
