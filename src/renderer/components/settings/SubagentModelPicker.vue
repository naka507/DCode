<script setup lang="ts">
/**
 * Searchable model menu for a subagent definition.
 *
 * A definition may pin any configured model, so this field can offer every
 * model of every configured provider — tens of rows on a real install. A native
 * `<select>` renders that list at the OS level: it cannot be filtered, has no
 * scroll bound, and a long list simply runs off the window instead of scrolling
 * inside itself. This follows the default-model picker and the service picker:
 * an anchored menu, a local search field, and a scroll-bounded grouped list.
 * Filtering never talks to the host.
 *
 * The surface reuses the `provider-service-*` option-menu styles on purpose:
 * all three pickers are the same control, and one definition of it means a
 * design change reaches them together.
 *
 * The `SubagentModelPicker` component. The decisions that
 * are not mechanical:
 *
 *  1. **`onChange` is an `emit`, not a prop.** An `onChange`
 *     callback; the consumers here listen with `@change`, which is the Vue
 *     spelling of the same contract.
 *  2. **The two `useEffect`s are `watch`es with `flush: "post"`.** Both read the
 *     DOM the effect just rendered — the option buttons for `scrollIntoView`,
 *     and the visible ids for the active-row reset — so they must run after the
 *     patch, which is what `useEffect` did.
 *  3. **`optionRefs` is a plain `Map`, not a `ref`.** Same choice as
 *     `SettingsMenuSelect.vue`: the map is written from function refs on every
 *     patch and never drives rendering, so making it reactive would only add
 *     work.
 *  4. **`aria-hidden="true"` is explicit** on the chevron, the search glyph and
 *     the option check. A bare Vue attribute renders `""` where `"true"` is
 *     intended.
 */
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { IconCheck, IconChevronDown, IconSearch } from "../../lib/icons";
import Input from "../ui/Input.vue";
import AnchoredMenu from "./AnchoredMenu.vue";
import type { SubagentModelChoiceGroup } from "./subagent-models";

type ModelMenuRow = {
  /** Pin value; the empty string is inherit-session. */
  id: string;
  /** Text shown on the row: a model id, or the inherit label. */
  label: string;
  /** Provider this row belongs to; empty for inherit and orphan pins. */
  groupName: string;
  /** True on a group's first row, which draws the provider header. */
  startsGroup: boolean;
  /** True when that header needs the divider spacing above it. */
  divided: boolean;
};

const props = withDefaults(
  defineProps<{
    /** Current pin, or the empty string for inherit-session. */
    value: string;
    groups: readonly SubagentModelChoiceGroup[];
    /** A pin that is no longer configured, kept selectable so an edit cannot drop it. */
    orphanPin: string | null;
    disabled?: boolean;
    emptyLabel?: string;
    label?: string;
    allowInherit?: boolean;
  }>(),
  {
    disabled: false,
    emptyLabel: undefined,
    label: undefined,
    allowInherit: true,
  },
);

const emit = defineEmits<{ change: [next: string] }>();

const { t } = useI18n();

const open = ref(false);
const query = ref("");
const activeId = ref(props.value);
const optionRefs = new Map<string, HTMLButtonElement>();

function setOptionRef(id: string, node: unknown) {
  if (node instanceof HTMLButtonElement) optionRefs.set(id, node);
  else optionRefs.delete(id);
}

const rows = computed<ModelMenuRow[]>(() => {
  const list: ModelMenuRow[] = props.allowInherit
    ? [
        {
          id: "",
          label: t("extensions.subagents.modelInherit"),
          groupName: "",
          startsGroup: false,
          divided: false,
        },
      ]
    : [];
  props.groups.forEach((group, groupIndex) => {
    group.choices.forEach((choice, index) => {
      list.push({
        id: choice.value,
        label: choice.modelId,
        groupName: group.providerName,
        startsGroup: index === 0,
        divided: groupIndex > 0 && index === 0,
      });
    });
  });
  if (props.orphanPin) {
    list.push({
      id: props.orphanPin,
      label: props.orphanPin,
      groupName: "",
      startsGroup: false,
      divided: false,
    });
  }
  return list;
});

const visible = computed(() => {
  const needle = query.value.trim().toLowerCase();
  if (!needle) return rows.value;
  // The provider name is part of the haystack so "opencode" narrows to that
  // provider's models without the user knowing a model id.
  return rows.value.filter((row) =>
    `${row.groupName} ${row.label}`.toLowerCase().includes(needle),
  );
});

const visibleIds = computed(() => visible.value.map((row) => row.id));

// See note 2: the active row has to stay inside the visible set, and the check
// reads the ids this patch produced.
watch(
  visibleIds,
  (ids) => {
    if (!ids.includes(activeId.value)) activeId.value = ids[0] ?? "";
  },
  { immediate: true, flush: "post" },
);

watch(
  () => [open.value, activeId.value] as const,
  () => {
    if (!open.value) return;
    optionRefs.get(activeId.value)?.scrollIntoView({ block: "nearest" });
  },
  { flush: "post" },
);

function close() {
  open.value = false;
  query.value = "";
}

function choose(id: string) {
  emit("change", id);
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

const selected = computed(() => rows.value.find((row) => row.id === props.value) ?? null);
const triggerLabel = computed(
  () => selected.value?.label ?? (props.value || props.emptyLabel),
);

function onTriggerClick() {
  query.value = "";
  activeId.value = props.value;
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
    // The empty string is a real option (inherit), so this cannot be
    // a truthiness test.
    if (visibleIds.value.includes(activeId.value)) choose(activeId.value);
  }
}
</script>

<template>
  <AnchoredMenu
    class="provider-service-anchor"
    :open="open"
    menu-class-name="provider-service-menu"
    :label="label ?? t('extensions.subagents.model')"
    initial-focus="input"
    @close="close"
  >
    <template #trigger="{ setAnchor }">
      <button
        :ref="setAnchor"
        type="button"
        class="field-select provider-service-trigger"
        :disabled="disabled"
        aria-haspopup="listbox"
        :aria-expanded="open"
        :aria-label="label ?? t('extensions.subagents.model')"
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
        :placeholder="t('extensions.subagents.modelSearch')"
        :aria-label="t('extensions.subagents.modelSearch')"
        autocomplete="off"
        @input="query = ($event.target as HTMLInputElement).value"
        @keydown="onSearchKeydown"
      />
    </div>
    <div class="provider-service-results" role="presentation">
      <div v-if="visible.length === 0" class="provider-service-no-results">
        {{ t("extensions.subagents.modelNoMatches") }}
      </div>
      <ul class="provider-service-list">
        <li v-for="row in visible" :key="row.id || '__inherit__'">
          <div
            v-if="row.startsGroup"
            class="provider-service-group"
            :class="{ 'has-divider': row.divided }"
          >
            {{ row.groupName }}
          </div>
          <button
            :ref="(node) => setOptionRef(row.id, node)"
            type="button"
            role="option"
            :tabindex="-1"
            :aria-selected="row.id === value"
            class="provider-service-option"
            :class="{
              'is-current': row.id === value,
              'is-active': row.id === activeId,
            }"
            @mouseenter="activeId = row.id"
            @click="choose(row.id)"
          >
            <span class="provider-service-option-check" aria-hidden="true">
              <IconCheck v-if="row.id === value" :size="12" />
            </span>
            <span class="provider-service-option-label font-mono">
              {{ row.label }}
            </span>
          </button>
        </li>
      </ul>
    </div>
  </AnchoredMenu>
</template>
