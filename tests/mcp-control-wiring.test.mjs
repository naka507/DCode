import { readMainModuleSync, readMainSourceSync } from "./helpers/source-contracts.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(here, "..");
register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));
const {
  MCP_CONTROL_BLOCKED_CHANNEL_KEYS,
  MCP_CONTROL_CATALOG_CHANNEL_KEYS,
  createMcpControlOperations,
} = await import("../src/main/mcp-control.ts");

const main = readMainSourceSync();
const startup = readMainModuleSync("bootstrap/startup.ts");
const shutdown = readMainModuleSync("bootstrap/shutdown.ts");
const pluginIpc = readMainModuleSync("ipc/plugin-ipc.ts");
const workspaceIpc = readMainModuleSync("ipc/workspace-ipc.ts");
const extensionIpc = readMainModuleSync("agent-extensions-ipc.ts");
const api = readFileSync(join(desktopRoot, "src/renderer/lib/api.ts"), "utf8");
const protocol = readFileSync(
  join(desktopRoot, "src/shared/protocol.ts"),
  "utf8",
);

function ipcInvokeKeys(source) {
  const block = source.match(/invoke:\s*\{([\s\S]*?)\n  \},/)?.[1] ?? "";
  return [...block.matchAll(/^\s+([A-Za-z0-9_]+):/gm)].map((match) => match[1]);
}

test("the optional MCP control server reuses IPC and synchronizes renderer state", () => {
  assert.match(startup, /const invokeIpc = registerIpc\(\)/);
  assert.match(startup, /process\.env\.DCODE_MCP_CONTROL === "1"/);
  assert.match(startup, /channels: IPC\.invoke/);
  assert.match(startup, /version: APP_VERSION/);
  assert.match(startup, /mcpControlRendererEvent/);
  assert.match(startup, /process\.env\.DCODE_MCP_PORT/);
  assert.match(shutdown, /getMcpControl\(\)\?\.stop\(\)/);
  assert.match(api, /projectPath\?: string \| null/);
  assert.match(api, /selectSessionId\?: string/);
});

test("native picker handlers and secret-write channels stay out of the MCP catalog", () => {
  const pickerKeys = [];
  const handlePattern = /handle(?:WithEvent)?\(\s*IPC\.invoke\.([A-Za-z0-9_]+)/g;
  for (const source of [pluginIpc, workspaceIpc, extensionIpc]) {
    const starts = [...source.matchAll(handlePattern)];
    for (let index = 0; index < starts.length; index += 1) {
      const from = starts[index].index ?? 0;
      const to = index + 1 < starts.length ? (starts[index + 1].index ?? source.length) : source.length;
      const block = source.slice(from, to);
      if (block.includes("showOpenDialog") || block.includes("openProjectPicker")) {
        pickerKeys.push(starts[index][1]);
      }
    }
  }
  assert.ok(pickerKeys.includes("pluginLoadDev"));
  assert.ok(pickerKeys.includes("projectOpen"));

  const catalog = new Set(MCP_CONTROL_CATALOG_CHANNEL_KEYS);
  const invokeKeys = new Set(ipcInvokeKeys(protocol));
  for (const key of pickerKeys) {
    assert.equal(catalog.has(key), false, `${key} is a native picker`);
  }
  for (const key of MCP_CONTROL_BLOCKED_CHANNEL_KEYS) {
    assert.equal(catalog.has(key), false, `${key} must stay excluded`);
    assert.equal(invokeKeys.has(key), true, `${key} must remain an IPC channel`);
  }
  for (const key of MCP_CONTROL_CATALOG_CHANNEL_KEYS) {
    assert.equal(invokeKeys.has(key), true, `${key} is not an IPC.invoke channel`);
  }
  const channels = Object.fromEntries(
    MCP_CONTROL_CATALOG_CHANNEL_KEYS.map((key) => [key, `dcode/${key}`]),
  );
  channels.pluginLoadDev = "dcode/plugin/loadDev";
  channels.secretsSet = "dcode/secrets/set";
  channels.providersCreate = "dcode/providers/create";
  const live = createMcpControlOperations(channels);
  assert.equal(live.some((operation) => operation.id === "plugin/loadDev"), false);
  assert.equal(live.some((operation) => operation.id === "providers/create"), false);
  assert.equal(live.find((operation) => operation.id === "session/configure")?.risk, "dangerous");
});

test("the tray's session-preference channel stays out of the MCP catalog", () => {
  // cf9d77e8. The tray writes session preferences through Main, so MCP control
  // must not expose that channel: it is a user-initiated desktop surface, not a
  // tool channel. The key is named here as well as looped over above, because a
  // channel dropped from the list entirely would otherwise leave every
  // assertion green while the exclusion silently disappeared.
  assert.ok(
    MCP_CONTROL_BLOCKED_CHANNEL_KEYS.includes("traySetSessionPreferences"),
    "traySetSessionPreferences must be listed as blocked",
  );
  assert.equal(
    MCP_CONTROL_CATALOG_CHANNEL_KEYS.includes("traySetSessionPreferences"),
    false,
    "the tray's session-preference channel must not reach the MCP catalog",
  );
  assert.match(
    protocol,
    /traySetSessionPreferences: "dcode\/tray\/setSessionPreferences"/,
    "the channel must remain a real IPC channel, not a removed one",
  );
});
