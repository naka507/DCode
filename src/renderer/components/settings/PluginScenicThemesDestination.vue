<script setup lang="ts">
/**
 * Scenic-themes destination.
 *
 * The `PluginScenicThemesDestination` component. The host owns every
 * pixel of this destination; plugins supply only the already validated card
 * metadata and declared backdrop assets, so the markup here is the whole
 * component.
 *
 * `selectTheme` stays an imperative callback prop (the `Props`), the way
 * the settings rows keep `saveSettings`; it is not an `onXxx`
 * event prop, so it is not an emit. The store read is
 * `store.appState?.settings?.theme`, the tracked form of
 * `useAppStore((state) => state.settings?.theme)`.
 *
 * The pure `clampBlur` is the framework-free half and
 * lives in `components/settings/plugin-scenic-themes-destination.ts`.
 */
import { computed, ref, watch } from "vue";
import type { PluginScenicThemesDestinationMeta } from "@dcode/shared";
import { api } from "../../lib/api";
import { useAppStore } from "../../stores/app-store";
import Button from "../ui/Button.vue";
import HelpIcon from "../ui/HelpIcon.vue";
import { clampBlur } from "./plugin-scenic-themes-destination";

const props = defineProps<{
  destination: PluginScenicThemesDestinationMeta;
  selectTheme: (themeId: string) => Promise<void>;
}>();

const store = useAppStore();

const selectedTheme = computed(() => store.appState?.settings?.theme);

const selectedCard = computed(
  () =>
    props.destination.themes.find((theme) => theme.themeId === selectedTheme.value) ??
    props.destination.themes[0],
);

const confirmedBlur = ref(selectedCard.value?.blur ?? 6);
const draftBlur = ref(selectedCard.value?.blur ?? 6);
const saving = ref(false);

watch(selectedCard, (card) => {
  const blur = card?.blur ?? card?.blurDefault ?? 6;
  confirmedBlur.value = blur;
  draftBlur.value = blur;
});

async function chooseTheme(themeId: string) {
  try {
    await props.selectTheme(themeId);
  } catch (error) {
    store.appState?.showToast(error instanceof Error ? error.message : String(error), {
      variant: "error",
    });
  }
}

async function apply() {
  const card = selectedCard.value;
  if (!card || saving.value || draftBlur.value === confirmedBlur.value) return;
  saving.value = true;
  try {
    await api.setPluginScenicThemeBlur(
      props.destination.pluginId,
      card.themeId,
      draftBlur.value,
    );
    confirmedBlur.value = draftBlur.value;
  } catch (error) {
    draftBlur.value = confirmedBlur.value;
    store.appState?.showToast(error instanceof Error ? error.message : String(error), {
      variant: "error",
    });
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <section
    v-if="selectedCard"
    class="plugin-scenic-themes-destination"
    :aria-label="destination.label"
  >
    <p class="plugin-scenic-themes-description">{{ destination.description }}</p>
    <div class="plugin-scenic-theme-grid">
      <button
        v-for="theme in destination.themes"
        :key="theme.themeId"
        type="button"
        class="plugin-scenic-theme-card"
        :class="{ active: theme.themeId === selectedTheme }"
        :aria-pressed="theme.themeId === selectedTheme"
        @click="chooseTheme(theme.themeId)"
      >
        <img :src="theme.previewUrl" alt="" />
        <span class="plugin-scenic-theme-card-shade" aria-hidden="true" />
        <span class="plugin-scenic-theme-card-content">
          <span class="plugin-scenic-theme-card-title">{{ theme.label }}</span>
          <span class="plugin-scenic-theme-card-description">{{ theme.description }}</span>
        </span>
        <span
          v-if="theme.themeId === selectedTheme"
          class="plugin-scenic-theme-card-check"
          aria-hidden="true"
          >✓</span
        >
      </button>
    </div>
    <div class="plugin-scenic-blur-control">
      <div class="plugin-scenic-blur-copy">
        <span class="plugin-scenic-blur-label">
          Backdrop blur
          <HelpIcon :label="`Applies to ${selectedCard.label}`" />
        </span>
      </div>
      <div class="plugin-scenic-blur-actions">
        <label class="sr-only" for="plugin-scenic-backdrop-blur">Backdrop blur</label>
        <input
          id="plugin-scenic-backdrop-blur"
          type="range"
          min="0"
          max="20"
          step="1"
          :value="draftBlur"
          @input="draftBlur = clampBlur(Number(($event.target as HTMLInputElement).value))"
        />
        <output for="plugin-scenic-backdrop-blur">{{ draftBlur }}px</output>
        <Button
          variant="primary"
          :disabled="saving || draftBlur === confirmedBlur"
          @click="apply"
        >
          {{ saving ? "Applying…" : "Apply" }}
        </Button>
      </div>
    </div>
  </section>
</template>
