#!/usr/bin/env node
/** Real DCore and desktop host transport; isolated files, no model or user data. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (!process.env.DCODE_HOST_BIN) throw new Error("DCODE_HOST_BIN must identify the candidate DCore binary");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "package.json"));
const { build } = require("esbuild");
const temp = await mkdtemp(join(tmpdir(), "dcode-prompt-grants-"));
let host;
let sequence = 0;
async function deadline(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Prompt grant E2E timed out")), 10_000);
    })]);
  } finally { clearTimeout(timer); }
}
try {
  const bundle = join(temp, "transport.cjs");
  await build({
    stdin: {
      contents: 'export { HostProcess } from "./src/main/host-process"; export { grantPromptReadPaths } from "./src/engine/prompt-read-grants";',
      resolveDir: root, loader: "ts",
    },
    outfile: bundle, bundle: true, platform: "node", format: "cjs",
    define: { __dirname: JSON.stringify(join(root, "src/main")) },
  });
  const { HostProcess, grantPromptReadPaths } = require(bundle);
  const project = join(temp, "project");
  const reference = join(temp, "reference");
  const outside = join(temp, "outside");
  for (const dir of [project, reference, outside]) await mkdir(dir);
  const file = join(reference, "中文 reference.txt");
  const sibling = join(reference, "sibling.txt");
  const secret = join(outside, "ungranted.txt");
  await writeFile(file, "reference contents");
  await writeFile(sibling, "sibling contents");
  await writeFile(secret, "must stay outside the grant");
  await symlink(outside, join(reference, "escape"), process.platform === "win32" ? "junction" : "dir");
  const dataDir = join(temp, "data");
  host = new HostProcess(dataDir, () => {});
  await deadline(host.handshake());
  const call = (method, params) => deadline(host.call(method, params));
  const { session } = await call("session.create", { mode: "agent", projectPath: project });
  const sessionId = session.id;
  await call("session.configure", { id: sessionId, mode: "agent", permissionMode: "auto" });
  const { turnId } = await call("session.beginTurn", { sessionId });
  const read = (path, id = sessionId) => call("tools.execute", {
    sessionId: id, toolCallId: `read-${++sequence}`, toolName: "Read", args: { path }, mode: "agent",
  });
  assert.equal((await read(file)).errorCode, "TOOL_DENIED");
  await deadline(grantPromptReadPaths(host, sessionId, `Read \`${file}\``, turnId));
  assert.equal((await read(file)).ok, true);
  assert.equal((await read(sibling)).errorCode, "TOOL_DENIED");
  const write = await call("tools.execute", {
    sessionId, toolCallId: "write", toolName: "Write", args: { path: file, content: "changed" }, mode: "agent",
  });
  assert.equal(write.errorCode, "TOOL_DENIED");
  assert.equal(await readFile(file, "utf8"), "reference contents");
  console.log("PASS prompt path grants one file, preserving sibling and write boundaries");

  await deadline(grantPromptReadPaths(host, sessionId, `Read \`${reference}\``, turnId));
  assert.equal((await read(sibling)).ok, true);
  assert.equal((await read(join(reference, "escape", "ungranted.txt"))).errorCode, "TOOL_DENIED");
  await call("permissions.clearSessionGrants", { sessionId });
  assert.equal((await read(file)).errorCode, "TOOL_DENIED");
  console.log("PASS directory grants reject symlink/junction escape and revoke immediately");

  await call("session.endTurn", { turnId, status: "completed" });
  const next = await call("session.beginTurn", { sessionId });
  await assert.rejects(deadline(grantPromptReadPaths(host, sessionId, `Read \`${file}\``, turnId)));
  assert.equal((await read(file)).errorCode, "TOOL_DENIED");
  await deadline(grantPromptReadPaths(host, sessionId, `Read \`${file}\``, next.turnId));
  assert.equal((await read(file)).ok, true);
  await host.dispose();
  host = new HostProcess(dataDir, () => {});
  await deadline(host.handshake());
  assert.equal((await read(file)).errorCode, "TOOL_DENIED");
  console.log("PASS ended turns cannot grant paths; host restart clears all prompt grants");
} finally {
  await host?.dispose();
  await rm(temp, { recursive: true, force: true });
}
