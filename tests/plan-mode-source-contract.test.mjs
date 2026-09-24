import {
  readStoreModuleSync,
  readStoreSource,
} from "./helpers/source-contracts.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * The plan/goal artifact-surface source contract.
 *
 * Covers the whole Plan-mode surface for the two cases the relevant commits
 * amended. Other Plan-mode documents (`docs/spec/04-ux/08-component-spec.md`,
 * `src/i18n/locales/*`, `styles/composer.css`) and the syntax dcode already
 * pins in its own suites are not repeated here.
 *
 *  - `77767f73` amended `plan approval sends exact identities and waits for host
 *    confirmation`: the approval card and the store's `openPlanArtifact` both
 *    pick the artifact's surface through the shared preference helper.
 *  - `68dc4136` added `the startup artifact restore resolves launchable views
 *    first`.
 *
 * Notes on the readers:
 *
 *  - `readStoreSource()` is dcode's own concatenated store reader (it reads
 *    `src/renderer/stores/`); the same applies to `readStoreModuleSync`.
 *  - `barSource` is `PlanApprovalBar.vue`, and its pending flag is
 *    `const isPending = computed(() => props.proposal.status === "pending")`.
 *  - `openPlanArtifact(relativePath, pluginViews)` in the store source is
 *    unchanged textually: `app-store.ts` kept the same helper and parameter
 *    names.
 */

const storeSource = await readStoreSource();
const barSource = await readFile(
  new URL("../src/renderer/components/PlanApprovalBar.vue", import.meta.url),
  "utf8",
);
const eventsSource = readStoreModuleSync("slices/events-slice.ts");
const sessionSource = readStoreModuleSync("slices/session-slice.ts");

test("plan approval sends exact identities and waits for host confirmation", () => {
  // The slice of the case that `77767f73` changed: the approval card and
  // the store helper both resolve the artifact's surface through the shared
  // preference, so the two call sites cannot drift apart.
  assert.match(storeSource, /openPlanArtifact/);
  assert.match(
    storeSource,
    /preferredFileWorkPanelTab\(relativePath, pluginViews\)/,
  );
  assert.match(
    barSource,
    /const isPending = computed\(\(\) => props\.proposal\.status === "pending"\)/,
  );
});

test("the startup artifact restore resolves launchable views first", () => {
  // The artifact's surface comes from the launchable plugin views, and the
  // renderer only reads that list after `ready`. Opening the artifact before
  // that read used the host file tab and then took a second tab when
  // `selectSession` restored the same approval.
  const bootstrapStart = storeSource.indexOf("bootstrap: async");
  assert.ok(bootstrapStart > -1, "bootstrap is declared in the store source");
  const bootstrap = storeSource.slice(bootstrapStart);
  const resolvedViews = bootstrap.indexOf("await get().refreshPluginViews();");
  // The same loop shape also runs once before the restore, so search from the
  // refresh rather than from the top of `bootstrap`.
  const restoreLoop = bootstrap.indexOf(
    "for (const proposal of activePendingPlans)",
    resolvedViews,
  );

  assert.ok(resolvedViews > -1, "bootstrap resolves the launchable views");
  assert.ok(
    restoreLoop > resolvedViews,
    "the view list resolves before the pending-plan restore loop",
  );
  assert.ok(
    bootstrap.indexOf("openPlanArtifact(", resolvedViews) > restoreLoop,
    "no artifact opens before that loop",
  );
  // Every slice call site forwards the live list, so a stub list cannot hide
  // the wrong surface behind a green run.
  for (const slice of [eventsSource, sessionSource]) {
    assert.match(slice, /openPlanArtifact\([\s\S]{0,120}?get\(\)\.pluginViews/);
  }
});
