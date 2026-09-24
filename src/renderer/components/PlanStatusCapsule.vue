<script setup lang="ts">
/**
 * Plan Status Capsule (floating in top-right when plan/goal is executing or pending).
 *
 * Displays:
 *  - Real-time plan / task name and current execution step
 *  - Clean floating capsule matching the subagent status bar style
 *  - Clicking expands an inline floating popover panel (NOT the large right work panel)
 *    showing all phases, checklist steps, progress bar, and action buttons.
 *  - Click-outside dismissal.
 */
import { computed, onMounted, onScopeDispose, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  parsePlanStages,
  type PlanStageSummary,
  type PlanProposal,
} from "@dcode/shared";
import { useAppStore } from "../stores/app-store";
import { preferredFileWorkPanelTab } from "../lib/work-panel-tabs";
import {
  IconCheck,
  IconChevronDown,
  IconClose,
  IconCopy,
  IconFileText,
  IconListChecks,
} from "../lib/icons";

const props = withDefaults(
  defineProps<{
    sessionId?: string;
  }>(),
  {
    sessionId: undefined,
  },
);

const { locale } = useI18n();
const store = useAppStore();

const isZh = computed(() => locale.value?.startsWith("zh"));

const targetSessionId = computed(
  () => props.sessionId || store.appState?.activeSessionId,
);

const proposal = computed<PlanProposal | undefined>(() => {
  const id = targetSessionId.value;
  return id ? store.appState?.planCheckpoints[id] : undefined;
});

const isDismissed = ref(false);
const isExpanded = ref(false);
const rootRef = ref<HTMLDivElement | null>(null);

watch(
  () => proposal.value?.id,
  () => {
    isDismissed.value = false;
    isExpanded.value = false;
  },
);

const isExecuting = computed(
  () =>
    proposal.value?.executionState === "running" ||
    proposal.value?.executionState === "queued",
);

const isCompleted = computed(
  () => proposal.value?.executionState === "completed",
);

const isVisible = computed(() => {
  if (isDismissed.value || !proposal.value) return false;
  const p = proposal.value;
  return (
    p.status === "pending" ||
    p.executionState === "running" ||
    p.executionState === "queued" ||
    p.executionState === "completed"
  );
});

const stages = computed<PlanStageSummary | null>(() => {
  if (!proposal.value?.markdown) return null;
  return parsePlanStages(proposal.value.markdown, proposal.value.executionState);
});

const currentStepText = computed(() => {
  if (!stages.value) return "";
  if (isCompleted.value) {
    return isZh.value
      ? `全部完成 (${stages.value.totalSteps} 步骤)`
      : `All completed (${stages.value.totalSteps} steps)`;
  }
  const currPhase = stages.value.phases[stages.value.currentPhaseIndex];
  if (!currPhase) {
    return `${stages.value.completedSteps}/${stages.value.totalSteps}`;
  }
  const activeStep =
    currPhase.steps.find((s) => s.status === "in_progress") ||
    currPhase.steps.find((s) => s.status === "pending");
  if (activeStep) {
    return `${currPhase.title}: ${activeStep.title}`;
  }
  return `${currPhase.title} (${stages.value.completedSteps}/${stages.value.totalSteps})`;
});

function toggleExpanded() {
  isExpanded.value = !isExpanded.value;
}

function dismiss(event: MouseEvent) {
  event.stopPropagation();
  isDismissed.value = true;
  isExpanded.value = false;
}

function openArtifact() {
  const path = proposal.value?.artifact?.relativePath?.trim();
  if (!path || !targetSessionId.value) return;
  store.appState?.openWorkPanelTabForSession(
    targetSessionId.value,
    preferredFileWorkPanelTab(path, store.appState?.pluginViews ?? []),
  );
}

async function copyReport() {
  if (!proposal.value || !stages.value) return;
  const p = proposal.value;
  const s = stages.value;
  const lines: string[] = [
    `# ${p.title}`,
    `状态: ${isCompleted.value ? "已完成" : "执行中"} (${s.completedSteps}/${s.totalSteps} 步骤已完成)`,
    "",
  ];
  for (const phase of s.phases) {
    const mark =
      phase.status === "completed"
        ? "✓"
        : phase.status === "in_progress"
          ? "●"
          : "○";
    lines.push(`## [${mark}] ${phase.title}`);
    for (const step of phase.steps) {
      const box = step.status === "completed" ? "[x]" : "[ ]";
      lines.push(`- ${box} ${step.title}`);
    }
    lines.push("");
  }
  try {
    await navigator.clipboard.writeText(lines.join("\n"));
    store.appState?.showToast(
      isZh.value
        ? "计划进度报告已复制到剪贴板"
        : "Plan progress report copied to clipboard",
      { variant: "info" },
    );
  } catch {
    /* ignore clipboard error */
  }
}

function onPointerDown(event: PointerEvent) {
  if (!isExpanded.value) return;
  const el = rootRef.value;
  if (el && !el.contains(event.target as Node)) {
    isExpanded.value = false;
  }
}

onMounted(() => {
  window.addEventListener("pointerdown", onPointerDown, true);
});

onScopeDispose(() => {
  window.removeEventListener("pointerdown", onPointerDown, true);
});
</script>

<template>
  <div
    v-if="isVisible"
    ref="rootRef"
    class="plan-status-capsule-wrap no-drag"
  >
    <!-- Floating Capsule Pill -->
    <div
      class="plan-status-capsule no-drag"
      :class="{
        'is-running': isExecuting,
        'is-completed': isCompleted,
        'is-expanded': isExpanded,
      }"
      role="button"
      tabindex="0"
      :aria-expanded="isExpanded"
      @click="toggleExpanded"
      @keydown.enter.space.prevent="toggleExpanded"
    >
      <span class="capsule-icon-wrap" aria-hidden="true">
        <IconCheck v-if="isCompleted" :size="13" />
        <span v-else-if="isExecuting" class="plan-capsule-pulse">●</span>
        <IconListChecks v-else :size="13" />
      </span>

      <div class="capsule-text-wrap">
        <span class="capsule-plan-title">{{ proposal?.title }}</span>
        <span class="capsule-separator">·</span>
        <span class="capsule-plan-step" :title="currentStepText">{{ currentStepText }}</span>
      </div>

      <span
        class="capsule-chevron-wrap"
        :class="{ 'is-flipped': isExpanded }"
        aria-hidden="true"
      >
        <IconChevronDown :size="12" />
      </span>

      <button
        v-if="isCompleted"
        type="button"
        class="plan-capsule-dismiss-btn"
        :title="isZh ? '关闭状态胶囊' : 'Dismiss capsule'"
        @click="dismiss"
      >
        <IconClose :size="10" />
      </button>
    </div>

    <!-- Floating Detail Popover (Not the big right workpanel) -->
    <Transition name="plan-popover-fade">
      <div
        v-if="isExpanded && stages"
        class="plan-status-popover no-drag"
        role="dialog"
        :aria-label="proposal?.title"
      >
        <!-- Popover Header -->
        <div class="plan-popover-header">
          <div class="plan-popover-title-row">
            <span class="plan-popover-kind-tag">
              {{
                proposal?.kind === "goal"
                  ? isZh
                    ? "目标"
                    : "Goal"
                  : isZh
                    ? "计划"
                    : "Plan"
              }}
            </span>
            <span class="plan-popover-title">{{ proposal?.title }}</span>
          </div>
          <button
            type="button"
            class="plan-popover-close-btn"
            :title="isZh ? '收起' : 'Close'"
            @click="isExpanded = false"
          >
            <IconClose :size="13" />
          </button>
        </div>

        <!-- Progress Overview -->
        <div class="plan-popover-progress-box">
          <div class="plan-popover-progress-bar">
            <div
              class="plan-popover-progress-fill"
              :class="{ 'is-completed': isCompleted }"
              :style="{ width: `${stages.progressPercent}%` }"
            />
          </div>
          <div class="plan-popover-progress-meta">
            <span>
              {{ stages.completedSteps }} / {{ stages.totalSteps }}
              {{ isZh ? "步骤完成" : "steps completed" }}
            </span>
            <span class="plan-popover-pct">{{ stages.progressPercent }}%</span>
          </div>
        </div>

        <!-- Phases and Checklist Steps -->
        <div class="plan-popover-phases-list">
          <div
            v-for="(phase, pIdx) in stages.phases"
            :key="phase.id"
            class="plan-popover-phase"
            :class="{
              'is-completed': phase.status === 'completed',
              'is-in_progress': phase.status === 'in_progress',
              'is-pending': phase.status === 'pending',
            }"
          >
            <div class="plan-popover-phase-header">
              <span class="plan-popover-phase-badge">
                <IconCheck v-if="phase.status === 'completed'" :size="10" />
                <span
                  v-else-if="phase.status === 'in_progress'"
                  class="plan-phase-pulse"
                >●</span>
                <span v-else>{{ pIdx + 1 }}</span>
              </span>
              <span class="plan-popover-phase-title">{{ phase.title }}</span>
              <span class="plan-popover-phase-ratio">
                {{
                  phase.steps.filter((s) => s.status === "completed").length
                }}/{{ phase.steps.length }}
              </span>
            </div>

            <!-- Steps checklist inside phase -->
            <div v-if="phase.steps.length > 0" class="plan-popover-steps-list">
              <div
                v-for="step in phase.steps"
                :key="step.id"
                class="plan-popover-step-item"
                :class="{
                  'is-completed': step.status === 'completed',
                  'is-in_progress': step.status === 'in_progress',
                  'is-pending': step.status === 'pending',
                }"
              >
                <span class="plan-popover-step-icon">
                  <IconCheck v-if="step.status === 'completed'" :size="10" />
                  <span
                    v-else-if="step.status === 'in_progress'"
                    class="plan-step-dot"
                  >●</span>
                  <span v-else class="plan-step-box" />
                </span>
                <span class="plan-popover-step-title">{{ step.title }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Footer Actions -->
        <div class="plan-popover-footer">
          <button
            v-if="proposal?.artifact?.relativePath"
            type="button"
            class="plan-popover-action-btn"
            @click="openArtifact"
          >
            <IconFileText :size="12" />
            <span>{{ isZh ? "查看计划文档" : "View Artifact" }}</span>
          </button>
          <button
            type="button"
            class="plan-popover-action-btn"
            @click="copyReport"
          >
            <IconCopy :size="12" />
            <span>{{ isZh ? "复制进度报告" : "Copy Report" }}</span>
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>
