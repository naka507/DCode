<script setup lang="ts">
/**
 * Plan Status Capsule (floating in top-right when plan/goal is executing or pending).
 *
 * Displays:
 *  - Real-time plan / task name and concise progress ratio e.g. "目标任务XXXXX（1/4）"
 *  - Clean floating capsule without cluttering specific task details in the status bar
 *  - Clicking expands an inline floating popover panel (matching reference mockup)
 *    showing progress ratio, collapsed completed items, active step with '→',
 *    and pending steps with '○'.
 *  - Header action button '↗' and footer quick link open full details in right WorkPanel.
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
  IconArrowRight,
  IconArrowUpRight,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconClose,
  IconListChecks,
  IconMore,
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

// Collapsible group states matching reference UI
const showCompleted = ref(false);
const showAllPending = ref(false);

watch(
  () => proposal.value?.id,
  () => {
    isDismissed.value = false;
    isExpanded.value = false;
    showCompleted.value = false;
    showAllPending.value = false;
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

/**
 * Concise Capsule Title:
 * Format: 目标任务XXXXX（1/4）
 * Stripped of verbose current step details.
 */
const displayTitle = computed(() => {
  const rawTitle = proposal.value?.title?.trim() || (isZh.value ? "目标任务" : "Goal Task");
  if (stages.value && stages.value.totalSteps > 0) {
    const { completedSteps, totalSteps } = stages.value;
    return isZh.value
      ? `${rawTitle}（${completedSteps}/${totalSteps}）`
      : `${rawTitle} (${completedSteps}/${totalSteps})`;
  }
  return rawTitle;
});

export interface FormattedStepItem {
  id: string;
  title: string;
  subtitle?: string;
  status: "completed" | "in_progress" | "pending";
  phaseTitle: string;
}

function parseStepTitle(raw: string): { title: string; subtitle?: string } {
  const clean = raw.trim();
  const match = clean.match(/^([^(（]+)[(（](.+)[)）]?$/);
  if (match && match[1].trim()) {
    return {
      title: match[1].trim(),
      subtitle: `(${match[2].trim().replace(/[)）]+$/, "")})`,
    };
  }
  return { title: clean };
}

const allFormattedSteps = computed<FormattedStepItem[]>(() => {
  if (!stages.value) return [];
  const list: FormattedStepItem[] = [];
  for (const phase of stages.value.phases) {
    for (const step of phase.steps) {
      const { title, subtitle } = parseStepTitle(step.title);
      list.push({
        id: step.id,
        title,
        subtitle,
        status: step.status,
        phaseTitle: phase.title,
      });
    }
  }
  return list;
});

const completedStepsList = computed(() =>
  allFormattedSteps.value.filter((s) => s.status === "completed"),
);

const inProgressStepsList = computed(() =>
  allFormattedSteps.value.filter((s) => s.status === "in_progress"),
);

const pendingStepsList = computed(() =>
  allFormattedSteps.value.filter((s) => s.status === "pending"),
);

const displayedPendingSteps = computed(() => {
  if (showAllPending.value || pendingStepsList.value.length <= 2) {
    return pendingStepsList.value;
  }
  return pendingStepsList.value.slice(0, 2);
});

const hiddenPendingCount = computed(() => {
  if (showAllPending.value || pendingStepsList.value.length <= 2) {
    return 0;
  }
  return pendingStepsList.value.length - 2;
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

function handleOpenDetails() {
  isExpanded.value = false;
  openArtifact();
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
    <!-- Floating Capsule Pill: Shows e.g. "目标任务XXXXX（1/4）" -->
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
        <span class="capsule-plan-title" :title="displayTitle">{{ displayTitle }}</span>
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

    <!-- Floating Detail Popover (Matching Reference Image) -->
    <Transition name="plan-popover-fade">
      <div
        v-if="isExpanded && stages"
        class="plan-status-popover no-drag"
        role="dialog"
        :aria-label="proposal?.title"
      >
        <!-- Popover Header: 进程  2/9       ...  ↗ -->
        <div class="plan-popover-header">
          <div class="plan-popover-title-row">
            <span class="plan-popover-badge-label">{{ isZh ? "进程" : "Progress" }}</span>
            <span class="plan-popover-ratio-text">
              {{ stages.completedSteps }}/{{ stages.totalSteps }}
            </span>
          </div>

          <div class="plan-popover-header-actions">
            <button
              type="button"
              class="plan-popover-icon-btn"
              :title="isZh ? '复制进度报告' : 'Copy Report'"
              @click="copyReport"
            >
              <IconMore :size="14" />
            </button>
            <button
              type="button"
              class="plan-popover-icon-btn is-launch"
              :title="isZh ? '在右侧面板查看详情' : 'Open in WorkPanel'"
              @click="handleOpenDetails"
            >
              <IconArrowUpRight :size="14" />
            </button>
          </div>
        </div>

        <!-- Steps Content List -->
        <div class="plan-popover-body">
          <!-- 1. Collapsed Completed Section: < 已完成 2 项 -->
          <div v-if="completedStepsList.length > 0" class="plan-collapse-section">
            <button
              type="button"
              class="plan-collapse-trigger"
              @click="showCompleted = !showCompleted"
            >
              <span class="plan-collapse-arrow" :class="{ 'is-open': showCompleted }">
                <IconChevronRight :size="11" />
              </span>
              <span class="plan-collapse-label">
                {{ isZh ? `已完成 ${completedStepsList.length} 项` : `${completedStepsList.length} completed` }}
              </span>
            </button>

            <!-- Expanded completed items -->
            <div v-if="showCompleted" class="plan-collapse-items">
              <div
                v-for="step in completedStepsList"
                :key="step.id"
                class="plan-item-row is-completed"
                @click="handleOpenDetails"
              >
                <span class="plan-item-icon is-completed">
                  <IconCheck :size="11" />
                </span>
                <div class="plan-item-content">
                  <span class="plan-item-title">{{ step.title }}</span>
                  <span v-if="step.subtitle" class="plan-item-subtitle">{{ step.subtitle }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- 2. In-Progress Steps with → Arrow -->
          <div v-if="inProgressStepsList.length > 0" class="plan-inprogress-section">
            <div
              v-for="step in inProgressStepsList"
              :key="step.id"
              class="plan-item-row is-in_progress"
              @click="handleOpenDetails"
            >
              <span class="plan-item-icon is-in_progress">
                <IconArrowRight :size="13" />
              </span>
              <div class="plan-item-content">
                <span class="plan-item-title">{{ step.title }}</span>
                <span v-if="step.subtitle" class="plan-item-subtitle">{{ step.subtitle }}</span>
              </div>
            </div>
          </div>

          <!-- 3. Pending Steps with ○ Circle -->
          <div v-if="pendingStepsList.length > 0" class="plan-pending-section">
            <div
              v-for="step in displayedPendingSteps"
              :key="step.id"
              class="plan-item-row is-pending"
              @click="handleOpenDetails"
            >
              <span class="plan-item-icon is-pending">
                <span class="plan-circle-icon" />
              </span>
              <div class="plan-item-content">
                <span class="plan-item-title">{{ step.title }}</span>
                <span v-if="step.subtitle" class="plan-item-subtitle">{{ step.subtitle }}</span>
              </div>
            </div>

            <!-- More pending items trigger: < 待处理 4 项 -->
            <button
              v-if="hiddenPendingCount > 0"
              type="button"
              class="plan-collapse-trigger is-pending-more"
              @click="showAllPending = true"
            >
              <span class="plan-collapse-arrow">
                <IconChevronRight :size="11" />
              </span>
              <span class="plan-collapse-label">
                {{ isZh ? `待处理 ${hiddenPendingCount} 项` : `${hiddenPendingCount} more pending` }}
              </span>
            </button>
          </div>

          <!-- All done state -->
          <div
            v-if="inProgressStepsList.length === 0 && pendingStepsList.length === 0"
            class="plan-all-done-banner"
          >
            <IconCheck :size="13" />
            <span>{{ isZh ? "所有规划步骤已全部完成" : "All planned steps completed" }}</span>
          </div>
        </div>

        <!-- Popover Footer Quick Link to Right Panel -->
        <div class="plan-popover-footer" role="button" tabindex="0" @click="handleOpenDetails">
          <span class="plan-popover-footer-tip">
            {{ isZh ? "在右侧面板查看完整计划细节" : "View full plan details in WorkPanel" }}
          </span>
          <IconArrowUpRight :size="12" />
        </div>
      </div>
    </Transition>
  </div>
</template>
