/**
 * Transcript markup contract — partial port.
 *
 * `features/chat/transcript/AssistantTurn.vue` is read through
 * `readTranscriptSource()`. This file carries only the assertion `07b2ab83`
 * changed:
 *
 *   `assert.ok(transcriptSource.includes("{complete ? ("))`
 *     -> `assert.ok(transcriptSource.includes("{complete && actionMessage ? ("))`
 *
 * Retranslated, not transliterated:
 *
 *  - The `{(content || hasError) && actionMessage ? (` wrapper is the
 *    `v-if` on the `.message-actions` div; the three `{complete ? (…) : null}`
 *    children are the `v-if="complete"` on each control. Vue therefore folds
 *    "complete" into the *gate* rather than into three inner conditions, which
 *    is the same DOM: no toolbar at all unless the turn is complete and has an
 *    action target.
 *  - `'<CopyButton text={content} label={t("chat.copy")} />'` becomes the two
 *    bound attributes `:text="content"` / `:label="t('chat.copy')"` on
 *    `<CopyButton … />`.
 *
 * The regression this guards: the action row used to mount on
 * `(content || hasError) && actionMessage` with every control hidden behind
 * `complete`, so a running or failed turn reserved an invisible toolbar's
 * height below its output.
 *
 * No counterpart: the user-plate CSS matchers, `fork tools use the branch
 * icon`, the tool-details and context-inspector greps. Those surfaces live in
 * their own dcode suites (`assistant-turns.test.mjs`, `context-usage.test.mjs`,
 * `surface-polish` and the `src/renderer/styles/*` contract tests), and the
 * JSX-shaped greps have no Vue equivalent.
 *
 * Two assertions below are additions, not ports. The wiring of
 * `shouldGroupTurnProcess` (`21fd93ff`) and `shouldAutoOpenTurnProcess`
 * (`1b34777f`) was only covered through `scripts/e2e/turn-process.ts`, which
 * has no equivalent here, and through the unit test of the two helpers — so a
 * renderer that stopped calling them would leave the whole suite green. These
 * two source contracts close that hole.
 * Two more assertions cover cases dcode never carried: `00369136` added the
 * `.tool-file-item { flex: none }` contract (a column flex list with a height
 * cap shrinks every row whose overflow is not visible, so a long result was
 * pressed into a sliver and its paths were clipped away), in the
 * `tool block bodies stay bounded and role-coded` test.
 * `tests/mcp-control-wiring.test.mjs` carries the `cf9d77e8` case for
 * `MCP_CONTROL_BLOCKED_CHANNEL_KEYS` instead, because that list is a Main-side
 * contract rather than a renderer one.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [transcriptSource, turnProcessSource, activityGroupSource, messagesStyles] =
  await Promise.all([
    read("../src/renderer/features/chat/transcript/AssistantTurn.vue"),
    read("../src/renderer/features/chat/transcript/TurnProcess.vue"),
    read("../src/renderer/features/chat/transcript/ActivityGroup.vue"),
    read("../src/renderer/styles/messages.css"),
  ]);

/**
 * The root elements of ActivityGroup's template, as `{ tag, classes }`.
 *
 * The component renders a `<template v-if="visible">` fragment with two
 * mutually exclusive roots — the embedded `div` and the card `div` — so the
 * roots are the elements at depth 1 inside that fragment. An element nested
 * inside another is not a root.
 *
 * This has to be structural, not a name lookup. The width contract below is
 * about whichever element the column actually makes a flex item: a wrapper
 * added around the rows (`<div class="turn-process-activity-shell"><div
 * class="turn-process-activity">…`) takes over that role, keeps every name the
 * guard used to assert, and brings the max-content overflow straight back. A
 * guard that only asks "does this name appear somewhere" cannot see that.
 */
function templateRoots(source) {
  const template = source.match(/^<template>\s*\r?\n([\s\S]*?)\r?\n<\/template>\s*$/m)?.[1];
  if (!template) return [];

  const roots = [];
  let depth = 0;
  // Only tags move the depth: a `<!-- -->` comment and a `{{ … }}`
  // interpolation never do.
  const tagPattern = /<(\/?)([A-Za-z][\w.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  for (const match of template.matchAll(tagPattern)) {
    const [, closing, tag, attrs, selfClosing] = match;
    if (closing) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    // `<template v-if>` opens a fragment rather than an element, so it stays
    // outside the depth count: its children are the component's roots.
    const isFragment = tag === "template";
    if (!isFragment && depth === 0) {
      roots.push({
        tag,
        classes: (attrs.match(/(?<![:\w-])class="([^"]*)"/)?.[1] ?? "")
          .split(/\s+/)
          .filter(Boolean),
      });
    }
    if (!isFragment && !selfClosing) depth++;
  }
  return roots;
}

/**
 * Every declaration block in `stylesheet` whose selector is exactly `.className`,
 * comments stripped.
 *
 * All of them, not the first: this file re-declares selectors (see
 * `.asktool-question-number`), and the later block wins. Reading only the first
 * match would let `width: 100%` be re-set to `max-content` further down while
 * the guard stayed green. Comments are stripped for the same reason — a rule
 * commented out is not a rule, and `[^}]*` would happily match the prose.
 */
function ruleBodies(stylesheet, className) {
  const css = stylesheet.replace(/\/\*[\s\S]*?\*\//g, " ");
  return [...css.matchAll(/([^{}]*)\{([^{}]*)\}/g)]
    .filter(([, prelude]) => new RegExp(`^\\.${className}$`).test(prelude.trim()))
    .map(([, , body]) => body);
}

/** The last declaration of `property` across all of a selector's blocks. */
function lastDeclaration(bodies, property) {
  let value;
  for (const body of bodies) {
    for (const match of body.matchAll(new RegExp(`(?:^|;)\\s*${property}\\s*:([^;]+)`, "g"))) {
      value = match[1].trim();
    }
  }
  return value;
}

test("streaming assistant turns hide answer copy until idle", () => {
  assert.ok(
    transcriptSource.includes('<div v-if="complete && actionMessage" class="message-actions">'),
    "the assistant action row must gate on `complete && actionMessage`: an " +
      "incomplete or actionless turn must not mount an empty toolbar",
  );
  assert.ok(transcriptSource.includes('<CopyButton :text="content" :label="t(\'chat.copy\')" />'));
  // No control may keep the old inner-only gate, which is what let the empty
  // row mount in the first place.
  assert.doesNotMatch(transcriptSource, /v-if="\(content \|\| hasError\) && actionMessage"/);
});

test("tool file rows keep their content height inside the capped list", () => {
  // 00369136. `.tool-file-list` is a column flex container with a 260px cap, so
  // every row is a flex item; an item whose overflow is not visible has an
  // automatic minimum size of zero, which pressed a long result into a sliver
  // and let the row's own `overflow: hidden` clip the paths away. The row must
  // therefore be pinned to its content height, and the list scrolls instead.
  assert.match(
    messagesStyles,
    /\.tool-file-list,\s*\.tool-match-list \{[\s\S]*?max-height:\s*260px;[\s\S]*?overflow:\s*auto;/,
    "the tool file and match lists must stay height-capped and scrollable",
  );
  const fileItem = messagesStyles.match(/\.tool-file-item \{([^}]*)\}/)?.[1];
  assert.ok(fileItem, "`.tool-file-item` must exist as its own top-level rule");
  assert.match(fileItem, /display:\s*block;/);
  assert.match(fileItem, /width:\s*100%;/);
  assert.match(
    fileItem,
    /flex:\s*none;/,
    "a capped column flex list shrinks a row whose overflow is hidden; " +
      "without `flex: none` the paths are clipped to a sliver",
  );
});

test("only compact mode wraps the turn in a process disclosure", () => {
  // 21fd93ff: detailed renders every part in place. The gate is read from the
  // settings store, and the two branches are the Compact disclosure plus the
  // flat `entry.parts` render.
  assert.match(transcriptSource, /const groupProcess = computed\(\(\) =>/);
  assert.match(transcriptSource, /shouldGroupTurnProcess\(/);
  assert.match(
    transcriptSource,
    /resolveThinkingDisplayMode\(store\.appState\?\.settings\?\.thinkingDisplayMode\)/,
  );
  assert.match(transcriptSource, /<template v-if="groupProcess">/);
  assert.match(transcriptSource, /v-for="part in props\.entry\.parts"/);
});

test("the process disclosure opens through the shared mode gate", () => {
  // 1b34777f: TurnProcess must ask the helper rather than inlining
  // `isActive && (hasToolFailure || mode === "detailed")`, so detailed history
  // stays open and compact only opens an active failure.
  assert.match(turnProcessSource, /shouldAutoOpenTurnProcess\(/);
  assert.doesNotMatch(turnProcessSource, /mode\.value === "detailed"/);
});

test("every activity-group root claims the column's width", () => {
  /*
   * A layout regression, not a port. The assistant column is a column flex
   * container with `align-items: flex-start`, so each child is sized to
   * fit-content unless it claims the width itself. `turn-process-activity` —
   * the group's embedded root, which Detailed mode renders for every activity
   * part — had no rule at all, so one long line inside it (a run row's command,
   * a `tool-row-summary` that cannot wrap) laid the whole column out at
   * max-content: measured at 26,135px inside a 692px column in the reporter's
   * session. `.message-row` carries `content-visibility: auto`, whose paint
   * containment clipped everything past the visible edge, so the expanded
   * detail read as cut off with a horizontal scrollbar under it.
   *
   * The guard is the invariant, not the value: *whichever* element the template
   * makes a root — read structurally, so a wrapper added around the rows is
   * caught rather than satisfied — must have a rule that claims the column's
   * width. `width: 100%` is the declaration that does the constraining
   * (measured: `min-width: 0` alone left the max-content width in place);
   * `min-width: 0` is asserted alongside it because both roots are meant to
   * state one contract, and the check is written so that a later block
   * re-declaring either property is what the guard reads.
   */
  const roots = templateRoots(activityGroupSource);
  assert.ok(
    roots.length >= 2,
    `ActivityGroup renders ${roots.length} template root(s); this contract needs ` +
      "the embedded root and the card root to both exist",
  );

  for (const root of roots) {
    const className = root.classes[0];
    assert.ok(
      className,
      `the \`<${root.tag}>\` root of ActivityGroup carries no static class; the ` +
        "width contract is keyed by class name",
    );
    const bodies = ruleBodies(messagesStyles, className);
    assert.ok(
      bodies.length > 0,
      `\`.${className}\` — the class of a template root — has no top-level rule ` +
        "in styles/messages.css, so the root is sized to max-content inside the " +
        "flex-start assistant column and one long tool line widens the column " +
        "past its clip",
    );
    assert.equal(
      lastDeclaration(bodies, "width"),
      "100%",
      `\`.${className}\` must end up with \`width: 100%\`: the assistant column ` +
        "aligns children to flex-start, so a root without it is sized to " +
        "max-content",
    );
    assert.equal(
      lastDeclaration(bodies, "min-width"),
      "0",
      `\`.${className}\` must end up with \`min-width: 0\`: both roots of the ` +
        "activity group state the same width contract, so neither can drift " +
        "into a max-content box",
    );
  }
});
