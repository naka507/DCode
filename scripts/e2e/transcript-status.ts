/**
 * Transcript runtime-status lifecycle fixture (issue #323) for the Vue
 * renderer.
 *
 * The components are Vue 3 SFCs, so the probe is assembled with `createApp` /
 * `h` and the app's own vue-i18n instance (`src/renderer/i18n.ts`), exactly as
 * `./transcript-runtime-slot.ts` and `./transcript-disclosure-anchor.ts` do.
 * The scenario, its checks, its tolerances and every failure-message string are
 * unchanged.
 *
 * Every adaptation is an API bridge, not a weakened check:
 *
 *  1. **State writes commit asynchronously.** `await nextTick()` is the way to
 *     await that commit, so `render()` and `activity()` are `async` and every
 *     call awaits them. The assertions still observe
 *     the committed DOM, because `nextTick` is what makes that true. A
 *     `patchAppState(...)` whose result is asserted immediately gets the same
 *     `await nextTick()`.
 *  2. **The deferred-commit barrier is `nextTick()`.** Vue's renderer is
 *     synchronous, so the committed DOM is the current value in every case the
 *     scenario's gates force — see the comment at
 *     `src/renderer/features/chat/transcript/hooks/useTranscriptScroll.ts:534-550`.
 *     One `nextTick()` is therefore the whole barrier, and no timing assertion
 *     changes meaning.
 *  3. **The root is `createApp(Root)` + `app.mount(host)`**, and a render is a
 *     reassignment of the
 *     reactive props cell the root renders from, followed by the `nextTick()`
 *     above. Teardown is `app.unmount()`. A render whose props are
 *     unchanged (`await render()`) re-renders the root but leaves the child's
 *     DOM untouched, because Vue compares a child's props by `Object.is`; the
 *     assertion that follows still observes the same committed DOM, which is
 *     what it is about.
 *  4. **The app's own i18n instance is installed via `app.use(i18n)`.** The
 *     catalogs are installed into
 *     the vue-i18n instance at import time, so importing it is enough to get a
 *     working instance, and `i18n.t(key)` is `i18n.global.t(key)`.
 *  5. **The store's state writes go through `patchAppState(...)`.** The write is
 *     synchronous; the `await nextTick()` after it is what makes the render
 *     observable, because Vue commits the render on the microtask
 *     queue. State reads are `currentAppState()`, and
 *     `initializeAppStore()` runs once before the first read or write, because
 *     the store commits its initial state lazily.
 *  6. **The app store's Pinia instance is installed.** `ChatTranscript` reads
 *     `useAppStore()`, so the fixture needs the same instance the renderer entry
 *     point installs (see `src/renderer/stores/pinia.ts`).
 *  7. **One cast keeps the input shape exact.** The runtime-phase loop passes
 *     `{ phase, since }` for every phase including `retrying`, whose declared
 *     type also carries `attempt`; the runtime reads only `phase` and `since`
 *     here. The cast preserves the fixture's input rather than inventing an
 *     `attempt` the scenario never sent.
 *
 * No `declare global` block and no `assert` helper: this probe is exported and
 * awaited by `./transcript-render`, and it reports through `check` rather than
 * by throwing, so there is nothing for either to do.
 */
import { createApp, defineComponent, h, nextTick, shallowRef, type VNode } from "vue";
import { rendererPinia } from "../../src/renderer/stores/pinia";
import { i18n } from "../../src/renderer/i18n";
import ChatTranscript from "../../src/renderer/features/chat/transcript/ChatTranscript.vue";
import {
  currentAppState,
  initializeAppStore,
  patchAppState,
} from "../../src/renderer/stores/app-store";
import type { PendingPermission } from "../../src/renderer/lib/pending-permissions";
import type {
  AgentActivity,
  PlanningState,
  UiMessage,
} from "@dcode/shared";

/** The props the probe drives; the component's own `ComponentProps` equivalent. */
type TranscriptProps = {
  sessionId: string;
  messages: UiMessage[];
  isRunning: boolean;
  readingWindow?: boolean;
  planningState?: PlanningState;
  askPending?: boolean;
  pendingPermission?: PendingPermission;
};

/** A turn stays visibly active even when its latest output stops changing. */
export async function transcriptStatusProbe(): Promise<{
  ok: boolean;
  checks: string[];
  failures: string[];
}> {
  const host = document.createElement("div");
  host.style.cssText =
    "position:absolute;inset:0;display:flex;flex-direction:column";
  document.body.append(host);
  const failures: string[] = [];
  const checks: string[] = [];
  const check = (value: unknown, label: string) => {
    checks.push(label);
    if (!value) failures.push(label);
  };
  const sessionId = "status-lifecycle";
  const createdAt = new Date().toISOString();
  const user: UiMessage = {
    id: "user",
    role: "user",
    content: "Inspect the workspace",
    createdAt,
  };
  const answer: UiMessage = {
    id: "answer",
    role: "assistant",
    content: "I will inspect the files.",
    status: "streaming",
    createdAt,
  };
  const tool: UiMessage = {
    id: "tool",
    role: "tool",
    content: "",
    toolName: "Bash",
    toolCallId: "call",
    toolArgs: { command: "pwd" },
    toolStatus: "running",
    createdAt,
  };
  // The reactive props cell; `render()` reassigns it instead of calling a
  // render function on a root (note 3).
  const propsRef = shallowRef<TranscriptProps>({
    sessionId,
    messages: [user],
    isRunning: true,
  });
  const Root = defineComponent({
    name: "TranscriptStatusRoot",
    setup: () => (): VNode => h(ChatTranscript, propsRef.value),
  });
  const app = createApp(Root);
  app.use(i18n);
  // `ChatTranscript` reads the app store, so the fixture needs the same Pinia
  // instance the renderer entry point installs (note 6).
  app.use(rendererPinia);
  app.mount(host);
  // Before the first read or write: the store commits its initial state
  // lazily (note 5).
  initializeAppStore();
  const initial = currentAppState();
  const render = async (update: Partial<TranscriptProps> = {}) => {
    propsRef.value = { ...propsRef.value, ...update };
    await nextTick();
  };
  /**
   * Writes `agentStatuses` and awaits the commit; the
   * `nextTick()` is what makes the new state observable (notes 1 and 5).
   */
  const activity = async (value: AgentActivity | undefined) => {
    patchAppState({
      agentStatuses: {
        [sessionId]: {
          sessionId,
          isRunning: true,
          pendingToolConfirmations: 0,
          activity: value,
        },
      },
    });
    await nextTick();
  };
  const indicator = (id: string) => host.querySelector(`[data-testid="${id}"]`);
  /**
   * The two derived labels and the exact lane assertion. `childElementCount`
   * and the `> *` selector below count *elements*, so the comment placeholders a
   * `v-if` leaves behind (`_createCommentVNode("v-if", true)`, mounted as real
   * comment nodes by Vue's `processCommentNode`) do not affect either check.
   */
  const oneStatus = (id: string, label: string) => {
    const lane = host.querySelector(".transcript-runtime-status");
    check(lane?.childElementCount === 1 && Boolean(indicator(id)), label);
    check(
      indicator(id)?.getAttribute("role") === "status",
      `${label}: accessible status`,
    );
    check(
      !host.querySelector(".message-row.assistant .message-actions"),
      `${label}: running turn has no empty action toolbar`,
    );
  };
  const noStatus = (label: string) =>
    check(!host.querySelector(".transcript-runtime-status > *"), label);
  try {
    for (const mode of ["detailed", "compact"] as const) {
      patchAppState({
        settings: {
          defaultMode: "agent",
          theme: "light",
          enterToSend: true,
          onboardingDismissed: true,
          thinkingDisplayMode: mode,
        },
        agentStatuses: {},
        pendingPlans: {},
      });
      await render({
        sessionId,
        messages: [user],
        isRunning: true,
        readingWindow: false,
      });
      oneStatus("working-indicator", `${mode}: send before first event`);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const userBubble = host.querySelector(".message-row.user .message-bubble");
      const waitingLabel = indicator("working-indicator")?.querySelector(".working-indicator-label");
      const initialGap = userBubble && waitingLabel
        ? waitingLabel.getBoundingClientRect().top - userBubble.getBoundingClientRect().bottom
        : Number.NaN;
      check(Math.abs(initialGap - 52) <= 0.01,
        `${mode}: initial wait retains the user action row (${initialGap}px)`);

      await render({ messages: [{ ...user, revisionCount: 3, activeRevision: 2 }] });
      for (const width of [window.innerWidth, 320]) {
        host.style.width = `${width}px`;
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const buttons = [...host.querySelectorAll<HTMLButtonElement>(".message-row.user .message-actions button")];
        const copy = buttons.find((button) => button.getAttribute("aria-label") === i18n.global.t("chat.copy"));
        check(buttons.length === 5 && copy && !copy.disabled &&
          buttons.filter((button) => button !== copy).every((button) => button.disabled),
          `${mode}/${width}: copy available; edit, delete and revisions disabled during wait`);
        copy?.focus();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const status = host.querySelector(".transcript-runtime-status")?.getBoundingClientRect();
        check(Boolean(status) && buttons.every((button) => {
          const box = button.getBoundingClientRect();
          return status && (box.left >= status.right || box.top >= status.bottom || box.right <= status.left || box.bottom <= status.top);
        }), `${mode}/${width}: status and all user action hit targets do not overlap`);
        const box = copy?.getBoundingClientRect();
        check(copy && document.activeElement === copy && box &&
          copy.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)),
          `${mode}/${width}: copy receives keyboard focus and pointer hit`);
      }
      host.style.width = "";
      for (const [target, label] of [
        [host.querySelector(".transcript-runtime-status"), "chat.conversationMenu"],
        [host.querySelector(".message-row.user .message-bubble"), "chat.messageMenu"],
      ] as const) {
        target?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 80, clientY: 160 }));
        await nextTick();
        check(document.querySelector('[role="menu"]')?.getAttribute("aria-label") === i18n.global.t(label),
          `${mode}: ${label} retains context menu ownership`);
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        await nextTick();
      }
      await activity({ phase: "waiting-model", since: Date.now() });
      oneStatus("run-activity-indicator", `${mode}: first wait receives phase changes`);
      await render({ isRunning: false });
      check(!host.querySelector(".transcript-runtime-status") &&
        host.querySelectorAll(".message-row.user button:disabled").length === 0,
        `${mode}: cancelling before output restores user actions and normal row`);
      await activity(undefined);
      await render({ messages: [user, answer], isRunning: true });
      oneStatus("working-indicator", `${mode}: partial answer remains active`);
      // Geometry needs painted content, including content-visibility layout.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      const fragment = host.querySelector(".assistant-turn-fragment");
      const statusLabel = indicator("working-indicator")?.querySelector(
        ".working-indicator-label",
      );
      const gap =
        fragment && statusLabel
          ? statusLabel.getBoundingClientRect().top -
            fragment.getBoundingClientRect().bottom
          : Number.NaN;
      check(
        Math.abs(gap - 24) <= 0.01,
        `${mode}: status stays adjacent to partial answer (${gap}px)`,
      );
      await render({
        messages: [
          { ...user, id: "older-user" },
          { ...answer, id: "older-answer", status: "complete" },
          user,
          answer,
        ],
      });
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      const olderTurn = host.querySelector(
        '.assistant-turn:has([data-message-id="older-answer"])',
      );
      check(
        olderTurn &&
          getComputedStyle(olderTurn).paddingBottom === "14px" &&
          olderTurn.querySelectorAll(".message-actions button").length === 3,
        `${mode}: completed history retains its spacing and actions`,
      );
      await render({ messages: [user, answer], readingWindow: true });
      const readingTurn = host.querySelector(".assistant-turn");
      check(
        readingTurn && getComputedStyle(readingTurn).paddingBottom === "14px",
        `${mode}: history reading retains the normal message spacing`,
      );
      await render({ readingWindow: false });
      // No more deltas: an unchanged streaming message must not erase feedback.
      await render();
      oneStatus("working-indicator", `${mode}: quiet partial answer`);
      await render({ messages: [user, answer, tool] });
      oneStatus("working-indicator", `${mode}: running tool`);
      await render({
        messages: [
          user,
          answer,
          { ...tool, toolStatus: "success", content: "done" },
        ],
      });
      oneStatus(
        "working-indicator",
        `${mode}: completed tool before next status`,
      );
      await activity({ phase: "waiting-model", since: Date.now() });
      oneStatus("run-activity-indicator", `${mode}: named model wait`);
      await activity(undefined);
      oneStatus("working-indicator", `${mode}: cleared phase keeps fallback`);
      await render({
        messages: [
          user,
          { ...answer, content: "", thinking: "Inspecting files" },
        ],
      });
      oneStatus("working-indicator", `${mode}: thinking only`);
      await render({
        messages: [user, { ...answer, content: "Here is the result." }],
      });
      oneStatus("working-indicator", `${mode}: resumed answer`);
      for (const status of ["complete", "aborted", "error"] as const) {
        await render({
          messages: [user, { ...answer, status }],
          isRunning: false,
        });
        check(
          !host.querySelector(".transcript-runtime-status"),
          `${mode}: ${status} removes lane`,
        );
        const settledTurn = host.querySelector(".assistant-turn");
        check(
          settledTurn && getComputedStyle(settledTurn).paddingBottom === "14px",
          `${mode}: ${status} restores the normal message spacing`,
        );
        check(
          host.querySelectorAll(
            ".message-row.assistant .message-actions button",
          ).length === 3,
          `${mode}: settled non-error content retains copy, branch, and retry`,
        );
      }
      await render({
        messages: [
          user,
          {
            ...answer,
            status: "error",
            error: {
              code: "UNKNOWN",
              message: "Fixture error",
              retriable: false,
            },
          },
        ],
        isRunning: false,
      });
      check(
        !host.querySelector(".message-row.assistant .message-actions"),
        `${mode}: failed turn has no empty toolbar`,
      );
    }
    await render({ messages: [user, answer], isRunning: true });
    for (const phase of [
      "starting",
      "waiting-model",
      "preparing",
      "recovering",
      "retrying",
    ] as const) {
      // Note 7: every phase is sent as `{ phase, since }`, `retrying`
      // included.
      await activity({ phase, since: Date.now() } as AgentActivity);
      oneStatus(
        "run-activity-indicator",
        `${phase}: partial text cannot hide runtime phase`,
      );
      check(
        indicator("run-activity-indicator")?.getAttribute("data-phase") ===
          phase,
        `${phase}: correct label owner`,
      );
    }
    await activity(undefined);
    await render({ planningState: "planning" });
    oneStatus("planning-indicator", "planning remains visible after output");
    await activity({ phase: "waiting-model", since: Date.now() });
    oneStatus(
      "run-activity-indicator",
      "runtime phase takes precedence over planning",
    );
    await render({ askPending: true });
    noStatus("question pending yields to user interaction");
    await render({
      askPending: false,
      pendingPermission: {
        sessionId,
        requestId: "permission",
        toolCallId: "call",
        toolName: "Bash",
        argsPreview: { command: "pwd" },
        risk: "low",
        reason: "fixture",
        receivedAt: Date.now(),
      },
    });
    noStatus("permission pending yields to approval");
    check(
      host.querySelector(".permission-card button"),
      "permission actions remain mounted",
    );
    const permissionTurn = host.querySelector(".assistant-turn");
    check(
      permissionTurn &&
        getComputedStyle(permissionTurn).paddingBottom === "14px",
      "permission card keeps the normal message spacing",
    );
    await render({ pendingPermission: undefined });
    patchAppState({
      pendingPlans: {
        [sessionId]: {
          id: "proposal",
          sessionId,
          turnId: "turn",
          toolCallId: "submit",
          kind: "plan",
          title: "Review plan",
          markdown: "Plan",
          plan: "Plan",
          question: "Proceed?",
          version: 1,
          status: "pending",
          createdAt,
          updatedAt: createdAt,
        },
      },
    });
    // The commit point: Vue commits on the microtask queue, so `nextTick` awaits it.
    await nextTick();
    noStatus("plan approval yields to user interaction");
    patchAppState({ pendingPlans: {} });
    await nextTick();
    oneStatus("run-activity-indicator", "approval resolved restores activity");
    await render({ readingWindow: true });
    check(
      !host.querySelector(".transcript-runtime-status"),
      "history reading has no live lane",
    );
    await render({ readingWindow: false });
    oneStatus("run-activity-indicator", "return to latest restores activity");
    await render({ sessionId: "other-session", planningState: undefined });
    oneStatus(
      "working-indicator",
      "session switch cannot inherit another session's phase",
    );
    await render({ sessionId });
    oneStatus(
      "run-activity-indicator",
      "return to running session restores its own phase",
    );
    await render({ isRunning: false });
    noStatus("terminal turn hides even a retained runtime phase");
    return { ok: failures.length === 0, checks, failures };
  } finally {
    app.unmount();
    host.remove();
    patchAppState({
      settings: initial.settings,
      agentStatuses: initial.agentStatuses,
      pendingPlans: initial.pendingPlans,
    });
  }
}
