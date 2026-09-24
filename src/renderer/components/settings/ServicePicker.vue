<script setup lang="ts">
/**
 * Searchable Service menu for the add/edit provider dialog.
 *
 * The `ServicePicker` component. Native
 * `<select>` is sluggish in this overlay and cannot filter. This follows the
 * default-model picker: an anchored menu, a local search field, and a flat
 * vendor list. Filtering never talks to the host.
 *
 * Deliberate choices:
 *  - `trigger(ref)` render prop → the `#trigger` scoped slot `AnchoredMenu.vue`
 *    exposes, which hands the caller `setAnchor`.
 *  - `onChange` is the `change` emit, not a callback prop: it is an event.
 *  - `optionRefs` is a plain `Map`; the template registers each option through a
 *    function ref, so a re-render cannot leave a stale node behind.
 *  - `useEffect` dependencies on `visibleIds` become a `watch` with the same
 *    tuple, and the `scrollIntoView` effect keeps its `flush: "post"` timing so
 *    the option nodes exist before the scroll runs.
 *  - `CUSTOM_SERVICE` moved into the module block below: `<script setup>` cannot
 *    export, and `ProviderSetupDialog.vue` imports the sentinel to tell the
 *    custom path from a named preset.
 */
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { NAMED_ENDPOINT_PRESETS } from "@dcode/shared";
import { IconCheck, IconChevronDown, IconSearch } from "../../lib/icons";
import Input from "../ui/Input.vue";
import AnchoredMenu from "./AnchoredMenu.vue";

type ServiceOption = {
  id: string;
  label: string;
  haystack: string;
};

const props = withDefaults(
  defineProps<{
    value: string;
    autoFocus?: boolean;
    disabled?: boolean;
    onChange: (next: string) => void;
  }>(),
  { autoFocus: false, disabled: false },
);

const { t } = useI18n();

const open = ref(false);
const query = ref("");
const activeId = ref(props.value || CUSTOM_SERVICE);
const restoreFocus = ref(true);
const optionRefs = new Map<string, HTMLButtonElement>();

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

const customLabel = computed(() => t("settings.presetCustomEndpoint"));

const options = computed<ServiceOption[]>(() => {
  const custom: ServiceOption = {
    id: CUSTOM_SERVICE,
    label: customLabel.value,
    haystack: `${customLabel.value} custom endpoint`.toLowerCase(),
  };
  const named = NAMED_ENDPOINT_PRESETS.map((preset) => {
    const label = t(preset.labelKey);
    const aliases = preset.aliases?.join(" ") ?? "";
    return {
      id: preset.id,
      label,
      haystack:
        `${label} ${preset.name} ${preset.id} ${preset.vendorKey} ${aliases} ${preset.baseUrl} ${hostOf(preset.baseUrl)}`.toLowerCase(),
    };
  });
  return [custom, ...named];
});

const visible = computed(() => {
  const needle = query.value.trim().toLowerCase();
  if (!needle) return options.value;
  return options.value.filter((option) => option.haystack.includes(needle));
});

const visibleIds = computed(() => visible.value.map((option) => option.id));

watch(visibleIds, (ids) => {
  if (ids.includes(activeId.value)) return;
  activeId.value = ids[0] ?? "";
});

watch(
  () => [activeId.value, open.value] as const,
  () => {
    if (!open.value) return;
    optionRefs.get(activeId.value)?.scrollIntoView({ block: "nearest" });
  },
  { flush: "post" },
);

const selected = computed(() =>
  options.value.find((option) => option.id === props.value),
);
const triggerLabel = computed(
  () => selected.value?.label ?? t("settings.chooseService"),
);

function setOptionRef(id: string, node: unknown) {
  if (node instanceof HTMLButtonElement) optionRefs.set(id, node);
  else optionRefs.delete(id);
}

function close() {
  open.value = false;
  query.value = "";
}

function choose(id: string) {
  // The next field (API key or Name) takes focus; do not bounce to the trigger.
  restoreFocus.value = false;
  props.onChange(id);
  close();
}

function moveActive(delta: number) {
  const ids = visibleIds.value;
  if (ids.length === 0) return;
  const index = ids.indexOf(activeId.value);
  const next =
    index === -1
      ? delta > 0
        ? 0
        : ids.length - 1
      : (index + delta + ids.length) % ids.length;
  activeId.value = ids[next] ?? "";
}

function onTriggerClick() {
  if (props.disabled) return;
  restoreFocus.value = true;
  query.value = "";
  activeId.value = props.value || CUSTOM_SERVICE;
  open.value = !open.value;
}

function onSearchKeydown(event: KeyboardEvent) {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    moveActive(1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    moveActive(-1);
  } else if (event.key === "Enter") {
    event.preventDefault();
    if (activeId.value) choose(activeId.value);
  }
}
</script>

<script lang="ts">
/**
 * `<script setup>` cannot export, so the sentinel `CUSTOM_SERVICE` — which
 * `ProviderSetupDialog.vue` imports to tell the custom path from a named preset
 * — lives in the module block, the idiom `McpEditorSheet.vue` and
 * `SubagentEditorSheet.vue` already use for their framework-free halves.
 */
export const CUSTOM_SERVICE = "custom";
</script>

<template>
  <AnchoredMenu
    class="provider-service-anchor"
    :open="open"
    menu-class-name="provider-service-menu"
    :label="t('settings.service')"
    initial-focus="input"
    :restore-focus="restoreFocus"
    @close="close"
  >
    <template #trigger="{ setAnchor }">
      <button
        :ref="setAnchor"
        type="button"
        class="field-select provider-service-trigger"
        :class="{ 'is-placeholder': !selected }"
        :disabled="disabled"
        :autofocus="autoFocus"
        aria-haspopup="listbox"
        :aria-expanded="open"
        @click="onTriggerClick"
      >
        <span class="provider-service-trigger-label">{{ triggerLabel }}</span>
        <IconChevronDown
          class="provider-service-trigger-chevron"
          :size="14"
          aria-hidden="true"
        />
      </button>
    </template>

    <div class="provider-service-search">
      <IconSearch :size="14" aria-hidden="true" />
      <Input
        :value="query"
        :placeholder="t('settings.searchService')"
        :aria-label="t('settings.searchService')"
        autocomplete="off"
        @input="query = ($event.target as HTMLInputElement).value"
        @keydown="onSearchKeydown"
      />
    </div>
    <div class="provider-service-results" role="presentation">
      <div v-if="visible.length === 0" class="provider-service-no-results">
        {{ t("settings.noServiceMatches") }}
      </div>
      <ul v-else class="provider-service-list">
        <li v-for="option in visible" :key="option.id">
          <button
            :ref="(node) => setOptionRef(option.id, node)"
            type="button"
            role="option"
            :tabindex="-1"
            :aria-selected="option.id === value"
            class="provider-service-option"
            :class="{
              'is-current': option.id === value,
              'is-active': option.id === activeId,
            }"
            @mouseenter="activeId = option.id"
            @click="choose(option.id)"
          >
            <span class="provider-service-option-check" aria-hidden="true">
              <IconCheck v-if="option.id === value" :size="12" />
            </span>
            <span class="provider-service-option-label">{{ option.label }}</span>
          </button>
        </li>
      </ul>
    </div>
  </AnchoredMenu>
</template>
