import {
  readStoreModuleSync,
  readStoreSourceSync,
} from "./helpers/source-contracts.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * The plan/goal approval card's surface choice: the assertions that `77767f73`
 * ("open plan and goal artifacts in the bundled file view") changed, plus the
 * sibling assertions in the same case that this tree can honor. Cases for
 * features this tree does not touch (command-shell settings, locale-backed
 * copy, composer-stack styles) are deliberately not carried here; the
 * pending-plan reconciliation contract they repeat is asserted against the
 * same store source by `plan-mode-source-contract`.
 *
 * Notes on the surface differences:
 *
 *  - the component `src/renderer/components/PlanApprovalBar.vue`.
 *  - `preferredFileWorkPanelTab(artifactPath, pluginViews)` -> the Vue
 *  - the component reads the store through a computed, so the call site is
 *    `preferredFileWorkPanelTab(path, pluginViews.value)`.
 *    `const isPending = computed(() => props.proposal.status === "pending")`.
 *  - `copy` resolves under the proposal kind's namespace:
 *    `t(copyKey(kind.value, name))`, because `kind` is a computed in
 *    `<script setup>`.
 *  - the markup binds `class="plan-approval-title"` and `:disabled="busy"`.
 */

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [approvalBar, approvalPreferences, apiSource, storeSource] =
  await Promise.all([
    read("../src/renderer/components/PlanApprovalBar.vue"),
    read("../src/renderer/lib/plan-approval-preferences.ts"),
    read("../src/renderer/lib/api.ts"),
    readStoreSourceSync(),
  ]);
const interactionSource = readStoreModuleSync("slices/interaction-slice.ts");

test("plan approval exposes only the artifact and remembers the selected mode", () => {
  assert.match(approvalBar, /proposal\.title/);
  assert.match(
    approvalBar,
    /preferredFileWorkPanelTab\(path, pluginViews\.value\)/,
  );
  assert.match(approvalBar, /openWorkPanelTabForSession/);
  assert.match(
    approvalBar,
    /const isPending = computed\(\(\) => props\.proposal\.status === "pending"\)/,
  );
  assert.match(approvalBar, /PLAN_APPROVAL_DEFAULT_MODE/);
  assert.match(approvalBar, /readPlanApprovalMode\(\)/);
  assert.match(approvalBar, /rememberPlanApprovalMode\(selectedMode\)/);
  assert.match(approvalPreferences, /PLAN_APPROVAL_MODE_STORAGE_KEY/);
  assert.match(approvalPreferences, /store\.setItem\(PLAN_APPROVAL_MODE_STORAGE_KEY, mode\)/);
  assert.match(approvalPreferences, /PLAN_APPROVAL_FALLBACK_MODE/);
  assert.doesNotMatch(
    approvalBar,
    /proposal\.question|proposal\.expiresAt|autoWarning|expiresAt|statusText/,
  );
  assert.doesNotMatch(
    approvalBar,
    /planApprovalPermissionMode|feedback|changes_requested/,
  );
  assert.doesNotMatch(apiSource, /planApprovalPermissionMode/);
  assert.doesNotMatch(storeSource, /planApprovalPermissionMode/);
  // Every label resolves under the proposal kind's namespace, so one bar serves
  // both `plan.*` and `goal.*` copy (D198).
  assert.match(approvalBar, /return `\$\{kind\}\.\$\{name\}`/);
  assert.match(
    approvalBar,
    /const copy = \(name: string\) => t\(copyKey\(kind\.value, name\)\)/,
  );
  assert.doesNotMatch(approvalBar, /t\("plan\./);
  assert.match(approvalBar, /data-testid="plan-open-artifact"/);
  assert.doesNotMatch(approvalBar, /request_changes|requestChanges/);
});

test("approval card omits validity details while the pending gate stays actionable", () => {
  assert.doesNotMatch(
    approvalBar,
    /PLAN_APPROVAL_RECONCILE_RETRY_MS|window\.setTimeout|restorePendingPlan/,
  );
  assert.doesNotMatch(
    approvalBar,
    /plan-approval-question|plan-approval-expiry|plan-approval-status|plan-approval-warning/,
  );
  assert.match(approvalBar, /class="plan-approval-title"/);
  assert.match(approvalBar, /class="plan-approval-artifact"/);
  assert.match(approvalBar, /:disabled="busy"/);
  assert.match(
    storeSource,
    /PendingPlanRefreshResult = "pending" \| "terminal" \| "unavailable"/,
  );
  assert.match(
    storeSource,
    /const generation = runtime\.nextPlanSyncGeneration\(sessionId\)/,
  );
  assert.match(storeSource, /await api\.pendingPlans\(sessionId\)/);
  assert.match(
    storeSource,
    /if \(generation !== runtime\.planSyncGeneration\(sessionId\)\) return "unavailable"/,
  );
  assert.doesNotMatch(
    storeSource,
    /pendingPlanLoads|pendingPlanLoadGenerations|pendingPlanFollowUps/,
  );
  const resolveBlock = interactionSource.slice(
    interactionSource.indexOf("resolvePlan: async"),
  );
  assert.match(resolveBlock, /PLAN_APPROVAL_TIMEOUT/);
  assert.match(
    resolveBlock,
    /await get\(\)\.restorePendingPlan\(resolution\.sessionId\)/,
  );
  assert.match(storeSource, /return activeProposal \? "pending" : "terminal"/);
  assert.match(storeSource, /isPendingPlan\(checkpoint\)/);
  assert.match(storeSource, /pendingPlans\[sessionId\]\?\.status === "pending"/);
  assert.match(storeSource, /pendingPlans\[resolution\.sessionId\]/);
  assert.match(storeSource, /planCheckpoints: checkpoint/);
});
