<script setup lang="ts">
/**
 * A menu select for a Settings row.
 *
 * Settings cards clip their overflow (`.settings-panel` draws the frame with
 * `overflow: hidden`), so the option list opens through `AnchoredMenu`. A
 * native `<select>` draws its popup at the OS level instead: it ignores the
 * menu surface tokens, shows the platform highlight, and has no current-value
 * marker. The closed trigger sizes to the current label (capped by its parent)
 * so a short value does not stretch the settings control column. Rows whose
 * list is short still use this control so one Settings window does not mix two
 * popup implementations.
 *
 * Unlike the Appearance pickers this list is not searchable — the longest
 * catalog here is the host command-shell list — so the menu opens on the
 * current option and keyboard users move with arrows alone.
 */
import { computed, ref } from "vue";
import { IconCheck, IconChevronDown } from "../../lib/icons";
import AnchoredMenu from "./AnchoredMenu.vue";

export type MenuSelectOption = {
  id: string;
  label: string;
  /** Listed but not selectable; the host may report an unavailable shell. */
  disabled?: boolean;
};

const props = withDefaults(
  defineProps<{
    value: string;
    options: MenuSelectOption[];
    /** Accessible name for the trigger and the menu. */
    label: string;
    disabled?: boolean;
    /** Keeps the trigger non-interactive while a write is in flight. */
    busy?: boolean;
    /** Stretch across a form field. Compact settings rows leave this off. */
    fullWidth?: boolean;
  }>(),
  { disabled: false, busy: false, fullWidth: false },
);

const emit = defineEmits<{ change: [id: string] }>();

const open = ref(false);
const activeId = ref(props.value);
const optionRefs = new Map<string, HTMLButtonElement>();

const current = computed(() =>
  props.options.find((option) => option.id === props.value),
);
const selectable = computed(() =>
  props.options.filter((option) => !option.disabled),
);

function setOptionRef(id: string, node: unknown) {
  if (node instanceof HTMLButtonElement) optionRefs.set(id, node);
  else optionRefs.delete(id);
}

function close() {
  open.value = false;
}

function choose(option: MenuSelectOption) {
  close();
  if (option.disabled || option.id === props.value) return;
  emit("change", option.id);
}

function moveActive(from: string, delta: number) {
  const list = selectable.value;
  if (list.length === 0) return;
  const index = list.findIndex((option) => option.id === from);
  const next =
    index === -1
      ? delta > 0
        ? 0
        : list.length - 1
      : (index + delta + list.length) % list.length;
  const target = list[next];
  if (!target) return;
  activeId.value = target.id;
  optionRefs.get(target.id)?.focus();
}

/*
  Arrow keys wrap over the selectable rows for parity with the Appearance
  pickers; Home/End and Enter stay with the focused option button.
*/
function onMenuKeydown(event: KeyboardEvent) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  moveActive(activeId.value, event.key === "ArrowDown" ? 1 : -1);
}

function onTriggerClick() {
  activeId.value = props.value;
  open.value = !open.value;
}
</script>

<template>
  <AnchoredMenu
    class="settings-menu-select-anchor"
    :class="{ 'is-full': fullWidth }"
    :open="open"
    :menu-class-name="'settings-menu-select-menu'"
    :label="label"
    align="end"
    @close="close"
    @menu-keydown="onMenuKeydown"
  >
    <template #trigger="{ setAnchor }">
      <button
        :ref="setAnchor"
        type="button"
        class="settings-menu-select-trigger"
        aria-haspopup="listbox"
        :aria-expanded="open"
        :aria-label="label"
        :disabled="disabled || busy"
        @click="onTriggerClick"
      >
        <span class="settings-menu-select-trigger-label">
          {{ current?.label ?? value }}
        </span>
        <IconChevronDown :size="14" aria-hidden="true" />
      </button>
    </template>

    <div class="settings-menu-select-results">
      <ul class="settings-menu-select-list">
        <li v-for="option in options" :key="option.id">
          <button
            :ref="(node) => setOptionRef(option.id, node)"
            type="button"
            role="option"
            :tabindex="-1"
            :aria-selected="option.id === value"
            :disabled="option.disabled"
            class="settings-menu-select-option"
            :class="{
              'is-current': option.id === value,
              'is-active': option.id === activeId,
            }"
            @mouseenter="activeId = option.id"
            @focus="activeId = option.id"
            @click="choose(option)"
          >
            <span class="settings-menu-select-option-label">
              {{ option.label }}
            </span>
            <IconCheck
              v-if="option.id === value"
              :size="14"
              class="settings-menu-select-check"
              aria-hidden="true"
            />
          </button>
        </li>
      </ul>
    </div>
  </AnchoredMenu>
</template>
