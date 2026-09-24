<script setup lang="ts">
/**
 * Top-level chat page surface.
 *
 * Holds the retained session panes (ADR 0137). Every session the user has
 * visited recently keeps its own mounted `SessionPane`, bounded by
 * `RETAINED_SESSION_PANE_LIMIT`; switching reveals the destination pane and
 * hides the others, so no transcript is rebuilt and no frame is dimmed. Only a
 * session with no retained pane has to wait, and that wait is marked by the
 * progress track alone while the current pane stays on screen.
 *
 * The composer is mounted once for the surface rather than per branch: it owns
 * per-session drafts already, and remounting it on every switch discarded its
 * measured metrics and focus.
 *
 * The decisions that are not mechanical:
 *
 * 1. **The store selectors are `computed`s.** This file reads nine fields
 *     through `useAppStore((state) => state.…)`; `store.appState` is the
 *     store's `shallowRef`, so one `computed` per field tracks the same reads.
 * `getState()` is not part of that surface — where a handler would write
 *     `useAppStore.getState().foo()`, this file calls
 *     `store.appState?.foo()`.
 *  2. **`useMemo` is a `computed`**, so `heroProject` and the empty-title split
 * re-derive exactly when the dependencies it tracks move.
 * 3. **`StableComposer` is gone.** A component wrapper was hoisted to a
 *     module constant so the surface's re-renders did not remount it; a Vue
 *     component is not re-created by its parent's re-render, so no wrapper is
 *     needed and the composer is rendered directly.
 *  4. **`i18nHasError` stays a function call, not a `computed`.** It reads `t`
 *     and the error code; folding it into a `computed` would be equivalent, but
 *     it is called inline in the render and the call is one lookup.
 * 5. **The class list is a static `class` plus an object `:class`.** The class is
 *     built `` `chat-surface route-surface${sessionSwitching ? " session-switching" : ""}` ``;
 *     the object form is what the class-name contract reads, and the rendered
 *     class list is identical.
 *  6. **`data-home-session-kind` is a `computed`.** The three-way ternary is the
 *     same, but a `computed` keeps the template to one binding.
 *  7. **`aria-busy` stays bound to the boolean.** The bound boolean renders
 *     `aria-busy="true"` / `"false"`; Vue writes the same two strings for a
 *     non-boolean `aria-*` attribute.
 *  8. **The bare `aria-hidden` on the two hero nodes is written out** as
 *     `aria-hidden="true"`: a bare attribute in a Vue template renders as
 *     `""`, so the explicit value is required.
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { headPermission } from "../lib/pending-permissions";
import { headAsk } from "../lib/pending-asks";
import { useAppStore } from "../stores/app-store";
import { IconX } from "../lib/icons";
import Composer from "./Composer.vue";
import ConversationWidthHandles from "./ConversationWidthHandles.vue";
import HomeMascotLogo from "./HomeMascotLogo.vue";
import HomeProjectSwitcher from "./HomeProjectSwitcher.vue";
import OnboardingChecklist from "./OnboardingChecklist.vue";
import SessionPane from "./SessionPane.vue";
import TooltipButton from "./TooltipButton.vue";

const { t } = useI18n();
const store = useAppStore();

/** The translated message for a known error code, or `null` when there is none. */
function i18nError(code: string | null | undefined): string | null {
  if (!code) return null;
  const key = `errors.${code}`;
  const message = t(key);
  return message === key ? null : message;
}

/** The last path segment, used when a workspace has no display name of its own. */
function projectName(path?: string | null, name?: string | null): string | null {
  if (name) return name;
  if (!path) return null;
  const parts = path.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] || path;
}

const activeSessionId = computed(() => store.appState?.activeSessionId);
const selectingSessionId = computed(() => store.appState?.selectingSessionId);
const retainedSessionIds = computed(() => store.appState?.retainedSessionIds ?? []);
const messages = computed(() => store.appState?.messages ?? []);
// Only the error layer's retry affordance needs the run state here; each pane
// reads its own session's flag.
const isRunning = computed(() => store.appState?.isRunning ?? false);
const workspace = computed(() => store.appState?.workspace);
const error = computed(() => store.appState?.error);
const errorCode = computed(() => store.appState?.errorCode);
const errorRetriable = computed(() => store.appState?.errorRetriable);
const activeSession = computed(() =>
  activeSessionId.value
    ? store.appState?.sessions.find(
        (session) => session.id === activeSessionId.value,
      )
    : undefined,
);

// A pending permission or ask is itself transcript content, so the empty state
// must yield to it. Each pane subscribes to its own queues; the surface only
// needs the visible session's to choose between empty state and panes.
const activePermission = computed(() =>
  activeSessionId.value
    ? headPermission(
        store.appState?.pendingPermissions ?? {},
        activeSessionId.value,
      )
    : undefined,
);
const askPending = computed(() =>
  Boolean(
    activeSessionId.value &&
      headAsk(store.appState?.pendingAsks ?? {}, activeSessionId.value),
  ),
);

const heroProject = computed(() =>
  activeSession.value?.projectPath?.trim()
    ? projectName(activeSession.value.projectPath, workspace.value?.name)
    : null,
);
const isTemporarySession = computed(() =>
  Boolean(
    activeSessionId.value &&
      activeSession.value &&
      !activeSession.value.projectPath?.trim(),
  ),
);
/**
 * The empty title with the project name pulled out of it, so the switcher can
 * render in its place. The split is on a marker rather than rendering the
 * translated string, because the name is a component, not text.
 */
const emptyTitleParts = computed(() => {
  const marker = "__PROJECT__";
  const template = t("chat.emptyTitleInProject", { project: marker });
  const [before = "", after = ""] = template.split(marker);
  return { before, after };
});

// The head of the retained order is the session on screen. It equals
// `activeSessionId` except during a cold switch, where the destination has no
// pane yet: the surface then keeps showing the pane it already has instead of
// blanking or dimming it, and the store promotes the destination once its
// transcript commits.
const visibleSessionId = computed(() => retainedSessionIds.value[0]);
// Only a cold switch is a wait worth marking. Once the destination is the
// visible pane the user is already reading it, so a warm switch (including
// re-selecting the session already on screen) shows no progress track even
// though revalidation may still be in flight.
const sessionSwitching = computed(
  () =>
    Boolean(selectingSessionId.value) &&
    selectingSessionId.value !== visibleSessionId.value,
);

const hasTranscript = computed(
  () =>
    Boolean(activePermission.value) ||
    askPending.value ||
    messages.value.some((message) => {
      const hasContent = Boolean((message.content || "").trim());
      const hasThinking =
        typeof message.thinking === "string" && Boolean(message.thinking.trim());
      if (message.role === "assistant") return hasContent || hasThinking;
      return hasContent || message.role === "tool";
    }),
);
// The empty state belongs to the session on screen. While a cold switch is
// still resolving, the visible pane keeps its own transcript, so the hero must
// not take over just because the destination projection is still empty.
const showEmptyState = computed(
  () =>
    !hasTranscript.value &&
    (!visibleSessionId.value ||
      visibleSessionId.value === activeSessionId.value),
);
/** The hero's session kind, as the `data-home-session-kind` hook. */
const homeSessionKind = computed(() =>
  heroProject.value ? "project" : isTemporarySession.value ? "temporary" : "empty",
);
/** The error line: the translated code when there is one, else the raw text. */
const errorText = computed(
  () => i18nError(errorCode.value) ?? error.value,
);
const showErrorSettings = computed(() =>
  [
    "MODEL_NOT_CONFIGURED",
    "PROVIDER_SECRET_MISSING",
    "PROVIDER_UNAUTHORIZED",
  ].includes(errorCode.value ?? ""),
);
const showErrorRetry = computed(
  () => Boolean(errorRetriable.value) && !isRunning.value,
);

function openErrorSettings(): void {
  store.appState?.setSettingsTab("agent");
  store.appState?.setPage("settings");
}

function retryLastPrompt(): void {
  void store.appState?.retryLastPrompt();
}

function dismissError(): void {
  store.appState?.clearError();
}
</script>

<template>
  <div
    class="chat-surface route-surface"
    :class="{ 'session-switching': sessionSwitching }"
    :aria-busy="sessionSwitching"
  >
    <div
      v-if="sessionSwitching"
      class="session-switch-progress"
      aria-hidden="true"
    >
      <span />
    </div>
    <ConversationWidthHandles />
    <div
      v-if="showEmptyState"
      class="home-main-content"
      data-testid="home-empty"
      :data-home-session-kind="homeSessionKind"
    >
      <div class="home-scroll">
        <div class="home-stack-inner">
          <div class="empty-hero">
            <div
              class="empty-hero-icon"
              data-testid="home-icon"
              aria-hidden="true"
            >
              <HomeMascotLogo />
            </div>
            <h1>
              <template v-if="heroProject">
                {{ emptyTitleParts.before
                }}<HomeProjectSwitcher
                  :name="heroProject"
                  :path="workspace?.path || activeSession?.projectPath || null"
                />{{ emptyTitleParts.after }}
              </template>
              <template v-else-if="isTemporarySession">
                {{ t("chat.emptyTitleTemporary") }}
              </template>
              <template v-else>
                {{ t("chat.emptyTitle") }}
              </template>
            </h1>
          </div>
          <OnboardingChecklist />
        </div>
      </div>
      <div class="home-composer-wrap">
        <Composer variant="home" />
      </div>
    </div>
    <template v-else>
      <div class="session-panes">
        <SessionPane
          v-for="id in retainedSessionIds"
          :key="id"
          :session-id="id"
          :visible="id === visibleSessionId"
        />
      </div>
      <Composer variant="docked" />
    </template>

    <div v-if="error" class="chat-error-layer">
      <div class="chat-error-notice">
        <span :title="error ?? undefined">{{ errorText }}</span>
        <button
          v-if="showErrorSettings"
          type="button"
          class="chat-error-action"
          @click="openErrorSettings"
        >
          {{ t("errors.action.openSettings") }}
        </button>
        <button
          v-if="showErrorRetry"
          type="button"
          class="chat-error-action"
          @click="retryLastPrompt"
        >
          {{ t("errors.action.retry") }}
        </button>
        <TooltipButton
          type="button"
          class="chat-error-dismiss"
          :label="t('errors.action.dismiss')"
          :aria-label="t('errors.action.dismiss')"
          @click="dismissError"
        >
          <IconX :size="13" />
        </TooltipButton>
      </div>
    </div>
  </div>
</template>
