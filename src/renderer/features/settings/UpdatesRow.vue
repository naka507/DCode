<script setup lang="ts">
/**
 * The app-update row (Settings → About).
 *
 * The action button follows the live update
 * state: install when a build is downloaded, open the releases page in manual
 * mode, check otherwise. Release notes are shown inline while a version is
 * pending and in full through `ReleaseNotesDialog`.
 */
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { api } from "../../lib/api";
import { useUpdateState } from "../../hooks/use-update-state";
import { IconFileText } from "../../lib/icons";
import Button from "../../components/ui/Button.vue";
import ReleaseNotesDialog from "../../components/ReleaseNotesDialog.vue";
import SettingsRow from "./primitives/SettingsRow.vue";

const props = defineProps<{ currentVersion?: string }>();

const { t } = useI18n();
const update = useUpdateState();

const releaseNotesOpen = ref(false);

const disabled = computed(() => !update.value || update.value.mode === "disabled");
/**
 * A build with no configured release repository: Settings shows the current
 * version alone. The check button and the release-notes entry both depend on a
 * feed, so neither is offered.
 */
const unconfigured = computed(
  () => update.value?.mode === "disabled" && !update.value?.releasesUrl,
);
const currentVersion = computed(
  () => update.value?.currentVersion ?? props.currentVersion ?? "",
);
const busy = computed(
  () => update.value?.status === "checking" || update.value?.status === "downloading",
);

const statusText = computed<string | null>(() => {
  const state = update.value;
  if (unconfigured.value) return t("updates.versionLabel", { version: currentVersion.value });
  if (disabled.value) return t("updates.devDisabled");
  if (!state) return null;
  switch (state.status) {
    case "checking":
      return t("updates.checking");
    case "up-to-date":
      return t("updates.upToDate");
    case "available":
      return `${t("updates.available", { version: state.availableVersion })}${
        state.mode === "manual" ? ` ${t("updates.manualHint")}` : ""
      }`;
    case "downloading":
      return t("updates.downloading", { percent: state.progressPercent ?? 0 });
    case "downloaded":
      return t("updates.downloaded", { version: state.availableVersion });
    case "error":
      return t("updates.error", { message: state.error ?? "" });
    default:
      return null;
  }
});

const notes = computed(() => update.value?.releaseNotes?.trim() || null);

const showNotes = computed(
  () =>
    !!notes.value &&
    (update.value?.status === "available" ||
      update.value?.status === "downloading" ||
      update.value?.status === "downloaded"),
);

function closeReleaseNotes() {
  releaseNotesOpen.value = false;
}
</script>

<template>
  <SettingsRow :title="t('updates.title')" :description="unconfigured ? t('updates.unconfigured') : t('updates.desc')">
    <div class="flex flex-col items-end gap-1.5">
      <div v-if="!unconfigured" class="update-settings-actions">
        <Button variant="secondary" @click="releaseNotesOpen = true">
          <IconFileText :size="14" />
          {{ t("updates.releaseNotes") }}
        </Button>
        <Button
          v-if="update?.status === 'downloaded'"
          variant="primary"
          @click="void api.updatesInstall().catch(() => undefined)"
        >
          {{ t("updates.restart") }}
        </Button>
        <Button
          v-else-if="update?.status === 'available' && update.mode === 'manual'"
          variant="secondary"
          @click="void api.updatesOpenReleases().catch(() => undefined)"
        >
          {{ t("updates.viewRelease") }}
        </Button>
        <Button
          v-else
          variant="secondary"
          :disabled="disabled || busy"
          @click="void api.updatesCheck().catch(() => undefined)"
        >
          {{ busy ? t("updates.checking") : t("updates.check") }}
        </Button>
      </div>
      <div v-if="statusText" class="text-right text-xs-plus text-text-muted">
        {{ statusText }}
      </div>
      <div v-if="showNotes" class="update-settings-notes">
        <div class="update-settings-notes-label">{{ t("updates.whatsNew") }}</div>
        <pre class="update-settings-notes-body">{{ notes }}</pre>
      </div>
    </div>
    <ReleaseNotesDialog
      v-if="releaseNotesOpen"
      :current-version="update?.currentVersion ?? props.currentVersion"
      :available-version="update?.availableVersion"
      @close="closeReleaseNotes"
    />
  </SettingsRow>
</template>
