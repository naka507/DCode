import { readMainModuleSync } from "./helpers/source-contracts.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dcorePath } from "./helpers/sibling-repos.mjs";

const readAbsolute = (path) => readFileSync(path, "utf8");

// The branch archive is implemented in the host-core crate of the sibling dcore
// checkout, so the two host-side contracts skip rather than fail when it is
// absent; a copy inside dcode would let the two languages drift apart.
const sessionsPath = dcorePath("crates/host-core/src/sessions.rs");
const rpcPath = dcorePath("crates/host-core/src/rpc/mod.rs");
const transcriptsPath = dcorePath("crates/host-core/src/transcripts.rs");

const skip =
  sessionsPath === null || rpcPath === null || transcriptsPath === null
    ? "needs the dcore checkout beside dcode"
    : false;

const agentEndBlock = () => {
  const main = readMainModuleSync("runtime/event-persistence.ts");
  const start = main.indexOf('if (event.type === "agent_end")');
  assert.ok(start > 0, "agent_end branch exists");
  const end = main.indexOf('if (event.type === "message_end"', start);
  assert.ok(end > start, "agent_end branch is bounded by the next event branch");
  return main.slice(start, end);
};

test("turn completion archives the regenerate branch in one host call", () => {
  const block = agentEndBlock();

  // The archive must not read the transcript, decide, and write it back: the
  // final assistant message can land in between (ADR 0060).
  assert.doesNotMatch(block, /"session\.replaceMessages"/);
  assert.doesNotMatch(block, /"session\.get"/);
  assert.doesNotMatch(block, /"session\.saveRevision"/);
  assert.doesNotMatch(block, /"session\.listRevisions"/);
  assert.match(block, /"session\.saveActiveRevision"/);
});

test("the outbox is drained before a branch is archived", () => {
  const block = agentEndBlock();

  assert.match(block, /persistenceOutbox\.size\(\) > 0/);
  assert.match(block, /await persistenceOutbox\.flush\(\(\) => runtimeState\.host\)/);
  // An archive that misses the final message is wrong forever once the pager
  // restores it, so a still-pending outbox skips the archive instead.
  assert.match(block, /skipped regenerate branch archive/);
});

test("the host owns the branch root search and the pager stamp", { skip }, () => {
  const host = readAbsolute(sessionsPath);
  const rpc = readAbsolute(rpcPath);
  const transcripts = readAbsolute(transcriptsPath);

  assert.match(rpc, /"session\.saveActiveRevision" => \{/);
  assert.match(host, /pub fn save_active_branch_revision\(/);
  // The stamp rewrites one line and re-reads the file, so a concurrent append
  // survives; a full rewrite from a stale snapshot would delete it.
  assert.match(host, /transcripts::update_message\(db\.data_dir\(\), session_id, &record\)/);
  assert.match(transcripts, /pub fn update_message\(/);
  assert.match(transcripts, /fs::read_to_string\(&path\)/);
});

test("a transcript rewrite keeps each message's owning turn", { skip }, () => {
  const host = readAbsolute(sessionsPath);

  assert.match(host, /SELECT id, turn_id FROM messages/);
  assert.match(host, /owning_turns\.get\(&record\.id\)\.map\(String::as_str\)/);
});
