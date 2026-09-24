/**
 * Transcript render fixture (E2E-083) for the Vue renderer.
 *
 * The components are Vue 3 SFCs, so the probes are assembled with `createApp` /
 * `h` and the app's own vue-i18n instance (`src/renderer/i18n.ts`), exactly as
 * `scripts/e2e/transcript-disclosure-anchor.ts` does. This file is the esbuild
 * entry's counterpart: it defines the two globals the runner calls and
 * delegates the other two scenarios to their own modules.
 *
 * Every adaptation is an API bridge, not a weakened check:
 *
 *  1. **State writes commit asynchronously.** `await nextTick()` is the way to
 *     await that commit, so `render()` is `async`.
 *     Every assertion still observes the committed DOM: `nextTick` is what
 *     makes that true.
 *
 *  2. **The render-count contract is what the fixture has to get right, and
 *     this is the load-bearing part.** Vue has no memo comparator — it skips a
 *     child when `hasPropsChanged` finds every prop identical by `Object.is`,
 *     which is shallow, so a fresh `items` array defeats it and every one of the
 *     100 unchanged groups re-renders while the live tail token changes.
 *     Measured, not assumed: fed straight from `buildTranscriptEntries` the same
 *     20-update loop renders the groups 2000 times, not 0.
 *
 *     The guarantee is `reuseTranscriptEntries` (`lib/assistant-turns.ts`),
 *     which keeps object identity for unchanged rows and which the real
 *     `useTranscriptScroll` calls. This fixture therefore routes its entries
 *     through that function, the way the app does. The assertions are unchanged
 *     and still fail loudly (2000 !== 0) if that guarantee regresses.
 *
 *  3. **Render errors are caught by `app.config.errorHandler`.** The probe
 *     asserts the same thing: no render error escaped.
 *
 *  4. **The app's own i18n instance is installed via `app.use(i18n)`.** The
 *     catalogs are installed into the vue-i18n instance at import time
 *     (`src/renderer/i18n.ts`), so importing it is enough to get a working
 *     instance.
 */
import { createApp, defineComponent, h, nextTick, shallowRef, type VNode } from "vue";
import { rendererPinia } from "../../src/renderer/stores/pinia";
import { i18n } from "../../src/renderer/i18n";
import AssistantTurn from "../../src/renderer/features/chat/transcript/AssistantTurn.vue";
import {
  buildTranscriptEntries,
  reuseTranscriptEntries,
  type TranscriptEntry,
} from "../../src/renderer/lib/assistant-turns";
import { initializeAppStore } from "../../src/renderer/stores/app-store";
import type { UiMessage } from "@dcode/shared";
import { transcriptRuntimeSlotProbe } from "./transcript-runtime-slot";
import { transcriptStatusProbe } from "./transcript-status";
import { turnProcessProbe } from "./turn-process";

declare global {
  var __activityGroupRenders: string[];
  var transcriptRenderProbe: () => Promise<unknown>;
  var transcriptRuntimeSlotProbe: () => Promise<unknown>;
}

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const createdAt = "2026-09-13T00:00:00.000Z";
const message = (
  id: string,
  role: UiMessage["role"],
  content: string,
  extra: Partial<UiMessage> = {},
): UiMessage => ({ id, role, content, createdAt, ...extra });

/** Real Vue DOM + production transcript components; no component/hook mocks. */
globalThis.transcriptRenderProbe = async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const renderErrors: unknown[] = [];
  const entryRef = shallowRef<TranscriptEntry | null>(null);
  const Root = defineComponent({
    setup() {
      return (): VNode | null =>
        entryRef.value
          ? h(AssistantTurn, { entry: entryRef.value, isActive: true })
          : null;
    },
  });
  const app = createApp(Root);
  app.config.errorHandler = (error) => {
    renderErrors.push(error);
  };
  app.use(i18n);
  // `AssistantTurn` reads the app store, so the fixture needs the same Pinia
  // instance the renderer entry point installs (see `stores/pinia.ts`).
  app.use(rendererPinia);
  app.mount(host);
  initializeAppStore();

  /**
   * The `root.render(<AssistantTurn entry={entry} isActive />)` step.
   *
   * The entry is taken from the identity-preserving list, which is what lets an
   * unchanged `ActivityGroup` keep its props — see note 2 in the file header.
   */
  let previousEntries: TranscriptEntry[] | undefined;
  const render = async (messages: UiMessage[]) => {
    const built = buildTranscriptEntries(messages).entries;
    previousEntries = reuseTranscriptEntries(previousEntries, built);
    const entry = previousEntries.find((item) => item.kind === "assistant-turn");
    assert(entry?.kind === "assistant-turn", "assistant turn missing");
    entryRef.value = entry;
    await nextTick();
    assert(
      renderErrors.length === 0,
      `Vue render failed: ${renderErrors.map(String).join("; ")}`,
    );
  };
  try {
    const groups = 100;
    let messages: UiMessage[] = [message("user", "user", "Inspect the workspace")];
    for (let index = 0; index < groups; index++) {
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
    await render(messages);
    globalThis.__activityGroupRenders = [];
    const startedAt = performance.now();
    for (let update = 0; update < 20; update++) {
      messages = [...messages];
      messages[messages.length - 1] = {
        ...messages[messages.length - 1]!,
        content: `Streaming fragment ${update}`,
        status: "streaming",
      };
      await render(messages);
    }
    const textUpdateRenders = globalThis.__activityGroupRenders.length;
    const textUpdateDurationMs = performance.now() - startedAt;
    assert(
      host.textContent?.includes("Streaming fragment 19"),
      `streaming tail did not update: ${host.textContent?.slice(-500)}, renders=${textUpdateRenders}`,
    );
    assert(
      textUpdateRenders === 0,
      `${groups} unchanged activity groups rendered ${textUpdateRenders} times across 20 text updates`,
    );

    globalThis.__activityGroupRenders = [];
    messages = [...messages];
    messages[1] = {
      ...messages[1]!,
      toolArgs: { command: "printf changed-command" },
    };
    await render(messages);
    assert(
      globalThis.__activityGroupRenders.join(",") === "tool-0",
      "changed tool group did not render exactly once",
    );
    assert(
      host.textContent?.includes("changed-command"),
      "changed tool row not visible",
    );

    // Keep Task's own message stable: a later lifecycle result must still
    // update its terminal status and timing (#238), unlike unrelated text.
    const start = Date.now() - 12_000;
    const task = message("task", "tool", "started", {
      toolName: "Task",
      toolCallId: "task-call",
      toolStatus: "success",
      toolArgs: { agent: "explorer", task: "Inspect a module" },
      toolResult: {
        details: {
          delegationId: "delegate",
          status: "running",
          startedAt: start,
        },
      },
    });
    let lifecycle = message("wait", "tool", "running", {
      toolName: "TaskWait",
      toolCallId: "wait-call",
      toolStatus: "success",
      toolResult: {
        details: {
          delegations: [
            { delegationId: "delegate", status: "running", startedAt: start },
          ],
        },
      },
    });
    const taskMessages = () => [
      message("user", "user", "Delegate"),
      task,
      message("between", "assistant", "Waiting"),
      lifecycle,
      message("tail", "assistant", "Continuing"),
    ];
    await render(taskMessages());
    assert(
      host.querySelector(".has-subagents")?.classList.contains("active"),
      "running Task group is not active",
    );
    globalThis.__activityGroupRenders = [];
    lifecycle = {
      ...lifecycle,
      content: "completed",
      toolResult: {
        details: {
          delegations: [
            {
              delegationId: "delegate",
              status: "completed",
              startedAt: start,
              completedAt: start + 2_000,
            },
          ],
        },
      },
    };
    await render(taskMessages());
    assert(
      globalThis.__activityGroupRenders.includes("task"),
      "Task group ignored a lifecycle status update",
    );
    const topology = host.querySelector(".has-subagents");
    const taskDuration = () =>
      host
        .querySelector(".has-subagents .subagent-activity-metrics")
        ?.textContent?.split("·")
        .at(-1)
        ?.trim();
    assert(
      taskDuration() === "2s",
      "Task completion timing did not update to 2s",
    );
    assert(
      !topology?.classList.contains("active"),
      "completed Task group is still active",
    );

    globalThis.__activityGroupRenders = [];
    lifecycle = {
      ...lifecycle,
      toolResult: {
        details: {
          delegations: [
            {
              delegationId: "delegate",
              status: "completed",
              startedAt: start,
              completedAt: start + 4_000,
            },
          ],
        },
      },
    };
    await render(taskMessages());
    assert(
      globalThis.__activityGroupRenders.includes("task"),
      "Task group ignored a timing-only update",
    );
    assert(
      taskDuration() === "4s",
      "Task completion timing did not update to 4s",
    );

    const statusLifecycle = await transcriptStatusProbe();
    return {
      ok: statusLifecycle.ok,
      statusLifecycle,
      groups,
      textUpdates: 20,
      textUpdateRenders,
      changedToolRenders: 1,
      taskLifecycleUpdated: true,
      taskTimingUpdated: true,
      turnProcess: await turnProcessProbe(),
      textUpdateDurationMs,
    };
  } finally {
    app.unmount();
    host.remove();
  }
};

/**
 * Real `ChatTranscript` in a real viewport: the tail runtime status (issue
 * #323) must come and go without changing the geometry of the transcript that
 * is already on screen. Registered here because the runner calls it as the
 * second global; the scenario itself lives in `./transcript-runtime-slot`.
 */
globalThis.transcriptRuntimeSlotProbe = transcriptRuntimeSlotProbe;
