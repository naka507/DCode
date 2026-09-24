<script setup lang="ts">
/**
 * Theme picker for Settings → General → Appearance.
 *
 * Language, font, and theme are searchable picker rows. Built-in System /
 * Light / Dark stay pinned at the top; plugin themes follow after a divider.
 * Search matches labels, descriptions, ids, and plugin ids.
 */
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  BUILTIN_THEME_PREFERENCES,
  type AppSettings,
  type ThemePreference,
} from "@dcode/shared";
import { IconCheck, IconChevronDown, IconSearch } from "../../lib/icons";
import { useAppStore } from "../../stores/app-store";
import AnchoredMenu from "./AnchoredMenu.vue";
import SettingsRow from "../../features/settings/primitives/SettingsRow.vue";

type ThemeOption = {
  id: ThemePreference;
  title: string;
  hint: string | null;
  haystack: string;
  kind: "builtin" | "plugin";
};

const props = defineProps<{
  settings: AppSettings;
  saveSettings: (patch: Partial<AppSettings>) => Promise<void>;
}>();

const { t } = useI18n();
const store = useAppStore();

const pluginThemes = computed(() => store.appState?.pluginThemes ?? []);

const open = ref(false);
const query = ref("");
const activeId = ref<ThemePreference>(props.settings.theme ?? "system");
const optionRefs = new Map<string, HTMLButtonElement>();

const selectedId = computed<ThemePreference>(
  () => props.settings.theme ?? "system",
);

const options = computed<ThemeOption[]>(() => {
  const builtins: ThemeOption[] = BUILTIN_THEME_PREFERENCES.map((id) => {
    const title = t(
      id === "light"
        ? "settings.themeLight"
        : id === "dark"
          ? "settings.themeDark"
          : "settings.themeSystem",
    );
    return {
      id,
      title,
      hint: null,
      haystack: `${title} ${id}`.toLowerCase(),
      kind: "builtin",
    };
  });
  const plugins: ThemeOption[] = pluginThemes.value.map((theme) => {
    const hint = t("settings.themeFromPlugin", { plugin: theme.pluginId });
    return {
      id: theme.id,
      title: theme.label,
      hint,
      haystack: `${theme.label} ${hint} ${theme.id} ${theme.pluginId} ${theme.themeId} plugin`.toLowerCase(),
      kind: "plugin",
    };
  });
  return [...builtins, ...plugins];
});

const visible = computed(() => {
  const needle = query.value.trim().toLowerCase();
  if (!needle) return options.value;
  return options.value.filter((option) => option.haystack.includes(needle));
});

const visibleIds = computed(() => visible.value.map((option) => option.id));

watch(visibleIds, (ids) => {
  if (ids.includes(activeId.value)) return;
  activeId.value = ids[0] ?? "system";
});

watch(
  () => [activeId.value, open.value] as const,
  () => {
    if (!open.value) return;
    optionRefs.get(activeId.value)?.scrollIntoView({ block: "nearest" });
  },
  { flush: "post" },
);

const selected = computed(() =>
  options.value.find((option) => option.id === selectedId.value),
);
const triggerLabel = computed(() => selected.value?.title ?? selectedId.value);

function setOptionRef(id: string, node: unknown) {
  if (node instanceof HTMLButtonElement) optionRefs.set(id, node);
  else optionRefs.delete(id);
}

function close() {
  open.value = false;
  query.value = "";
}

function choose(id: ThemePreference) {
  close();
  if (id === selectedId.value) return;
  void props.saveSettings({ theme: id });
}

function moveActive(delta: number) {
  const ids = visibleIds.value;
  if (ids.length === 0) return;
  const index = ids.indexOf(activeId.value);
  const next =
    index === -1
      ? delta > 0
        ? 0
        : ids.length - 1
      : (index + delta + ids.length) % ids.length;
  activeId.value = ids[next] ?? "system";
}

function onTriggerClick() {
  query.value = "";
  activeId.value = selectedId.value;
  open.value = !open.value;
}

function onSearchKeydown(event: KeyboardEvent) {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    moveActive(1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    moveActive(-1);
  } else if (event.key === "Enter") {
    event.preventDefault();
    if (activeId.value) choose(activeId.value);
  }
}

/** True on a builtin row whose next visible row is a plugin theme. */
function showDivider(index: number): boolean {
  const option = visible.value[index];
  const next = visible.value[index + 1];
  return option?.kind === "builtin" && next?.kind === "plugin";
}
</script>

<template>
  <SettingsRow
    :title="t('settings.theme')"
    :description="t('settings.themeDesc')"
  >
      <AnchoredMenu
        class="settings-theme-anchor"
        :open="open"
        menu-class-name="settings-theme-menu"
        :label="t('settings.theme')"
        align="end"
        initial-focus="input"
        @close="close"
      >
        <template #trigger="{ setAnchor }">
          <button
            :ref="setAnchor"
            type="button"
            class="settings-theme-trigger"
            aria-haspopup="listbox"
            :aria-expanded="open"
            :aria-label="t('settings.theme')"
            @click="onTriggerClick"
          >
            <span class="settings-theme-trigger-label">{{ triggerLabel }}</span>
            <IconChevronDown :size="14" aria-hidden="true" />
          </button>
        </template>

        <div class="settings-theme-search">
          <IconSearch :size="13" aria-hidden="true" />
          <input
            v-model="query"
            type="text"
            class="settings-search"
            :placeholder="t('settings.themeSearchPlaceholder')"
            :aria-label="t('settings.themeSearchPlaceholder')"
            spellcheck="false"
            autocorrect="off"
            autocapitalize="off"
            autocomplete="off"
            @keydown="onSearchKeydown"
          />
        </div>
        <div class="settings-theme-results">
          <div v-if="visible.length === 0" class="settings-theme-empty">
            {{ t("settings.noResults") }}
          </div>
          <ul v-else class="settings-theme-list">
            <li
              v-for="(option, index) in visible"
              :key="option.id"
              :class="{ 'has-divider': showDivider(index) }"
            >
              <button
                :ref="(node) => setOptionRef(option.id, node)"
                type="button"
                role="option"
                :tabindex="-1"
                :aria-selected="option.id === selectedId"
                class="settings-theme-option"
                :class="{
                  'is-current': option.id === selectedId,
                  'is-active': option.id === activeId,
                }"
                @mouseenter="activeId = option.id"
                @click="choose(option.id)"
              >
                <span class="settings-theme-option-copy">
                  <span class="settings-theme-option-title">
                    {{ option.title }}
                  </span>
                  <span v-if="option.hint" class="settings-theme-option-hint">
                    {{ option.hint }}
                  </span>
                </span>
                <IconCheck
                  v-if="option.id === selectedId"
                  :size="14"
                  class="settings-theme-check"
                  aria-hidden="true"
                />
              </button>
              <span
                v-if="showDivider(index)"
                class="settings-theme-divider"
                aria-hidden="true"
              />
            </li>
          </ul>
        </div>
      </AnchoredMenu>
  </SettingsRow>
</template>
