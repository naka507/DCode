# dcode architecture

`dcode` is a shipped desktop agent application, version `1.0.0`
(`package.json`, agreed by `APP_VERSION` in `src/shared/protocol.ts`).

This document records the parts of the architecture that are not recoverable
from reading a single file: the process model, the ownership boundaries, the
load-bearing properties of the renderer that have each been broken once
already, and the packaging and asset contracts whose failure modes are
invisible to every gate. It is the first document to read when a path looks
unfamiliar.

The renderer's sidebar/project slice hand-off notes are in the `Renderer`
section below, next to the state-container contract they depend on.

---

## What this repository is

The Electron shell, the Vue 3 renderer, the agent runtime, the host bridge,
and the plugin SDK live in one tree under `src/`. The privileged native host
(`DCore`) is a standalone native component (see [Host boundary](#host-boundary-dcode-and-native-host)).

```text
src/main/              Electron main process, IPC, bootstrap, plugin runtime
src/preload/           preload bridge (index, plugin-panel)
src/renderer/          Vue 3 renderer (see Renderer)
src/agent/runtime/     pi sidecar wrapper (bundled by `npm run build:sidecar`)
src/agent/host/        headless Agent Host module (admission, queue, approvals, events)
src/engine/            Electron-independent execution engine (transports, supervisor, turn lifecycle)
src/racp/              RACP-WS server/client and device pairing
src/shared/            IPC/protocol contracts, error codes
src/i18n/              UI catalogs (`en`, `zh-CN`)
src/plugin/sdk/        plugin author types/validators
src/plugin/devkit/     pi-plugin CLI
resources/             skills, plugins, models.dev catalogs
scripts/               repository automation, E2E drivers, gates
tests/                 test suites (`node --test` and vitest) and helpers
build/ patches/        packaging assets, applied patches
```

`npm` owns the JS packages. There is no workspace: `package-lock.json` is the
lockfile, and `pnpm-workspace.yaml` is not the package manager. Toolchain:
Node ≥ 22.19.

## Process model and ownership

Frozen process model:

```text
Renderer
   ↓
Preload IPC
   ↓
Electron Main
   ↓
Rust Host Core / Node Agent Runtime
   ↓
pi-ai / pi-agent-core
```

Ownership:

```text
Renderer       = UI and interaction
Electron Main  = thin orchestrator
Rust Host Core = persistence and authoritative host/native state
Agent Runtime  = agent execution
Plugin SDK     = extension contract
Shared         = cross-boundary contracts and schemas
```

Mandatory boundaries:

* Renderer must not access SQLite directly.
* Renderer must not depend on Electron Main implementation internals.
* SQLite is owned exclusively by Rust host-core.
* Agent execution must not move into the renderer.
* Electron Main must remain a thin orchestrator.
* `src/shared/` must not depend on main-process implementation code.
* Plugin permission and sandbox boundaries must not be bypassed.

Changing a frozen architecture, public interface, data ownership model, or
security boundary requires a recorded decision. This repository keeps no
separate `docs/adr/` tree: the decision is recorded in this document, next
to the constraint it explains.

---

## Renderer

The renderer is Vue 3. `src/renderer/App.vue` is the root: the crash boundary
(`features/app/chrome/ErrorBoundary.vue`) wraps `features/app/AppShell.vue`, so
a render failure in any surface replaces the window with the boundary's report
instead of a blank page.

```text
App.vue, main.ts
components/            surfaces and primitives
features/              app, chat, plugins, sessions, settings
pages/                 route pages
hooks/ lib/ capture/   framework-neutral modules and the automation surface
stores/                Pinia store: app-store.ts, slices/, runtime/
styles/                stylesheet partials, sequenced by globals.css
assets/ i18n.ts index.html
```

### The state container is Pinia

`src/renderer/stores/app-store.ts` is a Pinia setup store composed from eight
state slices (`stores/slices/*-slice.ts`) and eight runtimes
(`stores/runtime/`). Two properties are load-bearing and must not be
"simplified" away:

1. **The payload is a `shallowRef`, never `ref` / `reactive`.** A deep proxy
   makes every state object unreachable to `structuredClone`, which is what
   Electron's IPC serializer uses, so any `api.*` call handing a state-derived
   object across the bridge would throw `could not be cloned`. A shallow ref
   keeps the flat object raw while still notifying `watch` / `computed` when a
   commit replaces it, and keeps the reference-identity comparisons the
   reconciliation runtimes rely on (`state.messages === previous.messages`)
   exact.

2. **Listener fan-out is a plain `Set`, not `watch`.** `watch` routes its
   callback through Vue's `callWithAsyncErrorHandling`, which rethrows in
   development but only `console.error`s in production. A throwing reconcile
   listener would then be swallowed and the `setState` caller would carry on as
   if the commit had succeeded, which breaks the boot error handling.
   `Set.forEach` semantics — synchronous, a throw reaching the caller — are
   what the boot error handling depends on, and are reproduced verbatim.

Components read the store through `store.appState` (or `storeToRefs`), which
tracks the ref:

```ts
const store = useAppStore();
// tracked:
const page = computed(() => store.appState?.page);
```

`getState()` is deliberately not on the returned surface: a plain method call
is not tracked, so `useAppStore().getState().messages` would never re-render.
It stays a module-level helper for the slices, which are not reactive
consumers. Framework-free modules reach the same state through the
`currentAppState()` / `patchAppState()` wrappers in `app-store.ts`.

The store instance is created on first use, not at module scope. Pinia applies
plugins at store-creation time, and `pinia.use(...)` calls made before
`app.use(pinia)` sit in a "to be installed" queue that is only flushed during
`app.use`; a module-scope instantiation would create the store before that
flush and no plugin (including Pinia's own devtools action timeline) would
apply. `initializeAppStore()` in `main.ts` performs that first use.

The shallow ref is coarse: any commit re-renders every consumer. If a surface
gets expensive, split a finer-grained store rather than adding memoization.

### The IPC payload boundary

A Vue `ref` / `reactive` value is a `Proxy`, and `structuredClone` — which
`ipcRenderer.invoke` uses to serialise its arguments — refuses a proxy. The
failure is `An object could not be cloned.`: Chromium's own `DataCloneError`,
raised inside the bridge before any main-process handler runs, which is why it
is not one of the app's own error codes. The type system cannot see it —
`models.value` is typed `ModelBinding[]` and the element handed to the bridge
was typed `ModelBinding`, so nothing in the renderer type-checked wrong.

There is exactly one boundary: `invoke()` in `src/renderer/lib/api.ts` runs
every outbound argument through `toIpcPayload`
(`src/renderer/lib/ipc-payload.ts`). Every `api.*` call goes through it, so a
new call site cannot reintroduce the class of failure by omission.

`toIpcPayload` is a deep copy of plain containers, not `toRaw`:

* `toRaw` unwraps only the value it is handed. The usual shape is a fresh array
  built by `.map()` over a ref — the array is already plain and only its
  elements are proxies, so a single `toRaw` on the array does nothing.
* `toRaw` and `isRef` are duck-typed on data-visible keys (`__v_raw`,
  `__v_isRef`). Payload data can contain those keys, and then `toRaw` would
  silently substitute the wrong object. The helpers here read no such key.
* Only plain objects, arrays, `Map` and `Set` are rebuilt. `ArrayBuffer`,
  `Date`, `RegExp`, typed arrays and class instances pass through by
  reference, because a JSON round-trip would corrupt the `ArrayBuffer` in
  `ComposerPasteFile.data` and turn a `Date` into a string. Keys holding
  `undefined` survive, which a JSON round-trip would drop.
* Cycles and repeated references are handled with a `seen` map, so a payload
  referencing one object twice arrives referencing one object twice.

The plugin-panel window has a separate preload (`src/preload/plugin-panel.ts`)
for plugin-authored pages, which are not Vue and do not reach `lib/api.ts`;
its payloads are not sanitised here.

The copy is unconditional, so an already-plain payload is traversed and rebuilt
before `ipcRenderer.invoke` clones it again. That is a deliberate trade:
correctness at the boundary is worth more than one extra pass.

`tests/ipc-payload.test.mjs` pins the container, identity and `undefined`-key
facts. `tests/ipc-payload-probe.test.mjs` fails if a proxy-stripping helper or
an `api.*` stub is reintroduced into the `provider-ipc-payload` E2E fixture,
because such a helper removes exactly the proxies production code still sends
and leaves the probe green while the real bridge throws.

### Framework-difference traps

Each is invisible in review and each is real, so they are recorded here.

**Bare `aria-hidden` is not `aria-hidden="true"`.** A valueless `aria-hidden`
renders as `aria-hidden=""`, which is *not* the same attribute value as
`aria-hidden="true"`. Write the explicit form. No gate polices it, so the
ratio between the two forms — not the absolute number — is the signal.

**A destructured `ref` is unwrapped in the template.** In `<script setup>`,
`const { x } = useThing()` followed by `x.value` in the template reads
`undefined`, because the template has already unwrapped `x`. Use `x` in the
template and `x.value` in the script.

**The Markdown pipeline is a rewrite, not a translation.**
`package.json` carries `marked`, `dompurify`, `katex`, `shiki` and `mermaid`,
and no `remark-*` / `rehype-*` package. `lib/markdown-source.ts` walks a hast
tree and stamps `data-source-start` / `data-source-end` onto every element,
which is what transcript search highlighting
(`lib/transcript-search-highlight.ts`) and the disclosure-anchor E2E depend on.
`lib/shiki.ts` (278 lines) and `lib/mermaid.ts` cover the code-block and
diagram halves. `Markdown.vue` must therefore reproduce the *rendered result* —
the same tags, the same `data-source-*` anchors, the same sanitize allowlist —
by driving `marked` and stamping offsets itself.

**An orphaned `.vue` file is never compiled, so it hides real syntax errors.**
`electron-vite build` only compiles what the entry chain reaches, while
`vue-tsc --noEmit` type-checks *every* file in the project but does not run the
SFC template compiler. A file with no importer therefore passes both gates
while being unbuildable. Two shapes have shipped that way: an inline
`@keydown` handler whose value contained `return` outside a function body (the
template compiler parses an attribute value as a single expression), and a
`<script setup>` block that re-exported a value (`compiler-sfc` permits
`export type` and rejects every other export kind). Reachability from
`App.vue` is pinned for exactly this reason.

### Stylesheet and class contract

Class names come from the shared stylesheet in `src/renderer/styles/` — 28
partials sequenced by `globals.css`. Import order *is* the cascade: tokens and
base first, feature layers in the order the UI was built, the
responsive/reduced-motion tail last so it can override what precedes it.
Reordering the imports changes rendering.

Never add a component-local `<style>` block, and never invent a class name that
no partial defines. `tests/vue-class-contract.test.mjs` enforces this against
the real stylesheet.

All user-visible strings in `src/renderer/` go through i18n — labels, buttons,
placeholders, menus, notifications, `title`, and `aria-*`. The catalogs are
`src/i18n/locales/en/` and `src/i18n/locales/zh-CN/`; both locales move
together. Keyboard shortcuts belong in the configurable keybinding registry,
not hard-coded in business logic.

### The module-graph contract

`tests/renderer-module-graph.test.mjs` pins the renderer graph from four sides:

* every relative import resolves;
* every aliased import (`@dcode/*`, `@renderer/*`) resolves;
* every import names a binding its target module actually exports;
* the graph is reachable from `App.vue`, with the declared placeholder list
  matching reality.

It exists because the repository once could not build while `npm test` reported
a clean run. `AppShell.vue` was committed importing nine modules that did not
exist, so `electron-vite build` failed on `Could not resolve
"../../components/ChatSurface.vue"` — the suite asserted source *text* and
never resolved the graph.

The binding check is the second half of the same lesson. A `.vue` module whose
default export comes from its `<template>` or `<script setup>` block has no
default of its own, so a barrel that re-exports only *foreign* defaults
(`export { default as X } from "..."`) is not importable by default. All four
gates stay green on that mistake:

* the bundler resolves the file and links the bundle;
* `vue-tsc --noEmit` accepts a default import of a `.vue` module that has none;
* the resolution test stops at the filename;
* `vue-class-contract` reads class attributes only.

At runtime the dev server inlines the module and appends
`const _sfc_main = {}`, so the consumer renders nothing: a blank pane with
every gate reporting success. A barrel of foreign defaults must be imported by
name.

The placeholder convention closes the same hole from the other side. Each
surface the shell imports but that is not yet real gets a component carrying
the `PLACEHOLDER — NOT PORTED YET.` marker with a bare `<span />` template
(optionally behind `v-if` for a prop the shell always passes), so the shell's
import resolves and the shell's own layout is unaffected — the shell lays its
children out as a flex row, so a placeholder carrying `flex: 1` would claim
half the window. `UNPORTED_PLACEHOLDERS` in the module-graph test is empty
today; a new placeholder must be declared, a declared one must still be a
marker-carrying stub, and a declaration whose file grew a real body fails.

---

## Host boundary: dcode and native host

The privileged native host binary (`DCore`) is not built in this repository. DCode consumes it as a pre-compiled native binary placed under `bin/DCore` (`bin/DCore.exe` on Windows), which `package.json`'s electron-builder `extraResources` copies into the package as `bin/DCore`. `src/main/host-process.ts` resolves the packaged path first and falls back to configured local development paths or the `DCODE_HOST_BIN` environment variable.

* Do not add a `Cargo.toml`, a Rust crate, or a `target/` directory to dcode.
  Persistence, schema, migration, and native-host execution logic are encapsulated in the native host layer.
* Keep persistence, schema, migration, repository, domain logic, and
  filesystem responsibilities separated when they represent distinct concerns.
  Do not create abstraction layers without a real responsibility boundary.
* The host's SQLite schema version is **19**. DCode communicates with the host via standard IPC protocols and expects a matching schema version.

---

## Packaging facts

`package.json`'s `build` block is the source of truth. Three properties are
worth recording because their failure modes are silent.

### The package ships two Chromium locales, not fifty-five

Electron bundles a `locales/*.pak` catalogue covering every language Chromium
speaks. The app itself offers two — `supportedLocales` in `src/i18n/index.ts`
is `en` and `zh-CN` — so the other fifty-three files are dead weight in every
installer, and `build.electronLanguages` drops them. A packaged
`win-unpacked/locales` holds `en-US.pak` and `zh-CN.pak` and nothing else.

Two details are not visible from the configuration alone. The vocabularies
differ: the app's locale ids are `en` and `zh-CN`, while Chromium's tags are
`en-US` and `zh-CN`, and `app-builder-lib` matches `electronLanguages` against
the `.pak` basenames. Writing the app ids there deletes the only English
locale and leaves the build green. The second is that an empty or absent list
is a no-op rather than a restriction: the builder reads `asArray(...)` into
`wantedLanguages`, which is falsy for `[]`, so a typo silently restores all
fifty-five files.

`tests/development-branding.test.mjs` therefore asserts the shipped tag list
equals the Chromium tag each `supportedLocales` entry maps to, rejects an empty
list, and fails if the two vocabularies are conflated. Trimming is safe for
detection: with the fifty-three files removed, Electron's `app.getLocale()`
still resolves the OS language, because the runtime reads the system locale
rather than the `.pak` catalogue. Locale choice inside the app is unaffected
either way — it flows from `app.getLocale()` and the `--dcode-locale=`
argument the preload reads, not from Chromium's translated UI strings.

### The product name is `DCode`, the data directory is `dcode`

`build.productName` is `DCode`, `build.appId` is `net.dcode.app`, and the
artifact names are `DCode-${version}-${arch}…`. The user-data surface keeps the
lowercase identity instead: Electron's `userData` is the name-derived
`dcode` directory, and host-core keeps `pi.sqlite` beside the persistence
outbox and log tree under `~/.dcode`.

The two names are deliberately different and only the development profile
moves. A development build gets `dcode Dev` as its `userData` and `~/.dcode-dev`
as its data directory, so a shipped app that is already running does not hold
the single-instance lock against it, and a development host cannot put a second
host-core over the same single-writer database. A shipped installation keeps
`dcode` and `~/.dcode`, so no upgrade relocates a user's database, secrets,
plugins, or renderer-local state. `DCODE_DATA_DIR` overrides either profile
outright, which is how the E2E harnesses, the capture rig, and side-by-side
profiles choose their own root. `src/main/data-paths.ts` holds the resolution.

### The host binary is `DCore`

`build.extraResources` (and the per-platform `win` / `mac` / `linux` blocks)
copies `bin/DCore` into the release package. `src/main/host-process.ts` resolves
the packaged path first and falls back to development paths or the
`DCODE_HOST_BIN` environment variable when running locally.

---

## The brand assets are derived, and the derivation is load-bearing

`build/icon_1024.png` is the read-only master. `scripts/make-icon.py` derives
`icon.ico`, `icon.png`, `icon.icns`, and the macOS tray template from it, and
refuses to write its own source. `scripts/make-brand-marks.py` regenerates that
master plus the renderer's marks from the design exports; running it against
the exports reproduces every shipped file byte for byte, which is the check
that the derivation is still the one that produced them. The design exports
(`logo.png`, `home.png`, `mascot.gif`) are local files, not repository content.

### Theme polarity cannot be read off a file name

`styles/chat-shell.css` and `BrandLogo.vue` both select on `data-theme`: the
`-dark` asset is shown on the dark theme, the `-light` asset on the light one.
What each variant has to *contain* differs by asset, because the two are not
the same kind of picture.

The mascot is line art on a transparent ground, drawn directly onto the theme's
surface. The dark theme's surface is dark, so `home-mascot-dark.*` must carry
*light* line art and `home-mascot-light.*` dark line art; swapping the pair
makes the mascot invisible on one theme, and no assertion about names or file
sizes can detect it. `tests/brand-assets.test.mjs` measures the median
luminance of the opaque pixels to pin which is which.

The brand mark is an opaque tile with a contrasting glyph, so either variant
reads on either theme. Its contract is only that the pair is complementary,
which holds by construction: the `-light` file is the `-dark` file's RGB
inverted with the alpha channel preserved. Both facts are asserted.

The mascot animation needs the same care twice over. Its source is dark line
art on a light ground, so the alpha channel comes from darkness — a pixel at or
below the threshold is line, one above it is ground — rather than from keying
out the background colour, which would erase the drawing's own fills. The
threshold is applied before and after the resize, so the shipped frames are
strictly binary. Each frame is then written as a GIF whose transparent index is
also the logical-screen background index, so a decoder that honours the
background cannot paint a stray colour behind the art. Both indices are passed
explicitly rather than left to Pillow's defaults.

### The macOS DMG plates have their own contract

The direction of causality matters. `dmg-builder` measures the plate with
`sips` and uses those pixel dimensions as the Finder window size;
`build.dmg.window` is only consulted when there is no background image, so in
this configuration it does not size anything. The plate therefore has to be
exactly 720x500 — another size moves the window out from under the icon
coordinates in `build.dmg.contents`, which are absolute — and
`dmg-background@2x.png` has to be exactly 1440x1000, because
`tiffutil -cathidpicheck` pairs the two by their pixel ratio. A missing
companion falls back to the 1x plate; a present but non-double one is handed to
`tiffutil` and fails the macOS build outright. Both files are re-cut from a
design export by `scripts/make-dmg-background.py`, and the `brand-assets` test
asserts the sizes against `build.dmg.window` rather than against literals.

`build/logo_dark.png` used to be tracked, referenced by nothing, and 450 KB.
Both the 1024 master and the renderer's 192 px marks are now derived from the
same design export, so the file had no reader and was deleted rather than left
to drift away from the logo it was supposed to mirror.

---

## Development verification

### Quality gate command list

```bash
npm run typecheck
npm test
npm run test:unit
npm run lint
npm run build
npm run build:sidecar

node scripts/check-architecture.mjs
node scripts/check-agent-policy-sync.mjs
```

Run the minimum sufficient set for the surface changed. `npm run test:e2e` and
the targeted `npm run test:e2e:*` scripts start or attach to a Desktop instance
and must only run when the request explicitly asks for it.

Two runners, both over `tests/`, which mirrors the source tree. `npm test` is
`node --test` over `tests/**/*.test.mjs` with TypeScript sources loaded through
the registered transform hooks; it is the primary suite. `npm run test:unit` is
`vitest run` over `tests/**/*.test.ts`; `npm run test:all` runs both.

`scripts/check-architecture.mjs` enforces an 800-LOC ceiling on *new*
TypeScript files, which needs a revision to diff against. That base is the
repository's actual default branch, resolved at run time; the fallback is
`HEAD^`, which is one commit deep and therefore not a branch base.
`tests/architecture-gate-base.test.mjs` pins the resolution against real
throwaway repositories.
