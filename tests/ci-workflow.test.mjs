import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const releaseMacScriptSource = await read("../scripts/release-macos.sh");

test("the signed local macOS lane selects the native runner architecture", () => {
  assert.match(releaseMacScriptSource, /DEFAULT_MAC_ARCH/);
  assert.match(releaseMacScriptSource, /MAC_ARCH="\$\{MAC_ARCH:-\$DEFAULT_MAC_ARCH\}"/);
  assert.match(releaseMacScriptSource, /must match the host/);
  assert.match(releaseMacScriptSource, /electron-builder --mac "--\$\{MAC_ARCH\}"/);
  assert.doesNotMatch(
    releaseMacScriptSource,
    /-c\.(?:dmg|zip)\.artifactName/,
    "the signed local macOS lane uses the shared artifact naming config",
  );
});

// The two contracts below read this tree's own packaging config and Linux ASAR
// export script.
const desktopPackageSource = await read("../package.json");
const releaseAsarScriptSource = await read("../scripts/export-linux-asar.mjs");

test("macOS artifact names include the target architecture", () => {
  assert.equal(
    JSON.parse(desktopPackageSource).build.mac.artifactName,
    "DCode-${version}-${arch}-mac.${ext}",
    "macOS ZIP names include the target architecture",
  );
  assert.equal(
    JSON.parse(desktopPackageSource).build.dmg.artifactName,
    "DCode-${version}-${arch}.${ext}",
    "macOS DMG names include the target architecture",
  );
});

test("the Linux ASAR export publishes the unpacked app.asar beside installers", () => {
  assert.match(
    releaseAsarScriptSource,
    /linux-unpacked\/resources\/app\.asar/,
  );
  assert.match(
    releaseAsarScriptSource,
    /DCode-\$\{releaseVersion\}-linux-x64\.asar/,
  );
});
