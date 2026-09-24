import { readMainSource, readMainModule } from "./helpers/source-contracts.mjs";
import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { supportedLocales } from "../src/i18n/index.ts";

const devScriptUrl = new URL(
  "../scripts/dev-electron.mjs",
  import.meta.url,
);

const mainSource = await readMainSource();
const mainIndexSource = await readMainModule("index.ts");
const brandingSource = await readMainModule("bootstrap/app-lifecycle.ts");
const windowSource = await readMainModule("bootstrap/window.ts");
const startupSource = await readMainModule("bootstrap/startup.ts");
const iconScriptSource = await readFile(
  new URL("../scripts/make-icon.py", import.meta.url),
  "utf8",
);
const devScriptSource = await readFile(
  devScriptUrl,
  "utf8",
);
const linuxAsarScriptSource = await readFile(
  new URL("../scripts/export-linux-asar.mjs", import.meta.url),
  "utf8",
);
const macosVerifyScriptSource = await readFile(
  new URL("../scripts/verify-macos-release.sh", import.meta.url),
  "utf8",
);
const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const protocolSource = await readFile(
  new URL("../src/shared/protocol.ts", import.meta.url),
  "utf8",
);
const windowsIcon = await readFile(
  new URL("../build/icon.ico", import.meta.url),
);


/**
 * The Chromium locale tags that must survive packaging, and the app locale each
 * one serves. The vocabularies are not the same: the app's `en` is Chromium's
 * `en-US`, and `app-builder-lib` matches `electronLanguages` against the `.pak`
 * basenames, not against `supportedLocales`.
 */
const SHIPPED_CHROMIUM_LOCALES = ["en-US", "zh-CN"];
const CHROMIUM_LOCALE_FOR = { en: "en-US", "zh-CN": "zh-CN" };

test("Windows runtime registers the canonical native application identity", () => {
  const appId = protocolSource.match(/APP_ID = "([^"]+)"/)?.[1];
  assert.equal(appId, packageJson.build.appId);
  assert.ok(startupSource.includes("app.whenReady()"), "main process readiness hook");
  assert.match(mainIndexSource, /app\.setName\(APP_NAME\)/);
  assert.match(
    mainIndexSource,
    /process\.platform === "win32"[\s\S]*app\.setAppUserModelId\(APP_ID\)/,
  );
});

test("Windows packages pin DCode executable and shortcut names", () => {
  assert.equal(packageJson.build.win.executableName, "DCode");
  assert.equal(packageJson.build.nsis.shortcutName, "DCode");
});

test("every packaged artifact carries the DCode product name", () => {
  // The product name is spread across four places electron-builder reads
  // independently, plus the Linux ASAR exporter and the macOS verifier. A
  // partial rename ships an installer named DCode beside a DMG named dcode,
  // which no single assertion above would catch.
  assert.equal(packageJson.build.productName, "DCode");
  assert.equal(packageJson.build.win.executableName, "DCode");
  assert.equal(packageJson.build.nsis.shortcutName, "DCode");
  assert.equal(packageJson.build.linux.executableName, "DCode");
  assert.equal(
    packageJson.build.mac.artifactName,
    "DCode-${version}-${arch}-mac.${ext}",
  );
  assert.equal(packageJson.build.dmg.artifactName, "DCode-${version}-${arch}.${ext}");
  assert.match(
    linuxAsarScriptSource,
    /`DCode-\$\{releaseVersion\}-linux-x64\.asar`/,
  );
  assert.match(macosVerifyScriptSource, /^PRODUCT_NAME="DCode"$/m);
});

test("packaged builds ship Chromium locales for exactly the shipped UI languages", () => {
  // Electron ships ~55 `locales/*.pak` files. The app only offers English and
  // Simplified Chinese (`supportedLocales`), so the rest are dead weight in the
  // installer. `electronLanguages` is the only switch that trims them, and
  // app-builder-lib deletes every `.pak` that does not match — an empty list is
  // a no-op, so a typo here silently restores all 55.
  //
  // The two tag vocabularies differ, which is the part worth pinning: the app
  // uses `en`, Chromium ships `en-US.pak`. Asserting the app ids verbatim would
  // pass while deleting the only English locale.
  const electronLanguages = packageJson.build.electronLanguages;
  assert.ok(
    Array.isArray(electronLanguages) && electronLanguages.length > 0,
    "build.electronLanguages must be a non-empty list; an empty one leaves every locale in the package",
  );
  assert.deepEqual(
    [...electronLanguages].sort(),
    [...SHIPPED_CHROMIUM_LOCALES].sort(),
    "the packaged Chromium locales must match the shipped UI languages",
  );
  for (const { id } of supportedLocales) {
    assert.ok(
      SHIPPED_CHROMIUM_LOCALES.includes(CHROMIUM_LOCALE_FOR[id]),
      `no packaged Chromium locale covers the shipped UI locale ${id}`,
    );
  }
});

test("Windows packages and windows use the canonical dcode icon", () => {
  assert.equal(packageJson.build.win.icon, "build/icon.ico");
  assert.deepEqual(
    packageJson.build.win.extraResources.find((resource) => resource.to === "app-icon.ico"),
    {
      from: "build/icon.ico",
      to: "app-icon.ico",
    },
  );
  assert.deepEqual([...windowsIcon.subarray(0, 4)], [0, 0, 1, 0]);
  assert.ok(windowsIcon.readUInt16LE(4) >= 4, "ICO must contain multiple sizes");
  assert.match(iconScriptSource, /windows_icon = BUILD \/ "icon\.ico"/);
  assert.match(iconScriptSource, /format="ICO"/);
  assert.match(windowSource, /function windowsIconPath\(\)/);
  assert.match(windowSource, /app\.isPackaged\s*\n?\s*\?\s*process\.resourcesPath/);
  assert.match(windowSource, /app-icon\.ico/);
  assert.match(windowSource, /icon: windowsIconPath\(\)/);
});

test("Linux packages align the desktop entry with the Wayland app identity", () => {
  assert.equal(packageJson.desktopName, "dcode.desktop");
  assert.equal(packageJson.build.linux.syncDesktopName, true);
});

test("macOS development uses the canonical dcode Dock icon", () => {
  assert.match(
    brandingSource,
    /process\.platform !== "darwin" \|\| !isDevelopmentBuild \|\| !app\.dock/,
  );
  assert.match(
    brandingSource,
    /join\(app\.getAppPath\(\), "build", "icon_1024\.png"\)/,
  );
  assert.match(brandingSource, /nativeImage\.createFromPath\(iconPath\)/);
  assert.match(brandingSource, /if \(icon\.isEmpty\(\)\)/);
  assert.match(brandingSource, /app\.dock\.setIcon\(icon\)/);
  // Branding is the first thing readiness does, after the only statement that
  // may precede it: the bail for a launch that lost the single-instance lock
  // and must not touch the running app's Dock tile.
  assert.match(
    startupSource,
    /if \(!hasSingleInstanceLock\) return;\s+applyDevelopmentBranding\(\);/,
  );
});

test("macOS icon derivation preserves the canonical renderer asset", () => {
  assert.match(iconScriptSource, /SOURCE = BUILD \/ "icon_1024\.png"/);
  assert.match(iconScriptSource, /with Image\.open\(SOURCE\) as source/);
  assert.doesNotMatch(
    iconScriptSource,
    /\.save\(BUILD \/ "icon_1024\.png"\)/,
  );
});

test("macOS development launches from a branded host bundle", () => {
  assert.equal(packageJson.scripts.dev, "node scripts/dev-electron.mjs");
  assert.match(devScriptSource, /process\.platform === "darwin"/);
  assert.match(devScriptSource, /DCODE_DEV: "1"/);
  assert.match(devScriptSource, /ELECTRON_EXEC_PATH/);
  assert.match(devScriptSource, /CFBundleDisplayName", APP_NAME/);
  assert.match(devScriptSource, /CFBundleName", APP_NAME/);
  assert.match(devScriptSource, /CFBundleExecutable", APP_NAME/);
  assert.match(devScriptSource, /CFBundleIconFile", "icon\.icns"/);
  assert.match(
    devScriptSource,
    /copyFileSync\(iconPath, join\(resources, "icon\.icns"\)\)/,
  );
  assert.match(devScriptSource, /verbatimSymlinks: true/);
  assert.match(devScriptSource, /join\(ROOT, "\.cache", "electron-dev"\)/);
  assert.doesNotMatch(devScriptSource, /node_modules.*Info\.plist/);
});

test(
  "development launcher can be imported without starting Electron",
  async () => {
    const launcher = await import(devScriptUrl.href);
    assert.equal(typeof launcher.prepareMacDevelopmentBundle, "function");
  },
);

test(
  "macOS development bundle rewrites native identity and reuses its cache",
  { skip: process.platform !== "darwin" },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "dcode-dev-bundle-"));
    const sourceBundle = join(root, "Electron.app");
    const contents = join(sourceBundle, "Contents");
    const macos = join(contents, "MacOS");
    const resources = join(contents, "Resources");
    const executable = join(macos, "Electron");
    const iconPath = join(root, "source.icns");
    const cacheRoot = join(root, "cache");

    try {
      await mkdir(macos, { recursive: true });
      await mkdir(resources, { recursive: true });
      await writeFile(executable, "electron-host");
      await writeFile(iconPath, "canonical-icon");
      await writeFile(
        join(contents, "Info.plist"),
        `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleDisplayName</key><string>Electron</string>
<key>CFBundleName</key><string>Electron</string>
<key>CFBundleExecutable</key><string>Electron</string>
<key>CFBundleIdentifier</key><string>com.github.Electron</string>
<key>CFBundleIconFile</key><string>electron.icns</string>
</dict></plist>`,
      );

      const { prepareMacDevelopmentBundle } = await import(devScriptUrl.href);
      const options = {
        electronExecutable: executable,
        electronVersion: "test-version",
        iconPath,
        cacheRoot,
        sign: false,
      };
      const brandedExecutable = prepareMacDevelopmentBundle(options);
      const brandedContents = join(
        brandedExecutable,
        "..",
        "..",
      );
      const plist = await readFile(join(brandedContents, "Info.plist"), "utf8");

      assert.equal(await readFile(brandedExecutable, "utf8"), "electron-host");
      assert.equal(
        await readFile(join(brandedContents, "Resources", "icon.icns"), "utf8"),
        "canonical-icon",
      );
      assert.match(plist, /<string>dcode<\/string>/);
      assert.match(plist, /<string>net\.dcode\.app\.dev<\/string>/);
      assert.equal(prepareMacDevelopmentBundle(options), brandedExecutable);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
