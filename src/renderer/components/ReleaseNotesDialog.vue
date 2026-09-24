<script setup lang="ts">
/**
 * Release notes dialog.
 *
 * The `ReleaseNotesDialog` component. It hand-rolls the modal
 * contract (Escape, Tab wrap, `body.style.overflow`, focus restore and focus of
 * the close button) with no portal at all — the dialog renders where it is
 * mounted, inside the settings page. This component keeps that DOM position (there is
 * no `DialogPortal`) and uses the same `reka-ui` Dialog primitives as the
 * sibling `ProjectCreateDialog.vue` / `SessionRenameDialog.vue` for the
 * whole contract instead of re-implementing any of it. `DialogTitle` supplies
 * the `release-notes-title` id and `DialogContent` wires
 * `aria-labelledby` from it; the summary paragraph keeps its own
 * `release-notes-summary` id and is named through the explicit
 * `aria-describedby`.
 *
 * The module has no framework-free half: the whole file is one component, so
 * there is no `.ts` beside it. The changelog catalog and its two normalizers
 * come from `@dcode/shared`.
 *
 * `currentVersion` / `availableVersion` keep their current shapes; `onClose`
 * becomes the `close` emit.
 */
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  DialogContent,
  DialogOverlay,
  DialogRoot,
  DialogTitle,
} from "reka-ui";
import {
  CHANGELOG,
  normalizeChangelogVersion,
  resolveChangelogLocale,
} from "@dcode/shared";
import Badge from "./ui/Badge.vue";
import TooltipButton from "./TooltipButton.vue";
import { IconClose } from "../lib/icons";

const props = defineProps<{
  currentVersion?: string;
  availableVersion?: string;
}>();

const emit = defineEmits<{ close: [] }>();

const { t, locale } = useI18n();

const open = ref(true);

/**
 * `i18n.resolvedLanguage ?? i18n.language` is vue-i18n's `locale`, and
 * `resolveChangelogLocale` narrows it to a catalog that ships.
 */
const changelogLocale = computed(() => resolveChangelogLocale(locale.value));
const entries = computed(() => CHANGELOG[changelogLocale.value]);

const normalizedCurrent = computed(() =>
  normalizeChangelogVersion(props.currentVersion),
);
const normalizedAvailable = computed(() =>
  normalizeChangelogVersion(props.availableVersion),
);

const dateFormatter = computed(
  () =>
    new Intl.DateTimeFormat(changelogLocale.value, {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }),
);
</script>

<template>
  <DialogRoot v-model:open="open" @update:open="(value) => !value && emit('close')">
    <DialogOverlay class="overlay release-notes-overlay">
      <DialogContent
        class="dialog release-notes-dialog"
        :aria-modal="true"
        aria-describedby="release-notes-summary"
      >
        <header class="release-notes-header">
          <div class="release-notes-heading">
            <DialogTitle as="h2">
              {{ t("updates.releaseNotes") }}
            </DialogTitle>
            <p id="release-notes-summary">
              {{ t("updates.releaseCount", { count: entries.length }) }}
            </p>
          </div>
          <TooltipButton
            as="button"
            type="button"
            class="icon-btn release-notes-close"
            :label="t('updates.closeReleaseNotes')"
            :aria-label="t('updates.closeReleaseNotes')"
            @click="emit('close')"
          >
            <IconClose :size="16" />
          </TooltipButton>
        </header>

        <div class="release-notes-list selectable">
          <article
            v-for="entry in entries"
            :key="entry.version"
            class="release-notes-version"
            :class="{
              'is-highlighted':
                entry.version === normalizedAvailable ||
                entry.version === normalizedCurrent,
            }"
            :data-release-version="entry.version"
          >
            <div class="release-notes-version-header">
              <div>
                <h3>{{ t("updates.versionLabel", { version: entry.version }) }}</h3>
                <time v-if="entry.date" :datetime="entry.date">
                  {{ dateFormatter.format(new Date(`${entry.date}T00:00:00Z`)) }}
                </time>
              </div>
              <div class="release-notes-badges">
                <Badge v-if="entry.version === normalizedAvailable" tone="success">
                  {{ t("updates.availableBadge") }}
                </Badge>
                <Badge v-if="entry.version === normalizedCurrent">
                  {{ t("updates.currentBadge") }}
                </Badge>
              </div>
            </div>
            <ul>
              <li v-for="highlight in entry.highlights" :key="highlight">
                {{ highlight }}
              </li>
            </ul>
          </article>
        </div>
      </DialogContent>
    </DialogOverlay>
  </DialogRoot>
</template>
