import { readComposerModule } from "./helpers/source-contracts.mjs";
import assert from "node:assert/strict";
import test from "node:test";

/**
 * Covers the composer's native-deletion guard (sha a1db7e99). One assertion
 * describes the install wiring:
 *
 *  - The guard is installed from
 *    `watch(props.inputRef, ..., { flush: "post" })`, because a template ref is
 *    filled after mount, and disposed through `onCleanup`. The assertion pins
 *    that wiring.
 *
 * `native-deletion.ts` itself is framework-free, so the rest is unchanged.
 */
const [inputSource, deletionSource] = await Promise.all([
  readComposerModule("ComposerInput.vue"),
  readComposerModule("native-deletion.ts"),
]);

test("composer input owns the native deletion guard", () => {
  assert.match(inputSource, /installComposerDeletionGuard\(editor\)/);
  assert.match(inputSource, /watch\(\s*props\.inputRef,/);
  assert.match(inputSource, /\{ flush: "post", immediate: true \}/);
  assert.match(inputSource, /onCleanup\(installComposerDeletionGuard\(editor\)\)/);
  assert.match(deletionSource, /event\.inputType\.startsWith\("delete"\)/);
  assert.match(deletionSource, /event\.getTargetRanges\(\)/);
  assert.match(deletionSource, /historyRedo/);
  assert.match(deletionSource, /event\.isComposing/);
  assert.match(deletionSource, /placeholders\.has\(br\)/);
  assert.doesNotMatch(deletionSource, /trim\(\)/);
});
