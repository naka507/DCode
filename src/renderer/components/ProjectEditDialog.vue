<script setup lang="ts">
/**
 * Edit project dialog.
 *
 * The `ProjectEditDialog` surface. The modal contract (Escape-to-close, Tab
 * wrap, `body.style.overflow`, focus restore, overlay click) is hand-rolled, so
 * it uses the same `reka-ui` Dialog primitives as `ProjectCreateDialog.vue`:
 * `DialogRoot` / `DialogPortal` / `DialogOverlay` / `DialogContent` /
 * `DialogTitle` with the `overlay` + `dialog` class pairing. None of the
 * hand-rolled behaviour is
 * re-implemented here — keeping any of it would double up on the primitive.
 *
 * The local `folderName` / `folderParent` / `samePath` helpers come from
 * `lib/project-folders` (identical logic), so the dialog, the
 * create dialog and the store share one definition.
 *
 * `project` keeps its earlier shape; `onClose` / `onSaved` / `onError` become
 * the `close` / `saved` / `error` emits.
 */
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from "reka-ui";
import type { ProjectGroupRecord, ProjectGroupRoot } from "@dcode/shared";
import { api } from "../lib/api";
import { MAX_PROJECT_NAME_CHARS } from "../lib/sidebar-preferences";
import {
  appendProjectFolders,
  folderName,
  folderParent,
  sameProjectPath,
} from "../lib/project-folders";
import { overlayRoot } from "../lib/overlay-root";
import Button from "./ui/Button.vue";
import TooltipButton from "./TooltipButton.vue";
import {
  IconClose,
  IconFolder,
  IconMonitor,
  IconNewProject,
  IconStar,
  IconX,
} from "../lib/icons";

export type ProjectEditTarget = {
  name: string;
  path: string;
  groupId?: string;
  roots?: ProjectGroupRoot[];
  legacy?: boolean;
};

const props = defineProps<{ project: ProjectEditTarget }>();

const emit = defineEmits<{
  close: [];
  saved: [group: ProjectGroupRecord];
  error: [error: unknown];
}>();

const { t } = useI18n();

const group = ref<ProjectGroupRecord | null>(null);
const name = ref(props.project.name);
const folders = ref<string[]>(
  props.project.roots
    ?.slice()
    .sort((a, b) => a.position - b.position)
    .map((root) => root.path) ?? [props.project.path],
);
const primaryPath = ref(props.project.path);
const loading = ref(true);
const busy = ref(false);
const folderPickerBusy = ref(false);
const inputRef = ref<HTMLInputElement | null>(null);
// Native dialogs are process-wide and the disabled attribute only lands after
// the next patch, so an in-flight flag closes the gap a rapid second click
// would otherwise slip through.
const folderPickerInFlightRef = ref(false);

/**
 * Closing is refused while a save is in flight. reka's DialogRoot drives
 * `open`, so the refusal is expressed as a value that never leaves `true`:
 * only the `close` emit tells the caller to unmount, which is exactly the
 * emit tells the caller to unmount, which is the whole contract
 */
const open = computed({
  get: () => true,
  set: (value: boolean) => {
    if (value) return;
    if (busy.value) return;
    emit("close");
  },
});

/**
 * The cancel path shared by the titlebar close button and the footer Cancel
 * button. The guard used to sit at each call site behind `!busyRef.current`;
 * each call site; the guard lives here so both buttons and the overlay's
 * `open` setter refuse a close while a save is in flight.
 */
function requestClose() {
  if (busy.value) return;
  emit("close");
}

watch(
  () => [props.project.groupId, props.project.path] as const,
  ([groupId, requestedPath], _previous, onCleanup) => {
    let cancelled = false;
    void api
      .listProjectGroups()
      .then(({ groups }) => {
        if (cancelled) return;
        const resolved = groups.find(
          (candidate) =>
            (groupId && candidate.id === groupId) ||
            sameProjectPath(candidate.primaryPath, requestedPath) ||
            candidate.roots.some((root) => sameProjectPath(root.path, requestedPath)),
        );
        if (!resolved) {
          throw new Error(t("project.notFound"));
        }
        group.value = resolved;
        name.value = resolved.name;
        primaryPath.value = resolved.primaryPath;
        folders.value = resolved.roots
          .slice()
          .sort((a, b) => a.position - b.position)
          .map((root) => root.path);
        loading.value = false;
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        loading.value = false;
        emit("error", error);
      });
    onCleanup(() => {
      cancelled = true;
    });
  },
  { immediate: true },
);

// The name field takes focus once the dialog is on screen, matching the
// focus-on-mount behaviour.
onMounted(() => {
  void nextTick(() => inputRef.value?.focus());
});

const submitDisabled = computed(
  () =>
    loading.value ||
    !group.value ||
    !name.value.trim() ||
    folders.value.length === 0 ||
    !folders.value.some((path) => sameProjectPath(path, primaryPath.value)) ||
    busy.value,
);

async function addFolders() {
  if (busy.value || folderPickerInFlightRef.value) return;
  folderPickerInFlightRef.value = true;
  folderPickerBusy.value = true;
  try {
    const result = await api.pickProjectFolders();
    if (result.canceled || result.folders.length === 0) return;
    folders.value = appendProjectFolders(folders.value, result.folders);
  } catch (error) {
    emit("error", error);
  } finally {
    folderPickerInFlightRef.value = false;
    folderPickerBusy.value = false;
  }
}

async function submit() {
  const trimmedName = name.value.trim();
  const current = group.value;
  if (!current || loading.value || !trimmedName || busy.value) return;
  if (
    folders.value.length === 0 ||
    !folders.value.some((path) => sameProjectPath(path, primaryPath.value))
  ) {
    return;
  }
  busy.value = true;
  try {
    // `folders` is a `ref`, so its `.value` is a reactive proxy array and
    // would be rejected by `ipcRenderer.invoke`'s structured clone.
    const result = await api.updateProjectGroup(current.id, trimmedName, [
      ...folders.value,
    ]);
    emit("saved", result.group);
    emit("close");
  } catch (error) {
    emit("error", error);
  } finally {
    busy.value = false;
  }
}

function removeFolder(path: string) {
  folders.value = folders.value.filter((item) => !sameProjectPath(item, path));
}
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal :to="overlayRoot()">
      <DialogOverlay class="overlay project-create-dialog-overlay">
        <DialogContent class="dialog project-create-dialog project-edit-dialog" :aria-modal="true">
          <div class="project-create-dialog-head">
            <div class="project-create-dialog-heading">
              <DialogTitle class="project-create-dialog-title">
                {{ t("project.editTitle") }}
              </DialogTitle>
              <p class="project-edit-dialog-description">{{ t("project.editDescription") }}</p>
            </div>
            <TooltipButton
              as="button"
              type="button"
              class="project-create-dialog-close"
              :label="t('project.editCancel')"
              :aria-label="t('project.editCancel')"
              :disabled="busy"
              @click="requestClose"
            >
              <IconClose :size="17" />
            </TooltipButton>
          </div>

          <form class="project-create-dialog-form" @submit.prevent="submit">
            <div class="project-create-dialog-content">
              <section
                class="project-create-dialog-section project-create-dialog-identity"
                aria-labelledby="project-edit-name-heading"
              >
                <div class="project-create-dialog-section-head project-create-dialog-name-head">
                  <label
                    id="project-edit-name-heading"
                    class="project-create-dialog-section-title project-create-dialog-field-label"
                    for="project-edit-name"
                  >
                    {{ t("project.createNameLabel") }}
                  </label>
                  <span class="project-create-dialog-name-count" aria-live="polite">
                    {{ name.length }}/{{ MAX_PROJECT_NAME_CHARS }}
                  </span>
                </div>
                <input
                  id="project-edit-name"
                  ref="inputRef"
                  v-model="name"
                  class="field-input project-create-dialog-name-field"
                  :maxlength="MAX_PROJECT_NAME_CHARS"
                  :aria-label="t('project.createNameLabel')"
                  :disabled="loading || busy"
                  spellcheck="false"
                  autocorrect="off"
                  autocapitalize="off"
                />
              </section>

              <section
                class="project-create-dialog-section project-create-dialog-folders"
                aria-labelledby="project-edit-folders-heading"
              >
                <div class="project-create-dialog-section-head">
                  <h3 id="project-edit-folders-heading" class="project-create-dialog-section-title">
                    {{ t("project.createFoldersLabel") }}
                    <span v-if="folders.length > 0" class="project-create-dialog-count">
                      {{ folders.length }}
                    </span>
                  </h3>
                  <span class="project-create-dialog-source" data-project-source="local">
                    <IconMonitor :size="15" aria-hidden="true" />
                    {{ t("project.createComputer") }}
                  </span>
                </div>

                <div v-if="folders.length > 0" class="project-create-dialog-folder-list" role="list">
                  <div
                    v-for="path in folders"
                    :key="path"
                    class="project-create-folder-row"
                    :class="{ 'is-primary': sameProjectPath(path, primaryPath) }"
                    role="listitem"
                  >
                    <span class="project-create-folder-icon" aria-hidden="true">
                      <IconFolder :size="17" />
                    </span>
                    <span class="project-create-folder-copy" :title="path">
                      <span class="project-create-folder-name">{{ folderName(path) }}</span>
                      <span class="project-create-folder-path">{{ folderParent(path) }}</span>
                    </span>
                    <span v-if="sameProjectPath(path, primaryPath)" class="project-create-primary-tag">
                      <IconStar :size="11" fill="currentColor" aria-hidden="true" />
                      {{ t("project.createPrimary") }}
                    </span>
                    <TooltipButton
                      as="button"
                      type="button"
                      class="project-create-folder-remove"
                      :label="
                        sameProjectPath(path, primaryPath)
                          ? t('project.editPrimaryLocked')
                          : t('project.createRemoveFolder')
                      "
                      :aria-label="
                        `${
                          sameProjectPath(path, primaryPath)
                            ? t('project.editPrimaryLocked')
                            : t('project.createRemoveFolder')
                        }: ${folderName(path)}`
                      "
                      :disabled="loading || busy || sameProjectPath(path, primaryPath)"
                      @click="removeFolder(path)"
                    >
                      <IconX :size="15" />
                    </TooltipButton>
                  </div>
                </div>

                <button
                  type="button"
                  :aria-label="t('project.createAddFolder')"
                  class="project-create-add-folder"
                  :class="{ 'is-empty': folders.length === 0 }"
                  :disabled="loading || busy || folderPickerBusy"
                  @click="addFolders"
                >
                  <span class="project-create-add-folder-icon" aria-hidden="true">
                    <IconNewProject :size="18" />
                  </span>
                  <span class="project-create-add-folder-copy">
                    <span class="project-create-add-folder-title">
                      {{ t("project.createAddFolder") }}
                    </span>
                  </span>
                </button>
              </section>
            </div>

            <div class="project-create-dialog-actions">
              <Button type="button" variant="ghost" :disabled="busy" @click="requestClose">
                {{ t("project.editCancel") }}
              </Button>
              <Button type="submit" variant="primary" :disabled="submitDisabled">
                {{ busy ? t("project.editSaving") : t("project.editAction") }}
              </Button>
            </div>
          </form>
        </DialogContent>
      </DialogOverlay>
    </DialogPortal>
  </DialogRoot>
</template>
