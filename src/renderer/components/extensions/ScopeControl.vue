<script setup lang="ts">
/**
 * The one control that answers both questions an extension raises: is it on, and
 * where does it apply. Plugins, MCP servers and user skills all render this, so a
 * user learns the affordance once.
 *
 * The full form keeps all three states visible. Dense installed-plugin rows use
 * one current-state trigger instead, with the same three choices in a small
 * menu so the row does not become a second toolbar.
 *
 * The `ScopeControl` component. Its framework-free half (`ScopeTarget`,
 * `ScopeControlProps`, `projectLabel`, the
 * state tables) is in `./scope-control` and re-exported from the plain
 * specifier — the same shape `ToolRow.vue` / `ActivityGroup.vue` use. The local
 * `ScopeProjectsSummary` is `./ScopeProjectsSummary.vue`, which the parent
 * renders twice with a different anchor and trigger; the base name deliberately
 * does not collide with a `.ts`, so the "split module hides a missing component"
 * trap cannot apply.
 *
 * The decisions that are not mechanical:
 *
 *  1. **`onSetEnabled` / `onSetScope` are `set-enabled` / `set-scope` emits.**
 * Both callers (`InstalledPluginsPanel`, `McpEditorSheet`) own the
 *     write, and a Vue child reaches its parent only through `emit()`, so a
 *     listener is the faithful form. Note that `void onSetEnabled(false)` had
 * fire-and-forget semantics; `emit` returns nothing, and the
 *     parent's async work is its own concern, so nothing here awaits.
 *  2. **`AnchoredMenu`'s render-prop `trigger` is its `#trigger` scoped slot.**
 *     `setAnchor` is the function ref the menu hands back, and it is
 *     bound to `TooltipButton` itself (a component ref), which the menu
 *     resolves through `$el`/`nextElementSibling` — see `AnchoredMenu.vue`.
 *  3. **`<StateIcon>` is a `<component :is>`.** Three icon elements are
 *     selected by the state, which is the same tree with one indirection fewer.
 *  4. **The `is-${state}` trigger modifier is an object binding of literal
 * names.** A template literal
 *     would not be read as names: the class-name contract reads a template
 *     literal's static text verbatim and would report the glued fragment `is-`.
 * `is-projects` has no rule in either tree  styles only `is-off`
 *     and `is-global`), so it is inert here too and is reported to
 *     the maintainer rather than allowlisted here — see the module report.
 *  5. **`aria-hidden` is written explicitly** wherever the template would write it
 *     bare: a bare Vue attribute renders `""` where an explicit `"true"` is
 *     intended.
 *  6. `t(key, "Fallback")` becomes `t(key)`: every key ships in the catalogs.
 */
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  activationState,
  resolveScope,
  withProject,
  type ActivationScope,
  type ActivationState,
} from "@dcode/shared";
import {
  IconCheck,
  IconChevronDown,
  IconFolder,
  IconGlobe,
  IconPower,
} from "../../lib/icons";
import AnchoredMenu from "../settings/AnchoredMenu.vue";
import TooltipButton from "../TooltipButton.vue";
import ScopeProjectsSummary from "./ScopeProjectsSummary.vue";
import {
  STATE_HINT_KEYS,
  STATE_LABEL_KEYS,
  STATE_ORDER,
  type ScopeControlProps,
} from "./scope-control";

const props = withDefaults(defineProps<ScopeControlProps>(), {
  currentProjectPath: undefined,
  disabled: false,
  compact: false,
});

const emit = defineEmits<{
  "set-enabled": [enabled: boolean];
  "set-scope": [scope: ActivationScope];
}>();

const { t } = useI18n();

const pickerOpen = ref(false);
const compactOpen = ref(false);
const compactWrapRef = ref<HTMLElement | null>(null);

const state = computed(() => activationState(props.target));
const scope = computed(() => resolveScope(props.target.scope));

/** The icon component for one state; see note 3. */
const STATE_ICONS = {
  off: IconPower,
  projects: IconFolder,
  global: IconGlobe,
} as const;

function select(next: ActivationState): void {
  if (props.disabled) return;
  compactOpen.value = false;
  if (next === state.value && next !== "projects") return;
  if (next === "off") {
    emit("set-enabled", false);
    pickerOpen.value = false;
    return;
  }
  if (next === "global") {
    // Keep the project list: a user who widens a scope and narrows it again
    // should get their selection back, not an empty list.
    emit("set-scope", { mode: "global", projects: scope.value.projects });
    if (!props.target.enabled) emit("set-enabled", true);
    pickerOpen.value = false;
    return;
  }
  // "This project" with nothing selected yet seeds itself from the window, so
  // the common case — scope this to what I have open — needs no second step.
  if (scope.value.projects.length === 0 && props.currentProjectPath) {
    emit("set-scope", withProject(scope.value, props.currentProjectPath));
    if (!props.target.enabled) emit("set-enabled", true);
    pickerOpen.value = true;
    return;
  }
  if (state.value !== "projects") {
    emit("set-scope", { mode: "projects", projects: scope.value.projects });
    if (!props.target.enabled) emit("set-enabled", true);
  }
  pickerOpen.value = !pickerOpen.value;
}

const currentStateLabel = computed(() =>
  state.value === "projects" && scope.value.projects.length > 0
    ? t("extensions.scope.projectCount", { count: scope.value.projects.length })
    : t(STATE_LABEL_KEYS[state.value]),
);

function onCompactTriggerClick(): void {
  if (pickerOpen.value) {
    pickerOpen.value = false;
    return;
  }
  compactOpen.value = !compactOpen.value;
}
</script>

<script lang="ts">
/**
 * the module exported the component plus `ScopeTarget`,
 * `ScopeControlProps` and `projectLabel` from one file. `<script setup>` cannot
 * export, so the framework-free half is re-exported here from `./scope-control`
 * and every importer keeps one specifier.
 */
export { projectLabel, type ScopeControlProps, type ScopeTarget } from "./scope-control";
</script>

<template>
  <div class="scope-control" :class="{ 'is-compact': props.compact }">
    <div v-if="props.compact" class="scope-compact-wrap" ref="compactWrapRef">
      <AnchoredMenu
        class="scope-compact-menu-anchor"
        :open="compactOpen"
        menu-class-name="scope-compact-menu"
        :label="t('extensions.scope.ariaLabel', { name: props.label })"
        role="menu"
        align="end"
        @close="compactOpen = false"
      >
        <template #trigger="{ setAnchor }">
          <TooltipButton
            :ref="setAnchor"
            as="button"
            type="button"
            class="scope-compact-trigger"
            :aria-label="`${t('extensions.scope.ariaLabel', { name: props.label })}: ${currentStateLabel}`"
            :label="t(STATE_HINT_KEYS[state])"
            :aria-haspopup="pickerOpen ? 'dialog' : 'menu'"
            :class="{
              'is-off': state === 'off',
              'is-projects': state === 'projects',
              'is-global': state === 'global',
            }"
            :disabled="props.disabled"
            @click="onCompactTriggerClick"
          >
            <component :is="STATE_ICONS[state]" :size="13" />
            <span class="scope-compact-label">{{ currentStateLabel }}</span>
            <IconChevronDown class="scope-compact-chevron" :size="12" />
          </TooltipButton>
        </template>
        <TooltipButton
          v-for="option in STATE_ORDER"
          :key="option"
          as="button"
          type="button"
          role="menuitemradio"
          :aria-checked="state === option"
          class="scope-compact-option"
          :class="{ 'is-active': state === option }"
          :label="t(STATE_HINT_KEYS[option])"
          :aria-label="t(STATE_LABEL_KEYS[option])"
          :disabled="props.disabled"
          @click="select(option)"
        >
          <component :is="STATE_ICONS[option]" :size="13" />
          <span class="scope-compact-option-copy">
            <span class="scope-compact-option-label">
              {{ t(STATE_LABEL_KEYS[option]) }}
            </span>
            <span class="scope-compact-option-hint">
              {{ t(STATE_HINT_KEYS[option]) }}
            </span>
          </span>
          <IconCheck v-if="state === option" :size="13" />
        </TooltipButton>
      </AnchoredMenu>
      <ScopeProjectsSummary
        v-if="state === 'projects'"
        compact
        :anchor="compactWrapRef"
        :scope="scope"
        :projects="props.projects"
        :current-project-path="props.currentProjectPath"
        :open="pickerOpen"
        :label="props.label"
        @open-change="pickerOpen = $event"
        @set-scope="emit('set-scope', $event)"
      />
    </div>

    <template v-else>
      <div
        class="scope-track"
        role="radiogroup"
        :aria-label="t('extensions.scope.ariaLabel', { name: props.label })"
      >
        <TooltipButton
          v-for="option in STATE_ORDER"
          :key="option"
          as="button"
          type="button"
          role="radio"
          :aria-checked="state === option"
          class="scope-seg"
          :class="{ 'is-active': state === option }"
          :label="t(STATE_HINT_KEYS[option])"
          :aria-label="t(STATE_LABEL_KEYS[option])"
          :disabled="props.disabled"
          @click="select(option)"
        >
          <component :is="STATE_ICONS[option]" :size="13" />
          <span>{{ t(STATE_LABEL_KEYS[option]) }}</span>
        </TooltipButton>
      </div>
      <ScopeProjectsSummary
        v-if="state === 'projects'"
        :scope="scope"
        :projects="props.projects"
        :current-project-path="props.currentProjectPath"
        :open="pickerOpen"
        :label="props.label"
        @open-change="pickerOpen = $event"
        @set-scope="emit('set-scope', $event)"
      />
    </template>
  </div>
</template>
