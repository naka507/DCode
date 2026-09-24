/**
 * Turn-process fixture (E2E-083) for the Vue renderer.
 *
 * The components are Vue 3 SFCs, so the probe is assembled with `createApp` /
 * `h` and the app's own vue-i18n instance (`src/renderer/i18n.ts`), exactly as
 * `scripts/e2e/transcript-disclosure-anchor.ts` does. Every check, every check
 * name and every failure string is unchanged, in the same order.
 *
 * Every adaptation is an API bridge, not a weakened check:
 *
 *  1. **State writes commit asynchronously.** `await nextTick()` is the way to
 *     await that commit, so `render()` and `click()` are `async` and every call
 *     site awaits them. `nextTick` resolves after Vue has
 *     flushed the render queue *and* its post-flush watchers, which is what
 *     makes the same assertions observable here.
 *  2. **The store's state reads and writes go through the module wrappers.**
 *     The Pinia store deliberately does not expose
 *     `getState()` on its public surface (`stores/app-store.ts`), so the
 *     fixture reads and writes through the two module-level wrappers the app
 *     itself uses. `initializeAppStore()` is called once before the first read,
 *     because the store commits its initial state lazily.
 *  3. **Render errors are caught by `app.config.errorHandler`.** The probe
 *     asserts the same thing: no render error escaped.
 *  4. **The app's own i18n instance is installed.** The catalogs are
 *     installed into the vue-i18n instance at import time
 *     (`src/renderer/i18n.ts`), so importing it is enough to get a working
 *     instance, and `t(key, params)` is `i18n.global.t(key, params)`
 *     because the instance is a global-scope instance (`legacy: false`).
 *  5. **The search target is provided, not passed down.** `provide` only works
 *     during a component's `setup`, so the provider is the fixture's root
 *     component and `AssistantTurn` is rendered *inside* it — the rows `inject`
 *     the target, so the provider has to be an ancestor (same move as note 2 in
 *     `transcript-disclosure-anchor.ts`). The provided value is a `Ref`, which is
 *     the type `provideTranscriptSearch(searchRef)` takes;
 *     `useTranscriptSearchTarget()` reads its
 *     `.value` when the row is set up, so — as in `TurnProcess.vue` — the target
 *     is the one current at that row's mount, and the `search` case below mounts
 *     the turn with its target already set.
 *  6. **The `key` on the child element is the vnode `key`.** Re-keying
 *     `<AssistantTurn key={key} … />` on every render matters because a
 *     different key at the same position unmounts and remounts, the same key
 *     patches in place and keeps the component's own state. Vue's patch decides
 *     identity the same way (`type` + `key`), so the fixture sets the case's key
 *     on the `AssistantTurn` vnode it returns and gets the same distinction —
 *     see the `render()` comment for the case that depends on it.
 *  7. **A store commit is synchronous; its DOM commit is one tick later.** The
 *     "mode changes update mounted history" case therefore awaits `nextTick()`
 *     after `patchAppState`. The assertion is unchanged: the *mounted* turn
 *     must react to the setting.
 *  8. **`ThinkingDisplayModeRow`'s props kept their names.** The SFC takes
 *     `settings` and `saveSettings` (`Partial<AppSettings>` patch, `Promise`).
 *  9. **`retryable: true` is `retriable: true` in the failure case's error
 *     payload.** `AppError` spells the field `retriable` (`src/shared/errors.ts`),
 *     so the literal object was already off-type; nothing reads either spelling
 *     and the case asserts the failure row's visibility, so the corrected name
 *     preserves the fixture's meaning.
 * 10. `t(key, "Fallback")` becomes `t(key)`: every key ships in the catalogs.
 */
import { createApp, defineComponent, h, nextTick, shallowRef } from "vue";
import { rendererPinia } from "../../src/renderer/stores/pinia";
import { i18n } from "../../src/renderer/i18n";
import AssistantTurn from "../../src/renderer/features/chat/transcript/AssistantTurn.vue";
import ThinkingDisplayModeRow from "../../src/renderer/components/settings/ThinkingDisplayModeRow.vue";
import {
  buildTranscriptEntries,
  type AssistantTurnEntry,
} from "../../src/renderer/lib/assistant-turns";
import { provideTranscriptSearch } from "../../src/renderer/lib/transcript-search-context";
import type { TranscriptSearchTarget } from "../../src/renderer/lib/transcript-reading";
import {
  currentAppState,
  initializeAppStore,
  patchAppState,
} from "../../src/renderer/stores/app-store";
import type { AppSettings, UiMessage } from "@dcode/shared";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const message = (
  id: string,
  role: UiMessage["role"],
  content: string,
  extra: Partial<UiMessage> = {},
): UiMessage => ({
  id,
  role,
  content,
  createdAt: "2026-09-17T00:00:00.000Z",
  ...extra,
});

/** Real mounted Vue components: disclosure ownership, preferences and search. */
export async function turnProcessProbe() {
  const container = document.createElement("div");
  document.body.append(container);
  const errors: unknown[] = [];
  /** The provided search target; a ref, so a new value reaches the mounted turn. */
  const searchRef = shallowRef<TranscriptSearchTarget | null>(null);
  /** The current `render(...)` case: the turn and the key it is mounted under. */
  const turn = shallowRef<{
    entry: AssistantTurnEntry;
    isActive: boolean;
    key: string;
  } | null>(null);
  /** The settings row that replaces the turn tree for the preferences case. */
  const settingsRow = shallowRef<{
    settings: AppSettings;
    saveSettings: (patch: Partial<AppSettings>) => Promise<void>;
  } | null>(null);

  /**
   * The root render step: an `I18nextProvider` wrapping a search-context
   * provider wrapping `AssistantTurn`, expressed as one root component.
   *
   * The root owns the provide (note 5) and returns the current case; returning a
   * different vnode type replaces the tree exactly as rendering a different
   * element type would.
   */
  const Fixture = defineComponent({
    name: "TurnProcessFixture",
    setup() {
      provideTranscriptSearch(searchRef);
      return () => {
        const current = turn.value;
        if (current) {
          return h(AssistantTurn, {
            key: current.key,
            entry: current.entry,
            isActive: current.isActive,
          });
        }
        const row = settingsRow.value;
        return row
          ? h(ThinkingDisplayModeRow, {
              settings: row.settings,
              saveSettings: row.saveSettings,
            })
          : null;
      };
    },
  });

  const app = createApp(Fixture);
  app.config.errorHandler = (error) => errors.push(error);
  app.use(i18n);
  // `AssistantTurn` and the settings row read the app store, so the fixture
  // needs the same Pinia instance the renderer entry point installs (see
  // `stores/pinia.ts`).
  app.use(rendererPinia);
  // The order matters: read the current settings, commit the fixture's own, then
  // create the root. `initializeAppStore()` is what makes the first read legal
  // (the store commits its initial state lazily), and the commit is synchronous
  // (note 2), so the first render already sees the fixture's settings.
  initializeAppStore();
  const initialSettings = currentAppState().settings;
  const settings: AppSettings = {
    defaultMode: "agent",
    theme: "light",
    enterToSend: true,
    onboardingDismissed: true,
  };
  patchAppState({ settings });
  app.mount(container);
  const notes: string[] = [];
  const check = (value: unknown, name: string) => {
    assert(value, name);
    notes.push(name);
  };
  /**
   * The render step for one turn case.
   *
   * The `key` is the key of the `AssistantTurn` vnode: Vue patches by `type` +
   * `key`, so a *different* key at the same
   * `key` meant: Vue patches by `type` + `key`, so a *different* key at the same
   * position unmounts the old instance and mounts a fresh one, while the *same*
   * key patches the existing instance in place and keeps the state it owns.
   * That distinction is load-bearing: the "manual disclosure survives
   * active-to-complete transition" case clicks the header (which `claim()`s the
   * disclosure) and then renders the same turn twice under the one
   * `compact-group` key, so the component instance — and the claim inside
   * `useAutomaticDisclosure` — is the one that survives the transition. A
   * remount per `render` call would reset the claim and fail that check.
   */
  const render = async (
    messages: UiMessage[],
    active = false,
    search: TranscriptSearchTarget | null = null,
    key = "turn",
  ) => {
    const entry = buildTranscriptEntries(messages).entries.find(
      (item) => item.kind === "assistant-turn",
    );
    assert(entry?.kind === "assistant-turn", "missing turn");
    searchRef.value = search;
    settingsRow.value = null;
    turn.value = { entry, isActive: active, key };
    await nextTick();
    assert(!errors.length, `render error: ${errors.map(String).join("; ")}`);
  };
  const header = () =>
    container.querySelector<HTMLButtonElement>(".turn-process > button");
  const process = () => container.querySelector<HTMLElement>(".turn-process-body");
  const visible = (element: Element | null) =>
    Boolean(element?.getBoundingClientRect().height);
  const click = async (element: HTMLElement | null) => {
    assert(element, "missing click target");
    element.click();
    await nextTick();
  };
  const intro = message("intro", "assistant", "Inspecting the files", {
    thinking: "reasoning detail",
    status: "complete",
  });
  const read = message("read", "tool", "read output", {
    toolName: "Read",
    toolCallId: "read-call",
    toolStatus: "success",
    toolArgs: { path: "src/example.ts" },
  });
  const progress = message("progress", "assistant", "Found the problem");
  const edit = message("edit", "tool", "edit output", {
    toolName: "Edit",
    toolCallId: "edit-call",
    toolStatus: "success",
    toolArgs: { path: "src/example.ts" },
  });
  const answer = message("answer", "assistant", "The fix is ready.", {
    status: "complete",
    createdAt: "2026-09-17T00:00:03.000Z",
    responseDurationMs: 1000,
  });
  const messages = [intro, read, progress, edit, answer];
  try {
    await render(messages);
    check(
      container.querySelectorAll(".turn-process").length === 0,
      "detailed does not wrap a process",
    );
    check(
      visible(container.querySelector('[data-message-id="answer"]')),
      "final answer stays visible",
    );
    check(
      visible(container.querySelector('[data-message-id="progress"]')),
      "detailed keeps intermediate progress visible",
    );
    check(
      container.querySelector('[data-message-id="edit"]')?.classList.contains("open") === true,
      "detailed opens the last tool",
    );
    check(
      container.querySelector('[data-message-id="read"]')?.classList.contains("open") !== true,
      "detailed keeps earlier tools collapsed",
    );
    check(
      container.querySelectorAll(".tool-row").length === 3,
      "detailed shows thinking and both tools in place",
    );
    await render(
      [intro, { ...read, toolStatus: "error", isError: true }, answer],
      false,
      null,
      "failed-last-tool",
    );
    check(
      container.querySelector('[data-message-id="read"]')?.classList.contains("open") !== true,
      "detailed keeps a last failed tool collapsed",
    );

    const streaming = message("stream", "assistant", "Live text", {
      status: "streaming",
    });
    await render([streaming], true, null, "stream");
    check(
      !header() && visible(container.querySelector('[data-message-id="stream"]')),
      "streamed answer is never delayed behind disclosure",
    );
    await render([streaming, read], true, null, "stream");
    check(
      !header() && visible(container.querySelector('[data-message-id="stream"]')),
      "detailed keeps streamed text visible after later tools",
    );
    await render([intro, read, { ...answer, status: "aborted" }], false, null, "aborted");
    check(
      visible(container.querySelector('[data-message-id="answer"]')),
      "stopped partial answer remains visible",
    );
    await render(
      [
        intro,
        read,
        // The literal payload uses `retryable: true`, but `AppError`
        // spells the field `retriable` (`src/shared/errors.ts`), so the object was
        // already off-type. Nothing reads either spelling — the case asserts the
        // failure row's visibility — so the corrected field name preserves the
        // fixture's meaning; see note 9.
        message("failure", "assistant", "", {
          error: { code: "INTERNAL", message: "Connection failed", retriable: true },
        }),
      ],
      false,
      null,
      "error",
    );
    check(
      visible(container.querySelector('[data-message-id="failure"]')),
      "failure remains visible",
    );

    patchAppState({
      settings: { ...settings, thinkingDisplayMode: "compact" },
    });
    await render(messages, false, null, "compact-group");
    check(
      container.querySelectorAll(".turn-process").length === 1,
      "one process per turn",
    );
    check(
      header()?.getAttribute("aria-expanded") === "false" && !visible(process()),
      "compact completed process starts collapsed",
    );
    check(
      container.querySelector('[data-message-id="edit"]')?.classList.contains("open") !== true,
      "compact keeps tool payloads collapsed",
    );
    check(
      header()?.textContent?.includes("4 steps"),
      "process counts tools and progress once",
    );
    await click(header());
    check(
      visible(container.querySelector('[data-message-id="progress"]')),
      "expanding reveals intermediate progress",
    );
    check(
      process()?.querySelectorAll(".tool-row").length === 2,
      "compact expanding retains both tools without thinking",
    );
    // Both renders use the `compact-group` key the click above happened under:
    // the mounted instance keeps its claimed disclosure across the transition
    // (see the `render()` comment).
    await render(messages, true, null, "compact-group");
    await render(messages, false, null, "compact-group");
    check(
      header()?.getAttribute("aria-expanded") === "true",
      "manual disclosure survives active-to-complete transition",
    );

    await render([intro, read], true, null, "live");
    check(
      header()?.getAttribute("aria-expanded") === "false",
      "compact live process stays collapsed without a tool failure",
    );
    await render(
      messages,
      false,
      { sessionId: "s", messageId: "progress", query: "problem", requestId: 1 },
      "search",
    );
    check(
      visible(container.querySelector('[data-message-id="progress"]')),
      "search reveals folded progress",
    );

    const liveThought = message("live-thought", "assistant", "", {
      thinking: "Reasoning before the answer",
      status: "streaming",
    });
    const processLabel = () =>
      container.querySelector(".tool-activity-label")?.textContent;
    await render([liveThought], true, null, "thinking-transition");
    check(
      processLabel()?.startsWith(i18n.global.t("chat.thinkingFor", { time: "" })),
      "active reasoning uses the thinking label",
    );
    await render(
      [{ ...liveThought, content: "Answer has started" }],
      true,
      null,
      "thinking-transition",
    );
    check(
      !header() &&
        visible(container.querySelector('[data-message-id="live-thought"]')),
      "answer streaming ends the thinking label even when reasoning is retained",
    );
    await render(
      [
        liveThought,
        message("separate-answer", "assistant", "Answer text", {
          status: "streaming",
        }),
      ],
      true,
      null,
      "thinking-transition",
    );
    check(
      processLabel()?.startsWith(i18n.global.t("chat.processingFor", { time: "" })),
      "a later answer takes precedence over an earlier streaming thought",
    );

    await render([streaming, read], true, null, "stream-compact");
    check(
      process()?.querySelector('[data-message-id="stream"]'),
      "later tool moves provisional text into process",
    );

    await render(
      [intro, { ...read, toolStatus: "error", isError: true }, answer],
      true,
      null,
      "tool-error",
    );
    check(
      header()?.getAttribute("aria-expanded") === "true" && visible(process()),
      "an active tool failure opens an unclaimed process",
    );

    let saved: Partial<AppSettings> | undefined;
    // The second render step, with a different element type: the turn tree is
    // replaced by the preferences row (and replaced back by the next
    // `render(...)` call below).
    settingsRow.value = {
      settings,
      saveSettings: async (patch) => {
        saved = patch;
        patchAppState({ settings: { ...settings, ...patch } });
      },
    };
    turn.value = null;
    await nextTick();
    await click(container.querySelector('button[aria-haspopup="listbox"]'));
    await click(
      Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(
        (item) => item.textContent === "Compact",
      ) ?? null,
    );
    check(
      saved?.thinkingDisplayMode === "compact",
      "settings control saves compact mode",
    );

    await render(
      [intro, { ...read, toolStatus: "error", isError: true }, answer],
      true,
      null,
      "compact-error",
    );
    check(
      header()?.getAttribute("aria-expanded") === "true" && visible(process()),
      "compact mode reveals an active tool failure",
    );

    const thought = message("thought", "assistant", "", {
      thinking: "hidden thinking words",
      status: "streaming",
    });
    await render([thought], true, null, "compact");
    check(
      Boolean(header()) && !container.textContent?.includes("hidden thinking words"),
      "compact live thinking has status without reasoning text",
    );
    await click(header());
    check(
      visible(container.querySelector(".thinking-compact")),
      "compact live thinking remains indicator-only when expanded",
    );
    await render([{ ...thought, status: "complete" }], false, null, "compact");
    check(
      !header() && !container.querySelector(".thinking"),
      "completed compact thinking leaves no empty process or thought block",
    );
    await render([{ ...thought, content: "Started answer" }], true, null, "compact");
    check(
      !container.querySelector(".thinking") &&
        visible(container.querySelector('[data-message-id="thought"]')),
      "compact thinking ends as soon as answer text starts",
    );
    await render(messages, false, null, "compact-tools");
    check(
      header()?.getAttribute("aria-expanded") === "false" && !visible(process()),
      "compact completed process starts collapsed",
    );
    await click(header());
    check(
      !container.querySelector(".thinking") &&
        process()?.querySelectorAll(".tool-row").length === 2,
      "compact keeps tools and progress accessible",
    );
    patchAppState({
      settings: { ...settings, thinkingDisplayMode: "detailed" },
    });
    // The store commit is synchronous; the mounted turn re-renders on the next
    // flush (note 7).
    await nextTick();
    check(
      Boolean(container.querySelector(".thinking")),
      "mode changes update mounted history",
    );
    check(
      messages[0].thinking === "reasoning detail",
      "presentation never deletes reasoning data",
    );
    return { ok: true, checks: notes };
  } finally {
    app.unmount();
    patchAppState({ settings: initialSettings });
    container.remove();
  }
}
