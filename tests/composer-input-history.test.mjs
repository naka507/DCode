import assert from "node:assert/strict";
import test from "node:test";
import {
  INITIAL_INPUT_HISTORY_STATE,
  navigateInputHistory,
  promptHistoryFromMessages,
} from "../src/renderer/features/chat/composer/input-history.ts";

const user = (content, extra = {}) => ({
  id: `msg-${content}`,
  role: "user",
  content,
  createdAt: "2026-10-31T00:00:00.000Z",
  ...extra,
});
const assistant = (content) => ({
  id: `msg-${content}`,
  role: "assistant",
  content,
  createdAt: "2026-10-31T00:00:00.000Z",
});

test("history keeps only fresh user prompts, oldest first", () => {
  const messages = [
    user("fix the login bug"),
    assistant("done"),
    user("  "),
    user("add a test for it", { steering: true }),
    user("add a test for it"),
    user("add a test for it"),
    user("ship it"),
  ];
  assert.deepEqual(promptHistoryFromMessages(messages), [
    "fix the login bug",
    "add a test for it",
    "ship it",
  ]);
});

test("history trims prompt text", () => {
  assert.deepEqual(promptHistoryFromMessages([user("  hello  ")]), ["hello"]);
});

test("up walks back to the oldest prompt and stays there", () => {
  const entries = ["first", "second", "third"];
  let step = navigateInputHistory(INITIAL_INPUT_HISTORY_STATE, entries, "up", "draft");
  assert.deepEqual(step, { state: { index: 2, savedDraft: "draft" }, text: "third" });
  step = navigateInputHistory(step.state, entries, "up", step.text);
  assert.deepEqual(step, { state: { index: 1, savedDraft: "draft" }, text: "second" });
  step = navigateInputHistory(step.state, entries, "up", step.text);
  assert.deepEqual(step, { state: { index: 0, savedDraft: "draft" }, text: "first" });
  assert.equal(navigateInputHistory(step.state, entries, "up", step.text), null);
});

test("down past the newest entry restores the stashed draft", () => {
  const entries = ["first", "second"];
  const up = navigateInputHistory(INITIAL_INPUT_HISTORY_STATE, entries, "up", "my draft");
  assert.equal(up.text, "second");
  const down = navigateInputHistory(up.state, entries, "down", up.text);
  assert.deepEqual(down, {
    state: INITIAL_INPUT_HISTORY_STATE,
    text: "my draft",
  });
});

test("down while not navigating and up with no entries change nothing", () => {
  assert.equal(
    navigateInputHistory(INITIAL_INPUT_HISTORY_STATE, ["only"], "down", "draft"),
    null,
  );
  assert.equal(navigateInputHistory(INITIAL_INPUT_HISTORY_STATE, [], "up", "draft"), null);
});

test("a stale index is clamped when entries shrink", () => {
  const state = { index: 5, savedDraft: "draft" };
  const step = navigateInputHistory(state, ["a", "b"], "up", "b");
  assert.deepEqual(step, { state: { index: 0, savedDraft: "draft" }, text: "a" });
});
