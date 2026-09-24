<script setup lang="ts">
/**
 * Create project dialog.
 *
 * The `ProjectCreateDialog` component. Creates from
 * local folders or one git checkout; both sources fold onto the same project
 * semantic in the store.
 *
 * Behaviour that moves to reka-ui's Dialog (and must NOT be re-implemented
 * here, or it would double up):
 *   - Escape-to-close, focus trap with Tab wrap, and focus restore to the
 *     previously focused element.
 *   - Body scroll lock (`DialogOverlay` -> `useBodyScrollLock`).
 *   - Outside-pointer dismissal, plus `aria-hidden` on the rest of the page
 *     (`useHideOthers`).
 *   - `role="dialog"`, `aria-labelledby`, `aria-describedby`, and the title id
 *     are wired by `DialogContent`/`DialogTitle`.
 *
 * The modal contract used to be hand-rolled with a `keydown` listener, a
 * manual `querySelectorAll` focus loop, and direct `body.style.overflow`
 * writes. Keeping any of it here would fight the primitive.
 *
 * What deliberately stays local, because the class names are the test contract
 * and the DOM shape is the target: the overlay/content class
 * pairing (`overlay project-create-dialog-overlay` /
 * `dialog project-create-dialog`), the section markup, and the two disabled
 * predicates.
 */
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from "reka-ui";
import { MAX_PROJECT_NAME_CHARS } from "../lib/sidebar-preferences";
import { api } from "../lib/api";
import { parseGitCloneUrl } from "../lib/git-clone-url";
import {
  appendProjectFolders,
  folderName,
  folderParent,
} from "../lib/project-folders";
import { overlayRoot } from "../lib/overlay-root";
import { useAppStore } from "../stores/app-store";
import {
  IconBranch,
  IconClose,
  IconFolder,
  IconMonitor,
  IconNewProject,
  IconStar,
  IconX,
} from "../lib/icons";

/** The Create project dialog creates from local folders or one git checkout. */
type ProjectSource = "local" | "git";

const { t } = useI18n();
const store = useAppStore();

/*
  The dialog reads the composed app store, which is where every "open project"
  entry point writes. It used to read a separate `projectCreate` store that had
  its own `createProjectDialogOpen`; nothing ever called that store's
  `openProject()`, so the flag the dialog watched was never set and the Add
  button did nothing. One flag, one owner.
*/
const open = computed({
  get: () => store.appState?.createProjectDialogOpen ?? false,
  set: (value: boolean) => {
    // reka-ui closes on Escape, an outside pointer press, or its own close
    // button; every one of those paths has to reach the store. A busy
    // create/clone is not dismissable (Escape and the overlay click are
    // suppressed the same way), because the project group is already
    // being written on the host.
    if (value) {
      void store.appState?.openProject();
      return;
    }
    if (busy.value) return;
    store.appState?.closeProjectDialog();
  },
});

const source = ref<ProjectSource>("local");
const name = ref("");
const folders = ref<string[]>([]);
const gitUrl = ref("");
const cloneParent = ref("");
const busy = ref(false);
const folderPickerBusy = ref(false);
const inputRef = ref<{ $el?: HTMLElement; focus?: () => void } | null>(null);
// Native dialogs are process-wide and the disabled attribute only lands after
// the next patch, so an in-flight flag closes the gap a rapid second click
// would otherwise slip through.
const folderPickerInFlightRef = ref(false);
// The repository name seeds the project name until the user types their own.
const nameTouched = ref(false);

const cloneTarget = computed(() => parseGitCloneUrl(gitUrl.value));

// Reset on open, matching the effect that keyed on `open`.
watch(open, (isOpen) => {
  if (!isOpen) return;
  source.value = "local";
  name.value = "";
  folders.value = [];
  gitUrl.value = "";
  cloneParent.value = "";
  nameTouched.value = false;
  busy.value = false;
  folderPickerInFlightRef.value = false;
  folderPickerBusy.value = false;
  void nextTick(() => inputRef.value?.focus?.());
});

// A pasted repository URL names the project without stealing a typed name.
watch(
  () => cloneTarget.value?.name,
  (repoName) => {
    if (source.value !== "git" || nameTouched.value) return;
    name.value = repoName ?? "";
  },
);

const submitDisabled = computed(() =>
  source.value === "git"
    ? !name.value.trim() || !cloneTarget.value || !cloneParent.value || busy.value
    : !name.value.trim() || folders.value.length === 0 || busy.value,
);

const submitLabel = computed(() => {
  if (busy.value) {
    return source.value === "git" ? t("project.cloning") : t("project.createSaving");
  }
  return source.value === "git" ? t("project.cloneAction") : t("project.createAction");
});

function reportError(error: unknown) {
  store.appState?.showToast(error instanceof Error ? error.message : String(error), {
    variant: "error",
  });
}

async function addFolders() {
  if (busy.value || folderPickerInFlightRef.value) return;
  folderPickerInFlightRef.value = true;
  folderPickerBusy.value = true;
  try {
    const result = await api.pickProjectFolders();
    if (result.canceled || result.folders.length === 0) return;
    folders.value = appendProjectFolders(folders.value, result.folders);
  } catch (error) {
    reportError(error);
  } finally {
    folderPickerInFlightRef.value = false;
    folderPickerBusy.value = false;
  }
}

async function chooseCloneParent() {
  if (busy.value || folderPickerInFlightRef.value) return;
  folderPickerInFlightRef.value = true;
  folderPickerBusy.value = true;
  try {
    const result = await api.pickProjectFolders();
    if (result.canceled || result.folders.length === 0) return;
    cloneParent.value = result.folders[0];
  } catch (error) {
    reportError(error);
  } finally {
    folderPickerInFlightRef.value = false;
    folderPickerBusy.value = false;
  }
}

async function submit() {
  const trimmedName = name.value.trim();
  if (!trimmedName || busy.value) return;
  if (source.value === "git") {
    if (!cloneTarget.value || !cloneParent.value) return;
  } else if (folders.value.length === 0) {
    return;
  }
  busy.value = true;
  try {
    if (source.value === "git" && cloneTarget.value) {
      await store.appState?.createProjectFromGit({
        name: trimmedName,
        url: cloneTarget.value.url,
        parentPath: cloneParent.value,
      });
    } else {
      await store.appState?.createProjectFromFolders({
        name: trimmedName,
        folders: folders.value,
        primaryPath: folders.value[0],
      });
    }
  } catch (error) {
    reportError(error);
  } finally {
    busy.value = false;
  }
}

function removeFolder(path: string) {
  folders.value = folders.value.filter((item) => item !== path);
}
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal :to="overlayRoot()">
      <DialogOverlay class="overlay project-create-dialog-overlay">
        <DialogContent class="dialog project-create-dialog" :aria-modal="true">
          <div class="project-create-dialog-head">
            <div class="project-create-dialog-heading">
              <DialogTitle class="project-create-dialog-title">
                {{ t("project.createTitle") }}
              </DialogTitle>
            </div>
            <button
              type="button"
              class="project-create-dialog-close"
              :aria-label="t('project.createCancel')"
              :disabled="busy"
              @click="store.appState?.closeProjectDialog()"
            >
              <IconClose :size="17" />
            </button>
          </div>

          <form
            class="project-create-dialog-form"
            @submit.prevent="submit"
          >
            <div class="project-create-dialog-content">
              <section
                class="project-create-dialog-section project-create-dialog-identity"
                aria-labelledby="project-create-name-heading"
              >
                <div class="project-create-dialog-section-head project-create-dialog-name-head">
                  <label
                    id="project-create-name-heading"
                    class="project-create-dialog-section-title project-create-dialog-field-label"
                    for="project-create-name"
                  >
                    {{ t("project.createNameLabel") }}
                  </label>
                  <span class="project-create-dialog-name-count" aria-live="polite">
                    {{ name.length }}/{{ MAX_PROJECT_NAME_CHARS }}
                  </span>
                </div>
                <input
                  id="project-create-name"
                  ref="inputRef"
                  v-model="name"
                  class="field-input project-create-dialog-name-field"
                  :maxlength="MAX_PROJECT_NAME_CHARS"
                  :aria-label="t('project.createNameLabel')"
                  :disabled="busy"
                  spellcheck="false"
                  autocorrect="off"
                  autocapitalize="off"
                  @input="nameTouched = true"
                />
              </section>

              <section
                class="project-create-dialog-section project-create-dialog-source-section"
                aria-labelledby="project-create-source-heading"
              >
                <div class="project-create-dialog-section-head">
                  <h3
                    id="project-create-source-heading"
                    class="project-create-dialog-section-title"
                  >
                    {{ t("project.createSourceLabel") }}
                  </h3>
                </div>
                <div
                  class="project-create-dialog-source-options"
                  role="group"
                  :aria-label="t('project.createSourceLabel')"
                >
                  <button
                    type="button"
                    class="project-create-dialog-source-option"
                    :class="{ 'is-active': source === 'local' }"
                    data-project-source="local"
                    :aria-pressed="source === 'local'"
                    :disabled="busy"
                    @click="source = 'local'"
                  >
                    <IconMonitor :size="15" aria-hidden="true" />
                    {{ t("project.createComputer") }}
                  </button>
                  <button
                    type="button"
                    class="project-create-dialog-source-option"
                    :class="{ 'is-active': source === 'git' }"
                    data-project-source="git"
                    :aria-pressed="source === 'git'"
                    :disabled="busy"
                    @click="source = 'git'"
                  >
                    <IconBranch :size="15" aria-hidden="true" />
                    {{ t("project.createSourceGit") }}
                  </button>
                </div>
              </section>

              <section
                v-if="source === 'local'"
                class="project-create-dialog-section project-create-dialog-folders"
                aria-labelledby="project-create-folders-heading"
              >
                <div class="project-create-dialog-section-head">
                  <h3
                    id="project-create-folders-heading"
                    class="project-create-dialog-section-title"
                  >
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

                <div
                  v-if="folders.length > 0"
                  class="project-create-dialog-folder-list"
                  role="list"
                >
                  <div
                    v-for="(path, index) in folders"
                    :key="path"
                    class="project-create-folder-row"
                    :class="{ 'is-primary': index === 0 }"
                    role="listitem"
                  >
                    <span class="project-create-folder-icon" aria-hidden="true">
                      <IconFolder :size="17" />
                    </span>
                    <span class="project-create-folder-copy" :title="path">
                      <span class="project-create-folder-name">{{ folderName(path) }}</span>
                      <span class="project-create-folder-path">{{ folderParent(path) }}</span>
                    </span>
                    <span v-if="index === 0" class="project-create-primary-tag">
                      <IconStar :size="11" fill="currentColor" aria-hidden="true" />
                      {{ t("project.createPrimary") }}
                    </span>
                    <button
                      type="button"
                      class="project-create-folder-remove"
                      :aria-label="`${t('project.createRemoveFolder')}: ${folderName(path)}`"
                      :disabled="busy"
                      @click="removeFolder(path)"
                    >
                      <IconX :size="15" />
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  :aria-label="t('project.createAddFolder')"
                  class="project-create-add-folder"
                  :class="{ 'is-empty': folders.length === 0 }"
                  :disabled="busy || folderPickerBusy"
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

              <section
                v-else
                class="project-create-dialog-section project-create-dialog-clone"
                aria-labelledby="project-create-clone-heading"
              >
                <div class="project-create-dialog-section-head">
                  <h3
                    id="project-create-clone-heading"
                    class="project-create-dialog-section-title"
                  >
                    {{ t("project.createRepositoryLabel") }}
                  </h3>
                  <span class="project-create-dialog-source" data-project-source="git">
                    <IconBranch :size="15" aria-hidden="true" />
                    {{ t("project.createSourceGit") }}
                  </span>
                </div>

                <input
                  id="project-create-clone-url"
                  v-model="gitUrl"
                  class="field-input project-create-dialog-url-field"
                  :placeholder="t('project.cloneUrlPlaceholder')"
                  :aria-label="t('project.createRepositoryLabel')"
                  spellcheck="false"
                  autocorrect="off"
                  autocapitalize="off"
                  autocomplete="off"
                  :disabled="busy"
                />

                <button
                  type="button"
                  class="project-create-dialog-location"
                  :class="{ 'is-chosen': Boolean(cloneParent) }"
                  :aria-label="t('project.createChooseLocation')"
                  :disabled="busy || folderPickerBusy"
                  @click="chooseCloneParent"
                >
                  <span class="project-create-dialog-location-icon" aria-hidden="true">
                    <IconFolder :size="17" />
                  </span>
                  <span class="project-create-dialog-location-copy">
                    <span class="project-create-dialog-location-title">
                      {{ cloneParent ? folderName(cloneParent) : t("project.createChooseLocation") }}
                    </span>
                    <span class="project-create-dialog-location-path">
                      {{ cloneParent ? folderParent(cloneParent) : t("project.createLocationHint") }}
                    </span>
                  </span>
                </button>

                <p class="project-create-dialog-clone-hint" role="status">
                  {{
                    cloneTarget
                      ? t("project.cloneDestHint", { name: cloneTarget.name })
                      : t("project.cloneUrlHint")
                  }}
                </p>
              </section>
            </div>

            <div class="project-create-dialog-actions">
              <button
                type="button"
                class="btn btn-ghost"
                :disabled="busy"
                @click="store.appState?.closeProjectDialog()"
              >
                {{ t("project.createCancel") }}
              </button>
              <button
                type="submit"
                class="btn btn-primary"
                :disabled="submitDisabled"
              >
                {{ submitLabel }}
              </button>
            </div>
          </form>
        </DialogContent>
      </DialogOverlay>
    </DialogPortal>
  </DialogRoot>
</template>
