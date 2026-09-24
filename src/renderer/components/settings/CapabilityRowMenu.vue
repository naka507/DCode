<script setup lang="ts">
/**
 * Overflow menu for one row.
 *
 * The `CapabilityRowMenu` surface. Open state is owned by the page so
 * only one row's menu can be open, and Escape or any outside press dismisses it.
 *
 * the `trigger(ref)` render prop is `AnchoredMenu`'s `trigger` scoped
 * slot, and `onOpenChange` is the `open-change` emit. The item `icon` is the
 * icon component itself (rather than a rendered `<IconTrash size={14} />`),
 * rendered here at the same 14px box every call site used.
 */
import { IconMore } from "../../lib/icons";
import TooltipButton from "../TooltipButton.vue";
import AnchoredMenu from "./AnchoredMenu.vue";
import type { CapabilityMenuItem } from "./agent-capability-layout";

defineProps<{
  label: string;
  items: readonly CapabilityMenuItem[];
  open: boolean;
  disabled?: boolean;
}>();

const emit = defineEmits<{ "open-change": [open: boolean] }>();
</script>

<template>
  <AnchoredMenu
    class="agent-capability-menu-wrap"
    :open="open"
    menu-class-name="agent-capability-menu"
    :label="label"
    role="menu"
    align="end"
    @close="emit('open-change', false)"
  >
    <template #trigger="{ setAnchor }">
      <TooltipButton
        :ref="setAnchor"
        as="button"
        type="button"
        class="settings-icon-button"
        :label="label"
        :aria-label="label"
        aria-haspopup="menu"
        :aria-expanded="open"
        :disabled="disabled"
        @click="emit('open-change', !open)"
      >
        <IconMore :size="16" />
      </TooltipButton>
    </template>

    <button
      v-for="item in items"
      :key="item.key"
      type="button"
      role="menuitem"
      :class="{ danger: item.danger }"
      :disabled="item.disabled"
      @click="item.onSelect()"
    >
      <component :is="item.icon" v-if="item.icon" :size="14" />
      {{ item.label }}
    </button>
  </AnchoredMenu>
</template>
