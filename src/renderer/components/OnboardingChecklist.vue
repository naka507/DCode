<script setup lang="ts">
/**
 * First-run inline checklist (D021): rendered on the empty chat home until every
 * step is done or the user dismisses it. State comes from the host
 * (`app.getOnboarding`); actions deep-link into the relevant surface.
 *
 * The `OnboardingChecklist` component.
 *
 * The decisions that are not mechanical:
 *
 * 1. **The store is read through `store.appState`.** Rather than three
 *     selector hooks plus `setPage` / `setSettingsTab` / `openProject`; here the
 *     state is a `computed` over the `shallowRef` and the three actions are
 *     reached through the same composed object, exactly as `SearchDialog.vue`
 *     does. `getState()` is never called from a component.
 *  2. **The dismiss patch uses `currentAppState()` + `patchAppState()`.** The
 *     earlier version read `useAppStore.getState().onboarding` inside `finally` — after
 *     an await, so a tracked read would be meaningless — and wrote
 *     `setState({ onboarding: { ...current, showChecklist: false } })`. Those two
 *     module-level helpers are the sanctioned counterparts of that pair, and the
 *     "only if `current` still exists" guard is kept.
 * 3. **`stepLabel` probes the catalog with `te()`.** The fallback compares the
 *     translation to its own key (`label === key ? fallback : label`), which is
 *     how an absent `onboarding.<id>` falls back to the host-supplied title;
 *     `te()` is the same question asked directly, and is the idiom
 *     `Sidebar.vue` already uses.
 *  4. **The two template-literal class bindings become static + object
 *     `:class`.** The rendered class list is identical; the static/dynamic split
 *     is what the class contract can read.
 *  5. `requestAnimationFrame` still runs the focus after paint, and the
 *     `.composer-input` selector is the one queried.
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { api } from "../lib/api";
import { IconCheck } from "../lib/icons";
import {
  currentAppState,
  patchAppState,
  useAppStore,
} from "../stores/app-store";

/** Host step ids (`app.getOnboarding`) mapped to locale keys under `onboarding.`. */
const STEP_LOCALE_KEY: Record<string, string> = {
  provider: "addProvider",
  secret: "saveKey",
  project: "openProject",
  prompt: "firstPrompt",
  plugin: "loadPlugin",
};

const { t, te } = useI18n();
const store = useAppStore();

const onboarding = computed(() => store.appState?.onboarding);
const steps = computed(() => onboarding.value?.steps ?? []);
/**
 * The checklist renders nothing when it is hidden, when the host sent no
 * steps, and when every step was already done.
 */
const visible = computed(
  () =>
    Boolean(onboarding.value?.showChecklist) &&
    steps.value.length > 0 &&
    !steps.value.every((step) => step.done),
);

function stepLabel(id: string, fallback: string): string {
  const key = `onboarding.${STEP_LOCALE_KEY[id] ?? id}`;
  return te(key) ? t(key) : fallback;
}

function runAction(id: string) {
  switch (id) {
    case "settings.providers":
    case "addProvider":
    case "saveKey":
      store.appState?.setSettingsTab("agent");
      store.appState?.setPage("settings");
      break;
    case "project.open":
    case "openProject":
      void store.appState?.openProject();
      break;
    case "chat.focus":
      store.appState?.setPage("chat");
      requestAnimationFrame(() => {
        document.querySelector<HTMLTextAreaElement>(".composer-input")?.focus();
      });
      break;
    case "plugins.open":
    case "loadPlugin":
      store.appState?.setPage("plugins");
      break;
    default:
      break;
  }
}

function dismiss() {
  void api
    .dismissOnboarding()
    .catch(() => undefined)
    .finally(() => {
      const current = currentAppState().onboarding;
      if (current) {
        patchAppState({ onboarding: { ...current, showChecklist: false } });
      }
    });
}
</script>

<template>
  <div
    v-if="visible"
    class="home-onboarding-checklist mx-auto w-full max-w-[560px] rounded-lg-plus border border-border-subtle bg-bg-elevated-opaque p-4 text-left shadow-none"
    data-testid="onboarding-checklist"
  >
    <div class="mb-2 flex items-center justify-between">
      <span class="text-md-plus font-medium text-text-primary">
        {{ t("onboarding.title") }}
      </span>
      <button
        type="button"
        class="rounded-md px-1.5 py-0.5 text-xs-plus text-text-muted hover:bg-bg-hover hover:text-text-primary"
        @click="dismiss"
      >
        {{ t("onboarding.dismiss") }}
      </button>
    </div>
    <ul class="flex flex-col gap-1.5">
      <li v-for="step in steps" :key="step.id">
        <button
          type="button"
          :disabled="step.done"
          class="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-md"
          :class="
            step.done
              ? {
                  'cursor-default': true,
                  'text-text-muted': true,
                  'line-through': true,
                }
              : {
                  'text-text-secondary': true,
                  'hover:bg-bg-hover': true,
                  'hover:text-text-primary': true,
                }
          "
          @click="runAction(step.action || step.id)"
        >
          <span
            class="flex h-4.5 w-4.5 flex-none items-center justify-center rounded-full border"
            :class="
              step.done
                ? {
                    'border-success': true,
                    'bg-success/15': true,
                    'text-success': true,
                  }
                : { 'border-border-strong': true, 'text-transparent': true }
            "
            aria-hidden="true"
          >
            <IconCheck :size="10" />
          </span>
          {{ stepLabel(step.id, step.title) }}
        </button>
      </li>
    </ul>
  </div>
</template>
