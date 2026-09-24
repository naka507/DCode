/**
 * The active-turn surface contract.
 *
 * Covers the transcript surface at
 * `src/renderer/features/chat/transcript/ChatTranscript.vue`. The assertions
 * name the SFC's own syntax, and its source text is read directly:
 *
 *  - `const runtimeStatusLane = computed(() => transcriptRunning.value)` is the
 *    lane gate; `v-if="runtimeStatusLane"` is the lane div's guard and
 *    `class="transcript-runtime-status"` is its static class.
 *  - `const specializedActivity = computed(() => agentActivity.value)` is the
 *    specialization gate.
 *
 * The tail-status gates were narrowed: the `planningState === "planning"`
 * branch no longer waits for `!activeToolGroup` / `!assistantIsAnswering`,
 * because those two computeds are gone — output arriving no longer hides the
 * status lane. The assertion pins
 * `/planningState === "planning"[\s\S]*!hasSpecializedActivity/`; that regex
 * alone also matches the pre-image, so this file additionally pins the two
 * deleted names out of the file, which is what the rewrite was about.
 *
 * The indicators are their own SFCs (`WorkingIndicator.vue`,
 * `RunActivityIndicator.vue`, `PlanningIndicator.vue`) and their markup is
 * asserted by `vue-class-contract` and the style rules below instead of by
 * literal markup greps.
 */
import { readStoreSource } from "./helpers/source-contracts.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [store, transcript, messagesStyles, chatShellStyles, proseStyles, en, zh] =
  await Promise.all([
    readStoreSource(),
    read("../src/renderer/features/chat/transcript/ChatTranscript.vue"),
    read("../src/renderer/styles/messages.css"),
    read("../src/renderer/styles/chat-shell.css"),
    read("../src/renderer/styles/prose.css"),
    read("../src/i18n/locales/en/index.ts"),
    read("../src/i18n/locales/zh-CN/index.ts"),
  ]);
test("active turns show immediate and phase-specific feedback without a progress card", () => {
  // The three tail indicators are their own SFCs; the transcript
  // mounts them behind the same three gates.
  assert.match(transcript, /<RunActivityIndicator/);
  assert.match(transcript, /<PlanningIndicator v-if="showPlanning" :kind="planningKind" \/>/);
  assert.match(transcript, /<WorkingIndicator v-if="showWorking" \/>/);
  assert.match(transcript, /const showWorking = computed\(/);
  assert.match(transcript, /const showPlanning = computed\(/);
  assert.match(transcript, /const showRunActivity = computed\(/);
  assert.match(
    transcript,
    /const specializedActivity = computed\(\(\) => agentActivity\.value\)/,
  );
  assert.match(transcript, /!hasSpecializedActivity/);
  assert.match(
    transcript,
    /planningState === "planning"[\s\S]*!hasSpecializedActivity/,
  );
  // 07b2ab83: the tail status no longer yields to existing output. The two
  // gates that used to hide it must not come back, or the running indicator
  // disappears again the moment the first text or completed tool row lands.
  assert.doesNotMatch(transcript, /assistantIsAnswering|activeToolGroup/);
  assert.match(transcript, /const showStatus = computed\(/);
  assert.match(
    transcript,
    /showStatus\.value && hasSpecializedActivity\.value/,
  );
  assert.match(messagesStyles, /\.planning-state-indicator\s*\{/);
  assert.match(
    messagesStyles,
    /\.planning-state-indicator[\s\S]*?animation:\s*planning-state-in/,
  );
  assert.match(
    messagesStyles,
    /\.planning-state-indicator \.working-indicator-mark > span\s*\{[\s\S]*?background:\s*var\(--ds-purple\)/,
  );
  assert.doesNotMatch(store, /AgentProgress|agentProgress|updateAgentProgress/);
  assert.match(messagesStyles, /\.working-indicator\s*\{/);
  assert.doesNotMatch(messagesStyles, /\.tool-activity-current/);
  assert.match(messagesStyles, /\.working-indicator-mark\s*\{/);
  assert.match(messagesStyles, /\.run-activity-indicator\[data-phase="waiting-model"\]/);
  assert.match(messagesStyles, /\.run-activity-indicator\[data-phase="compacting"\]/);
  assert.match(messagesStyles, /\.run-activity-indicator\[data-phase="recovering"\]/);
  assert.match(messagesStyles, /\.run-activity-indicator\[data-phase="retrying"\]/);
  assert.match(messagesStyles, /\.run-activity-error-popover\.message-error/);
  assert.match(
    messagesStyles,
    /\.run-activity-error-popover\.message-error \{[\s\S]*?background:\s*color-mix\(in oklab,\s*var\(--ds-error\)[^;]*var\(--ds-bg-elevated-opaque\)/,
  );
  assert.match(
    messagesStyles,
    /\.run-activity-retry-reason:hover[\s\S]*\.run-activity-error-popover/,
  );
  assert.match(messagesStyles, /\.run-activity-indicator\[data-phase="waiting-subagents"\]/);
  assert.match(messagesStyles, /\.working-indicator-mark > span\s*\{[\s\S]*?animation:\s*working-indicator-dot\s+1s/);
  assert.doesNotMatch(proseStyles, /\.working-indicator\s*\{|\.shimmer-text\s*\{/);
  assert.doesNotMatch(messagesStyles, /\.shimmer-text\s*\{|animation:\s*shimmer\b/);
  assert.match(
    messagesStyles,
    /\.tool-activity-label\.running::after,\s*\.tool-row-name\.running::after\s*\{[\s\S]*?animation:\s*activity-marker-pulse\s+1s/,
  );
  assert.doesNotMatch(
    en,
    /progressUnderstanding|progressWorking|progressChecking|progressFinalizing|progressWaiting/,
  );
  assert.doesNotMatch(
    zh,
    /progressUnderstanding|progressWorking|progressChecking|progressFinalizing|progressWaiting/,
  );
  for (const catalog of [en, zh]) {
    assert.match(catalog, /waitingForModel:/);
    assert.match(catalog, /startingTurn:/);
    assert.match(catalog, /preparingNextRequest:/);
    assert.match(catalog, /compactingContext:/);
    assert.match(catalog, /recoveringTurn:/);
    assert.match(catalog, /retryingModel:/);
    assert.match(catalog, /waitingForSubagentNamed:/);
    assert.match(catalog, /waitingForSubagents_one:/);
    assert.match(catalog, /waitingForSubagents_other:/);
  }
  assert.match(store, /agentStatuses: Record<string, AgentStatus>/);
  assert.match(store, /event\.type === "status"/);
  // 07b2ab83: the lane belongs to the whole running turn, and its gate is the
  // running flag alone — `const runtimeStatusLane = computed(() =>
  // transcriptRunning.value)`.
  assert.match(transcript, /const runtimeStatusLane = computed\(\(\) => transcriptRunning\.value\)/);
  assert.match(transcript, /<div v-if="runtimeStatusLane" class="transcript-runtime-status">/);
  // The tail status lane is part of the layout for the whole running turn, so
  // the indicators coming and going cannot resize the transcript (issue #323).
  assert.match(
    chatShellStyles,
    /\.transcript-runtime-status \{[\s\S]*?display: flow-root;[\s\S]*?min-height: calc\(var\(--text-sm-plus\) \* var\(--leading-body\) \+ 22px\);/,
  );
  // An empty lane must read as nothing at all: the reserve is geometry only,
  // so the rule may not paint a surface of its own.
  const laneRule =
    chatShellStyles.match(/\.transcript-runtime-status \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(laneRule, /min-height:/);
  assert.doesNotMatch(laneRule, /background|box-shadow|border-style|border-width|border:/);
  // The reserve is sized from the indicator's own box, so the two must be
  // changed together or the row starts moving again.
  assert.match(
    messagesStyles,
    /\.working-indicator \{[\s\S]*?margin: 2px 0 8px;[\s\S]*?padding: 8px 0 4px 16px;/,
  );
  assert.match(
    messagesStyles,
    /\.planning-state-indicator \{[\s\S]*?margin: 2px 0 8px;[\s\S]*?padding: 8px 0 4px 16px;/,
  );
});
