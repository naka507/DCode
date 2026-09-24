<script setup lang="ts">
/**
 * The project summary for the scope control, plus the popover that edits the
 * selected folders.
 *
 * The `ScopeProjectsSummary` component. It is its own SFC
 * because the parent renders it twice — once anchored on the compact wrap, once
 * with its own chip trigger — and an SFC holds one template, so the alternative
 * would be seventy duplicated lines with the trigger and the anchor differing
 * between them.
 *
 * The decisions that are not mechanical:
 *
 *  1. **`anchorRef` is the `anchor` prop.** The element used to be handed over as a
 *     `RefObject<HTMLElement | null>`; `AnchoredMenu.vue` takes the
 *     element itself, so the parent passes its `compactWrapRef` (unwrapped by
 *     the template) and the full form passes nothing.
 *  2. **`onOpenChange` / `onSetScope` are `open-change` / `set-scope` emits.**
 *     The parent is an SFC too, and a child's `emit()` is only reached by a
 *     listener, so the callbacks become events rather than props.
 *  3. **`trigger={(ref) => compact ? null : ...}` is a scoped slot with a
 *     `v-if`.** A slot that renders nothing is the same DOM as a render prop
 *     returning `null`; `setAnchor` is the function ref the chip takes.
 *  4. **`autoFocus` on the search field is gone.** The node used to be focused on
 *     insertion; `AnchoredMenu.vue`'s `initialFocus="input"` already focuses the
 *     popover's only input once the surface is measured and visible, which is
 *     the same moment. A Vue function ref would run on *every* patch and drag
 *     focus back out of a project row the user had just clicked.
 *  5. **`aria-hidden` / `aria-multiselectable` are explicit.** Both were written
 *     bare; a bare attribute in a Vue template renders as `""`, so the explicit
 *     `"true"` is required.
 *  6. **The `is-empty` / `is-open` / `is-on` modifiers are object `:class`
 *     bindings**, so the class-name contract reads literal names instead of the
 *     glued fragments `cx` arguments would not have produced anyway (see
 *     `lib/cx.ts`).
 *  7. `t(key, "Fallback")` becomes `t(key)`: every key ships in the catalogs.
 */
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  normalizeProjectPath,
  withProject,
  withoutProject,
  type ActivationScope,
  type ProjectRecord,
} from "@dcode/shared";
import { IconCheck, IconFolder, IconSearch, IconX } from "../../lib/icons";
import AnchoredMenu from "../settings/AnchoredMenu.vue";
import TooltipButton from "../TooltipButton.vue";
import { projectLabel } from "./scope-control";

const props = withDefaults(
  defineProps<{
    scope: ActivationScope;
    projects: readonly ProjectRecord[];
    currentProjectPath?: string | null;
    open: boolean;
    label: string;
    /** Keeps only the popover and folds the count into the parent's trigger. */
    compact?: boolean;
    /** External anchor for the compact form; `AnchoredMenu`'s own prop. */
    anchor?: HTMLElement | null;
  }>(),
  { currentProjectPath: undefined, compact: false, anchor: null },
);

const emit = defineEmits<{
  "open-change": [open: boolean];
  "set-scope": [scope: ActivationScope];
}>();

const { t } = useI18n();

const query = ref("");

// The filter effect keys on `open`; a closed popover forgets its filter.
watch(
  () => props.open,
  (open) => {
    if (!open) query.value = "";
  },
);

/**
 * The window's project is pinned to the top even when it was never saved as a
 * project record, and any path already in the scope is listed even if the
 * project has since been closed — otherwise a scope could not be undone from
 * here.
 */
const rows = computed(() => {
  const seen = new Set<string>();
  const out: Array<{ path: string; name: string; current: boolean }> = [];
  const push = (path: string, name: string) => {
    const key = normalizeProjectPath(path).toLocaleLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({
      path: normalizeProjectPath(path),
      name: name || projectLabel(path),
      current:
        key === normalizeProjectPath(props.currentProjectPath ?? "").toLocaleLowerCase(),
    });
  };
  if (props.currentProjectPath) {
    push(props.currentProjectPath, projectLabel(props.currentProjectPath));
  }
  for (const entry of props.scope.projects) push(entry, projectLabel(entry));
  for (const project of props.projects) push(project.path, project.name);
  const needle = query.value.trim().toLocaleLowerCase();
  if (!needle) return out;
  return out.filter(
    (row) =>
      row.name.toLocaleLowerCase().includes(needle) ||
      row.path.toLocaleLowerCase().includes(needle),
  );
});

const selected = computed(
  () => new Set(props.scope.projects.map((path) => path.toLocaleLowerCase())),
);

function isSelected(path: string): boolean {
  return selected.value.has(normalizeProjectPath(path).toLocaleLowerCase());
}

function toggle(path: string): void {
  const next = isSelected(path)
    ? withoutProject(props.scope, path)
    : withProject(props.scope, path);
  emit("set-scope", next);
}

const count = computed(() => props.scope.projects.length);

/** The chip's label: the count, or the single project's own name. */
const chipLabel = computed(() => {
  if (count.value === 0) return t("extensions.scope.pickProjects");
  if (count.value === 1) return projectLabel(props.scope.projects[0]);
  return t("extensions.scope.projectCount", { count: count.value });
});
</script>

<template>
  <AnchoredMenu
    class="scope-projects"
    :class="{ 'is-compact': props.compact }"
    :open="props.open"
    :anchor="props.anchor"
    menu-class-name="scope-popover"
    :label="t('extensions.scope.pickerTitle', { name: props.label })"
    role="dialog"
    align="end"
    initial-focus="input"
    @close="emit('open-change', false)"
  >
    <!-- The `trigger` render prop, expressed as a scoped slot; see note 3. -->
    <template #trigger="{ setAnchor }">
      <template v-if="!props.compact">
        <button
          :ref="setAnchor"
          type="button"
          class="scope-chip"
          :class="{ 'is-empty': count === 0, 'is-open': props.open }"
          aria-haspopup="dialog"
          :aria-expanded="props.open"
          @click="emit('open-change', !props.open)"
        >
          <IconFolder :size="12" />
          {{ chipLabel }}
        </button>
        <span v-if="count === 0" class="scope-warn" role="status">
          {{ t("extensions.scope.noProjectsWarning") }}
        </span>
      </template>
    </template>

    <div class="scope-popover-head">
      <div class="scope-popover-title">
        {{ t("extensions.scope.pickerTitle", { name: props.label }) }}
      </div>
      <TooltipButton
        as="button"
        type="button"
        class="scope-popover-close"
        :aria-label="t('common.close')"
        :label="t('common.close')"
        @click="emit('open-change', false)"
      >
        <IconX :size="12" />
      </TooltipButton>
    </div>
    <div class="scope-popover-search">
      <IconSearch :size="12" />
      <input
        :value="query"
        spellcheck="false"
        :placeholder="t('extensions.scope.searchProjects')"
        :aria-label="t('extensions.scope.searchProjects')"
        @input="query = ($event.target as HTMLInputElement).value"
      />
    </div>
    <div class="scope-popover-list" role="listbox" aria-multiselectable="true">
      <p v-if="rows.length === 0" class="scope-popover-empty">
        {{ t("extensions.scope.noProjects") }}
      </p>
      <template v-else>
        <button
          v-for="row in rows"
          :key="row.path"
          type="button"
          role="option"
          :aria-selected="isSelected(row.path)"
          class="scope-option"
          :class="{ 'is-on': isSelected(row.path) }"
          @click="toggle(row.path)"
        >
          <span class="scope-option-check" aria-hidden="true">
            <IconCheck v-if="isSelected(row.path)" :size="12" />
          </span>
          <span class="scope-option-copy">
            <span class="scope-option-name">
              {{ row.name }}
              <span v-if="row.current" class="scope-option-tag">
                {{ t("extensions.scope.currentProject") }}
              </span>
            </span>
            <span class="scope-option-path">{{ row.path }}</span>
          </span>
        </button>
      </template>
    </div>
    <p class="scope-popover-foot">{{ t("extensions.scope.subdirectoryNote") }}</p>
  </AnchoredMenu>
</template>
