/**
 * Provider drag/drop fixture for the Vue renderer.
 *
 * The components are Vue 3 SFCs, so the probe is assembled with `createApp` /
 * `h` and the app's own vue-i18n instance (`src/renderer/i18n.ts`). What the
 * probe proves is unchanged: provider order is written through the production
 * IPC surface to a real Rust host, and the drag, the keyboard move, the
 * cancelled drag, the failed save, the late catalog reply and the composer
 * model menu all observe that order.
 *
 * Every adaptation is an API bridge, not a weakened check:
 *
 *  1. **State writes commit asynchronously.** `await nextTick()` is the way to
 *     await that commit, used wherever a just-written state has to be visible
 *     before the next DOM read (the composer menu's two clicks).
 *  2. **Render errors are caught by `app.config.errorHandler`.** The probe
 *     asserts the same thing: no render error escaped.
 *  3. **The store's state reads and writes go through the module wrappers.**
 *     See `stores/app-store.ts`: state is published through `appState`, and
 *     `setState` merges. Restoring a captured snapshot is equivalent because
 *     the snapshot is a complete state object.
 *  4. **`useComposerModelMenu` options are `MaybeRefOrGetter`.** The fixture
 *     passes the same values; a computed provider is a valid getter input, which
 *     is what keeps the menu following the store.
 *  5. **`i18n.changeLanguage("zh-CN")` is `i18n.global.locale.value = "zh-CN"`**
 *     plus a tick, because the catalogs are installed at import time.
 */
import { computed, createApp, defineComponent, h, nextTick } from "vue";
import { i18n } from "../../src/renderer/i18n";
import { rendererPinia } from "../../src/renderer/stores/pinia";
import ModelConfigPage from "../../src/renderer/components/settings/ModelConfigPage.vue";
import ComposerModelPicker from "../../src/renderer/features/chat/composer/ComposerModelPicker.vue";
import { useComposerModelMenu } from "../../src/renderer/features/chat/composer/hooks/useComposerModelMenu";
import {
  currentAppState,
  initializeAppStore,
  patchAppState,
  useAppStore,
} from "../../src/renderer/stores/app-store";
import { api } from "../../src/renderer/lib/api";
import { cardReorderPerformance } from "./card-reorder-performance";

declare global {
  var providerOrderProbe: (restart?: boolean) => Promise<unknown>;
  var cardReorderPerformance: () => unknown;
}

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const painted = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function until(
  condition: () => boolean,
  message: string | (() => string),
) {
  const deadline = performance.now() + 5000;
  while (!condition() && performance.now() < deadline) await painted();
  assert(condition(), typeof message === "function" ? message() : message);
}

/**
 * The composer's model menu, mounted next to the settings page so a reorder
 * made in one is observable in the other. The first enabled provider is selected
 * out of the store; here the same read is a `computed`, and the menu options
 * take it as a getter.
 */
const ModelMenu = defineComponent({
  name: "ProviderOrderModelMenu",
  setup() {
    const store = useAppStore();
    const provider = computed(() =>
      store.appState?.providers.find((item) => item.enabled),
    );
    const controller = useComposerModelMenu({
      mode: "agent",
      activeSessionId: null,
      provider,
      modelId: computed(() => provider.value?.defaultModelId),
      thinkingProvider: provider,
      thinkingLevel: "off",
      controlsBlocked: false,
    });
    return () =>
      h(ComposerModelPicker, {
        controller,
        modelLabel: "Fixture",
        thinkingLabel: "off",
        thinkingLevel: "off",
        controlsBlocked: false,
        onCloseOtherMenus: () => {},
      });
  },
});

const Root = defineComponent({
  name: "ProviderOrderRoot",
  setup() {
    return () => h("div", [h(ModelConfigPage), h(ModelMenu)]);
  },
});

globalThis.providerOrderProbe = async (restart = false) => {
  const host = document.createElement("div");
  host.style.cssText = "width: 850px; margin: 24px;";
  document.body.append(host);
  const errors: unknown[] = [];
  const app = createApp(Root);
  app.config.errorHandler = (error) => {
    errors.push(error);
    console.error("PROVIDER_ORDER_RENDER_ERROR", error);
  };
  // `app.use(rendererPinia)` has to run before the composed store is built, so
  // Pinia's plugin queue is flushed first (see `stores/app-store.ts`).
  app.use(rendererPinia);
  app.use(i18n);
  initializeAppStore();
  const previous = currentAppState();

  const rows = () =>
    Array.from(host.querySelectorAll<HTMLElement>(".model-provider-row"));
  const names = () =>
    rows()
      .map(
        (entry) => entry.querySelector(".model-provider-row-name")?.textContent,
      )
      .join(",");
  const row = (name: string) =>
    rows().find(
      (entry) =>
        entry.querySelector(".model-provider-row-name")?.textContent === name,
    )!;
  const settled = (expected: string) =>
    until(
      () =>
        names() === expected &&
        row(expected.split(",")[0]).getAttribute("aria-disabled") !== "true",
      () => `provider order did not settle at ${expected}: ${names()}`,
    );
  const drag = async (from: string, to: string, after: boolean, drop = true) => {
    const source = row(from);
    const initial = source.getBoundingClientRect();
    const target = row(to);
    const rect = target.getBoundingClientRect();
    const x = initial.left + initial.width / 2;
    const y = initial.top + initial.height / 2;
    const clientY = after ? rect.bottom - 1 : rect.top + 1;
    source.dispatchEvent(
      new PointerEvent("pointerdown", {
        pointerId: 1,
        button: 0,
        clientX: x,
        clientY: y,
        bubbles: true,
      }),
    );
    window.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: 1,
        clientX: x + 12,
        clientY,
        bubbles: true,
        cancelable: true,
      }),
    );
    await painted();
    assert(
      source.style.transform.includes("translate("),
      "the whole card must follow the pointer",
    );
    assert(
      target.style.transform.includes("translateY"),
      "surrounding cards must make room before dropping",
    );
    assert(
      names() ===
        currentAppState()
          .providers.map((item) => item.name)
          .join(","),
      "drag preview must not persist before release",
    );
    window.dispatchEvent(
      new PointerEvent(drop ? "pointerup" : "pointercancel", {
        pointerId: 1,
        clientX: x + 12,
        clientY,
        bubbles: true,
      }),
    );
    await painted();
  };
  const key = (name: string, keyName: string) =>
    row(name).dispatchEvent(
      new KeyboardEvent("keydown", {
        key: keyName,
        bubbles: true,
        cancelable: true,
      }),
    );
  const realReorder = api.reorderProviders;
  const realList = api.listProviders;
  try {
    await currentAppState().refreshProviders();
    app.mount(host);
    await until(() => rows().length === 3, "configured provider rows missing");
    assert(errors.length === 0, `render failed: ${errors.map(String)}`);
    if (restart) {
      assert(
        names() === "B,C,A",
        "saved provider order did not survive host and renderer restart",
      );
      return { ok: true, restart: true };
    }
    assert(
      names() === "A,B,C",
      "legacy providers should retain creation order",
    );
    assert(
      !host.querySelector(".model-provider-reorder"),
      "cards should not display a separate drag handle",
    );
    const original = currentAppState().providers;
    const start = row("A").getBoundingClientRect();
    row("A").dispatchEvent(
      new PointerEvent("pointerdown", {
        pointerId: 3,
        button: 0,
        clientX: start.left + 50,
        clientY: start.top + 10,
        bubbles: true,
      }),
    );
    window.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: 3,
        clientX: start.left + 52,
        clientY: start.top + 12,
        bubbles: true,
      }),
    );
    assert(
      !host.querySelector(".is-dragging"),
      "small click movement must not start dragging",
    );
    window.dispatchEvent(
      new PointerEvent("pointerup", { pointerId: 3, bubbles: true }),
    );

    const action = row("B").querySelector<HTMLButtonElement>(
      ".model-provider-row-actions button",
    )!;
    action.dispatchEvent(
      new PointerEvent("pointerdown", { pointerId: 2, button: 0, bubbles: true }),
    );
    window.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: 2,
        clientX: 100,
        clientY: 100,
        bubbles: true,
      }),
    );
    assert(
      !host.querySelector(".is-dragging"),
      "action buttons must not start card dragging",
    );
    window.dispatchEvent(
      new PointerEvent("pointerup", { pointerId: 2, bubbles: true }),
    );

    const defaultProviderId = currentAppState().settings?.defaultProviderId;
    await drag("C", "A", false, false);
    assert(
      names() === "A,B,C" && !host.querySelector(".is-dragging"),
      "cancelled drag changed order or left an indicator",
    );
    await drag("C", "A", false);
    await settled("C,A,B");
    await drag("C", "B", true);
    await settled("A,B,C");
    key("C", "ArrowUp");
    await settled("A,C,B");
    for (const provider of currentAppState().providers) {
      assert(
        JSON.stringify(provider) ===
          JSON.stringify(original.find((item) => item.id === provider.id)),
        "sorting changed a provider configuration",
      );
    }
    assert(
      currentAppState().settings?.defaultProviderId === defaultProviderId,
      "sorting changed the default provider",
    );

    // An older catalog read cannot undo the refresh following an accepted move.
    let releaseOld: (() => void) | undefined;
    const staleList = await realList();
    api.listProviders = () =>
      new Promise((resolve) => {
        releaseOld = () => resolve(staleList);
      });
    const oldRefresh = currentAppState().refreshProviders();
    api.listProviders = realList;
    await drag("B", "A", false);
    await settled("B,A,C");
    releaseOld!();
    await oldRefresh;
    assert(names() === "B,A,C", "late catalog response reverted a saved order");

    api.reorderProviders = async () => {
      throw new Error("fixture write failed");
    };
    const toastCount = currentAppState().toasts.length;
    await drag("C", "B", false);
    await until(
      () => currentAppState().toasts.length > toastCount,
      "failed save must show an error",
    );
    await settled("B,A,C");
    api.reorderProviders = realReorder;
    await settled("B,A,C");

    let release: (() => void) | undefined;
    let calls = 0;
    api.reorderProviders = async (input) => {
      calls += 1;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return realReorder(input);
    };
    key("A", "ArrowDown");
    key("B", "ArrowDown");
    assert(calls === 1, "overlapping moves must be blocked until saving finishes");
    release!();
    await settled("B,C,A");
    api.reorderProviders = realReorder;

    const scrollTail = document.createElement("div");
    scrollTail.style.height = "300px";
    host.append(scrollTail);
    host.style.height = "220px";
    host.style.overflowY = "auto";
    host.scrollTop +=
      row("C").getBoundingClientRect().top - host.getBoundingClientRect().top;
    await painted();
    const bounds = host.getBoundingClientRect();
    const scrollBefore = host.scrollTop;
    row("C").dispatchEvent(
      new PointerEvent("pointerdown", {
        pointerId: 4,
        button: 0,
        clientX: bounds.left + 50,
        clientY: bounds.top + 20,
        bubbles: true,
      }),
    );
    window.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: 4,
        clientX: bounds.left + 50,
        clientY: bounds.bottom - 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await until(
      () => host.scrollTop > scrollBefore,
      () => `edge scroll did not advance: ${scrollBefore} -> ${host.scrollTop}`,
    );
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    // The commit the dispatch needs before the layout assertion below.
    await nextTick();
    assert(
      !host.querySelector(".is-dragging") && names() === "B,C,A",
      "Escape must restore the accepted layout",
    );
    const stoppedAt = host.scrollTop;
    await painted();
    await painted();
    assert(
      host.scrollTop === stoppedAt,
      "cancelling must stop automatic scrolling",
    );
    scrollTail.remove();
    host.style.height = "";
    host.style.overflowY = "";
    host.scrollTop = 0;
    await painted();

    i18n.global.locale.value = "zh-CN";
    await nextTick();
    await painted();
    assert(
      row("B").getAttribute("aria-label")?.includes("拖动"),
      "card reorder instruction must follow the interface language",
    );
    // The two clicks have to be visible in one turn, hence the tick between them.
    document
      .querySelector<HTMLButtonElement>(".composer-model-thinking-chip")!
      .click();
    await nextTick();
    document.querySelector<HTMLButtonElement>(".composer-menu-entry")!.click();
    await nextTick();
    await until(
      () => document.querySelectorAll(".composer-model-group").length === 3,
      "model menu groups missing",
    );
    const groups = Array.from(
      document.querySelectorAll(".composer-model-group"),
      (group) => group.getAttribute("aria-label"),
    );
    assert(
      groups.join(",") === "B,C,A",
      `composer model menu did not follow provider order: ${groups}`,
    );
    assert(errors.length === 0, `render errors: ${errors.map(String)}`);
    return {
      ok: true,
      drag: true,
      keyboard: true,
      cancelledDrag: true,
      failedSave: true,
      staleRefresh: true,
      modelMenu: true,
    };
  } finally {
    api.reorderProviders = realReorder;
    api.listProviders = realList;
    app.unmount();
    host.remove();
    patchAppState(previous);
  }
};

globalThis.cardReorderPerformance = cardReorderPerformance;
