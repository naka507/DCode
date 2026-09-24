<script setup lang="ts">
/**
 * Full-window boot surface shown until host/settings bootstrap finishes.
 *
 * Styling comes entirely from
 * `styles/chrome.css`; the class names are the contract.
 */
import { useI18n } from "vue-i18n";
import BrandLogo from "./BrandLogo.vue";
import { cx } from "../lib/cx";

withDefaults(defineProps<{ exiting?: boolean }>(), { exiting: false });

const { t } = useI18n();
</script>

<template>
  <div
    :class="cx('startup-splash', exiting && 'is-exiting')"
    role="status"
    aria-live="polite"
    :aria-busy="!exiting"
    data-testid="startup-splash"
  >
    <div class="startup-splash-card">
      <div class="startup-splash-mark" aria-hidden="true">
        <BrandLogo :size="64" />
      </div>
      <div class="startup-splash-copy">
        <div class="startup-splash-name">{{ t("app.shellName") }}</div>
        <div class="startup-splash-tagline">{{ t("app.tagline") }}</div>
      </div>
      <div class="startup-splash-track" aria-hidden="true">
        <span class="startup-splash-bar"></span>
      </div>
      <span class="sr-only">{{ t("app.starting") }}</span>
    </div>
  </div>
</template>
