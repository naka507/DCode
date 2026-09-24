<script setup lang="ts">
/**
 * Ambient update notice in the main pane's top safe area. Appears when an
 * update is ready to install (in-app mode) or newly detected (manual mode);
 * silent otherwise. The Settings → Info tab owns explicit checks and status.
 * When Main attaches localized release notes, they appear under the status
 * message as a compact "What's new" list (D164).
 *
 * Three early `return null`s become one `shown` predicate, because a
 * `<script setup>` body cannot return early without losing the template; the
 * DOM it renders is the same.
 */
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { UpdateState } from "@dcode/shared";
import { api } from "../lib/api";
import { useUpdateState } from "../hooks/use-update-state";
import Button from "./ui/Button.vue";
import TooltipButton from "./TooltipButton.vue";
import { IconClose, IconCloudDown, IconExternal } from "../lib/icons";

const { t } = useI18n();
const update = useUpdateState();
const dismissedState = ref<string | null>(null);

const stateKey = computed(
  () => `${update.value?.availableVersion}:${update.value?.status}`,
);

const visible = computed(() => {
  const state = update.value;
  // A disabled install has no feed at all: nothing to announce, ever.
  if (!state || state.mode === "disabled") return false;
  return (
    state.status === "downloaded" ||
    state.status === "downloading" ||
    (state.status === "available" && state.mode === "manual")
  );
});

/** Returns null for an absent version, a dismissal, or a hidden state. */
const shown = computed(
  () =>
    Boolean(update.value?.availableVersion) &&
    stateKey.value !== dismissedState.value &&
    visible.value,
);

const message = computed(() =>
  update.value ? bannerMessage(update.value, t) : "",
);

const progress = computed(() =>
  Math.max(0, Math.min(100, update.value?.progressPercent ?? 0)),
);

const notes = computed(() => update.value?.releaseNotes?.trim() || null);

function installUpdate() {
  void api.updatesInstall().catch(() => undefined);
}

function openReleases() {
  void api.updatesOpenReleases().catch(() => undefined);
}

type Translate = typeof t;

function bannerMessage(update: UpdateState, t: Translate): string {
  if (update.status === "downloading") {
    return t("updates.downloading", { percent: update.progressPercent ?? 0 });
  }
  if (update.status === "downloaded") {
    return t("updates.downloaded", { version: update.availableVersion });
  }
  return t("updates.available", { version: update.availableVersion });
}
</script>

<template>
  <div
    v-if="shown"
    role="status"
    aria-live="polite"
    aria-atomic="true"
    class="update-notice"
    :data-update-status="update?.status"
  >
    <div class="update-notice-icon" aria-hidden="true">
      <IconCloudDown class="size-4" />
    </div>

    <div class="update-notice-body">
      <div class="update-notice-title">{{ t("updates.title") }}</div>
      <div class="update-notice-message">{{ message }}</div>

      <div v-if="notes" class="update-notice-notes">
        <div class="update-notice-notes-label">{{ t("updates.whatsNew") }}</div>
        <pre class="update-notice-notes-body">{{ notes }}</pre>
      </div>

      <div
        v-if="update?.status === 'downloading'"
        class="update-notice-progress"
        role="progressbar"
        :aria-label="message"
        :aria-valuemin="0"
        :aria-valuemax="100"
        :aria-valuenow="Math.round(progress)"
      >
        <span :style="{ width: `${progress}%` }"></span>
      </div>

      <div class="update-notice-actions">
        <Button
          v-if="update?.status === 'downloaded'"
          variant="primary"
          size="sm"
          @click="installUpdate"
        >
          {{ t("updates.restart") }}
        </Button>
        <Button
          v-if="update?.status === 'available' && update?.mode === 'manual'"
          variant="secondary"
          size="sm"
          @click="openReleases"
        >
          <IconExternal class="size-3.5" />
          {{ t("updates.viewRelease") }}
        </Button>
      </div>
    </div>

    <TooltipButton
      as="button"
      type="button"
      :label="t('updates.dismiss')"
      :aria-label="t('updates.dismiss')"
      class="update-notice-dismiss"
      @click="dismissedState = stateKey"
    >
      <IconClose class="size-3.5" />
    </TooltipButton>
  </div>
</template>
