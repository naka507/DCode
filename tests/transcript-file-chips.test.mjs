import {
  readTranscriptModule,
  readTranscriptSource,
} from "./helpers/source-contracts.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * Transcript file-chip routing and verification.
 *
 * The last case landed with a1db7e99 (the #649 regression set for f3843754).
 * The assertions that named JSX props were retranslated:
 *
 *  - `className="composer-chip chat-file-chip"` -> the same attribute in a Vue
 *    template, and `function FileRefChip` -> the `FileRefChip.vue` SFC, which
 *    has no in-file function declaration to match. The first assertion is now
 *    the chip's class attribute plus the component import.
 *  - `segment.target.kind === "file"` -> the template's single-quoted form.
 *  - `openUrl(...)` / `openFile(target, mimeType)` -> the store actions
 *    `openUrlInWorkPanel` / `openFileInWorkPanel`, because the hook calls the
 *    store directly instead of destructuring actions first.
 *  - `useVerifiedChatText(text, attachments)` -> the composable takes
 *    getters, so the call site is `useVerifiedChatText(() => props.text, ...)`.
 *  - `attachments={message.attachments}` -> `:attachments="message.attachments"`.
 *  - `useAppStore((s) => s.workspace?.path)` -> `store.appState?.workspace?.path`
 *    read through a `computed`; the negative assertion that the *workspace
 *    object* is not the dependency is expressed against the store read instead.
 *  - `toolRow`'s `openTarget(previewTarget)` -> the row binds the
 *    computed to a local first (`const target = previewTarget.value`), so the
 *    call is `openTarget(target)`.
 *  - `ToolDetails`'s two inline `openTarget({ kind: "file", path: rel })` call
 *    sites -> one shared `openFile(path)` helper in the component, so the
 *    assertion counts one call site and pins the helper.
 */

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [transcript, styles, hook, api, toolDetails, toolRow, linkified, chip] =
  await Promise.all([
    readTranscriptSource(),
    read("../src/renderer/styles/chat-links.css"),
    read("../src/renderer/hooks/use-preview-target.ts"),
    read("../src/renderer/lib/api.ts"),
    read("../src/renderer/components/ToolDetails.vue"),
    readTranscriptModule("ToolRow.vue"),
    readTranscriptModule("LinkifiedText.vue"),
    readTranscriptModule("FileRefChip.vue"),
  ]);

test("sent user-message file refs render as composer-like chips", () => {
  assert.match(chip, /class="composer-chip chat-file-chip"/);
  assert.match(linkified, /import FileRefChip from "\.\/FileRefChip\.vue"/);
  assert.match(linkified, /segment\.target\.kind === 'file'/);
  assert.match(linkified, /useOpenChatFileRef/);
  assert.match(chip, /composer-chip-name/);
  assert.match(styles, /\.chat-file-chip[\s\S]*?appearance: none/);
});

test("a file chip is routed by where the reference resolved, never optimistically", () => {
  // Completion happens in the main process first, so the click can no longer
  // open a path that does not exist — the empty panel this used to produce is
  // replaced by a report.
  assert.match(hook, /api\.fsResolveRef\(/);
  assert.match(hook, /chat\.fileRefMissing/);
  // A project group can hold several folders (ADR 0249), so the address shape
  // follows the folder that answered: relative for the primary one, absolute
  // for its siblings, and the file view switches to the folder it is given.
  assert.match(hook, /match\.projectRoot \? match\.projectRoot\.primary : true/);
  assert.match(hook, /inPrimary \? match\.relativePath : match\.absolutePath/);
  // A workspace HTML page is a page to run, not a file to read (ADR 0163), and
  // only the primary folder has a workspace-relative address for the browser.
  assert.match(hook, /inPrimary && isHtmlFilePath\(match\.relativePath\)/);
  assert.match(hook, /openUrlInWorkPanel\(match\.relativePath\)/);
  // A project file prefers the bundled file view; without that plugin the
  // host file tab is the same surface this hook used before.
  assert.match(hook, /FILE_MANAGER_PLUGIN_TAB/);
  assert.match(hook, /fileManagerPluginTab\(target\)/);
  assert.match(hook, /openFileInWorkPanel\(target, mimeType\)/);
  // Session scratch and attachment files live outside the plugin's project
  // roots, so they are addressed by absolute path on the host file tab.
  assert.match(hook, /openFileInWorkPanel\(match\.absolutePath, mimeType\)/);
  // The OS handoff is no longer what a chat click does; the channel itself
  // stays part of the public IPC surface.
  assert.doesNotMatch(hook, /api\.fsOpen\(/);
  assert.match(api, /fsOpen: \(path: string\) => invoke\(IPC\.invoke\.fsOpen, \{ path \}\)/);
});

test("a tool row and a tool result row open a file where the message body does", () => {
  // One opener serves every transcript surface that names a file. It completes
  // the reference the same way a chat chip does instead of handing the raw path
  // to the host viewer, so a Read/Write/Edit row summary and a Glob/Grep result
  // row land in the bundled file view too (ADR 0262). The call this replaces is
  // the one that let those surfaces pick the destination themselves.
  assert.match(hook, /const openFileRef = useOpenChatFileRef\(\);/);
  assert.match(
    hook,
    /target\.kind === "file" \? openFileRef\(target\.path\) : openHttpUrl\(target\.url\)/,
  );
  assert.doesNotMatch(hook, /openFile\(target\.path\)/);
  // Both surfaces still call that opener, and neither reaches the host viewer's
  // store action directly: the tool row summary carries the call's own path,
  // and the result lists carry one entry per file and per matched file.
  assert.match(toolRow, /const openTarget = useOpenPreviewTarget\(\)/);
  assert.match(toolRow, /openTarget\(target\)/);
  assert.doesNotMatch(toolRow, /openFileInWorkPanel/);
  // The call used to be inlined twice (the file list and the match list); the
  // component funnels both through one helper.
  assert.match(toolDetails, /function openFile\(path: string\): void/);
  assert.equal(
    toolDetails.match(/openTarget\(\{ kind: "file", path: rel \}\)/g)?.length,
    1,
  );
  assert.doesNotMatch(toolDetails, /openFileInWorkPanel/);
});

test("user-message bare paths wait for fs/resolveRef before becoming chips", async () => {
  const [verified, files] = await Promise.all([
    read("../src/renderer/hooks/use-verified-chat-text.ts"),
    read("../src/renderer/lib/verified-chat-files.ts"),
  ]);
  // The composable takes getters, because a plain string argument would
  // freeze the first render's text.
  assert.match(
    linkified,
    /useVerifiedChatText\(\s*\(\) => props\.text,\s*\(\) => props\.attachments,\s*\)/,
  );
  assert.match(transcript, /:attachments="message\.attachments"/);
  // The dependency is the workspace *path* (a1db7e99), so a rename — which
  // replaces the workspace object — no longer rebuilds every visible lookup.
  assert.match(verified, /store\.appState\?\.workspace\?\.path/);
  assert.doesNotMatch(verified, /appState\?\.workspace(?!\?)/);
  assert.match(verified, /api\.fsResolveRef\(/);
  assert.match(files, /MAX_MESSAGE_CANDIDATES = 32/);
  assert.match(files, /MAX_CONCURRENT_LOOKUPS = 4/);
  assert.match(files, /!segment\.text\.startsWith\("@"\)/);
});
