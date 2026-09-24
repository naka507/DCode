/**
 * Strip Vue reactivity from an outbound IPC argument.
 *
 * `ipcRenderer.invoke` serialises its arguments with `structuredClone`, and a
 * Vue `ref`/`reactive` value is a `Proxy`, which `structuredClone` refuses:
 *
 *     const models = ref([{ id: "gpt-4o" }]);
 *     structuredClone({ models: models.value });  // DataCloneError
 *
 * That is a runtime failure the type system cannot see. `models.value` is typed
 * `ModelBinding[]`, the element is typed `ModelBinding`, and the value that
 * actually crosses the bridge is a proxy. The error the user gets is Chromium's
 * own — `An object could not be cloned.` — because it is raised inside
 * `ipcRenderer.invoke`, before any main-process handler runs.
 *
 * ## Why the containers are rebuilt
 *
 * `toRaw` unwraps only the value it is handed. The usual shape here is a *fresh*
 * array built by `.map()` over a `ref`, so the array is already plain and only
 * its elements are proxies:
 *
 *     toRaw(persisted)     // still holds proxied elements — throws
 *     toRaw(models.value)  // works, but only because the whole array is still
 *                          // the ref's own value
 *
 * Rebuilding each container does not depend on how the caller assembled the
 * argument.
 *
 * ## Why `toRaw` is deliberately not used
 *
 * `toRaw` and `isRef` are **duck-typed on data-visible keys** — `toRaw` reads an
 * own `__v_raw` and recurses, and `isRef` accepts any object with a truthy
 * `__v_isRef`. Payload data can contain those keys (any JSON-shaped setting can),
 * and then `toRaw` would silently substitute the wrong object — losing sibling
 * keys, or recursing forever on a self-referential `__v_raw`. The helpers here
 * read no such key: a plain object is copied property by property whatever its
 * keys are, and a `ref` is recognised by its prototype (`RefImpl`), never by
 * `__v_isRef` alone. `tests/ipc-payload.test.mjs` pins both facts.
 *
 * ## What is preserved
 *
 * Plain objects, arrays, `Map` and `Set` are rebuilt, so a proxy anywhere inside
 * them is gone by construction. Everything else is passed through by reference,
 * so the types `structuredClone` supports keep their identity and their type:
 * `ArrayBuffer` (a `ComposerPasteFile.data` is one, and JSON-copying it would
 * corrupt it), `Date`, `RegExp`, typed arrays, and class instances with a
 * meaningful prototype. A `Date` stays a `Date` rather than becoming an ISO
 * string.
 *
 * Cycles and repeated references are handled with the `seen` map, so a payload
 * that references one object twice still arrives referencing one object twice,
 * which is what `structuredClone` would have done on its own. Keys whose value is
 * `undefined` are copied as-is, because `structuredClone` keeps them; a
 * `JSON.parse(JSON.stringify(...))` round-trip would drop them.
 *
 * ## Scope
 *
 * This covers the renderer's own IPC: every `api.*` call in `lib/api.ts`, which
 * is the only path this renderer uses. The plugin-panel window has a separate
 * preload (`src/preload/plugin-panel.ts`) for plugin-authored pages, which are
 * not Vue and do not reach `lib/api.ts`; its payloads are not sanitised here.
 *
 * The copy is unconditional, so an already-plain payload is traversed and
 * rebuilt before `ipcRenderer.invoke` clones it again. That is a deliberate
 * trade: the alternative is a second traversal to detect reactivity, and
 * correctness at the boundary is worth more than one extra pass.
 */
import { isRef } from "vue";

/**
 * A container this helper rebuilds, as opposed to one it passes through.
 *
 * Vue's reactive and readonly proxies report their target's prototype through
 * the proxy trap, so a proxied plain object answers `true` here — which is what
 * lets the same branch handle both a plain value and a proxied one.
 * `tests/ipc-payload.test.mjs` asserts that property directly, so a future Vue
 * that stops forwarding the prototype fails loudly instead of leaking proxies.
 */
function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * A real `ref`, as opposed to a plain object that carries an `__v_isRef` key.
 * A ref's prototype is `RefImpl` (or a computed's), never `Object.prototype`.
 */
function isReactiveRef(value: object): boolean {
  return isRef(value) && !isPlainObject(value);
}

/**
 * The same value, with every plain container rebuilt as a plain
 * (non-reactive) one. Non-plain values are passed through by reference.
 *
 * `seen` maps an already-copied source object to its copy, which is what keeps
 * cycles finite and preserves shared references.
 */
function toPlain(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (value === null || typeof value !== "object") return value;

  // Order matters: the ref test must not swallow a plain object that merely has
  // an `__v_isRef` key, and an array must be recognised before the object test.
  if (isReactiveRef(value)) return toPlain((value as { value: unknown }).value, seen);

  const source = value as object;
  const existing = seen.get(source);
  if (existing !== undefined) return existing;

  if (Array.isArray(source)) {
    const copy: unknown[] = [];
    seen.set(source, copy);
    for (const item of source) copy.push(toPlain(item, seen));
    return copy;
  }

  if (isPlainObject(source)) {
    const copy: Record<string, unknown> = {};
    seen.set(source, copy);
    for (const [key, item] of Object.entries(source)) {
      // `copy[key] = item` would invoke the inherited `__proto__` setter for
      // that one key, dropping it and replacing the copy's prototype.
      // `structuredClone` defines an own property instead, so this does too.
      Object.defineProperty(copy, key, {
        value: toPlain(item, seen),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return copy;
  }

  // Map and Set are rebuilt so a proxy reachable only through one of their
  // entries is still stripped; `structuredClone` supports both, and neither
  // keeps its subclass through a clone, so a plain rebuild matches.
  if (source instanceof Map) {
    const copy = new Map<unknown, unknown>();
    seen.set(source, copy);
    for (const [key, item] of source) {
      copy.set(toPlain(key, seen), toPlain(item, seen));
    }
    return copy;
  }

  if (source instanceof Set) {
    const copy = new Set<unknown>();
    seen.set(source, copy);
    for (const item of source) copy.add(toPlain(item, seen));
    return copy;
  }

  return source;
}

/**
 * Prepare one argument for `ipcRenderer.invoke`.
 *
 * Applied to every argument rather than only to object-shaped ones: a primitive
 * costs one `typeof` check, and a rule that only inspects objects is a rule
 * somebody has to remember to apply.
 */
export function toIpcPayload<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  return toPlain(value, new WeakMap()) as T;
}
