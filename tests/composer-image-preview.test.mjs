/**
 * Composer image attachments and preview.
 *
 * The three `detachImageTokens` cases cover a framework-free module.
 * Everything else here covers the parts that are bound to the Vue surface,
 * because those are where a silent divergence can hide:
 *
 *  - the attachment strip and the preview dialog are SFCs whose class names must
 *    still be the ones `styles/composer-image-preview.css` defines;
 *  - the preview is gated in `ComposerInput.vue` rather than inside the dialog,
 *    so the blocking-overlay claim belongs to the dialog's lifetime;
 *  - the work panel has to hide native `WebContentsView`s under that overlay,
 *    which is the one part of the change that is not in the composer;
 *  - the eight `chat.imagePreview.*` keys must exist in both shipped locales.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  detachImageTokens,
  isImageReference,
} from "../src/renderer/features/chat/composer/image-attachments.ts";
import { definedClasses, templateOf, usedClasses } from "./helpers/class-contract.mjs";
import { loadStylesSync } from "./helpers/styles.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const en = read("../src/i18n/locales/en/index.ts");
const zh = read("../src/i18n/locales/zh-CN/index.ts");
const attachments = read("../src/renderer/features/chat/composer/ComposerImageAttachments.vue");
const preview = read("../src/renderer/features/chat/composer/ComposerImagePreview.vue");
const input = read("../src/renderer/features/chat/composer/ComposerInput.vue");
const composer = read("../src/renderer/components/Composer.vue");
const draft = read("../src/renderer/features/chat/composer/hooks/useComposerDraft.ts");
const workPanel = read("../src/renderer/components/workpanel/WorkPanel.vue");
const blockingOverlay = read("../src/renderer/lib/blocking-overlay.ts");
const globals = read("../src/renderer/styles/globals.css");

const image = { id: "image", sessionId: "a", path: "/scratch/a.png", name: "a.png", kind: "image", token: "\ue001" };
const file = { id: "file", sessionId: "a", path: "/scratch/a.txt", name: "a.txt", kind: "file", token: "\ue002" };

test("restored inline images retain identity and paths while text and file chips retain order", () => {
  const result = detachImageTokens(`before ${image.token}${file.token} after`, [image, file], 9);
  assert.equal(result.text, `before ${file.token} after`);
  assert.equal(result.caret, 8);
  const { token, ...detachedImage } = image;
  assert.deepEqual(result.references, [detachedImage, file]);
  assert.equal(image.token, "\ue001");
});

test("image-only drafts keep metadata and a valid empty-text caret", () => {
  const result = detachImageTokens(image.token, [image], 1);
  assert.equal(result.text, "");
  assert.equal(result.caret, 0);
  assert.equal(result.references[0].path, image.path);
  assert.equal(result.references[0].token, undefined);
});

test("MIME image references detach without changing earlier text or repeated normalization", () => {
  const result = detachImageTokens(`abc${image.token}def${image.token}`, [{ ...image, kind: "file", mimeType: "IMAGE/PNG" }], 2);
  assert.equal(result.text, "abcdef");
  assert.equal(result.caret, 2);
  assert.deepEqual(detachImageTokens(result.text, result.references, result.caret), result);
});

test("an image reference is recognized by kind or by a case-insensitive MIME prefix", () => {
  assert.equal(isImageReference({ ...image, kind: "image", mimeType: undefined }), true);
  assert.equal(isImageReference({ ...image, kind: "file", mimeType: "image/png" }), true);
  assert.equal(isImageReference({ ...image, kind: "file", mimeType: "IMAGE/JPEG" }), true);
  assert.equal(isImageReference({ ...image, kind: "file", mimeType: "text/plain" }), false);
  assert.equal(isImageReference({ ...image, kind: "file", mimeType: undefined }), false);
});

test("the strip and the dialog only render class names the stylesheet defines", () => {
  const defined = definedClasses(loadStylesSync());
  const rendered = new Set();
  for (const source of [attachments, preview]) {
    for (const name of usedClasses(templateOf(source))) rendered.add(name);
  }
  assert.deepEqual(
    [...rendered].filter((name) => !defined.has(name)).sort(),
    [],
    "a rendered class name has no rule in src/renderer/styles/*.css",
  );
  // The stylesheet itself has to be sequenced, or the rules never load.
  assert.match(globals, /@import "\.\/composer-image-preview\.css";/);
});

test("the preview dialog is gated outside the dialog so the overlay claim matches its lifetime", () => {
  // `useBlockingOverlay()` runs at setup and releases on scope dispose, so the
  // component must only exist while the preview is open.
  assert.match(input, /v-if="props\.imagePreview\?\.preview"/);
  assert.match(input, /<ComposerImagePreview/);
  assert.match(preview, /useBlockingOverlay\(\)/);
  assert.match(blockingOverlay, /onScopeDispose/);
  // The dialog needs the native top layer; it portals to `document.body`.
  assert.match(preview, /<Teleport to="body">/);
  assert.match(preview, /showModal\(\)/);
});

test("the work panel hides native views under a blocking overlay", () => {
  assert.match(workPanel, /useBlockingOverlayActive\(\)/);
  assert.match(
    workPanel,
    /:blocked="exiting \|\| panelBlocked \|\| blockingOverlayActive"/,
  );
});

test("the draft controller owns the preview and the image removal path", () => {
  assert.match(draft, /const imagePreview = useComposerImagePreview\(\{/);
  assert.match(draft, /^\s+imagePreview,$/m);
  assert.match(draft, /removeImage: \(id\) => \{/);
  assert.match(draft, /reference\.id !== id/);
  // Attachments alone make a draft non-empty: images carry no chip in the text.
  assert.match(composer, /draft\.value\.trim\(\) \|\| draft\.activeFileReferences\.length/);
  assert.match(composer, /<ComposerImageAttachments/);
  assert.match(composer, /:image-preview="draft\.imagePreview"/);
});

test("the image-preview copy exists in both shipped locales at the same relative offset", () => {
  const keys = [
    "title",
    "download",
    "previous",
    "next",
    "fit",
    "error",
    "retry",
    "position",
  ];
  for (const source of [en, zh]) {
    assert.match(source, /^  chat: \{\n    imagePreview: \{$/m);
    for (const key of keys) {
      assert.match(source, new RegExp(`^      ${key}: "`, "m"), `${key} is missing`);
    }
  }
  // Both catalogs keep the i18next dialect: a `{{...}}` placeholder, never a
  // vue-i18n `{...}` interpolation.
  assert.match(en, /position: "\{\{current\}\} of \{\{total\}\}"/);
  assert.match(zh, /position: "\{\{current\}\} \/ \{\{total\}\}"/);
});
