/**
 * Runtime status slot scenario (issue #323) for the Vue renderer.
 *
 * The scenario, its checks and its tolerances are unchanged; the fixture is
 * assembled from Vue 3 SFCs with `createApp` / `h` and the app's own vue-i18n
 * instance.
 *
 * Every adaptation is an API bridge, not a weakened check:
 *
 *  1. **State writes commit asynchronously.** `await nextTick()` is the way to
 *     await that commit. `update()` is `async`, and
 *     every call awaits it. The `settle()` convergence loop that follows each
 *     state change is what the scenario relies on anyway, so no timing
 *     assertion changes meaning.
 *
 *  2. **Render errors are caught by `app.config.errorHandler`.**
 *     The final check asserts the same thing: no render error escaped.
 *
 *  3. **The app's own i18n instance is installed via `app.use(i18n)`** — the
 *     catalogs are installed
 *     into the vue-i18n instance at import time.
 *
 *  4. **The store's state writes go through `patchAppState({ agentStatuses })`.**
 *     The write is synchronous, so the ordering the scenario depends on — write
 *     the store, then paint, both before the next frame — is preserved.
 *     `paint()` reassigns a reactive props object instead of re-rendering a tree
 *     root.
 *
 *  5. **The theme is set on `document.documentElement.dataset.theme`.** The
 *     app's `src/renderer/main.ts` also sets `dataset.platform` on the same
 *     element, and the stylesheet keys the window-chrome overrides off it, so
 *     the fixture leaves `platform` unset — the measured
 *     `.transcript-runtime-status` rule is not platform-gated.
 */
import { createApp, defineComponent, h, nextTick, ref, shallowRef, type VNode } from "vue";
import { rendererPinia } from "../../src/renderer/stores/pinia";
import { i18n } from "../../src/renderer/i18n";
import ChatTranscript from "../../src/renderer/features/chat/transcript/ChatTranscript.vue";
import { initializeAppStore, patchAppState } from "../../src/renderer/stores/app-store";
import type { AgentActivity, UiMessage } from "@dcode/shared";

const createdAt = "2026-09-13T00:00:00.000Z";
const message = (
  id: string,
  role: UiMessage["role"],
  content: string,
  extra: Partial<UiMessage> = {},
): UiMessage => ({ id, role, content, createdAt, ...extra });

export async function transcriptRuntimeSlotProbe(): Promise<{
  ok: boolean;
  snapshots: string[];
  idleLaneMounted: boolean;
  failures: string[];
}> {
  const host = document.createElement("div");
  host.setAttribute(
    "style",
    "position:absolute;inset:0;display:flex;flex-direction:column;min-height:0",
  );
  document.body.append(host);
  const renderErrors: unknown[] = [];
  const failures: string[] = [];
  const check = (passed: boolean, message: string) => {
    if (!passed) failures.push(message);
  };
  const sessionId = "runtime-slot";
  const messages: UiMessage[] = [message("user", "user", "Inspect the workspace")];
  for (let index = 0; index < 8; index++) {
    messages.push(
      message(`tool-${index}`, "tool", "done", {
        toolName: "Bash",
        toolCallId: `call-${index}`,
        toolStatus: "success",
        toolArgs: { command: `printf step-${index}` },
        toolResult: { details: { stdout: "done", exitCode: 0 } },
      }),
    );
    messages.push(
      message(`answer-${index}`, "assistant", `Finished step ${index}.`),
    );
  }
  // A completed tool row does not finish the turn: the fallback remains until
  // the runtime reports the next phase or the turn reaches a terminal state.
  messages.push(
    message("tool-tail", "tool", "done", {
      toolName: "Bash",
      toolCallId: "call-tail",
      toolStatus: "success",
      toolArgs: { command: "printf tail" },
      toolResult: { details: { stdout: "done", exitCode: 0 } },
    }),
  );

  const frame = () =>
    new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const content = () => host.querySelector<HTMLElement>(".thread-content");
  const scroller = () => host.querySelector<HTMLElement>(".thread-scroll");
  const lane = () =>
    host.querySelector<HTMLElement>(".transcript-runtime-status");
  // Bounded first commits, late row heights and the follow scroll all settle
  // over frames, so every comparison is made against settled geometry only. The
  // key carries the measured rows and the scroll extent, not just the content
  // height: two frames can share the height while the rows or the offset are
  // still moving.
  const settle = async () => {
    let previous = "";
    for (let attempt = 0; attempt < 60; attempt++) {
      await frame();
      const rows = host.querySelectorAll<HTMLElement>(".message-row");
      const geometry = [
        content()?.offsetHeight,
        scroller()?.scrollTop,
        scroller()?.scrollHeight,
        rows[0]?.getBoundingClientRect().top,
        rows[rows.length - 1]?.getBoundingClientRect().bottom,
      ].join(":");
      if (geometry === previous) return;
      previous = geometry;
    }
  };
  const snapshots: string[] = [];
  const snapshot = () => {
    const rows = [...host.querySelectorAll<HTMLElement>(".message-row")];
    const element = lane();
    const measured = {
      contentHeight: content()?.getBoundingClientRect().height ?? null,
      scrollHeight: scroller()?.scrollHeight ?? null,
      scrollTop: scroller()?.scrollTop ?? null,
      firstRowTop: rows[0]?.getBoundingClientRect().top ?? null,
      lastRowBottom: rows.at(-1)?.getBoundingClientRect().bottom ?? null,
      lastTextBottom:
        [...host.querySelectorAll(".assistant-turn-fragment")]
          .at(-1)
          ?.getBoundingClientRect().bottom ?? null,
      laneHeight: element?.getBoundingClientRect().height ?? null,
      laneChildren: element?.childElementCount ?? null,
      laneText: element?.textContent ?? null,
    };
    snapshots.push(JSON.stringify(measured));
    return measured;
  };
  type Snap = ReturnType<typeof snapshot>;
  const compare = (label: string, state: Snap, baseline: Snap) => {
    const fields = [
      "contentHeight",
      "scrollHeight",
      "scrollTop",
      "firstRowTop",
      "lastRowBottom",
    ] as const;
    for (const field of fields) {
      const before = baseline[field];
      const after = state[field];
      const moved =
        before === null || after === null ? Number.NaN : after - before;
      check(
        Math.abs(moved) <= 0.01,
        `${label}: ${field} moved by ${moved}px (${after} vs ${before})`,
      );
    }
  };

  // The props the real component receives, reassigned by `paint()` to
  // re-render the tree.
  const running = ref(true);
  const propsRef = shallowRef({
    sessionId,
    messages,
    isRunning: true,
  });
  const Root = defineComponent({
    setup() {
      return (): VNode =>
        h(ChatTranscript, {
          sessionId: propsRef.value.sessionId,
          messages: propsRef.value.messages,
          isRunning: running.value,
        });
    },
  });
  const app = createApp(Root);
  app.config.errorHandler = (error) => {
    renderErrors.push(error);
  };
  app.use(i18n);
  // `ChatTranscript` reads the app store and the Pinia instance must be the
  // renderer's own (see `src/renderer/stores/pinia.ts`).
  app.use(rendererPinia);
  app.mount(host);
  initializeAppStore();

  const paint = () => {
    propsRef.value = {
      sessionId,
      messages: propsRef.value.messages,
      isRunning: running.value,
    };
  };
  const update = async (activity: AgentActivity | undefined) => {
    patchAppState({
      agentStatuses: {
        [sessionId]: {
          sessionId,
          isRunning: true,
          pendingToolConfirmations: 0,
          activity,
        },
      },
    });
    paint();
    await nextTick();
  };

  try {
    await update(undefined);
    await settle();
    // The webfonts are only requested once application text is rendered, so the
    // baseline is taken after the swap: font metrics decide the row heights.
    await document.fonts.ready;
    await settle();
    const atRest = snapshot();
    check(
      atRest.laneChildren === 1,
      `the fallback status was missing: ${JSON.stringify(atRest)}`,
    );
    check(
      Boolean(host.querySelector('[data-testid="working-indicator"]')),
      "the running turn did not show the fallback status",
    );
    check(
      (atRest.laneHeight ?? 0) > 0,
      "the status lane did not reserve a slot at rest",
    );
    // A transcript that never scrolled would hide the shift this scenario is
    // about, because pinned follow moves the rows only through `scrollTop`.
    check(
      atRest.firstRowTop !== null && atRest.lastRowBottom !== null,
      "the fixture rendered no message row to measure",
    );
    check(
      (atRest.scrollTop ?? 0) > 0,
      `the fixture transcript is not scrolled to its own bottom: ${JSON.stringify(atRest)}`,
    );

    // The lane itself stays transparent in either theme; only its status
    // content is painted.
    for (const theme of ["dark", "light"]) {
      document.documentElement.dataset.theme = theme;
      await frame();
      const element = lane();
      if (!element) {
        check(false, `${theme}: the status lane is missing`);
        continue;
      }
      const style = getComputedStyle(element);
      check(
        style.backgroundColor === "rgba(0, 0, 0, 0)",
        `${theme}: the empty status lane painted a background (${style.backgroundColor})`,
      );
      check(
        style.borderTopWidth === "0px" && style.borderBottomWidth === "0px",
        `${theme}: the empty status lane drew a border`,
      );
      check(
        style.boxShadow === "none",
        `${theme}: the empty status lane drew a shadow`,
      );
      check(
        element.getBoundingClientRect().height > 0,
        `${theme}: the empty status lane lost its reserve`,
      );
    }
    document.documentElement.dataset.theme = "dark";

    await update({ phase: "waiting-model", since: Date.now() });
    await settle();
    const waiting = snapshot();
    const activityIndicator = host.querySelector(
      '[data-testid="run-activity-indicator"]',
    );
    check(
      waiting.laneChildren === 1,
      `the waiting status did not take the reserved slot: ${JSON.stringify(waiting)}`,
    );
    check(Boolean(activityIndicator), "the waiting status row is missing");
    check(
      activityIndicator?.getAttribute("role") === "status" &&
        activityIndicator?.getAttribute("aria-live") === "polite",
      "the waiting status row lost its live-region semantics",
    );
    check(
      (waiting.laneText ?? "").trim().length > 0,
      "the waiting status row rendered no label",
    );
    compare("waiting for the model", waiting, atRest);

    await update(undefined);
    await settle();
    const cleared = snapshot();
    check(
      cleared.laneChildren === 1,
      "clearing the phase removed the running indicator",
    );
    check(
      Boolean(host.querySelector('[data-testid="working-indicator"]')),
      "clearing the phase did not restore the fallback",
    );
    compare("status cleared", cleared, atRest);

    running.value = false;
    paint();
    await nextTick();
    await settle();
    check(
      lane() === null,
      "an idle transcript still reserved the runtime status lane",
    );
    const compareEnd = (label: string, ended: Snap, active: Snap, pinned: boolean) => {
      // Ending restores the real toolbar; its height need not match the lane.
      // Unpinned readers must keep their text position despite that change.
      if (!pinned) {
        for (const field of ["scrollTop", "firstRowTop", "lastTextBottom"] as const) {
          const before = active[field];
          const after = ended[field];
          check(
            before !== null && after !== null && Math.abs(after - before) <= 0.01,
            `${label}: ${field} changed (${after} vs ${before})`,
          );
        }
      }
      const element = scroller();
      if (pinned && element) {
        check(
          Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop) <= 1,
          `${label}: lost pinned follow`,
        );
      }
    };
    compareEnd("pinned turn ends", snapshot(), cleared, true);

    running.value = true;
    paint();
    await nextTick();
    await settle();
    const scrollElement = scroller();
    if (scrollElement) {
      scrollElement.dispatchEvent(new WheelEvent("wheel", { deltaY: -120, bubbles: true }));
      scrollElement.scrollTop = Math.max(0, scrollElement.scrollTop - 120);
      scrollElement.dispatchEvent(new Event("scroll", { bubbles: true }));
    }
    await settle();
    const reading = snapshot();
    check(
      (reading.scrollTop ?? 0) < (cleared.scrollTop ?? 0),
      "fixture did not scroll up before stopping",
    );
    running.value = false;
    paint();
    await nextTick();
    await settle();
    compareEnd("scrolled-up turn ends", snapshot(), reading, false);
    check(
      renderErrors.length === 0,
      `Vue render failed: ${renderErrors.map(String).join("; ")}`,
    );

    return {
      ok: failures.length === 0,
      snapshots,
      idleLaneMounted: lane() !== null,
      failures,
    };
  } finally {
    app.unmount();
    host.remove();
    patchAppState({ agentStatuses: {} });
  }
}
