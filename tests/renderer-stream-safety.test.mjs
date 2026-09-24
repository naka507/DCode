import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererHtml = await readFile(
  new URL("../src/renderer/index.html", import.meta.url),
  "utf8",
);

test("renderer CSP permits only local and bundled data fonts", () => {
  // `plugin-asset:` is host-owned and package-scoped — it serves only files a
  // loaded plugin declared — so a contributed theme font is still a local load.
  assert.match(rendererHtml, /font-src 'self' data: plugin-asset:;/);
  assert.doesNotMatch(rendererHtml, /font-src[^;]*https?:/);
});
