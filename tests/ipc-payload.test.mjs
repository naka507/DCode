/**
 * The renderer→main bridge must survive Vue reactivity.
 *
 * `ipcRenderer.invoke` serialises its arguments with `structuredClone`, and a
 * Vue `ref`/`reactive` value is a `Proxy` that `structuredClone` refuses. The
 * failure mode is nasty: it is a runtime `DataCloneError` with Chromium's own
 * text (`An object could not be cloned.`), raised before any main-process
 * handler runs, and invisible to the type system — `models.value` is typed
 * `ModelBinding[]` and the value that crosses the bridge is a proxy.
 *
 * These tests drive the real `src/renderer/lib/api.ts` against a real
 * `structuredClone` boundary (a stand-in for `ipcRenderer.invoke`), so the
 * assertion is the one that matters: does the argument graph actually clone?
 */
import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));

const { isProxy, reactive, readonly, ref } = await import("vue");
const { toIpcPayload } = await import("../src/renderer/lib/ipc-payload.ts");

/**
 * Import `api.ts` with a fake `window.dcode.invoke` whose boundary enforces the
 * same rule Electron does. Returns the api surface plus the captured calls.
 */
async function loadApi() {
  const calls = [];
  globalThis.window = {
    dcode: {
      invoke: async (channel, ...args) => {
        // The real boundary. Anything `structuredClone` rejects would throw in
        // `ipcRenderer.invoke` exactly like this.
        const cloned = structuredClone(args);
        calls.push({ channel, args, cloned });
        return { ok: true, data: null };
      },
    },
  };
  const { api } = await import("../src/renderer/lib/api.ts");
  return { api, calls };
}

test("a ref array handed to an IPC call is de-proxied before it crosses the bridge", async () => {
  const { api, calls } = await loadApi();

  const binding = { id: "gpt-4o", thinkingLevels: ["low", "high"] };
  const models = ref([binding]);

  // The shape the settings dialog used to send: a fresh array whose elements
  // were read through the ref, so each element was still a proxy.
  const persisted = models.value.map((entry) => entry);
  assert.equal(
    isProxy(persisted[0]),
    true,
    "the fixture must reproduce the bug: the element is a proxy",
  );

  await api.createProvider({
    name: "Custom",
    vendorKey: "custom",
    type: "openai_compatible",
    protocol: "openai_compatible",
    baseUrl: "https://api.example.com/v1",
    authKind: "api_key_and_base_url",
    models: persisted,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].channel, "dcode/providers/create");
  // The call got past `structuredClone`, which is the whole point.
  assert.deepEqual(calls[0].cloned[0].models, [
    { id: "gpt-4o", thinkingLevels: ["low", "high"] },
  ]);
});

test("reactivity is stripped at any depth, including through nested containers", () => {
  const state = reactive({
    level: { deep: { list: [{ id: "a" }] } },
    array: [{ nested: [{ id: "b" }] }],
  });

  const payload = toIpcPayload({ state });
  assert.equal(isProxy(payload.state), false);
  assert.equal(isProxy(payload.state.level.deep.list[0]), false);
  assert.equal(isProxy(payload.state.array[0].nested[0]), false);
  assert.deepEqual(structuredClone(payload), {
    state: {
      level: { deep: { list: [{ id: "a" }] } },
      array: [{ nested: [{ id: "b" }] }],
    },
  });
});

test("a proxied ArrayBuffer keeps its type and its bytes", () => {
  // `ComposerPasteFile.data` is an ArrayBuffer, so a JSON-based sanitiser would
  // corrupt the payload; only plain containers may be rebuilt.
  const buffer = new ArrayBuffer(4);
  new Uint8Array(buffer).set([7, 8, 9, 10]);
  const files = reactive([{ name: "a.txt", data: buffer }]);

  const payload = toIpcPayload({ files });
  assert.equal(payload.files[0].data instanceof ArrayBuffer, true);
  assert.deepEqual([...new Uint8Array(payload.files[0].data)], [7, 8, 9, 10]);
  assert.doesNotThrow(() => structuredClone(payload));
});

test("Date, Map, Set and class instances pass through unchanged", () => {
  class Marker {
    constructor() {
      this.tag = "marker";
    }
  }
  const date = new Date("2026-09-22T00:00:00Z");
  const map = new Map([["k", "v"]]);
  const set = new Set([1, 2]);
  const instance = new Marker();
  const state = reactive({ date, map, set, instance });

  const payload = toIpcPayload({ state });
  assert.equal(payload.state.date instanceof Date, true);
  assert.equal(payload.state.date.getTime(), date.getTime());
  assert.equal(payload.state.map instanceof Map, true);
  assert.equal(payload.state.set instanceof Set, true);
  assert.equal(payload.state.instance instanceof Marker, true);
});

test("cycles stay finite and shared references stay shared", () => {
  const node = { name: "root" };
  node.self = node;
  const shared = { id: "shared" };

  const payload = toIpcPayload({ node, a: shared, b: shared });
  assert.equal(payload.node.self, payload.node);
  assert.equal(payload.a, payload.b);
  assert.doesNotThrow(() => structuredClone(payload));
});

test("keys holding undefined are preserved, not dropped", () => {
  // A JSON round-trip would drop `secretValue` and change the payload.
  const payload = toIpcPayload({ name: "x", secretValue: undefined });
  assert.deepEqual(Object.keys(payload), ["name", "secretValue"]);
});

test("the payload no longer aliases the caller's reactive state", () => {
  const models = ref([{ id: "m", thinkingLevels: ["low"] }]);
  const payload = toIpcPayload({ models: models.value.map((entry) => entry) });

  payload.models[0].id = "mutated";
  assert.equal(models.value[0].id, "m", "the ref must not observe the payload");
});

test("primitives and empty calls pass straight through", () => {
  assert.equal(toIpcPayload("session-id"), "session-id");
  assert.equal(toIpcPayload(42), 42);
  assert.equal(toIpcPayload(null), null);
  assert.equal(toIpcPayload(undefined), undefined);
  assert.doesNotThrow(() => toIpcPayload(undefined));
});

test("a nested ref is unwrapped too, not only a reactive proxy", () => {
  // `toRaw` unwraps a reactive proxy but leaves a `ref` object alone, and a ref
  // is not cloneable either. A ref stored inside a state object would otherwise
  // still throw on its way across the bridge.
  const inner = ref({ deep: 1 });
  const payload = toIpcPayload({ mid: reactive({ inner }) });
  assert.equal(isProxy(payload.mid), false);
  assert.deepEqual(structuredClone(payload), { mid: { inner: { deep: 1 } } });
});

test("a benign non-Vue proxy is unwrapped as well", () => {
  // Vue is not the only source of proxies; the boundary must not care.
  const proxy = new Proxy({ a: 1, nested: { b: 2 } }, {});
  assert.throws(() => structuredClone({ proxy }), /could not be cloned/);
  assert.doesNotThrow(() => structuredClone(toIpcPayload({ proxy })));
});

test("a payload key that looks like Vue internals is treated as data", () => {
  // `toRaw` would read this own `__v_raw` and substitute the object it points
  // at, silently dropping `other`. Payload data can contain the key (any
  // JSON-shaped setting can), so the helper must never consult it.
  const spoofed = { __v_raw: { a: 1 }, other: 2 };
  const payload = toIpcPayload({ spoofed });
  assert.deepEqual(structuredClone(payload), {
    spoofed: { __v_raw: { a: 1 }, other: 2 },
  });

  // A self-referential `__v_raw` makes `toRaw` recurse forever.
  const selfReferential = { other: 3 };
  selfReferential.__v_raw = selfReferential;
  assert.doesNotThrow(() => structuredClone(toIpcPayload({ selfReferential })));

  // `isRef` is duck-typed too; a plain object with the flag must stay data.
  const spoofedRef = { __v_isRef: true, other: 4 };
  assert.deepEqual(structuredClone(toIpcPayload({ spoofedRef })), {
    spoofedRef: { __v_isRef: true, other: 4 },
  });
});

test("a proxy reachable only through a Map or Set is still stripped", () => {
  // Pass-through containers would carry the proxy to `structuredClone`, which
  // throws the very error this module exists to prevent.
  const inner = reactive({ a: 1 });
  const viaMap = toIpcPayload({ map: new Map([["k", inner]]) });
  const viaSet = toIpcPayload({ set: new Set([inner]) });
  assert.doesNotThrow(() => structuredClone(viaMap));
  assert.doesNotThrow(() => structuredClone(viaSet));
  assert.equal(viaMap.map instanceof Map, true);
  assert.equal(viaSet.set instanceof Set, true);
  assert.deepEqual(viaMap.map.get("k"), { a: 1 });
  assert.deepEqual([...viaSet.set], [{ a: 1 }]);
});

test("a cycle through a rebuilt container survives", () => {
  const map = new Map();
  const holder = { map };
  map.set("holder", holder);
  const payload = toIpcPayload({ holder });
  assert.equal(payload.holder.map.get("holder"), payload.holder);
  assert.doesNotThrow(() => structuredClone(payload));
});

test("a __proto__ key stays an own property of the copy", () => {
  // `copy["__proto__"] = x` would invoke the inherited setter and drop the key.
  const withProto = JSON.parse('{"__proto__": {"polluted": true}, "safe": 1}');
  const payload = toIpcPayload({ withProto });
  assert.equal(Object.getPrototypeOf(payload.withProto), Object.prototype);
  assert.equal(
    Object.prototype.hasOwnProperty.call(payload.withProto, "__proto__"),
    true,
  );
  assert.equal(payload.withProto.safe, 1);
  assert.doesNotThrow(() => structuredClone(payload));
});

test("a proxied plain object answers the plain-object test", () => {
  // The rebuild branch is what makes this module work, and it relies on Vue's
  // proxy forwarding its target's prototype. If a future Vue stops doing that,
  // this fails rather than silently leaking proxies to the bridge.
  assert.equal(Object.getPrototypeOf(reactive({ a: 1 })), Object.prototype);
  assert.equal(Object.getPrototypeOf(readonly({ a: 1 })), Object.prototype);
  // A real `ref` must NOT look plain, or `isReactiveRef` would never fire.
  assert.notEqual(Object.getPrototypeOf(ref({ a: 1 })), Object.prototype);
});
