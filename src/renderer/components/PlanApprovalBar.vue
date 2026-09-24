<script setup lang="ts">
/**
 * Plan and Goal approval gate, docked above the composer.
 *
 * The `PlanApprovalBar` component. Plan and Goal share this one
 * bar; only the copy differs, so every label is looked up under the proposal
 * kind's i18n namespace (D198) in the same way.
 *
 * The decisions that are not mechanical:
 *
 *  1. **`useAppStore.getState()` became `currentAppState()`.** `focusComposer`
 *     needs the *committed* `activeSessionId` right after an await, and a
 *     component is forbidden to call `getState()`; `currentAppState()` is the
 *     exported counterpart of the store's `getState()`.
 *  2. **The two `useEffect`s on `[proposal.id]` are one `immediate` watcher.**
 *     The earlier version reset the approval mode and closed the menu in one effect and
 *     cleared `resolving` in another, both keyed on the proposal id. Both are
 *     no-ops on mount (their initial state is already what they write), so one
 *     watcher that also runs once at setup reproduces both.
 *  3. **`AnchoredMenu`'s `trigger(ref)` render prop is its `#trigger` slot.**
 *     The slot hands back `setAnchor`, the same function ref the trigger
 *     receives; `AnchoredMenu.vue` documents why it resolves a
 *     fragment-rooted `TooltipButton` to the real `<button>`.
 *  4. **`onMenuKeyDown` is the `menu-keydown` emit.** The earlier version passed the
 *     handler down as a prop; the menu re-emits the native `keydown`
 *     from its portaled surface, so `event.currentTarget` is still the menu
 *     element the roving-focus query runs against.
 *  5. `t(kind + ".openArtifactLabel", { path })` keeps the shape: that
 *     key is absent from every shipped catalog there too, so `t` echoes the key
 *     in both implementations.
 *  6. `useAppStore((state) => state.pluginViews)` is a `computed` over
 *     `store.appState?.pluginViews ?? []` (77767f73). The store selector has no
 *     Vue counterpart: a component reads the tracked `store.appState`, so the
 *     launchable-view list is derived from it and stays reactive.
 */
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  parsePlanStages,
  type GlobalPermissionMode,
  type PlanProposal,
  type PluginViewMeta,
  type ProposalKind,
} from "@dcode/shared";
import { currentAppState, useAppStore } from "../stores/app-store";
import { preferredFileWorkPanelTab } from "../lib/work-panel-tabs";
import { PLAN_APPROVAL_DEFAULT_MODE } from "../lib/plan-mode-state";
import {
  readPlanApprovalMode,
  rememberPlanApprovalMode,
} from "../lib/plan-approval-preferences";
import { IconCheck, IconChevronDown, IconFileText } from "../lib/icons";
import TooltipButton from "./TooltipButton.vue";
import AnchoredMenu from "./settings/AnchoredMenu.vue";

const APPROVAL_MODES: readonly GlobalPermissionMode[] = [
  "ask",
  "accept-edits",
  "auto",
];

const APPROVAL_MODE_LABELS: Record<GlobalPermissionMode, string> = {
  ask: "ask",
  "accept-edits": "acceptEdits",
  auto: "auto",
};

const APPROVE_LABELS: Record<GlobalPermissionMode, string> = {
  ask: "approveAsk",
  "accept-edits": "approveAcceptEdits",
  auto: "approveAuto",
};

function isApprovalMode(value: string | undefined): value is GlobalPermissionMode {
  return value === "ask" || value === "accept-edits" || value === "auto";
}

/** `plan.reject` or `goal.reject`, chosen by the approved contract kind. */
function copyKey(kind: ProposalKind, name: string): string {
  return `${kind}.${name}`;
}

const props = defineProps<{ proposal: PlanProposal }>();

const { t } = useI18n();
const store = useAppStore();

const menuOpen = ref(false);
const resolving = ref(false);
const approvalMode = ref<GlobalPermissionMode>(readPlanApprovalMode());

const kind = computed<ProposalKind>(() =>
  props.proposal.kind === "goal" ? "goal" : "plan",
);
const copy = (name: string) => t(copyKey(kind.value, name));
const artifactPath = computed(
  () => props.proposal.artifact?.relativePath?.trim() || null,
);
const isPending = computed(() => props.proposal.status === "pending");
const busy = computed(() => resolving.value);
const pluginViews = computed<PluginViewMeta[]>(
  () => store.appState?.pluginViews ?? [],
);
const stageSummary = computed(() =>
  parsePlanStages(props.proposal.markdown, props.proposal.executionState),
);

watch(
  () => props.proposal.id,
  () => {
    approvalMode.value = readPlanApprovalMode();
    menuOpen.value = false;
    resolving.value = false;
  },
  { immediate: true },
);

const focusComposer = () => {
  if (currentAppState().activeSessionId !== props.proposal.sessionId) return;
  requestAnimationFrame(() => {
    document.querySelector<HTMLTextAreaElement>(".composer-input")?.focus();
  });
};

const resolve = async (
  action: "approve" | "reject",
  targetPermissionMode?: GlobalPermissionMode,
) => {
  if (busy.value || !isPending.value) return;
  menuOpen.value = false;
  if (action === "approve") {
    const selectedMode = targetPermissionMode ?? PLAN_APPROVAL_DEFAULT_MODE;
    approvalMode.value = selectedMode;
    rememberPlanApprovalMode(selectedMode);
  }
  resolving.value = true;
  try {
    const identity = {
      proposalId: props.proposal.id,
      sessionId: props.proposal.sessionId,
      turnId: props.proposal.turnId,
      toolCallId: props.proposal.toolCallId,
      version: props.proposal.version,
    };
    await store.appState?.resolvePlan(
      action === "approve"
        ? {
            ...identity,
            action,
            targetPermissionMode:
              targetPermissionMode ?? PLAN_APPROVAL_DEFAULT_MODE,
          }
        : { ...identity, action },
    );
    focusComposer();
  } catch (error) {
    store.appState?.showToast(
      error instanceof Error ? error.message : String(error),
      { variant: "error" },
    );
    resolving.value = false;
  }
};

const openArtifact = () => {
  const path = artifactPath.value;
  if (!path) return;
  store.appState?.openWorkPanelTabForSession(
    props.proposal.sessionId,
    preferredFileWorkPanelTab(path, pluginViews.value),
  );
};

function onMenuKeyDown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    menuOpen.value = false;
    return;
  }
  if (event.key === "Enter" || event.key === " ") {
    const target = event.target as HTMLElement;
    const mode = target.closest<HTMLButtonElement>(
      "[data-approval-mode]",
    )?.dataset.approvalMode;
    if (isApprovalMode(mode)) {
      event.preventDefault();
      approvalMode.value = mode;
      void resolve("approve", mode);
    }
    return;
  }
  if (!(["ArrowDown", "ArrowUp", "Home", "End"] as string[]).includes(event.key)) {
    return;
  }
  const container = event.currentTarget as HTMLElement | null;
  const items = Array.from(
    container?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [],
  );
  if (!items.length) return;
  event.preventDefault();
  const current = items.indexOf(document.activeElement as HTMLButtonElement);
  let next = current;
  if (event.key === "Home") next = 0;
  else if (event.key === "End") next = items.length - 1;
  else if (event.key === "ArrowDown") {
    next = current < 0 ? 0 : (current + 1) % items.length;
  } else if (event.key === "ArrowUp") {
    next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length;
  }
  items[next]?.focus();
}
</script>

<template>
  <section
    class="plan-approval-bar"
    role="region"
    :aria-label="copy('approvalRegion')"
    :aria-busy="busy"
    :data-kind="kind"
    :data-status="proposal.status"
    :data-execution-state="proposal.executionState || ''"
    data-testid="plan-approval-bar"
  >
    <span class="sr-only" role="status" aria-live="polite">
      {{ copy("readyAnnouncement") }}
    </span>
    <div class="plan-approval-copy">
      <h2 class="plan-approval-title">
        {{ proposal.title.trim() || copy("untitled") }}
      </h2>
      <div class="plan-approval-details">
        <button
          v-if="artifactPath"
          type="button"
          class="plan-approval-artifact"
          data-testid="plan-open-artifact"
          :aria-label="t(copyKey(kind, 'openArtifactLabel'), { path: artifactPath })"
          :title="artifactPath"
          @click="openArtifact"
        >
          <IconFileText :size="14" aria-hidden="true" />
          <span class="plan-approval-artifact-label">
            {{ copy("openArtifact") }}
          </span>
          <span class="plan-approval-artifact-path">
            {{ artifactPath }}
          </span>
        </button>
        <div v-if="stageSummary" class="plan-stages-track">
          <div
            v-for="(phase, idx) in stageSummary.phases"
            :key="phase.id"
            class="plan-stage-node"
            :data-status="phase.status"
            :title="`${phase.title} (${phase.steps.filter((s) => s.status === 'completed').length}/${phase.steps.length})`"
          >
            <span class="plan-stage-badge">
              <span v-if="phase.status === 'completed'">✓</span>
              <span v-else-if="phase.status === 'in_progress'" class="plan-stage-pulse">●</span>
              <span v-else>{{ idx + 1 }}</span>
            </span>
            <span class="plan-stage-title">{{ phase.title }}</span>
            <span
              v-if="idx < stageSummary.phases.length - 1"
              class="plan-stage-connector"
              aria-hidden="true"
            />
          </div>
          <span class="plan-stage-progress-badge">
            {{ stageSummary.completedSteps }}/{{ stageSummary.totalSteps }}
          </span>
        </div>
      </div>
    </div>
    <div v-if="isPending" class="plan-approval-actions">
      <button
        type="button"
        class="plan-approval-reject"
        :disabled="busy"
        @click="void resolve('reject')"
      >
        {{ copy("reject") }}
      </button>
      <AnchoredMenu
        class="plan-approval-split"
        :open="menuOpen"
        menu-class-name="plan-approval-menu"
        :label="copy('chooseApprovalMode')"
        role="menu"
        align="end"
        @close="menuOpen = false"
        @menu-keydown="onMenuKeyDown"
      >
        <template #trigger="{ setAnchor }">
          <button
            type="button"
            class="plan-approval-approve-main"
            :disabled="busy"
            :aria-label="copy(APPROVE_LABELS[approvalMode])"
            @click="void resolve('approve', approvalMode)"
          >
            {{
              resolving
                ? copy("approving")
                : copy(APPROVE_LABELS[approvalMode])
            }}
          </button>
          <TooltipButton
            :ref="setAnchor"
            type="button"
            class="plan-approval-approve-menu"
            :disabled="busy"
            :aria-label="copy('chooseApprovalMode')"
            :label="copy('chooseApprovalMode')"
            aria-haspopup="menu"
            :aria-expanded="menuOpen"
            @click="menuOpen = !menuOpen"
          >
            <IconChevronDown :size="13" aria-hidden="true" />
          </TooltipButton>
        </template>
        <button
          v-for="candidate in APPROVAL_MODES"
          :key="candidate"
          type="button"
          class="plan-approval-menu-item"
          role="menuitemradio"
          :aria-checked="approvalMode === candidate"
          :data-approval-mode="candidate"
          :disabled="busy"
          @click="
            approvalMode = candidate;
            void resolve('approve', candidate);
          "
        >
          <span>{{ copy(APPROVAL_MODE_LABELS[candidate]) }}</span>
          <IconCheck
            v-if="approvalMode === candidate"
            :size="13"
            aria-hidden="true"
          />
        </button>
      </AnchoredMenu>
    </div>
  </section>
</template>
