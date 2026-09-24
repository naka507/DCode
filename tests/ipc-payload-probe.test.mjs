/**
 * Contract for the provider IPC-payload regression probe.
 *
 * The bug: saving a new AI service showed `An object could not be cloned.`,
 * because the save payload carried the live elements of a `ref` array and
 * `ipcRenderer.invoke`'s `structuredClone` refuses a Vue proxy.
 *
 * The reason it shipped is worth pinning separately from the fix. The older
 * `scripts/e2e/provider-api-style.ts` probe already saved a provider, but it
 * stubbed the `api` object — *below* the IPC boundary — and then unwrapped
 * proxies with its own `unproxy` helper before calling `structuredClone`. That
 * helper removed exactly the proxies production code was still sending, so the
 * probe stayed green while the real bridge threw.
 *
 * These tests keep the new probe honest: it must stub `window.dcode.invoke`
 * (the real boundary) and must not carry a proxy-stripping helper of its own.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [runner, fixture, apiSource, payloadSource, packageJsonText] =
  await Promise.all([
    read("../scripts/e2e-provider-ipc-payload.mjs"),
    read("../scripts/e2e/provider-ipc-payload.ts"),
    read("../src/renderer/lib/api.ts"),
    read("../src/renderer/lib/ipc-payload.ts"),
    read("../package.json"),
  ]);
const packageJson = JSON.parse(packageJsonText);

test("the payload probe stubs the real IPC boundary, not the api object", () => {
  // `window.dcode.invoke` is the only renderer→main entry point; stubbing it
  // means every `api.*` call in the probe runs the production path.
  assert.match(
    fixture,
    /\.dcode = \{/,
    "the fixture must install the preload bridge itself",
  );
  assert.match(
    fixture,
    /structuredClone\(args\)/,
    "the fixture must apply the real structured clone to the argument list",
  );
  assert.doesNotMatch(
    fixture,
    /api\.\w+ = /,
    "stubbing `api.*` sits below the boundary and cannot catch this bug class",
  );
});

test("the payload probe does not carry its own proxy-stripping helper", () => {
  // The older fixture's `unproxy` is what hid the defect. A new helper with the
  // same effect would hide it again.
  assert.doesNotMatch(
    fixture,
    /function unproxy|unproxy\(/,
    "a proxy-stripping helper in the probe defeats the probe",
  );
  assert.doesNotMatch(
    fixture,
    /\btoRaw\b/,
    "the probe must let production code do the de-proxying",
  );
});

test("the probe asserts the user-visible banner, not just the call", () => {
  // The reported symptom is the dialog's own error text. Asserting only that
  // the call happened would pass on a payload that throws for another reason.
  assert.match(
    fixture,
    /\.provider-setup-error/,
    "the probe must read the dialog's error banner",
  );
  assert.match(
    fixture,
    /An object could not be cloned\./,
    "the probe must reproduce Electron's own wording",
  );
});

test("the runner is wired to a package script", () => {
  assert.equal(
    packageJson.scripts["test:e2e:provider-ipc-payload"],
    "node scripts/e2e-provider-ipc-payload.mjs",
  );
  assert.match(
    runner,
    /providerIpcPayloadProbe\(\)/,
    "the runner must call the fixture's probe",
  );
});

test("the production boundary de-proxies every argument", () => {
  // The fix lives at the single renderer→main exit, so a future call site
  // cannot reintroduce this by forgetting a helper.
  assert.match(
    apiSource,
    /const payload = args\.map\(toIpcPayload\);/,
    "lib/api.ts must run every IPC argument through toIpcPayload",
  );
  assert.match(
    apiSource,
    /window\.dcode\.invoke<T>\(channel, \.\.\.payload\)/,
    "the sanitised arguments are what must reach the bridge",
  );
});

test("the de-proxy helper does not trust Vue's data-visible duck-typing keys", () => {
  // `toRaw` reads an own `__v_raw` and recurses; `isRef` accepts any object with
  // a truthy `__v_isRef`. Payload data can contain those keys, so the helper
  // must not consult them — the behavioural proof is in `ipc-payload.test.mjs`.
  // Asserted against the import list, because the prose above explains why
  // `toRaw` is avoided and would otherwise satisfy the match itself.
  assert.doesNotMatch(
    payloadSource,
    /^import \{[^}]*\btoRaw\b[^}]*\} from "vue";$/m,
    "importing toRaw reintroduces the payload-visible `__v_raw` hijack",
  );
  assert.match(
    payloadSource,
    /function isReactiveRef\(value: object\): boolean \{\s*return isRef\(value\) && !isPlainObject\(value\);/,
    "a ref must be recognised by its prototype, not by `__v_isRef` alone",
  );
});

test("the de-proxy helper preserves types structuredClone supports", () => {
  // A JSON round-trip would corrupt `ComposerPasteFile.data` (an ArrayBuffer)
  // and turn a Date into a string, so only plain containers may be rebuilt.
  assert.match(
    payloadSource,
    /return source;/,
    "values the helper does not rebuild must pass through by reference",
  );
  assert.match(
    payloadSource,
    /const prototype = Object\.getPrototypeOf\(value\);/,
    "the plain-object test must read the real prototype",
  );
  // `Map` and `Set` ARE rebuilt, so a proxy reachable only through an entry is
  // stripped too.
  assert.match(payloadSource, /source instanceof Map/);
  assert.match(payloadSource, /source instanceof Set/);
});

test("the helper defines own properties rather than assigning them", () => {
  // `copy["__proto__"] = x` invokes the inherited setter, dropping the key and
  // replacing the copy's prototype. `structuredClone` defines an own property.
  assert.match(
    payloadSource,
    /Object\.defineProperty\(copy, key, \{/,
    "the copy must not go through the prototype setter for a `__proto__` key",
  );
});
