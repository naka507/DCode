import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));

const {
  RemoteControlHostService,
  getActiveRemoteControlHost,
  setActiveRemoteControlHost,
} = await import("../src/main/remote/remote-control-host.ts");

test("manages active remote control host singleton", () => {
  assert.equal(getActiveRemoteControlHost(), null);
  const service = new RemoteControlHostService({
    getAgentHostBridge: () => null,
  });
  setActiveRemoteControlHost(service);
  assert.equal(getActiveRemoteControlHost(), service);
  setActiveRemoteControlHost(null);
  assert.equal(getActiveRemoteControlHost(), null);
});

test("returns initial status when disabled", async () => {
  const service = new RemoteControlHostService({
    getAgentHostBridge: () => null,
  });
  const status = await service.getStatus();
  assert.equal(status.enabled, false);
  assert.ok(status.localAddresses.includes("127.0.0.1"));
  assert.equal(status.connectedClients, 0);
  assert.equal(status.pairingToken, undefined);
  assert.equal(status.pairingUrl, undefined);
});

test("requires agent host to enable", async () => {
  const service = new RemoteControlHostService({
    getAgentHostBridge: () => null,
  });
  await assert.rejects(
    async () => {
      await service.setEnabled(true);
    },
    /agent host is not available/,
  );
});

test("rejects generatePairingToken when not running", async () => {
  const service = new RemoteControlHostService({
    getAgentHostBridge: () => null,
  });
  await assert.rejects(
    async () => {
      await service.generatePairingToken();
    },
    /remote control host is not running/,
  );
});

test("starts, generates tokens, and stops with valid agent host", async () => {
  const fakeBridge = {
    agentHost: {
      on() {},
      off() {},
      start: async () => {},
    },
  };
  const service = new RemoteControlHostService({
    getAgentHostBridge: () => fakeBridge,
    defaultPort: 0,
  });

  const started = await service.setEnabled(true);
  assert.equal(started.enabled, true);
  assert.ok(started.port > 0);
  assert.ok(started.pairingToken?.startsWith("ppt1."));
  assert.ok(started.pairingUrl?.includes("ws://"));
  assert.equal(started.connectedClients, 0);

  const prevToken = started.pairingToken;
  const refreshed = await service.generatePairingToken();
  assert.notEqual(refreshed.pairingToken, prevToken);
  assert.ok(refreshed.pairingToken?.startsWith("ppt1."));

  const stopped = await service.setEnabled(false);
  assert.equal(stopped.enabled, false);
  assert.equal(stopped.pairingToken, undefined);
  assert.equal(stopped.pairingUrl, undefined);

  await service.dispose();
});
