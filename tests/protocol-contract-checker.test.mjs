import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const checker = fileURLToPath(
  new URL("../scripts/check-protocol-contract.mjs", import.meta.url),
);

async function fixture({ contractMethods, dcoreMethods, dcodeCalls }) {
  const root = await mkdtemp(join(tmpdir(), "proto-contract-"));
  const dcore = join(root, "dcore");
  await mkdir(join(root, "protocol"), { recursive: true });
  await mkdir(join(root, "src", "shared"), { recursive: true });
  await mkdir(join(dcore, "crates", "host-core", "src", "rpc"), { recursive: true });
  await writeFile(
    join(root, "protocol", "contract.json"),
    JSON.stringify({ version: 12, methods: contractMethods }),
  );
  await writeFile(
    join(root, "src", "shared", "protocol.ts"),
    "export const PROTOCOL_VERSION = 12;\n",
  );
  await writeFile(
    join(root, "src", "calls.ts"),
    dcodeCalls.map((m) => `host.call("${m}");`).join("\n") + "\n",
  );
  await writeFile(
    join(dcore, "crates", "host-core", "src", "state.rs"),
    "pub const PROTOCOL_VERSION: u32 = 12;\n",
  );
  await writeFile(
    join(dcore, "crates", "host-core", "src", "rpc", "mod.rs"),
    dcoreMethods.map((m) => `        "${m}" => {}`).join("\n") + "\n",
  );
  return { root, dcore };
}

async function run(root, dcore) {
  try {
    const { stdout } = await execFileAsync(process.execPath, [checker], {
      cwd: root,
      env: { ...process.env, DCORE_REPO: dcore },
    });
    return { code: 0, output: stdout };
  } catch (error) {
    return { code: error.code, output: error.stderr + error.stdout };
  }
}

test("checker sees camelCase methods on both sides", async () => {
  const { root, dcore } = await fixture({
    contractMethods: ["turn.appendEvent"],
    dcoreMethods: ["turn.appendEvent"],
    dcodeCalls: ["turn.appendEvent"],
  });
  const { code, output } = await run(root, dcore);
  assert.equal(code, 0, output);
  assert.match(output, /1 DCode call sites checked/);
});

test("checker reports a DCore method missing from the contract", async () => {
  const { root, dcore } = await fixture({
    contractMethods: ["turn.appendEvent"],
    dcoreMethods: ["turn.appendEvent", "turn.pruneEvents"],
    dcodeCalls: [],
  });
  const { code, output } = await run(root, dcore);
  assert.equal(code, 1);
  assert.match(output, /turn\.pruneEvents.*missing from protocol\/contract\.json/);
});

test("checker ignores error codes and enum values shaped like match arms", async () => {
  const { root, dcore } = await fixture({
    contractMethods: ["session.beginTurn"],
    dcoreMethods: ["session.beginTurn", "AGENT_BUSY", "up", "allow-once", "Bash"],
    dcodeCalls: [],
  });
  const { code, output } = await run(root, dcore);
  assert.equal(code, 0, output);
});

test("checker reports a DCode call site missing from the contract", async () => {
  const { root, dcore } = await fixture({
    contractMethods: ["turn.appendEvent"],
    dcoreMethods: ["turn.appendEvent"],
    dcodeCalls: ["turn.appendEvent", "session.nope"],
  });
  const { code, output } = await run(root, dcore);
  assert.equal(code, 1);
  assert.match(output, /session\.nope.*not in protocol\/contract\.json/);
});
