<script setup lang="ts">
/**
 * Conversation topbar.
 *
 * The `ConversationTopbar` component. The props map onto this SFC as
 * follows:
 *
 *   props `sidebarCollapsed`, `workPanelOpen`  ->  props of the same names
 *   props `onToggleSidebar`  ->  emit `toggle-sidebar`
 *   props `onNewTask`        ->  emit `new-task`
 *   props `onOpenSearch`     ->  emit `open-search`
 *
 * The three callbacks are events because a Vue SFC cannot take functions as
 * props and keep the call sites idiomatic; the two booleans stay props because
 * they are data, not intent.
 *
 * Notes on the markup:
 *   - the root class came from a template literal
 *     (`` `conversation-topbar${...}` ``). It is a static `class` plus an
 *     object `:class` here so the class contract can read both modifiers
 *     (`ct-collapsed`, `ct-work-panel-open`) as the names they are.
 *   - `TooltipButton` is the renderer's collapsed `Tooltip`/`TooltipButton`
 *     primitive; its `as` prop selects the anchor, so `as="button"` is what
 *     the `<TooltipButton>` (always a `<button>`) renders. Its tooltip
 *     text prop is `label`, and `aria-label` / `tabindex` are passed through as
 *     attributes.
 *
 * `isDefaultSessionTitle` is imported from the store rather than re-declared:
 * `stores/app-store.ts` re-exports the session-title runtime's version, which
 * also treats the localized "untitled task" title as default.
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { isDefaultSessionTitle, useAppStore } from "../stores/app-store";
import { IconNewSession, IconSearch, IconSidebar } from "../lib/icons";
import TooltipButton from "./TooltipButton.vue";

function projectName(path?: string | null, name?: string | null) {
  if (name) return name;
  if (!path) return null;
  const parts = path.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] || path;
}

const TOPBAR_TITLE_MAX_LENGTH = 10;

/**
 * `Array.from` is deliberate: it iterates code points, so a CJK title counts as
 * its characters rather than its UTF-16 units and truncates at 10.
 */
function truncateTopbarTitle(title: string) {
  const characters = Array.from(title);
  return characters.length > TOPBAR_TITLE_MAX_LENGTH
    ? `${characters.slice(0, TOPBAR_TITLE_MAX_LENGTH).join("")}…`
    : title;
}

defineProps<{
  sidebarCollapsed: boolean;
  workPanelOpen: boolean;
}>();

const emit = defineEmits<{
  "toggle-sidebar": [];
  "new-task": [];
  "open-search": [];
}>();

const { t } = useI18n();
const store = useAppStore();
const activeSessionId = computed(() => store.appState?.activeSessionId);
const sessions = computed(() => store.appState?.sessions ?? []);
const workspace = computed(() => store.appState?.workspace);

const activeSession = computed(() =>
  sessions.value.find((session) => session.id === activeSessionId.value),
);

const fullTaskTitle = computed(() =>
  isDefaultSessionTitle(activeSession.value?.title)
    ? t("chat.untitledTask")
    : activeSession.value?.title || t("chat.untitledTask"),
);
const taskTitle = computed(() => truncateTopbarTitle(fullTaskTitle.value));
const project = computed(() =>
  projectName(workspace.value?.path, workspace.value?.name),
);
</script>

<template>
  <div
    class="conversation-topbar"
    :class="{
      'ct-collapsed': sidebarCollapsed,
      'ct-work-panel-open': workPanelOpen,
    }"
    role="toolbar"
    :aria-label="t('nav.conversation')"
  >
    <div class="ct-left">
      <!--
        Always mounted: the slot animates from 0 to 28px with the dock, so
        unmounting it would reintroduce the first-frame title jump. While the
        sidebar is open the slot is zero-width and hidden from AT.
      -->
      <div class="ct-lead" :aria-hidden="!sidebarCollapsed">
        <TooltipButton
          as="button"
          type="button"
          class="ct-icon-btn"
          :label="t('nav.toggleSidebar')"
          :aria-label="t('nav.toggleSidebar')"
          :tabindex="sidebarCollapsed ? undefined : -1"
          @click="emit('toggle-sidebar')"
        >
          <IconSidebar :size="15" />
        </TooltipButton>
      </div>
      <div
        class="ct-title-wrap"
        :title="project ? `${project} · ${fullTaskTitle}` : fullTaskTitle"
      >
        <span class="ct-title">{{ taskTitle }}</span>
      </div>
    </div>

    <div class="ct-right">
      <div class="ct-actions">
        <TooltipButton
          as="button"
          type="button"
          class="ct-icon-btn"
          :label="t('nav.newTask')"
          :aria-label="t('nav.newTask')"
          @click="emit('new-task')"
        >
          <IconNewSession :size="15" />
        </TooltipButton>
        <TooltipButton
          as="button"
          type="button"
          class="ct-icon-btn"
          :label="t('nav.search')"
          :aria-label="t('nav.search')"
          @click="emit('open-search')"
        >
          <IconSearch :size="15" />
        </TooltipButton>
      </div>
    </div>
  </div>
</template>
