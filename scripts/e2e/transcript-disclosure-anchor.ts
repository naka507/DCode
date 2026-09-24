/**
 * Transcript disclosure-anchor fixture (issue #324) for the Vue renderer.
 *
 * The components are Vue 3 SFCs, so the probe is assembled with `createApp` /
 * `h` and the app's own vue-i18n instance (`src/renderer/i18n.ts`). What the
 * fixture proves is unchanged: it is a geometry assertion — the clicked title's
 * offset from the scroller's top edge, and the scroll offset, before and after a
 * real DOM click on the disclosure.
 *
 * Every adaptation is an API bridge, not a weakened check:
 *
 *  1. **State writes commit asynchronously.** `await nextTick()` is the way to
 *     await that commit, needed only to make a fresh mount measurable before the
 *     first `settle()`; the settle sequence itself (three 40 ms ticks, one for
 *     the observer-driven layout and one for the follow frame) is unchanged, so
 *     every timing assertion keeps its meaning.
 *     component *ancestor* of the rows, because the rows `inject` it, so this
 *     fixture wraps them in a `setup()` that calls the provider and returns the
 *     slot — the Vue equivalent of the same tree.
 *  3. **Render errors are caught by `app.config.errorHandler`.** The probe
 *     asserts the same thing: no render
 *     error escaped.
 *     takes DOM listeners under their native names, so the attribute is the
 *     same object key a JSX prop would be.
 *  5. **`useTranscriptScroll`'s options are `MaybeRefOrGetter`.** The fixture
 *     passes the same literal values; a plain value is a valid getter input.
 *     `useFollowScroll()` takes no arguments in either case.
 */
import { createApp, defineComponent, h, nextTick, type PropType, type VNode } from "vue";
import { rendererPinia } from "../../src/renderer/stores/pinia";
import { i18n } from "../../src/renderer/i18n";
import AssistantTurnModule from "../../src/renderer/features/chat/transcript/AssistantTurn.vue";
import ToolRow from "../../src/renderer/features/chat/transcript/ToolRow.vue";
import { buildTranscriptEntries } from "../../src/renderer/lib/assistant-turns";
import { provideDisclosureAnchorNotifier } from "../../src/renderer/lib/disclosure-anchor-context";
import { initializeAppStore, patchAppState } from "../../src/renderer/stores/app-store";
import { useTranscriptScroll } from "../../src/renderer/features/chat/transcript/hooks/useTranscriptScroll";
import { useFollowScroll } from "../../src/renderer/hooks/use-follow-scroll";
import type { UiMessage } from "@dcode/shared";
import type { App as VueApp } from "vue";

declare global {
  var transcriptDisclosureProbe: () => Promise<unknown>;
}

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const createdAt = "2026-09-16T00:00:00.000Z";

function message(
  id: string,
  role: UiMessage["role"],
  content: string,
  extra: Partial<UiMessage> = {},
): UiMessage {
  return { id, role, content, createdAt, ...extra };
}

/** A tool row whose opened body is far taller than its own header. */
function toolRowMessage(id: string): UiMessage {
  return message(id, "tool", "done", {
    toolName: "Bash",
    toolCallId: `call-${id}`,
    toolStatus: "success",
    toolArgs: { command: "printf 'step'" },
    toolResult: {
      details: {
        stdout: Array.from({ length: 80 }, (_value, index) => `step ${index}`).join(
          "\n",
        ),
        exitCode: 0,
      },
    },
  });
}

type Geometry = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  /** The clicked title's top, relative to the scroller's own top edge. */
  titleTop: number;
  distanceFromBottom: number;
};

function geometry(scroller: HTMLElement, title: HTMLElement): Geometry {
  const scrollerTop = scroller.getBoundingClientRect().top;
  return {
    scrollTop: scroller.scrollTop,
    scrollHeight: scroller.scrollHeight,
    clientHeight: scroller.clientHeight,
    titleTop: title.getBoundingClientRect().top - scrollerTop,
    distanceFromBottom:
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight,
  };
}

/** Three ticks: one for the observer-driven layout, one for the follow frame. */
async function settle() {
  for (let tick = 0; tick < 3; tick += 1) {
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}

/**
 * The transcript scroller's own DOM, with the real hook driving it: the real
 * ResizeObserver, follow mode and disclosure hold, in a real 600 CSS px
 * viewport. Only the app's stylesheet is left out, so the geometry comes from
 * inline sizes and the real components' intrinsic height.
 *
 * A `setup()` returning a render function is what makes the hook run *inside*
 * the component instance: `onMounted` and `watch` register against the instance
 * that is current at that moment. Note 2
 * still holds — the rows `inject` the notifier, so it is provided here, by the
 * same component that owns the scroller.
 */
const TranscriptFixture = defineComponent({
  props: {
    messages: { type: Array as PropType<UiMessage[]>, required: true },
    process: { type: Boolean, default: false },
  },
  setup(props) {
    const entry = props.process
      ? buildTranscriptEntries(props.messages).entries.find(
          (item) => item.kind === "assistant-turn",
        )
      : undefined;
    const {
      scrollRef,
      wrapRef,
      contentRef,
      handleScroll,
      disclosureAnchorNotifier,
    } = useTranscriptScroll({
      sessionId: "fixture",
      messages: props.messages,
      hasMoreBefore: false,
      isRunning: false,
      askPending: false,
      approvalPending: false,
      paneVisible: true,
      searchTarget: null,
      readingWindow: false,
    });
    provideDisclosureAnchorNotifier(disclosureAnchorNotifier);
    return () =>
      h(
        "div",
        {
          ref: wrapRef,
          class: "thread-wrap",
          style: { height: "100%", position: "relative" },
        },
        [
          h(
            "div",
            {
              ref: scrollRef,
              class: "thread-scroll",
              "data-scroll-owner": "transcript",
              onScroll: handleScroll,
              style: { height: "100%", overflowY: "auto" },
            },
            [
              h("div", { ref: contentRef, class: "thread-content" }, [
                h("div", { style: { height: "700px" } }),
                entry?.kind === "assistant-turn"
                  ? h(AssistantTurnModule, { entry, isActive: false })
                  : h(ToolRow, { message: props.messages[1]! }),
                h("div", { style: { height: "300px" } }),
              ]),
            ],
          ),
        ],
      );
  },
});

/** The nested dock scroller (D302), driven by its own follow hook. */
const FollowFixture = defineComponent({
  props: { tool: { type: Object as PropType<UiMessage>, required: true } },
  setup(props) {
    const { scrollRef, contentRef, handleScroll, disclosureAnchorNotifier } =
      useFollowScroll();
    provideDisclosureAnchorNotifier(disclosureAnchorNotifier);
    return () =>
      h(
        "div",
        {
          ref: scrollRef,
          class: "subagent-run-rows",
          "data-scroll-owner": "follow",
          onScroll: handleScroll,
          style: { height: "300px", overflowY: "auto" },
        },
        [
          h("div", { ref: contentRef }, [
            h("div", { style: { height: "320px" } }),
            h(ToolRow, { message: props.tool }),
            h("div", { style: { height: "200px" } }),
          ]),
        ],
      );
  },
});

globalThis.transcriptDisclosureProbe = async () => {
  const host = document.createElement("div");
  host.style.width = "700px";
  document.body.append(host);
  const renderErrors: unknown[] = [];
  const apps: Array<{ unmount: () => void }> = [];

  const mount = (node: () => VNode) => {
    const container = document.createElement("div");
    container.style.height = "600px";
    container.style.width = "640px";
    host.append(container);
    const app: VueApp = createApp({ render: node });
    app.config.errorHandler = (error) => {
      renderErrors.push(error);
      // The probe records this error; a bare window has no dev overlay, so it
      // also goes to the console the runner reads.
      console.error("TRANSCRIPT_DISCLOSURE_RENDER_ERROR", error);
    };
    app.use(i18n);
    // `ToolRow` reads the app store (`useAppStore`), so the fixture needs the
    // same Pinia instance the renderer entry point installs (see
    // `src/renderer/stores/pinia.ts`). Without it `useAppStore()` throws during
    // setup and the row renders as an empty comment node.
    app.use(rendererPinia);
    app.mount(container);
    apps.push(app);
    return container;
  };

  try {
    const tool = toolRowMessage("tool");
    const container = mount(() =>
      h(TranscriptFixture, {
        messages: [message("user", "user", "Inspect the workspace"), tool],
      }),
    );
    await nextTick();
    const scroller = container.querySelector<HTMLElement>(".thread-scroll");
    const title = container.querySelector<HTMLElement>(".tool-row-header");
    assert(scroller, "the transcript scroller did not render");
    assert(
      title,
      `the tool title did not render: ${container.innerHTML.slice(0, 1500)}`,
    );

    await settle();
    const before = geometry(scroller, title);
    assert(
      Math.abs(before.distanceFromBottom) < 1,
      `the transcript did not start pinned to the bottom: ${JSON.stringify(before)}`,
    );
    assert(
      before.scrollTop > 0 && before.titleTop >= 0 && before.titleTop < 600,
      `the clicked title is not on screen: ${JSON.stringify(before)}`,
    );

    // A plain click on the title, exactly as a reader expands a tool row.
    title.click();
    await settle();
    const expanded = geometry(scroller, title);
    assert(
      expanded.scrollHeight > before.scrollHeight + 100,
      `the disclosure did not change the height, so nothing was measured: ${JSON.stringify({ before, expanded })}`,
    );
    assert(
      Math.abs(expanded.titleTop - before.titleTop) < 2,
      `expanding the tool moved the clicked title by ${expanded.titleTop - before.titleTop}px: ${JSON.stringify({ before, expanded })}`,
    );
    assert(
      expanded.scrollTop <= before.scrollTop + 2,
      `expanding the tool re-bottomed the transcript: ${JSON.stringify({ before, expanded })}`,
    );

    title.click();
    await settle();
    const collapsed = geometry(scroller, title);
    assert(
      Math.abs(collapsed.titleTop - before.titleTop) < 2,
      `collapsing the tool moved the clicked title by ${collapsed.titleTop - before.titleTop}px: ${JSON.stringify({ before, collapsed })}`,
    );
    assert(
      Math.abs(collapsed.scrollTop - before.scrollTop) < 2,
      `collapsing the tool moved the transcript by ${collapsed.scrollTop - before.scrollTop}px: ${JSON.stringify({ before, collapsed })}`,
    );

    const dockContainer = mount(() =>
      h(FollowFixture, { tool: toolRowMessage("dock") }),
    );

    await nextTick();
    const dockScroller = dockContainer.querySelector<HTMLElement>(
      ".subagent-run-rows",
    );
    const dockTitle = dockContainer.querySelector<HTMLElement>(
      ".tool-row-header",
    );
    assert(dockScroller, "the dock scroller did not render");
    assert(dockTitle, "the dock tool title did not render");
    await settle();
    const dockBefore = geometry(dockScroller, dockTitle);
    assert(
      Math.abs(dockBefore.distanceFromBottom) < 1,
      `the dock did not start pinned to the bottom: ${JSON.stringify(dockBefore)}`,
    );
    dockTitle.click();
    await settle();
    const dockExpanded = geometry(dockScroller, dockTitle);
    assert(
      dockExpanded.scrollHeight > dockBefore.scrollHeight + 100,
      "the dock disclosure did not change the height",
    );
    assert(
      Math.abs(dockExpanded.titleTop - dockBefore.titleTop) < 2,
      `expanding the dock moved its own title by ${dockExpanded.titleTop - dockBefore.titleTop}px: ${JSON.stringify({ dockBefore, dockExpanded })}`,
    );
    assert(
      dockExpanded.scrollTop <= dockBefore.scrollTop + 2,
      "expanding the dock re-bottomed the dock scroller",
    );
    // `TurnProcess` only renders in Compact mode: `21fd93ff` ("keep detailed
    // turns ungrouped") gated it on `shouldGroupTurnProcess`, after this case
    // was written. The case still exercises the unconditional `TurnProcess`, so
    // the fixture seeds the setting rather than silently measuring nothing.
    initializeAppStore();
    patchAppState((state) => ({
      settings: { ...state.settings, thinkingDisplayMode: "compact" },
    }));
    const processContainer = mount(() =>
      h(TranscriptFixture, {
        process: true,
        messages: [
          message("process-user", "user", "Inspect"),
          message(
            "progress",
            "assistant",
            Array.from({ length: 50 }, (_, i) => `Progress paragraph ${i}.`).join(
              "\n\n",
            ),
          ),
          toolRowMessage("process-tool"),
          message("final", "assistant", "Finished."),
        ],
      }),
    );
    await nextTick();
    const processScroller = processContainer.querySelector<HTMLElement>(".thread-scroll");
    const processTitle = processContainer.querySelector<HTMLElement>(".turn-process > button");
    assert(processScroller && processTitle, "process fixture did not render");
    await settle();
    const processBefore = geometry(processScroller, processTitle);
    processTitle.click();
    await settle();
    const processExpanded = geometry(processScroller, processTitle);
    assert(processExpanded.scrollHeight > processBefore.scrollHeight + 100, "process did not expand");
    assert(Math.abs(processExpanded.titleTop - processBefore.titleTop) < 2, "process expansion moved its title");
    processTitle.click();
    await settle();
    const processCollapsed = geometry(processScroller, processTitle);
    assert(Math.abs(processCollapsed.titleTop - processBefore.titleTop) < 2, "process collapse moved its title");
    assert(renderErrors.length === 0, `render errors: ${renderErrors.map(String).join("; ")}`);
    return {
      ok: true,
      process: { before: processBefore, expanded: processExpanded, collapsed: processCollapsed },
      transcript: { before, expanded, collapsed },
      dock: { before: dockBefore, expanded: dockExpanded },
    };
  } finally {
    for (const app of apps) app.unmount();
    host.remove();
  }
};
