<script setup lang="ts">
/**
 * The titlebar's collapsed-sidebar actions.
 *
 * The `CollapsedTitlebarActions` component. Shown in place of the conversation topbar while the
 * sidebar is collapsed, so both shell controls stay reachable.
 *
 * The two actions are emits (`toggle-sidebar`, `new-task`); a Vue child signals
 * upward instead of taking callbacks.
 */
import { useI18n } from "vue-i18n";
import { IconNewSession, IconSidebar } from "../../../lib/icons";
import TooltipButton from "../../../components/TooltipButton.vue";

defineProps<{ sidebarToggleShortcut: string }>();

const emit = defineEmits<{
  "toggle-sidebar": [];
  "new-task": [];
}>();

const { t } = useI18n();
</script>

<template>
  <div class="titlebar-nav no-drag">
    <TooltipButton
      class="title-nav-btn"
      :label="sidebarToggleShortcut ? `${t('nav.expandSidebar')} (${sidebarToggleShortcut})` : t('nav.expandSidebar')"
      :aria-label="t('nav.expandSidebar')"
      :aria-expanded="false"
      data-nav="toggle-sidebar"
      @click="emit('toggle-sidebar')"
    >
      <IconSidebar :size="15" />
    </TooltipButton>
    <TooltipButton
      class="title-nav-btn"
      :label="t('nav.newTask')"
      :aria-label="t('nav.newTask')"
      data-nav="new-task"
      @click="emit('new-task')"
    >
      <IconNewSession :size="15" />
    </TooltipButton>
  </div>
</template>
