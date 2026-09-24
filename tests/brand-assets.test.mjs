import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  decodePng,
  gifHeader,
  gifInkLuminance,
  opaqueMedianLuminance,
} from "./helpers/image-stats.mjs";

/**
 * The brand assets, checked as pixels rather than as file names.
 *
 * `styles/chat-shell.css` shows the `-dark` pair on the dark theme and the
 * `-light` pair on the light theme, and `BrandLogo.vue` swaps on `data-theme`
 * the same way. The dark theme's surfaces are dark, so its variant must carry
 * *light* art — a swap of the two would make the mark invisible on one theme
 * and no name-based assertion could tell.
 */

const asset = (name) =>
  new URL(`../src/renderer/assets/${name}`, import.meta.url);

async function read(name) {
  return readFile(asset(name));
}

test("the mascot stills exist as a light/dark pair with opposite polarity", async () => {
  const dark = decodePng(await read("home-mascot-still-dark.png"));
  const light = decodePng(await read("home-mascot-still-light.png"));

  assert.equal(dark.width, 200);
  assert.equal(dark.height, 200);
  assert.equal(light.width, 200);
  assert.equal(light.height, 200);

  const darkLum = opaqueMedianLuminance(dark);
  const lightLum = opaqueMedianLuminance(light);

  // The dark theme shows `-dark`, so that asset is the light drawing.
  assert.ok(
    darkLum > 128,
    `home-mascot-still-dark.png must carry light art for the dark theme (median luminance ${darkLum})`,
  );
  assert.ok(
    lightLum < 128,
    `home-mascot-still-light.png must carry dark art for the light theme (median luminance ${lightLum})`,
  );
});

test("the mascot stills keep a transparent background", async () => {
  for (const name of [
    "home-mascot-still-dark.png",
    "home-mascot-still-light.png",
  ]) {
    const png = decodePng(await read(name));
    assert.equal(png.channels, 4, `${name} must keep an alpha channel`);
    const corner = (x, y) => png.pixels[(y * png.width + x) * 4 + 3];
    for (const [x, y] of [
      [0, 0],
      [png.width - 1, 0],
      [0, png.height - 1],
      [png.width - 1, png.height - 1],
    ]) {
      assert.equal(corner(x, y), 0, `${name} corner (${x},${y}) must be transparent`);
    }
  }
});

test("the mascot animation is a light/dark pair of the same length", async () => {
  const dark = gifHeader(await read("home-mascot-dark.gif"));
  const light = gifHeader(await read("home-mascot-light.gif"));

  for (const [name, header] of [
    ["home-mascot-dark.gif", dark],
    ["home-mascot-light.gif", light],
  ]) {
    assert.equal(header.width, 200, name);
    assert.equal(header.height, 200, name);
    // The transparent index doubles as the logical-screen background index, so
    // a decoder that honours the background cannot paint a stray colour behind
    // the art.
    assert.equal(
      header.transparentIndex,
      header.backgroundIndex,
      `${name} must declare its transparent entry as the background index`,
    );
  }

  const darkLum = gifInkLuminance(dark);
  const lightLum = gifInkLuminance(light);
  assert.ok(darkLum > 128, `home-mascot-dark.gif must draw light art (got ${darkLum})`);
  assert.ok(lightLum < 128, `home-mascot-light.gif must draw dark art (got ${lightLum})`);
});

test("the brand marks are complementary", async () => {
  const dark = decodePng(await read("brand/logo-dark.png"));
  const light = decodePng(await read("brand/logo-light.png"));

  assert.equal(dark.width, 192);
  assert.equal(light.width, 192);

  // Both marks are an opaque tile carrying a contrasting glyph, so the same
  // asset contains both polarities; the contract is that they are inverses.
  const darkLum = opaqueMedianLuminance(dark);
  const lightLum = opaqueMedianLuminance(light);
  assert.ok(
    Math.abs(darkLum - lightLum) > 100,
    `the two brand marks must be complementary (${darkLum} vs ${lightLum})`,
  );
  assert.ok(darkLum < lightLum, "the light mark must be the brighter one");
});

test("packaged builds ship a tray icon on every platform", async () => {
  // `trayIconPath()` looks for `tray-icon-mac.png` on macOS and `tray-icon.png`
  // elsewhere under `process.resourcesPath`. Without these extraResources the
  // lookup finds nothing, `createTray()` only logs a warning and returns, and
  // a packaged app has no tray at all — which no source-text assertion catches.
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const shipped = new Set();
  const collect = (entries) => {
    for (const entry of entries ?? []) shipped.add(entry.to);
  };
  collect(packageJson.build.extraResources);
  for (const target of ["win", "mac", "linux"]) {
    collect(packageJson.build[target]?.extraResources);
  }

  assert.ok(
    shipped.has("tray-icon.png"),
    "a packaged build must ship tray-icon.png (Windows/Linux tray)",
  );
  assert.ok(
    shipped.has("tray-icon-mac.png"),
    "a packaged build must ship tray-icon-mac.png (macOS tray)",
  );
});

test("the macOS DMG plates match the window electron-builder fits them into", async () => {
  // `dmg-builder` measures the plate with `sips` and uses those pixel
  // dimensions as the Finder window size — `build.dmg.window` is only read when
  // there is no background image, so it does not size anything here. The plate
  // therefore has to be the size the `build.dmg.contents` coordinates were laid
  // out against, and its retina companion has to be exactly double, because
  // `tiffutil -cathidpicheck` pairs the two by their pixel ratio. A plate of
  // another size moves the window out from under the icons; neither failure is
  // visible in a source-text assertion.
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const oneX = decodePng(
    await readFile(new URL("../build/dmg-background.png", import.meta.url)),
  );
  const twoX = decodePng(
    await readFile(new URL("../build/dmg-background@2x.png", import.meta.url)),
  );

  assert.equal(packageJson.build.dmg.background, "build/dmg-background.png");
  assert.deepEqual(
    { width: oneX.width, height: oneX.height },
    packageJson.build.dmg.window,
    "the 1x plate must match the window size the DMG layout is declared for",
  );
  assert.equal(twoX.width, oneX.width * 2, "the retina plate must be 2x wide");
  assert.equal(twoX.height, oneX.height * 2, "the retina plate must be 2x tall");
});
