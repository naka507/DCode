import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * `scripts/e2e-transcript-render.mjs` — the E2E-083 runner for stable completed
 * activity groups, the tail runtime status lane, and the compact turn process.
 *
 * A runner is the one artifact in this repository that no other gate can check.
 * `npm test` never executes it (it starts Electron), `vue-tsc` does not read it,
 * and the class contract only reads `.vue` templates. So a runner that queries a
 * selector the renderer stopped rendering, or whose build-time instrumentation
 * no longer matches the compiler's output, fails only when someone runs it
 * against a real app — which per `AGENTS.md` § 12 happens only on explicit
 * request.
 *
 * This file closes that gap for the parts of this runner that can be checked
 * statically, and it deliberately concentrates on the one that cannot be
 * checked any other way at all: the render-count instrumentation.
 *
 * Renders are counted by injecting a statement into the *source* of
 * `ActivityGroup.vue`, and the injected marker must occur exactly once. A Vue
 * SFC has no `}: ActivityGroupProps) {` source marker: `<script setup>`
 * compiles to a `setup()` that runs once per mount, and the per-render work is
 * the arrow function it returns. The anchor is therefore that arrow —
 * `return (_ctx, _cache) => {` — which the compiler emits exactly once per SFC.
 *
 * That anchor is a contract with the compiler, not with this repository's own
 * code, so nothing else here can see it break: if `@vue/compiler-sfc` changes the
 * emitted shape, the runner's `assert.equal(code.split(marker).length, 2)` makes
 * the run fail loudly rather than count nothing — but only when the runner is
 * executed. These tests compile the real SFC with the real compiler and assert
 * the anchor, so the break is caught by `npm test`.
 */

const root = fileURLToPath(new URL("../", import.meta.url));
const rendererRoot = join(root, "src", "renderer");
const transcriptRoot = join(rendererRoot, "features", "chat", "transcript");
const runnerPath = join(root, "scripts", "e2e-transcript-render.mjs");
const fixturePath = join(root, "scripts", "e2e", "transcript-render.ts");
const runtimeSlotPath = join(root, "scripts", "e2e", "transcript-runtime-slot.ts");
const statusPath = join(root, "scripts", "e2e", "transcript-status.ts");
const turnProcessPath = join(root, "scripts", "e2e", "turn-process.ts");
const packagePath = join(root, "package.json");
const readmePath = join(root, "scripts", "README.md");

const runnerSource = readFileSync(runnerPath, "utf8");
const fixtureSource = readFileSync(fixturePath, "utf8");
const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));

/** The marker the runner injects after; the same literal, read from the runner. */
function instrumentationMarker() {
  const match = runnerSource.match(/const marker = (".*?");/);
  assert.ok(
    match,
    "the runner no longer declares its instrumentation `marker`, so this test " +
      "cannot confirm it matches the compiler's output",
  );
  return JSON.parse(match[1]);
}

/**
 * The module the runner's `enforce: "post"` transform actually sees.
 *
 * The pipeline matters, and getting it wrong makes this test lie in both
 * directions. `@vitejs/plugin-vue` compiles the SFC with `inlineTemplate: true`
 * — the `setup()` and the render arrow it returns land in one module — and
 * vite's own esbuild step then strips the TypeScript annotations before any
 * `enforce: "post"` plugin runs. So the render arrow reaches the runner as
 * `return (_ctx, _cache) => {`, not as the compiler's annotated
 * `return (_ctx: any,_cache: any) => {`.
 *
 * Both steps are reproduced here because both are load-bearing: without
 * `inlineTemplate` there is no render arrow in the module at all, and without
 * the esbuild pass the marker would not match the string the runner searches
 * for — a mismatch that would make the runner's boundary assert fire at run
 * time while this test passed.
 */
async function compiledScript(sfcPath) {
  const { createRequire } = await import("node:module");
  const require = createRequire(join(root, "package.json"));
  const sfc = require("@vue/compiler-sfc");
  const esbuild = require("esbuild");
  const { descriptor, errors } = sfc.parse(readFileSync(sfcPath, "utf8"), {
    filename: sfcPath,
  });
  assert.equal(errors.length, 0, `${sfcPath} does not parse: ${errors}`);
  const typescript = sfc.compileScript(descriptor, {
    id: "transcript-render-contract",
    inlineTemplate: true,
    isProd: true,
  }).content;
  return (await esbuild.transform(typescript, { loader: "ts" })).code;
}

test("the transcript-render runner is registered and documented", () => {
  assert.ok(
    existsSync(runnerPath),
    "scripts/e2e-transcript-render.mjs is missing; the e2e runners are " +
      "documented in docs/ARCHITECTURE.md",
  );
  assert.equal(
    packageJson.scripts["test:e2e:transcript-render"],
    "node scripts/e2e-transcript-render.mjs",
    "the runner needs its own `test:e2e:*` alias; docs/ARCHITECTURE.md " +
      "records the aliases as matching the runners that exist",
  );
  assert.match(
    readFileSync(readmePath, "utf8"),
    /e2e-transcript-render\.mjs/,
    "scripts/README.md documents every runner; an undocumented one is " +
      "invisible to the next reader",
  );
});

test("every driver the runner bundles exists", () => {
  // The runner's entry is `scripts/e2e/transcript-render.ts`, which imports the
  // other three. A missing one fails the vite build at run time only.
  for (const path of [fixturePath, runtimeSlotPath, statusPath, turnProcessPath]) {
    assert.ok(
      existsSync(path),
      `${path.slice(root.length)} is missing, so the runner's vite build fails ` +
        "before any probe runs",
    );
  }
  for (const [name, path] of [
    ["transcriptRenderProbe", fixturePath],
    ["transcriptRuntimeSlotProbe", runtimeSlotPath],
    ["transcriptStatusProbe", statusPath],
    ["turnProcessProbe", turnProcessPath],
  ]) {
    const source = readFileSync(path, "utf8");
    assert.ok(
      source.includes(name),
      `${path.slice(root.length)} no longer defines ${name}; the runner's ` +
        "executeJavaScript call names it directly",
    );
  }
  // The runner calls both globals on `globalThis`, in this order, and merges
  // their results. The probe names are the runner's contract with the fixture.
  assert.match(
    runnerSource,
    /globalThis\.transcriptRenderProbe\(\)[\s\S]*globalThis\.transcriptRuntimeSlotProbe\(\)/,
    "the runner no longer calls transcriptRenderProbe() then " +
      "transcriptRuntimeSlotProbe(); the fixture installs exactly those two",
  );
  assert.match(
    readFileSync(fixturePath, "utf8"),
    /globalThis\.transcriptRuntimeSlotProbe = transcriptRuntimeSlotProbe/,
    "the fixture entry must install the runtime-slot probe on globalThis, " +
      "because the runner reads it from the page",
  );
});

test("the ActivityGroup render-count anchor still matches the compiler output", async () => {
  const marker = instrumentationMarker();
  const compiled = await compiledScript(
    join(transcriptRoot, "ActivityGroup.vue"),
  );
  // The contract is the render arrow: `assert.equal(...length, 2)` in the
  // runner. If this count is not 2, the runner's own assert fires at run time
  // and the render-count checks below it never execute.
  assert.equal(
    compiled.split(marker).length,
    2,
    `the compiled ActivityGroup.vue no longer contains ${JSON.stringify(marker)} ` +
      "exactly once, so the runner's instrumentation boundary assert fails and " +
      "no render count is taken",
  );
  // And the injected statement has to be able to read the prop it counts by.
  // `props` is the compiled name of the SFC's `__props` binding (verified in the
  // same output); the injection references `props.items[0]?.message.id`.
  assert.ok(
    compiled.includes("const props = __props;"),
    "the compiled ActivityGroup.vue no longer binds `props`, so the runner's " +
      "injected `props.items[0]?.message.id` would throw on every render",
  );
  assert.match(
    runnerSource,
    /\(globalThis\.__activityGroupRenders \?\?= \[\]\)\.push\(props\.items\[0\]\?\.message\.id\)/,
    "the runner must push the group's first item message id, which is what the " +
      "`__activityGroupRenders.includes(\"task\")` and `.join(\",\") === \"tool-0\"` " +
      "checks compare against",
  );
});

test("the render-count checks keep their predicates and counts", () => {
  // The three render-count assertions are the reason this runner exists
  // (E2E-083). Each is pinned with its exact expression, because a softened
  // predicate — `>= 1` for `=== 0`, or a dropped `includes` — would leave the
  // runner green while the regression it guards returns.
  // These assertions live in the fixture, which is where the probe bodies are;
  // the runner only bundles it and reads the merged result.
  assert.match(
    fixtureSource,
    /assert\(\s*textUpdateRenders === 0,\s*`\$\{groups\} unchanged activity groups rendered \$\{textUpdateRenders\} times across 20 text updates`,\s*\)/,
    "the `0 renders across 20 text updates` check is the core of E2E-083; " +
      "it must stay an exact `=== 0`, not a bound",
  );
  assert.ok(
    fixtureSource.includes('globalThis.__activityGroupRenders.join(",") === "tool-0"'),
    "the changed-tool check must assert exactly one render, of `tool-0`",
  );
  for (const message of [
    "Task group ignored a lifecycle status update",
    "Task group ignored a timing-only update",
  ]) {
    assert.ok(
      fixtureSource.includes(message),
      `the fixture lost the check "${message}"`,
    );
  }
  // The two timing checks measure the rendered label, not the fixture data.
  for (const value of ["2s", "4s"]) {
    assert.ok(
      fixtureSource.includes(`taskDuration() === "${value}"`),
      `the Task timing check for ${value} is missing or softened`,
    );
  }
  // And the probe must route its entries through the identity-preserving list:
  // that is what makes `=== 0` true at all, and a fixture that dropped it would
  // fail the assertion rather than pass silently — this pins the reason.
  assert.ok(
    fixtureSource.includes("reuseTranscriptEntries(previousEntries, built)"),
    "the fixture must feed the component entries whose identity is preserved " +
      "for unchanged rows; without it every group re-renders and the `=== 0` " +
      "assertion cannot hold",
  );
});

test("the runtime-slot scenario keeps its geometry tolerances", () => {
  const slot = readFileSync(runtimeSlotPath, "utf8");
  // The scenario is a geometry assertion: the tail status lane must come and go
  // without moving the transcript. The tolerances are the whole point, so they
  // are pinned by value rather than by presence.
  assert.ok(
    slot.includes("Math.abs(moved) <= 0.01"),
    "the 0.01px drift rule is the runtime-slot scenario's core assertion",
  );
  assert.ok(
    slot.includes(
      "Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop) <= 1",
    ),
    "the pinned-follow rule (<= 1px from the bottom) must stay exact",
  );
  // Every failure string is asserted, because the runner surfaces them verbatim
  // in `runtime status slot scenario failed: ${JSON.stringify(failures)}`.
  for (const message of [
    "the running turn did not show the fallback status",
    "the status lane did not reserve a slot at rest",
    "the fixture rendered no message row to measure",
    "the waiting status row is missing",
    "the waiting status row lost its live-region semantics",
    "clearing the phase removed the running indicator",
    "clearing the phase did not restore the fallback",
    "an idle transcript still reserved the runtime status lane",
    "lost pinned follow",
  ]) {
    assert.ok(
      slot.includes(message),
      `the runtime-slot scenario lost the failure "${message}"`,
    );
  }
  // The lane's own child count is asserted per phase; the indicator ids are what
  // make the count meaningful.
  assert.ok(
    slot.includes("atRest.laneChildren === 1"),
    "the at-rest lane child count check is missing",
  );
  assert.ok(
    slot.includes('[data-testid="working-indicator"]') &&
      slot.includes('[data-testid="run-activity-indicator"]'),
    "the scenario must identify the indicator by testid, not by tag",
  );
});

test("the runner compares the built stylesheet against the source rule", () => {
  // The runtime-slot scenario measures a rule that lives in the built
  // stylesheet, so the runner compares the two copies and fails a stale build.
  // Both halves are pinned: the source rule it reads, and the built rule it
  // matches. Without the second half the scenario measures geometry from
  // whatever CSS happened to be in `out/`, which is the drift this check exists
  // to stop.
  assert.ok(
    runnerSource.includes("src/renderer/styles/chat-shell.css"),
    "the runner must read the source rule from " +
      "src/renderer/styles/chat-shell.css",
  );
  assert.ok(
    runnerSource.includes("\\.transcript-runtime-status \\{"),
    "the runner must match the source rule's declaration block",
  );
  assert.ok(
    runnerSource.includes("\\.transcript-runtime-status\\{"),
    "the runner must match the minified built rule; without it a stale build " +
      "passes a geometry check against CSS that no longer describes the source",
  );
  const chatShell = readFileSync(
    join(rendererRoot, "styles", "chat-shell.css"),
    "utf8",
  );
  assert.ok(
    chatShell.includes(".transcript-runtime-status {"),
    "styles/chat-shell.css no longer declares the rule the runner compares",
  );
  const chatTranscript = readFileSync(
    join(transcriptRoot, "ChatTranscript.vue"),
    "utf8",
  );
  assert.ok(
    chatTranscript.includes('class="transcript-runtime-status"'),
    "ChatTranscript.vue no longer renders the lane the scenario measures",
  );
  assert.ok(
    chatTranscript.includes('v-if="runtimeStatusLane"'),
    "the lane must be gated on the running turn, or an idle transcript would " +
      "still reserve the slot the last check asserts is gone",
  );
});

test("the runner takes its build guard and Electron path from the shared driver", () => {
  // A runner that checked for `out/main/index.js` itself would drift from
  // `boot.mjs` and from the other runners, and its guard would go stale
  // silently — the failure mode is a run against an unbuilt app that measures
  // an empty page.
  assert.match(
    runnerSource,
    /import \{ assertDesktopBuild, resolveElectronBinary \} from "\.\/e2e\/boot\.mjs"/,
    "the runner must take both the build guard and the Electron path from " +
      "scripts/e2e/boot.mjs",
  );
  const bootSource = readFileSync(join(root, "scripts", "e2e", "boot.mjs"), "utf8");
  assert.match(
    bootSource,
    /export function assertDesktopBuild/,
    "boot.mjs no longer exports assertDesktopBuild, so the runner's guard is " +
      "unresolvable at import time",
  );
  // It must check the renderer's own entry point, which is what the runner then
  // reads to discover the stylesheet links.
  assert.match(
    bootSource,
    /"out", "renderer", "index\.html"/,
    "boot.mjs's build guard must require out/renderer/index.html, the file the " +
      "runner parses for stylesheet links",
  );
});

test("the runner builds the renderer's own stylesheet into the page", () => {
  // The scenario's geometry comes from the built stylesheet, so the runner has
  // to link the app's real CSS files and copy their assets. A runner that
  // linked nothing would measure the browser's defaults and pass vacuously.
  // The exact expression that scrapes the built page for its stylesheet links.
  assert.ok(
    runnerSource.includes('appHtml.matchAll(/href="([^" ]+\\.css)"/g)'),
    "the runner must discover the built stylesheet links from the app's " +
      "index.html; without them the page loads no app CSS",
  );
  assert.ok(
    runnerSource.includes('cp(join(renderer, "assets")'),
    "the runner must copy the built assets beside the temp page, or every " +
      "stylesheet link 404s and the geometry is the browser default",
  );
  assert.ok(
    runnerSource.includes("assertDesktopBuild(root)"),
    "the runner must refuse to run against an unbuilt app rather than measure " +
      "an empty page",
  );
});
