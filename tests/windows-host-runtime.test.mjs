import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { dcorePath, repoPath } from "./helpers/sibling-repos.mjs";

/**
 * host-core is a Rust crate that lives in the sibling `dcore` checkout, which
 * dcode's own packaging already depends on (`../dcore/target/release`). These
 * are cross-language contracts between the TypeScript side and that crate, so
 * they read the real crate rather than a copy that could drift out of sync.
 */
const cargoConfigPath = dcorePath(".cargo/config.toml");
const keyboardPath = dcorePath("crates/host-core/src/keyboard.rs");
const rpcPath = dcorePath("crates/host-core/src/rpc/mod.rs");

const skip =
  cargoConfigPath === null || keyboardPath === null || rpcPath === null
    ? "needs the dcore checkout beside dcode"
    : false;

test("Windows host-core statically links the MSVC CRT for clean installs", { skip }, async () => {
  const cargoConfig = await readFile(cargoConfigPath, "utf8");

  assert.match(
    cargoConfig,
    /\[target\.x86_64-pc-windows-msvc\]\s*\nrustflags = \["-C", "target-feature=\+crt-static"\]/,
  );
});

test("Windows keyboard hook retains only a weak stdout sender", { skip }, async () => {
  const keyboard = await readFile(keyboardPath, "utf8");
  const rpc = await readFile(rpcPath, "utf8");

  assert.match(keyboard, /OnceLock<mpsc::WeakUnboundedSender<String>>/);
  assert.match(keyboard, /tx\.downgrade\(\)/);
  assert.doesNotMatch(keyboard, /OnceLock<mpsc::UnboundedSender<String>>/);
  assert.match(rpc, /crate::keyboard::start\(tx\.clone\(\)\)/);
  assert.match(rpc, /tokio::time::timeout\(STDOUT_WRITER_SHUTDOWN, writer_done_rx\)/);
});

test("shared host stdin cap matches host-core MAX_STDIN_LINE_BYTES", { skip }, async () => {
  const rpc = await readFile(rpcPath, "utf8");
  const limits = await readFile(repoPath("src/shared/rpc-limits.ts"), "utf8");
  assert.match(rpc, /const MAX_STDIN_LINE_BYTES: u64 = 64 \* 1024 \* 1024;/);
  assert.match(limits, /export const MAX_HOST_STDIN_LINE_BYTES = 64 \* 1024 \* 1024;/);
});
