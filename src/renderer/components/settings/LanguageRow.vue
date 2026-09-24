<script setup lang="ts">
/**
 * Language picker for Settings → General → Appearance.
 *
 * Theme and language both use this searchable anchored-menu pattern.
 * Language is a growing named list: Auto pinned at the top, then shipped
 * locales with native names (endonyms, never translated) and English names
 * for search/sort.
 */
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { AppSettings } from "@dcode/shared";
import {
  listedLocales,
  localeInfo,
  type AppLanguageSetting,
  type AppLocale,
} from "@dcode/i18n";
import { IconCheck, IconChevronDown, IconSearch } from "../../lib/icons";
import { resolveAppLanguage } from "../../lib/app-language";
import AnchoredMenu from "./AnchoredMenu.vue";

type LanguageOption = {
  id: AppLanguageSetting;
  nativeName: string;
  englishName: string | null;
  haystack: string;
};

const props = defineProps<{
  settings: AppSettings;
  saveSettings: (patch: Partial<AppSettings>) => Promise<void>;
}>();

const { t } = useI18n();

const open = ref(false);
const query = ref("");
const activeId = ref<AppLanguageSetting>(props.settings.language ?? "auto");
const optionRefs = new Map<string, HTMLButtonElement>();

const detected = resolveAppLanguage("auto");
const detectedInfo = localeInfo(detected);
const selectedId = computed<AppLanguageSetting>(
  () => props.settings.language ?? "auto",
);
const autoLabel = computed(() => t("settings.languageAuto"));

const options = computed<LanguageOption[]>(() => {
  const auto: LanguageOption = {
    id: "auto",
    nativeName: autoLabel.value,
    englishName: t("settings.languageAutoDesc", {
      state: detectedInfo.nativeName,
    }),
    haystack:
      `${autoLabel.value} auto system ${detectedInfo.nativeName} ${detectedInfo.englishName} ${detectedInfo.id}`.toLowerCase(),
  };
  const locales = listedLocales().map((locale) => ({
    id: locale.id as AppLanguageSetting,
    nativeName: locale.nativeName,
    englishName:
      locale.englishName === locale.nativeName ? null : locale.englishName,
    haystack: `${locale.nativeName} ${locale.englishName} ${locale.id}`.toLowerCase(),
  }));
  return [auto, ...locales];
});

const visible = computed(() => {
  const needle = query.value.trim().toLowerCase();
  if (!needle) return options.value;
  return options.value.filter((option) => option.haystack.includes(needle));
});

const visibleIds = computed(() => visible.value.map((option) => option.id));

watch(visibleIds, (ids) => {
  if (ids.includes(activeId.value)) return;
  activeId.value = ids[0] ?? "auto";
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
const triggerLabel = computed(() =>
  selectedId.value === "auto"
    ? autoLabel.value
    : (selected.value?.nativeName ??
      localeInfo(selectedId.value as AppLocale).nativeName),
);

function setOptionRef(id: string, node: unknown) {
  if (node instanceof HTMLButtonElement) optionRefs.set(id, node);
  else optionRefs.delete(id);
}

function close() {
  open.value = false;
  query.value = "";
}

function choose(id: AppLanguageSetting) {
  close();
  if (id === selectedId.value) return;
  void props.saveSettings({ language: id });
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
  activeId.value = ids[next] ?? "auto";
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

/** Auto is a single pinned row; the divider follows it when locales exist. */
const showAutoDivider = computed(() =>
  visible.value.some((option) => option.id !== "auto"),
);
</script>

<template>
  <div class="settings-row">
    <div class="settings-row-copy">
      <div class="settings-row-title">{{ t("settings.language") }}</div>
    </div>
    <div class="settings-row-control">
      <AnchoredMenu
        class="settings-language-anchor"
        :open="open"
        menu-class-name="settings-language-menu"
        :label="t('settings.language')"
        align="end"
        initial-focus="input"
        @close="close"
      >
        <template #trigger="{ setAnchor }">
          <button
            :ref="setAnchor"
            type="button"
            class="settings-language-trigger"
            aria-haspopup="listbox"
            :aria-expanded="open"
            :aria-label="t('settings.language')"
            @click="onTriggerClick"
          >
            <span class="settings-language-trigger-label">{{ triggerLabel }}</span>
            <IconChevronDown :size="14" aria-hidden="true" />
          </button>
        </template>

        <div class="settings-language-search">
          <IconSearch :size="13" aria-hidden="true" />
          <input
            v-model="query"
            type="text"
            class="settings-search"
            :placeholder="t('settings.languageSearchPlaceholder')"
            :aria-label="t('settings.languageSearchPlaceholder')"
            spellcheck="false"
            autocorrect="off"
            autocapitalize="off"
            autocomplete="off"
            @keydown="onSearchKeydown"
          />
        </div>
        <div class="settings-language-results">
          <div v-if="visible.length === 0" class="settings-language-empty">
            {{ t("settings.noResults") }}
          </div>
          <ul v-else class="settings-language-list">
            <li
              v-for="(option, index) in visible"
              :key="option.id"
              :class="{ 'has-divider': index === 0 && showAutoDivider }"
            >
              <button
                :ref="(node) => setOptionRef(option.id, node)"
                type="button"
                role="option"
                :tabindex="-1"
                :aria-selected="option.id === selectedId"
                class="settings-language-option"
                :class="{
                  'is-current': option.id === selectedId,
                  'is-active': option.id === activeId,
                }"
                @mouseenter="activeId = option.id"
                @click="choose(option.id)"
              >
                <span class="settings-language-option-copy">
                  <span class="settings-language-option-native">
                    {{ option.nativeName }}
                  </span>
                  <span
                    v-if="option.englishName"
                    class="settings-language-option-english"
                  >
                    {{ option.englishName }}
                  </span>
                </span>
                <IconCheck
                  v-if="option.id === selectedId"
                  :size="14"
                  class="settings-language-check"
                  aria-hidden="true"
                />
              </button>
              <span
                v-if="index === 0 && showAutoDivider"
                class="settings-language-divider"
                aria-hidden="true"
              />
            </li>
          </ul>
        </div>
      </AnchoredMenu>
    </div>
  </div>
</template>
