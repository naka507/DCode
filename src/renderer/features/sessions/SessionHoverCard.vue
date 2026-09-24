<script setup lang="ts">
/**
 * Session-collaboration hover card.
 *
 * It renders through `<Teleport to="body">`, and its callbacks become emits:
 * `open-session` (the session id) and `close-request` is not needed — the card
 * keeps its `keepVisible` / `scheduleHide` hover contract through
 * `keep-visible` / `schedule-hide` emits instead of props, because both are
 * owned by the caller's hover composable.
 *
 * The read loop is `observeSessionCollaboration` driven by a `watch`; the
 * per-session state it resets on a session change, so a reused card never leaks
 * the previous session's status into the next one.
 * reused card never leaks the previous session's status into the next one.
 */
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type {
  ProjectWorkspace,
  SessionCollaborationSummary,
  SessionReference,
} from "@dcode/shared";
import { api } from "../../lib/api";
import {
  IconArrowUpRight,
  IconBranch,
  IconClock,
  IconFolder,
} from "../../lib/icons";
import { observeSessionCollaboration } from "./session-collaboration-reader";
import {
  collaborationStatusKey,
  currentCollaborationResult,
  formatSessionTimestamp,
  positionSessionHoverCard,
  sessionPreview,
  sessionReferenceAvailable,
} from "./session-collaboration-view";
import type { SessionHoverCardData } from "./useSessionHoverCard";

const props = defineProps<{
  card: SessionHoverCardData;
  refreshProject: (path: string) => Promise<ProjectWorkspace | null>;
}>();

const emit = defineEmits<{
  "open-session": [sessionId: string];
  "keep-visible": [];
  "schedule-hide": [];
}>();

const { t, locale } = useI18n();

const elementRef = ref<HTMLDivElement | null>(null);
const position = ref<{ top: number; left: number } | undefined>(undefined);
const summary = ref<SessionCollaborationSummary | undefined>(undefined);
const readState = ref<"loading" | "ready" | "unavailable">("loading");
const project = ref<{ space: string; branch?: string }>({
  space: props.card.space,
  branch: props.card.branch,
});

const session = computed(() => props.card.session);
const target = computed(() => props.card.target);

// The card is reusable; its per-session read state must not leak into the next
// hovered session when the caller does not remount it.
watch(
  () => [props.card.space, props.card.branch, props.card.session.id, props.card.target] as const,
  () => {
    summary.value = undefined;
    readState.value = "loading";
    project.value = { space: props.card.space, branch: props.card.branch };
  },
  { immediate: true },
);

// One serial read loop per session; a new session disposes the previous loop
// through `onCleanup` before the next one starts.
watch(
  () => [props.card.session.id, props.card.target] as const,
  ([sessionId, cardTarget], _previous, onCleanup) => {
    const dispose = observeSessionCollaboration({
      sessionId,
      read: api.getSessionCollaboration,
      isVisible: () =>
        cardTarget.isConnected && !document.hidden && document.hasFocus(),
      onSummary: (next) => {
        summary.value = next;
        readState.value = "ready";
      },
      onUnavailable: () => {
        readState.value = "unavailable";
      },
    });
    onCleanup(dispose);
  },
  { immediate: true },
);

// The cached project label and branch remain useful when this optional read
// fails, so a rejection is swallowed on purpose.
watch(
  () => [props.card.temporary, props.card.session.projectPath, props.card.target] as const,
  ([temporary, projectPath, cardTarget], _previous, onCleanup) => {
    if (temporary) return;
    let current = true;
    void props
      .refreshProject(projectPath ?? "")
      .then((workspace) => {
        if (current && cardTarget.isConnected && workspace) {
          project.value = { space: workspace.name, branch: workspace.branch };
        }
      })
      .catch(() => undefined);
    onCleanup(() => {
      current = false;
    });
  },
  { immediate: true },
);

// The card is `position: fixed`, so both offsets are lengths. Vue writes them
// to CSSOM verbatim and CSSOM drops a unitless length silently, which would
// leave the card at its static position.
const cardStyle = computed(() =>
  position.value
    ? {
        top: `${position.value.top}px`,
        left: `${position.value.left}px`,
        visibility: "visible" as const,
      }
    : { visibility: "hidden" as const },
);

/** Place the card against its row; re-place on any card resize. */
function place() {
  const element = elementRef.value;
  const anchor = props.card.target;
  if (!element || !anchor.isConnected) return;
  position.value = positionSessionHoverCard(
    anchor.getBoundingClientRect(),
    { width: element.offsetWidth, height: element.offsetHeight },
    { width: window.innerWidth, height: window.innerHeight },
  );
}

let observer: ResizeObserver | undefined;

onMounted(() => {
  place();
  observer = new ResizeObserver(() => place());
  if (elementRef.value) observer.observe(elementRef.value);
});

watch(
  () => [props.card.target, elementRef.value] as const,
  () => {
    observer?.disconnect();
    place();
    observer = new ResizeObserver(() => place());
    if (elementRef.value) observer.observe(elementRef.value);
  },
  { flush: "post" },
);

const modeKey = computed(() =>
  session.value.mode === "plan"
    ? "chat.modePlan"
    : session.value.mode === "goal"
      ? "chat.modeGoal"
      : session.value.permissionMode === "auto"
        ? "chat.permissionAuto"
        : session.value.permissionMode === "accept-edits"
          ? "chat.permissionAcceptEdits"
          : session.value.permissionMode === "ask"
            ? "chat.permissionAsk"
            : "chat.modeAgent",
);

const result = computed(() =>
  summary.value ? currentCollaborationResult(summary.value) : undefined,
);
const modelLabel = computed(
  () => summary.value?.modelName || summary.value?.providerName,
);

function timestamp(value: string | undefined) {
  return formatSessionTimestamp(value, locale.value);
}

function openSessionReference(reference: SessionReference) {
  emit("open-session", reference.sessionId);
}
</script>

<template>
  <Teleport to="body">
    <div
      ref="elementRef"
      :id="`session-hover-${card.session.id}`"
      class="sidebar-session-hover-card"
      role="dialog"
      :aria-label="t('sessionCollaboration.sessionDetails', { name: card.session.title })"
      :data-session-collaboration="card.session.id"
      :style="cardStyle"
      @pointerdown.stop
      @mouseenter="emit('keep-visible')"
      @mouseleave="emit('schedule-hide')"
      @focusin="emit('keep-visible')"
      @focusout="emit('schedule-hide')"
    >
      <div class="sidebar-session-hover-card-title">{{ card.session.title }}</div>
      <div class="sidebar-session-hover-card-tags">
        <span v-if="summary?.createdBySession" class="sidebar-session-hover-card-tag">
          <IconBranch :size="12" aria-hidden="true" />
          {{ t("sessionCollaboration.sessionTask") }}
        </span>
        <span class="sidebar-session-hover-card-tag sidebar-session-hover-card-tag-accent">
          {{ t(modeKey) }}
        </span>
        <span
          class="sidebar-session-hover-card-status"
          :data-status="readState === 'ready' ? summary?.status : readState"
        >
          <template v-if="readState === 'ready' && summary">
            {{ t(collaborationStatusKey(summary.status)) }}
          </template>
          <template v-else-if="readState === 'unavailable'">
            {{ t("sessionCollaboration.unavailable") }}
          </template>
          <template v-else>{{ t("sessionCollaboration.loading") }}</template>
        </span>
      </div>

      <div v-if="summary?.createdBySession" class="sidebar-session-hover-card-section">
        <span class="sidebar-session-hover-card-section-label">
          {{ t("sessionCollaboration.createdBy") }}
        </span>
        <button
          v-if="sessionReferenceAvailable(summary.createdBySession)"
          type="button"
          class="sidebar-session-hover-card-session-link"
          :data-session-link="summary.createdBySession.sessionId"
          :title="summary.createdBySession.sessionId"
          :aria-label="
            t('sessionCollaboration.openSession', {
              name:
                summary.createdBySession.title || summary.createdBySession.sessionId,
            })
          "
          @click="openSessionReference(summary.createdBySession)"
        >
          <span class="sidebar-session-hover-card-session-link-title">
            {{ summary.createdBySession.title || summary.createdBySession.sessionId }}
          </span>
          <IconArrowUpRight :size="12" aria-hidden="true" />
        </button>
        <span
          v-else
          class="sidebar-session-hover-card-session-link sidebar-session-hover-card-session-link-unavailable"
          :data-session-link="summary.createdBySession.sessionId"
          data-session-link-unavailable="true"
          :title="t('sessionCollaboration.referenceUnavailable')"
        >
          <span class="sidebar-session-hover-card-session-link-title">
            {{ summary.createdBySession.title || summary.createdBySession.sessionId }}
          </span>
          <span class="sr-only">{{ t("sessionCollaboration.referenceUnavailable") }}</span>
        </span>
      </div>

      <div v-if="summary?.createdSessions?.length" class="sidebar-session-hover-card-section">
        <span class="sidebar-session-hover-card-section-label">
          {{ t("sessionCollaboration.createdSessions") }}
        </span>
        <ul class="sidebar-session-hover-card-session-links">
          <li v-for="reference in summary.createdSessions.slice(0, 8)" :key="reference.sessionId">
            <button
              v-if="sessionReferenceAvailable(reference)"
              type="button"
              class="sidebar-session-hover-card-session-link"
              :data-session-link="reference.sessionId"
              :title="reference.sessionId"
              :aria-label="
                t('sessionCollaboration.openSession', {
                  name: reference.title || reference.sessionId,
                })
              "
              @click="openSessionReference(reference)"
            >
              <span class="sidebar-session-hover-card-session-link-title">
                {{ reference.title || reference.sessionId }}
              </span>
              <IconArrowUpRight :size="12" aria-hidden="true" />
            </button>
            <span
              v-else
              class="sidebar-session-hover-card-session-link sidebar-session-hover-card-session-link-unavailable"
              :data-session-link="reference.sessionId"
              data-session-link-unavailable="true"
              :title="t('sessionCollaboration.referenceUnavailable')"
            >
              <span class="sidebar-session-hover-card-session-link-title">
                {{ reference.title || reference.sessionId }}
              </span>
              <span class="sr-only">{{ t("sessionCollaboration.referenceUnavailable") }}</span>
            </span>
          </li>
        </ul>
      </div>

      <div v-if="summary?.currentTask" class="sidebar-session-hover-card-section">
        <span class="sidebar-session-hover-card-section-label">
          {{ t("sessionCollaboration.currentTask") }}
        </span>
        <span class="sidebar-session-hover-card-peer">
          {{
            t("sessionCollaboration.receivedFrom", {
              name:
                summary.currentTask.senderSession.title ||
                summary.currentTask.senderSession.sessionId,
            })
          }}
        </span>
        <span class="sidebar-session-hover-card-preview">
          {{ sessionPreview(summary.currentTask.text) }}
        </span>
      </div>

      <div v-if="summary?.recentExchanges.length" class="sidebar-session-hover-card-section">
        <span class="sidebar-session-hover-card-section-label">
          {{ t("sessionCollaboration.recentMessages") }}
        </span>
        <ol class="sidebar-session-hover-card-exchanges">
          <li v-for="exchange in summary.recentExchanges.slice(0, 2)" :key="exchange.messageId">
            <span class="sidebar-session-hover-card-peer">
              {{
                t(
                  exchange.direction === "incoming"
                    ? "sessionCollaboration.receivedFrom"
                    : "sessionCollaboration.sentTo",
                  { name: exchange.peer.title || exchange.peer.sessionId },
                )
              }}
            </span>
            <span class="sidebar-session-hover-card-preview">
              {{ sessionPreview(exchange.preview, 180) }}
            </span>
          </li>
        </ol>
      </div>

      <div
        v-if="result && (result.error || result.text)"
        class="sidebar-session-hover-card-section"
        :data-result-status="result.status"
      >
        <span class="sidebar-session-hover-card-section-label">
          {{ result.error ? t("sessionCollaboration.failure") : t("sessionCollaboration.result") }}
        </span>
        <span class="sidebar-session-hover-card-preview">
          {{ sessionPreview(result.error || result.text) }}
        </span>
      </div>

      <div class="sidebar-session-hover-card-meta">
        <div v-if="modelLabel" class="sidebar-session-hover-card-model">{{ modelLabel }}</div>
        <div class="sidebar-session-hover-card-meta-row">
          <span class="sidebar-session-hover-card-meta-icon" aria-hidden="true">
            <IconFolder :size="12" />
          </span>
          <span class="sidebar-session-hover-card-meta-value">
            <span class="sr-only">{{ t("nav.hoverCardSpace") }} </span>
            {{ project.space }}
            <template v-if="project.branch">
              <span aria-hidden="true"> · </span>
              <span :aria-label="t('nav.hoverCardBranchAria', { name: project.branch })">
                {{ project.branch }}
              </span>
            </template>
          </span>
        </div>
        <div class="sidebar-session-hover-card-meta-row">
          <span class="sidebar-session-hover-card-meta-icon" aria-hidden="true">
            <IconClock :size="12" />
          </span>
          <span class="sidebar-session-hover-card-meta-value">
            {{ t("nav.hoverCardUpdatedAt", { when: timestamp(card.session.updatedAt) }) }}
          </span>
        </div>
      </div>
    </div>
  </Teleport>
</template>
