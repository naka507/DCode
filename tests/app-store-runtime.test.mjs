/**
 * The composed app store's runtime contract.
 *
 * `tests/helpers/store-source.mjs` reads the store tree as *text*, which pins
 * the wiring's shape but executes none of it. These tests import the real
 * module, so the pieces the Pinia migration introduced — the lazy instance, the
 * initial commit, the synchronous listener fan-out and the raw-payload
 * guarantee — are actually run.
 *
 * The fan-out contract matters most: the pre-migration facade used a plain
 * `Set.forEach`, so a throwing reconcile listener propagated to the `setState`
 * caller and the boot error handling could react. Vue's `watch` would instead
 * swallow the throw in production builds, so this suite pins the propagating
 * behaviour.
 */
import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));

const { useAppStore, initializeAppStore, currentAppState, patchAppState } =
  await import("../src/renderer/stores/app-store.ts");
const { rendererPinia } = await import("../src/renderer/stores/pinia.ts");

test("the store builds a complete initial state on first use", () => {
  initializeAppStore();
  const state = currentAppState();
  assert.ok(state, "initializeAppStore() must commit a state object");
  assert.equal(state.ready, false, "the pre-bootstrap value");
  assert.equal(state.page, "chat");
  assert.deepEqual(state.messages, []);
  // One member from each slice, to prove every factory contributed.
  for (const member of [
    "newSession", // session-slice
    "sendPrompt", // queue-slice
    "compactContext", // transcript-slice
    "openProject", // project-slice
    "refreshProviders", // catalog-slice
    "handleAgentEvent", // events-slice
    "resolvePermission", // interaction-slice
    "openWorkPanelTabForSession", // work-panel-slice
    "navigateTranscript", // transcript-reading runtime
  ]) {
    assert.equal(typeof state[member], "function", `missing action ${member}`);
  }
});

test("initializeAppStore is idempotent and shares one instance", () => {
  initializeAppStore();
  const first = currentAppState();
  initializeAppStore();
  assert.strictEqual(currentAppState(), first, "a second call must not rebuild");
  assert.strictEqual(
    useAppStore(rendererPinia).appState,
    first,
    "the store instance must be a singleton",
  );
});

test("setState merges, publishes a new object, and keeps the skip contract", () => {
  initializeAppStore();
  const before = currentAppState();
  patchAppState({ ready: true });
  const after = currentAppState();
  assert.notStrictEqual(after, before, "a commit must publish a new object");
  assert.equal(after.ready, true);
  assert.equal(after.page, "chat", "unrelated members survive the merge");

  // An updater returning the current state means "no change".
  patchAppState((state) => state);
  assert.strictEqual(currentAppState(), after, "returning the current state is a no-op");
});

test("listeners fan out synchronously, in order, and can unsubscribe", () => {
  const store = useAppStore(rendererPinia);
  const order = [];
  const stopA = store.subscribe((state) => order.push(`a${state.unreadNotificationCount}`));
  const stopB = store.subscribe((state) => order.push(`b${state.unreadNotificationCount}`));
  store.setState({ unreadNotificationCount: 1 });
  assert.deepEqual(order, ["a1", "b1"], "synchronous, registration order");
  stopA();
  stopB();
  store.setState({ unreadNotificationCount: 2 });
  assert.deepEqual(order, ["a1", "b1"], "a stopped listener must not run again");
});

test("a throwing listener reaches the caller instead of being swallowed", () => {
  const store = useAppStore(rendererPinia);
  const stop = store.subscribe(() => {
    throw new Error("reconcile failed");
  });
  assert.throws(
    () => store.setState({ unreadNotificationCount: 77 }),
    /reconcile failed/,
    "the pre-migration Set.forEach semantics must be preserved",
  );
  stop();
});

test("subscribers receive the raw previous object for identity comparison", () => {
  const store = useAppStore(rendererPinia);
  let previousSeen;
  const stop = store.subscribe((_state, previous) => {
    previousSeen = previous;
  });
  const before = store.appState;
  store.setState({ ready: false });
  stop();
  assert.strictEqual(previousSeen, before, "previous must be the exact prior object");
});

test("the state payload stays raw so Electron IPC can clone it", () => {
  initializeAppStore();
  const state = currentAppState();
  // A deep proxy would make these throw "could not be cloned".
  assert.doesNotThrow(() => structuredClone(state.messages));
  assert.doesNotThrow(() => structuredClone({ sessions: state.sessions }));
  assert.doesNotThrow(() => structuredClone(state.retainedTranscripts));
});

test("a component reads the store reactively through store.appState", async () => {
  const { createSSRApp, defineComponent, h } = await import("vue");
  const { renderToString } = await import("vue/server-renderer");
  initializeAppStore();
  patchAppState({ unreadNotificationCount: 31 });

  const Probe = defineComponent({
    setup() {
      const store = useAppStore();
      // `store.appState` is the tracked read; `getState()` deliberately is not
      // on the returned surface, because an untracked read would never re-render.
      return () => h("span", String(store.appState?.unreadNotificationCount));
    },
  });
  const app = createSSRApp(Probe);
  app.use(rendererPinia);
  assert.match(await renderToString(app), />31</);
});
