/**
 * Composer paste regression fixture (real contenteditable, real preload, real
 * scratch writer) for the Vue renderer.
 *
 * The components are Vue 3 SFCs, so the tree is assembled with `createApp` /
 * `defineComponent` / `h`, and the app's own vue-i18n instance
 * (`src/renderer/i18n.ts`) is installed the way `src/renderer/main.ts` installs
 * it.
 *
 * Every adaptation is an API bridge, not a weakened check:
 *
 *  1. **State writes commit asynchronously.** `await nextTick()` is the way to
 *     await that commit, and it replaces every synchronous-commit call site,
 *     including the one that wrapped the synthetic paste dispatch. The
 *     `await pastePending` / `setTimeout(0)` / `requestAnimationFrame` settling
 *     that followed is unchanged.
 *  2. **Remount by key is asynchronous.** A synchronous commit would unmount the
 *     old tree *before* `resetComposerDraftCache()` ran. Vue patches on the
 *     microtask queue, so `reset()` unmounts (v-if), awaits, clears the cache,
 *     then bumps the key and awaits again — the disposing instance persists its
 *     own draft from `onScopeDispose`, and clearing before that would be undone
 *     by it. Same fresh-cache/fresh-mount contract, opposite order.
 *  3. **Render errors are caught by `app.config.errorHandler`.** Vue's handler
 *     also covers watcher and lifecycle errors, so the `errors.length === 0`
 *     checks are a superset of a render-only capture, never a subset.
 *  4. **The hook options are the composable's.** `useComposerDraft` no longer
 *     takes `t` (it reads `useI18n()`), and its `activeSessionId` /
 *     `workspacePath` / `sessions` / `inputBlocked` inputs are
 *     `MaybeRefOrGetter`s — a composable body runs once, so a plain value would
 *     freeze at the first session. `useComposerAttachments` likewise reads `t`
 *     itself and takes `activeSessionId` / `draftKey` / `largePasteThreshold` as
 *     getters.
 *  5. **`ComposerInput`'s callback props are emits.** `onPaste` -> `@paste`,
 *     `onInput` -> `@input`, `onInsertNewline` -> `@insert-newline`, and so on;
 *     `h` wires them as `onPaste`, `onInput`, ... matching the props the
 *     component declares.
 *  6. **`inputRef` must be handed over as the ref object.** `ComposerInput.vue`
 *     attaches the passed `Ref` with `:ref`; `h()` passes the prop through
 *     un-unwrapped (props are `shallowReactive`), so `draft.ref` is passed as
 *     the object, not `.value`.
 *  7. **The store is the Pinia store.** `useAppStore.setState` is
 *     `patchAppState` (the store's `setState` counterpart) and
 *     `currentAppState()` is the `getState()` counterpart.
 *  8. **`composerAc` is a real controller object.** `ComposerInput` reads
 *     `open` / `hasItems` / `items` / `highlight` through `toValue`, so a closed
 *     stub with every member is built here.
 */
import { computed, createApp, defineComponent, h, nextTick, ref } from "vue";
import { i18n } from "../../src/renderer/i18n";
import ComposerInput from "../../src/renderer/features/chat/composer/ComposerInput.vue";
import { useComposerAttachments } from "../../src/renderer/features/chat/composer/hooks/useComposerAttachments";
import {
  useComposerDraft,
  type ComposerDraftController,
} from "../../src/renderer/features/chat/composer/hooks/useComposerDraft";
import {
  editorSelectionRange,
  readEditorValue,
  setEditorCaret,
} from "../../src/renderer/features/chat/composer/editor";
import type { ComposerAutocompleteController } from "../../src/renderer/hooks/use-composer-autocomplete";
import { api } from "../../src/renderer/lib/api";
import {
  readComposerDraft,
  resetComposerDraftCache,
} from "../../src/renderer/lib/composer-draft-cache";
import { patchAppState, initializeAppStore } from "../../src/renderer/stores/app-store";
import { rendererPinia } from "../../src/renderer/stores/pinia";

declare global {
  var composerPasteProbe: () => Promise<unknown>;
}
const assert = (value: unknown, message: string) => {
  if (!value) throw new Error(message);
};
const sessions = [{ id: "paste-a" }, { id: "paste-b" }];
const noop = () => {};
let controller: ComposerDraftController;
let pastePending: Promise<unknown> | undefined;

/** Closed autocomplete controller; see note 8. */
const composerAc: ComposerAutocompleteController = {
  open: computed(() => false),
  mode: computed(() => null),
  query: computed(() => ""),
  items: computed(() => []),
  hasItems: computed(() => false),
  highlight: ref(0),
  setHighlight: noop,
  truncated: computed(() => false),
  noWorkspace: computed(() => false),
  close: noop,
  accept: () => null,
};

const Fixture = defineComponent({
  name: "ComposerPasteFixture",
  props: { sessionId: { type: String, required: true } },
  setup(props) {
    const draft = useComposerDraft({
      variant: "docked",
      activeSessionId: () => props.sessionId,
      workspacePath: "",
      sessions,
      composerPrefill: null,
      clearComposerPrefill: noop,
      invalidatePromptEnhancement: noop,
      inputBlocked: false,
    });
    controller = draft;
    const attachments = useComposerAttachments({
      inputBlocked: false,
      activeSessionId: () => props.sessionId,
      draftKey: () => draft.draftKey,
      largePasteThreshold: 600,
      draft,
    });
    return () =>
      h(ComposerInput, {
        inputRef: draft.ref,
        value: draft.value,
        placeholderText: "",
        placeholderKey: "fixture",
        inputBlocked: attachments.pasting.value,
        pasting: attachments.pasting.value,
        enterToSend: false,
        runActive: false,
        composerAc,
        onPaste: (event: ClipboardEvent) => {
          pastePending = Promise.resolve(attachments.pasteClipboardFiles(event));
        },
        onAcceptCompletion: noop,
        onSubmit: noop,
        onInsertNewline: draft.insertNewlineInEditor,
        onInput: draft.handleInput,
        onCompositionStart: noop,
        onCompositionEnd: noop,
        onFocus: noop,
        onBlur: noop,
      });
  },
});

globalThis.composerPasteProbe = async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const errors: unknown[] = [];
  // The app's real store, with its real i18n instance, before first use.
  initializeAppStore();
  const mounted = ref(true);
  const key = ref(0);
  const sessionId = ref("paste-a");
  const Root = defineComponent({
    name: "ComposerPasteRoot",
    setup: () => () =>
      mounted.value
        ? h(Fixture, { key: key.value, sessionId: sessionId.value })
        : null,
  });
  const app = createApp(Root);
  app.use(rendererPinia);
  app.use(i18n);
  // The render-error capture the probe reads; see note 3.
  app.config.errorHandler = (error) => {
    errors.push(error);
  };
  app.mount(host);
  const render = (nextSessionId = "paste-a") => {
    sessionId.value = nextSessionId;
    patchAppState({ activeSessionId: nextSessionId });
  };
  const reset = async (
    source = "prefix REPLACE suffix",
    start = 7,
    end = 14,
  ) => {
    render();
    mounted.value = false;
    await nextTick();
    resetComposerDraftCache();
    key.value += 1;
    mounted.value = true;
    await nextTick();
    const editor = controller.ref.value!;
    controller.applyEditorDraft(source, [], start);
    await nextTick();
    await new Promise(requestAnimationFrame);
    editor.focus();
    const range = document.createRange();
    range.setStart(editor.firstChild!, start);
    range.setEnd(editor.firstChild!, end);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    return editor;
  };
  const dispatchPaste = async (
    editor: HTMLDivElement,
    text: string,
    files: File[],
  ) => {
    const data = new DataTransfer();
    if (text) {
      data.setData("text/plain", text);
      data.setData("text/html", `<b>${text}</b>`);
    }
    for (const file of files) data.items.add(file);
    const event = new ClipboardEvent("paste", {
      clipboardData: data,
      bubbles: true,
      cancelable: true,
    });
    editor.dispatchEvent(event);
    await nextTick();
    await pastePending;
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert(event.defaultPrevented, "paste was not handled");
    assert(
      errors.length === 0,
      `Vue failed: ${errors.map(String).join("; ")}`,
    );
    return editor;
  };
  const paste = async (text: string, files: File[], empty = false) =>
    dispatchPaste(await (empty ? reset("", 0, 0) : reset()), text, files);
  const select = (editor: HTMLElement, start: number, end: number) => {
    setEditorCaret(editor, start);
    const selection = window.getSelection()!;
    const range = selection.getRangeAt(0).cloneRange();
    setEditorCaret(editor, end);
    const last = selection.getRangeAt(0);
    range.setEnd(last.startContainer, last.startOffset);
    selection.removeAllRanges();
    selection.addRange(range);
  };
  try {
    const nativeFiles = Array.from(
      (document.getElementById("native-files") as HTMLInputElement).files!,
    );
    assert(
      nativeFiles.length === 2 &&
        nativeFiles.every((file) => api.getDroppedFilePath(file)),
      "native File paths unavailable through real preload",
    );
    const image = new File([await nativeFiles[0].arrayBuffer()], "image.png", {
      type: "image/png",
    });
    assert(
      !api.getDroppedFilePath(image),
      "synthetic clipboard image unexpectedly has a native path",
    );
    const text = "Word paragraph 中文\nsecond line";
    let editor = await paste(text, [image]);
    assert(
      readEditorValue(editor) === `prefix ${text} suffix`,
      `Word text mismatch: ${JSON.stringify(readEditorValue(editor))}; white-space=${getComputedStyle(editor).whiteSpace}; contenteditable=${editor.contentEditable}; DOM=${editor.innerHTML}`,
    );
    assert(
      controller.fileReferences.length === 0,
      "Word text created an image reference",
    );
    assert(
      editorSelectionRange(editor).start === 7 + text.length,
      `text paste caret moved: ${editorSelectionRange(editor).start} expected ${7 + text.length}; DOM=${editor.innerHTML}`,
    );
    assert(!editor.querySelector("b"), "rich HTML entered the draft");

    const multilineCases = [
      "first\r\n\r\nlast\r\n",
      '<img src=x onerror="throw 1">\n<&> "quotes" \'single\'',
      "  leading \ntrailing  ",
      "line\n\n",
      // A Word selection can start above the copied text, so the pasted string
      // may begin with one or more line breaks.
      "\nsecond",
      "\n\nline",
      "\nA\nB\n",
    ];
    for (const content of multilineCases) {
      editor = await paste(content, [image]);
      const normalized = content.replace(/\r\n?/g, "\n");
      assert(
        readEditorValue(editor) === `prefix ${normalized} suffix`,
        `multiline text changed: ${JSON.stringify(readEditorValue(editor))}`,
      );
      assert(
        editorSelectionRange(editor).start === 7 + normalized.length,
        "multiline caret moved",
      );
      assert(
        !editor.querySelector("img,script,b"),
        "plain text interpreted as HTML",
      );
      assert(document.execCommand("undo"), "native undo unavailable");
      await new Promise(requestAnimationFrame);
      assert(
        readEditorValue(editor) === "prefix REPLACE suffix",
        "undo did not restore the replaced selection",
      );
      assert(document.execCommand("redo"), "native redo unavailable");
      await new Promise(requestAnimationFrame);
      assert(
        readEditorValue(editor) === `prefix ${normalized} suffix`,
        "redo lost multiline text",
      );
    }
    editor = await paste("line\n\n", [image], true);
    assert(
      readEditorValue(editor) === "line\n\n",
      `trailing newlines lost: ${JSON.stringify(readEditorValue(editor))}`,
    );
    assert(
      editorSelectionRange(editor).start === 6,
      "empty editor paste caret moved",
    );

    // Forced insertHTML failure: the raw-DOM fallback must still store the
    // editor's LF draft model instead of the clipboard's CRLF bytes.
    const realExecCommand = document.execCommand.bind(document);
    document.execCommand = ((
      commandId: string,
      ...rest: [boolean?, string?]
    ) =>
      commandId === "insertHTML"
        ? false
        : realExecCommand(commandId, ...rest)) as typeof document.execCommand;
    try {
      editor = await paste("fallback\r\ntext", [image], true);
      assert(
        readEditorValue(editor) === "fallback\ntext",
        `fallback kept clipboard line endings: ${JSON.stringify(readEditorValue(editor))}`,
      );
    } finally {
      document.execCommand = realExecCommand;
    }

    const beforeReplace = "one\nTWO\nthree";
    editor = await paste(beforeReplace, [image], true);
    assert(
      editor.querySelector("br"),
      "multiline fixture is missing a real BR",
    );
    select(editor, 2, 8);
    await dispatchPaste(editor, "A\nB", [image]);
    assert(
      readEditorValue(editor) === "onA\nBthree",
      "replacement across BR changed surrounding text",
    );
    assert(
      editorSelectionRange(editor).start === 5,
      "replacement across BR moved caret",
    );
    assert(document.execCommand("undo"), "cross-BR undo unavailable");
    await new Promise(requestAnimationFrame);
    assert(
      readEditorValue(editor) === beforeReplace,
      "cross-BR undo changed text",
    );
    assert(document.execCommand("redo"), "cross-BR redo unavailable");
    await new Promise(requestAnimationFrame);
    assert(
      readEditorValue(editor) === "onA\nBthree",
      "cross-BR redo changed text",
    );

    const longText = "字".repeat(601);
    editor = await paste(longText, [image]);
    assert(
      controller.fileReferences.length === 1 &&
        controller.fileReferences[0].mimeType === "text/plain",
      "large mixed paste did not use the text threshold",
    );
    assert(
      readEditorValue(editor) ===
        `prefix ${controller.fileReferences[0].token} suffix`,
      "large text chip lost the selection boundary",
    );

    await paste("", [image]);
    assert(
      controller.fileReferences.length === 1 &&
        controller.fileReferences[0].kind === "image",
      "image-only paste changed",
    );
    await paste("native-image.png", [nativeFiles[0]]);
    assert(
      controller.fileReferences.length === 1 &&
        controller.fileReferences[0].kind === "image",
      "native image file was mistaken for text",
    );
    await paste("file names", nativeFiles);
    assert(
      controller.fileReferences.length === 2,
      "mixed native files were lost",
    );
    assert(
      controller.fileReferences[1].mimeType === "text/plain",
      "native text file became inline text",
    );

    const saved = readComposerDraft("paste-a");
    assert(
      saved?.fileReferences.length === 2,
      "file references did not persist in the owning draft",
    );
    render("paste-b");
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert(controller.value === "", "attachments leaked into another session");
    render("paste-a");
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert(
      controller.fileReferences.length === 2,
      "session switch lost attachments",
    );
    const reference = controller.fileReferences[0];
    controller.applyEditorDraft(
      `left${reference.token}right`,
      [reference],
      4,
    );
    await nextTick();
    await new Promise(requestAnimationFrame);
    editor = controller.ref.value!;
    select(editor, 3, 6);
    await dispatchPaste(editor, "X\nY", [image]);
    assert(
      readEditorValue(editor) === "lefX\nYight",
      "replacement across attachment chip changed surrounding text",
    );
    assert(
      controller.fileReferences.length === 0,
      "replaced attachment stayed in draft metadata",
    );
    return {
      ok: true,
      mixedShortText: true,
      multilineAndUndoRedo: true,
      crossBreakAndChipSelection: true,
      mixedLongText: true,
      imageOnly: true,
      nativeImageFile: true,
      nativeMultipleFiles: true,
      selectionAndSessionDrafts: true,
    };
  } finally {
    app.unmount();
    host.remove();
    resetComposerDraftCache();
  }
};
