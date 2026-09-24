<script setup lang="ts">
/**
 * Plugin launcher surface.
 *
 * The shell loads the
 * same renderer entry with `?surface=plugin-launcher` for the global launcher
 * window, so this component is the whole document: search over launchable
 * plugins, recency-ordered results, and the keyboard loop that opens a panel.
 *
 * Styling comes entirely from `src/renderer/styles/plugin-launcher.css`; the
 * class names below are the contract that partial styles, so this component
 * must not carry a component-local style block of its own.
 */
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { isThemeColorScheme, type PluginSummary } from "@dcode/shared";
import { api } from "../lib/api";
import { searchLaunchablePlugins } from "../lib/plugin-launcher-search";
import {
  loadPluginLaunchHistory,
  rememberPluginLaunch,
} from "../lib/plugin-launcher-history";
import { IconArrowUpRight, IconPlug, IconSearch } from "../lib/icons";

function monogram(name: string): string {
  return Array.from(name.trim())[0]?.toLocaleUpperCase() ?? "P";
}

const { t } = useI18n();
const inputRef = ref<HTMLInputElement | null>(null);
const query = ref("");
const plugins = ref<PluginSummary[]>([]);
const highlighted = ref(0);
const loading = ref(true);
const openingId = ref<string | null>(null);
const error = ref<string | null>(null);
const recentIds = ref<string[]>(
  loadPluginLaunchHistory().map((record) => record.id),
);

/** Concurrent loads share one in-flight request. */
let loadPromise: Promise<void> | null = null;

const results = computed(() =>
  searchLaunchablePlugins(plugins.value, query.value, recentIds.value).slice(
    0,
    7,
  ),
);

async function load() {
  if (loadPromise) {
    await loadPromise;
    return;
  }
  loading.value = true;
  error.value = null;
  const request = (async () => {
    try {
      const result = await api.listPlugins();
      plugins.value = result.plugins;
    } catch (loadError) {
      error.value =
        loadError instanceof Error ? loadError.message : String(loadError);
    } finally {
      loading.value = false;
    }
  })();
  loadPromise = request;
  try {
    await request;
  } finally {
    if (loadPromise === request) loadPromise = null;
  }
}

function reset() {
  query.value = "";
  highlighted.value = 0;
  openingId.value = null;
  error.value = null;
  recentIds.value = loadPluginLaunchHistory().map((record) => record.id);
  // Warm-up may run before the host is ready, so retry the persisted theme
  // when the launcher is actually shown instead of keeping the fallback.
  void api
    .getSettings()
    .then((settings) => {
      document.documentElement.dataset.theme = isThemeColorScheme(settings.theme)
        ? settings.theme
        : window.matchMedia("(prefers-color-scheme: light)").matches
          ? "light"
          : "dark";
    })
    .catch(() => undefined);
  inputRef.value?.focus();
  void load();
}

let themeDisposed = false;
let themeMediaQuery: MediaQueryList | null = null;
let onSystemThemeChange: (() => void) | null = null;
let unsubscribeLauncherShown: (() => void) | null = null;

onMounted(() => {
  const applyTheme = (preference: string) => {
    if (themeDisposed) return;
    document.documentElement.dataset.theme = isThemeColorScheme(preference)
      ? preference
      : window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark";
  };

  void api
    .getSettings()
    .then((settings) => {
      applyTheme(settings.theme);
      if (isThemeColorScheme(settings.theme)) return;
      themeMediaQuery = window.matchMedia("(prefers-color-scheme: light)");
      onSystemThemeChange = () => applyTheme(settings.theme);
      themeMediaQuery.addEventListener("change", onSystemThemeChange);
    })
    .catch(() => applyTheme("system"));

  reset();
  unsubscribeLauncherShown = api.onPluginLauncherShown(reset);
});

onUnmounted(() => {
  themeDisposed = true;
  if (themeMediaQuery && onSystemThemeChange) {
    themeMediaQuery.removeEventListener("change", onSystemThemeChange);
  }
  unsubscribeLauncherShown?.();
});

watch(query, () => {
  highlighted.value = 0;
});

watch([highlighted, () => results.value.length], () => {
  if (highlighted.value < results.value.length) return;
  highlighted.value = Math.max(0, results.value.length - 1);
});

async function openPlugin(plugin: PluginSummary | undefined) {
  if (!plugin || openingId.value) return;
  openingId.value = plugin.id;
  error.value = null;
  try {
    await api.openPluginPanel(plugin.id);
    recentIds.value = rememberPluginLaunch(plugin.id).map(
      (record) => record.id,
    );
    await api.dismissPluginLauncher();
  } catch (openError) {
    error.value =
      openError instanceof Error ? openError.message : String(openError);
    openingId.value = null;
  }
}

function onKeyDown(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) {
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    void api.dismissPluginLauncher();
    return;
  }
  if (!results.value.length) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const delta = event.key === "ArrowDown" ? 1 : -1;
    highlighted.value =
      (highlighted.value + delta + results.value.length) % results.value.length;
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    void openPlugin(results.value[highlighted.value]);
  }
}

const emptyText = computed(() =>
  loading.value
    ? t("pluginLauncher.loading")
    : query.value.trim()
      ? t("pluginLauncher.noResults")
      : t("pluginLauncher.empty"),
);

/** ⌥ Space on macOS, Alt + Space everywhere else. */
const shortcutHint =
  window.dcode?.platform === "darwin" ? "⌥ Space" : "Alt + Space";
</script>

<template>
  <main class="plugin-launcher" :aria-label="t('pluginLauncher.title')">
    <section class="plugin-launcher-surface">
      <div class="plugin-launcher-search-row">
        <IconSearch :size="18" aria-hidden="true" />
        <input
          ref="inputRef"
          v-model="query"
          class="plugin-launcher-input"
          :placeholder="t('pluginLauncher.placeholder')"
          autocomplete="off"
          autocorrect="off"
          autocapitalize="off"
          spellcheck="false"
          role="combobox"
          :aria-expanded="results.length > 0"
          aria-controls="plugin-launcher-results"
          :aria-activedescendant="
            results[highlighted]
              ? `plugin-launcher-option-${results[highlighted].id}`
              : undefined
          "
          @keydown="onKeyDown"
        />
        <span class="plugin-launcher-shortcut" aria-hidden="true">
          {{ shortcutHint }}
        </span>
      </div>

      <div
        id="plugin-launcher-results"
        class="plugin-launcher-results"
        role="listbox"
      >
        <template v-if="results.length">
          <button
            v-for="(plugin, index) in results"
            :id="`plugin-launcher-option-${plugin.id}`"
            :key="plugin.id"
            type="button"
            role="option"
            :aria-selected="highlighted === index"
            class="plugin-launcher-option"
            :class="{ active: highlighted === index }"
            :disabled="openingId !== null"
            @pointermove="highlighted = index"
            @click="openPlugin(plugin)"
          >
            <span class="plugin-launcher-monogram" aria-hidden="true">
              {{ monogram(plugin.name) }}
            </span>
            <span class="plugin-launcher-option-copy">
              <strong>{{ plugin.name }}</strong>
              <span>{{ plugin.description || plugin.id }}</span>
            </span>
            <IconArrowUpRight :size="15" aria-hidden="true" />
          </button>
        </template>
        <div v-else class="plugin-launcher-empty" role="status">
          <IconPlug :size="20" aria-hidden="true" />
          <span>{{ emptyText }}</span>
        </div>
      </div>

      <footer class="plugin-launcher-footer">
        <span>{{ t("pluginLauncher.navigateHint") }}</span>
        <span>{{ t("pluginLauncher.openHint") }}</span>
        <span>{{ t("pluginLauncher.dismissHint") }}</span>
        <strong v-if="error" role="alert">{{ error }}</strong>
      </footer>
    </section>
  </main>
</template>
