/**
 * Coordinate native file import, clipboard persistence, and folder drops.
 * This keeps asynchronous attachment work out of the composer container while
 * preserving the existing session-owned draft handoff rules.
 *
 * The `useComposerAttachments` composable. Every change is mechanical:
 *
 *   - `useState` -> `ref`. The controller returns those refs, so a caller reads
 *     `pasting.value` in script and `pasting` in a template.
 *   - `useAppStore.getState()` -> `currentAppState()` for the values read
 *     mid-request, and `store.appState?.<action>` for the store
 *     actions — the same split `useComposerDraft` uses.
 *   - `t` comes from `useI18n()` the way `useComposerDraft` does, and the
 *     prop-shaped inputs are taken as `MaybeRefOrGetter` so a handler still
 *     sees the current session, draft key and threshold instead of the
 *     setup-time values.
 *   - `ClipboardEvent` / `DragEvent` hand over a non-null
 *     `dataTransfer` and a live `currentTarget`; the native events behind them
 *     type both as nullable, so each handler guards before use. The observable
 *     behaviour is unchanged.
 *   - The `pickerInFlight` ref becomes a plain `let` binding: it
 *     only guards async work and nothing renders from it, the same call
 *     `useComposerSubmit` makes for its non-reactive cells.
 */
import { computed, ref, toValue, type MaybeRefOrGetter, type Ref } from "vue";
import { useI18n } from "vue-i18n";
import { api } from "../../../../lib/api";
import {
  HOME_DRAFT_KEY,
  deleteComposerDraft,
  writeComposerDraft,
} from "../../../../lib/composer-draft-cache";
import {
  composerDropItems,
  hasComposerFileDrag,
  type ComposerDropItem,
} from "../../../../lib/composer-drop";
import type { ComposerDraftSnapshot } from "../../../../lib/composer-smart-stop";
import {
  clipboardFiles,
  createFileReference,
  editorSelectionRange,
  formatDroppedDirectoryPath,
  insertClipboardText,
  nextChipToken,
  normalizeClipboardLineEndings,
  preferClipboardText,
  readEditorValue,
  type ComposerFileReference,
} from "../editor";
import {
  currentAppState,
  materializeDraftSession,
  useAppStore,
} from "../../../../stores/app-store";
import type { ComposerDraftController } from "./useComposerDraft";

type UseComposerAttachmentsOptions = {
  inputBlocked: MaybeRefOrGetter<boolean>;
  activeSessionId: MaybeRefOrGetter<string | null | undefined>;
  draftKey: MaybeRefOrGetter<string>;
  largePasteThreshold: MaybeRefOrGetter<number>;
  draft: Pick<
    ComposerDraftController,
    | "ref"
    | "valueRef"
    | "fileReferencesRef"
    | "applyEditorDraft"
    | "snapshotReferences"
    | "commitEditorDom"
  >;
};

export type ComposerAttachmentsController = {
  pasting: Ref<boolean>;
  dropTargetActive: Ref<boolean>;
  setDropTargetActive: (active: boolean) => void;
  droppedDirectories: Ref<ComposerDropItem[]>;
  pickAndAttach: () => Promise<void>;
  pasteClipboardFiles: (event: ClipboardEvent) => void;
  attachDroppedItems: (items: ComposerDropItem[]) => Promise<void>;
  onComposerDragEnter: (event: DragEvent) => void;
  onComposerDragOver: (event: DragEvent) => void;
  onComposerDragLeave: (event: DragEvent) => void;
  onComposerDrop: (event: DragEvent) => void;
  openDroppedFolderAsProject: () => Promise<void>;
  insertDroppedDirectoryPaths: () => void;
  dismissDroppedDirectories: () => void;
};

export function useComposerAttachments({
  inputBlocked,
  activeSessionId,
  draftKey,
  largePasteThreshold,
  draft,
}: UseComposerAttachmentsOptions): ComposerAttachmentsController {
  const store = useAppStore();
  const { t } = useI18n();
  const pasting = ref(false);
  // Non-reactive on purpose: nothing renders from it, and it only closes the
  // gap between a picker click and the next patch's disabled attribute.
  let pickerInFlight = false;
  const dropTargetActive = ref(false);
  const droppedDirectories = ref<ComposerDropItem[]>([]);
  const isInputBlocked = computed(() => toValue(inputBlocked) || pasting.value);

  const snapshotReferences = (sourceSessionId: string) =>
    draft.snapshotReferences(sourceSessionId);

  const pickAndAttach = async () => {
    // The flag closes the gap before Vue re-renders the disabled button.
    if (pickerInFlight || isInputBlocked.value) return;
    pickerInFlight = true;
    pasting.value = true;
    try {
      // The picker accepts regular files; the importer classifies images from
      // MIME/extension metadata after selection.
      const result = await api.pickFiles();
      if (result.canceled || !result.token) return;

      const editor = draft.ref.value;
      const sourceValue = editor ? readEditorValue(editor) : draft.valueRef.value;
      const { start: selectionStart, end: selectionEnd } = editor
        ? editorSelectionRange(editor)
        : { start: sourceValue.length, end: sourceValue.length };
      const sourceSessionId = toValue(activeSessionId);
      const sourceDraftKey = toValue(draftKey);
      const previousReferences = snapshotReferences(sourceSessionId ?? "");
      // A picker action is real input, so a home draft gets a durable owner
      // before native paths are copied into scratch.
      const sessionId = sourceSessionId ?? (await materializeDraftSession());
      if (!sessionId) throw new Error("session unavailable");
      const imported = await api.importFiles(sessionId, result.token);
      const chips = imported.files.map((file) => {
        const token = nextChipToken();
        return {
          token,
          reference: createFileReference(file.path, file.name, sessionId, {
            kind: file.kind,
            mimeType: file.mimeType,
            token,
          }),
        };
      });
      if (!chips.length) return;
      const inserted = chips.map((chip) => chip.token).join("");
      const nextText =
        sourceValue.slice(0, selectionStart) +
        inserted +
        sourceValue.slice(selectionEnd);
      const nextReferences = [
        ...previousReferences.map((reference) =>
          createFileReference(reference.path, reference.name, sessionId, reference),
        ),
        ...chips.map((chip) => chip.reference),
      ];
      writeComposerDraft(sessionId, {
        text: nextText,
        fileReferences: [
          ...previousReferences,
          ...chips.map((chip) => toDraftReference(chip.reference)),
        ],
      });
      const currentSessionId = currentAppState().activeSessionId;
      if (currentSessionId === sessionId) {
        draft.applyEditorDraft(nextText, nextReferences, selectionStart + inserted.length);
      } else if (sourceDraftKey === HOME_DRAFT_KEY) {
        deleteComposerDraft(HOME_DRAFT_KEY);
      }
      showToast(t("chat.filesAttached", { count: chips.length }), "success");
    } catch (error) {
      showErrorToast(error);
    } finally {
      pickerInFlight = false;
      pasting.value = false;
    }
  };

  const pasteClipboardFiles = async (event: ClipboardEvent) => {
    if (isInputBlocked.value) return;
    const data = event.clipboardData;
    if (!data) return;
    const text = data.getData("text/plain");
    const pastedFiles = clipboardFiles(data);
    const files = preferClipboardText(text, pastedFiles, api.getDroppedFilePath)
      ? []
      : pastedFiles;
    const textLength = Array.from(text).length;
    const isLargeTextPaste =
      !files.length && textLength > toValue(largePasteThreshold);
    if (isLargeTextPaste || files.length) {
      event.preventDefault();
      const editor = event.currentTarget as HTMLDivElement;
      const { start: selectionStart, end: selectionEnd } = editorSelectionRange(editor);
      const sourceValue = readEditorValue(editor);
      const sourceSessionId = toValue(activeSessionId);
      const sourceDraftKey = toValue(draftKey);
      pasting.value = true;
      try {
        const payload = files.length
          ? await Promise.all(
              files.map(async (file) => ({
                name: file.name || undefined,
                mimeType: file.type || undefined,
                data: await file.arrayBuffer(),
              })),
            )
          : (() => {
              const bytes = new TextEncoder().encode(text);
              return [
                {
                  name: `pasted-text-${crypto.randomUUID().slice(0, 8)}.txt`,
                  mimeType: "text/plain",
                  recordHistory: true,
                  data: bytes.buffer.slice(
                    bytes.byteOffset,
                    bytes.byteOffset + bytes.byteLength,
                  ) as ArrayBuffer,
                },
              ];
            })();
        let sessionId = sourceSessionId;
        if (!sessionId) sessionId = (await materializeDraftSession()) ?? "";
        if (!sessionId) throw new Error("session unavailable");

        const result = await api.pasteFiles(sessionId, payload);
        const chips = result.files.map((file) => {
          const token = nextChipToken();
          return {
            token,
            reference: createFileReference(file.path, file.name, sessionId, {
              kind: file.kind,
              mimeType: file.mimeType,
              token,
            }),
          };
        });
        const inserted = chips.map((chip) => chip.token).join("");
        const nextText =
          sourceValue.slice(0, selectionStart) +
          inserted +
          sourceValue.slice(selectionEnd);
        const previousReferences = snapshotReferences(sourceSessionId ?? "");
        const nextReferences = [
          ...previousReferences.map((reference) =>
            createFileReference(reference.path, reference.name, sessionId!, reference),
          ),
          ...chips.map((chip) => chip.reference),
        ];
        writeComposerDraft(sessionId, {
          text: nextText,
          fileReferences: [
            ...previousReferences,
            ...chips.map((chip) => toDraftReference(chip.reference)),
          ],
        });
        const currentSessionId = currentAppState().activeSessionId;
        if (currentSessionId === sessionId) {
          draft.applyEditorDraft(nextText, nextReferences, selectionStart + inserted.length);
        } else if (sourceDraftKey === HOME_DRAFT_KEY) {
          deleteComposerDraft(HOME_DRAFT_KEY);
        }
        showToast(
          files.length
            ? t("chat.filesPasted", { count: result.files.length })
            : t("chat.largeTextPasted", { name: result.files[0]?.name ?? "pasted-text" }),
          "success",
        );
      } catch (error) {
        showErrorToast(error);
      } finally {
        pasting.value = false;
      }
      return;
    }

    // Small text paste is kept plain so rich HTML never enters the draft.
    event.preventDefault();
    if (!text) return;
    void api.recordClipboardPaste(text).catch(() => undefined);
    const editor = event.currentTarget as HTMLDivElement;
    if (!insertClipboardText(editor, text)) {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      range.deleteContents();
      range.insertNode(
        document.createTextNode(normalizeClipboardLineEndings(text)),
      );
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
      draft.commitEditorDom?.();
    }
  };

  const attachDroppedItems = async (items: ComposerDropItem[]) => {
    if (isInputBlocked.value || items.length === 0) return;
    const editor = draft.ref.value;
    const sourceValue = editor ? readEditorValue(editor) : draft.valueRef.value;
    const { start: selectionStart, end: selectionEnd } = editor
      ? editorSelectionRange(editor)
      : { start: sourceValue.length, end: sourceValue.length };
    const sourceSessionId = toValue(activeSessionId);
    const sourceDraftKey = toValue(draftKey);
    const previousReferences = snapshotReferences(sourceSessionId ?? "");
    const fileItems = items.filter((item) => !item.isDirectory);
    pasting.value = true;
    try {
      let sessionId = sourceSessionId;
      if (fileItems.length && !sessionId) sessionId = (await materializeDraftSession()) ?? "";
      if (fileItems.length && !sessionId) throw new Error("session unavailable");

      const pasted = fileItems.length
        ? await api
            .pasteFiles(
              sessionId!,
              await Promise.all(
                fileItems.map(async ({ file }) => ({
                  name: file.name || undefined,
                  mimeType: file.type || undefined,
                  data: await file.arrayBuffer(),
                })),
              ),
            )
            .then((result) => result.files)
        : [];
      const chips = pasted.map((file) => {
        const token = nextChipToken();
        return {
          token,
          reference: createFileReference(file.path, file.name, sessionId ?? "", {
            kind: file.kind,
            mimeType: file.mimeType,
            token,
          }),
        };
      });
      let fileIndex = 0;
      const inserted = items
        .map((item) => {
          if (item.isDirectory) return item.path ? formatDroppedDirectoryPath(item.path) : "";
          const chip = chips[fileIndex];
          fileIndex += 1;
          return chip?.token ?? "";
        })
        .filter(Boolean)
        .join(" ");
      if (!inserted) return;

      const nextText =
        sourceValue.slice(0, selectionStart) +
        inserted +
        sourceValue.slice(selectionEnd);
      const ownerSessionId = sessionId ?? "";
      const nextReferences = [
        ...previousReferences.map((reference) =>
          createFileReference(reference.path, reference.name, ownerSessionId, reference),
        ),
        ...chips.map((chip) => chip.reference),
      ];
      const targetKey = sessionId || sourceDraftKey;
      writeComposerDraft(targetKey, {
        text: nextText,
        fileReferences: [
          ...previousReferences,
          ...chips.map((chip) => toDraftReference(chip.reference)),
        ],
      });
      const currentSessionId = currentAppState().activeSessionId;
      if (currentSessionId === sessionId) {
        draft.applyEditorDraft(nextText, nextReferences, selectionStart + inserted.length);
      } else if (sourceDraftKey === HOME_DRAFT_KEY && sessionId) {
        deleteComposerDraft(HOME_DRAFT_KEY);
      }
      if (chips.length) showToast(t("chat.filesAttached", { count: chips.length }), "success");
    } catch (error) {
      showErrorToast(error);
    } finally {
      pasting.value = false;
    }
  };

  const onComposerDragEnter = (event: DragEvent) => {
    const dataTransfer = event.dataTransfer;
    if (!dataTransfer || !hasComposerFileDrag(dataTransfer)) return;
    event.preventDefault();
    dropTargetActive.value = true;
  };

  const onComposerDragOver = (event: DragEvent) => {
    const dataTransfer = event.dataTransfer;
    if (!dataTransfer || !hasComposerFileDrag(dataTransfer)) return;
    event.preventDefault();
    dataTransfer.dropEffect = "copy";
  };

  const onComposerDragLeave = (event: DragEvent) => {
    const relatedTarget = event.relatedTarget;
    const currentTarget = event.currentTarget as HTMLElement | null;
    if (relatedTarget instanceof Node && currentTarget?.contains(relatedTarget)) return;
    dropTargetActive.value = false;
  };

  const openDroppedFolderAsProject = async () => {
    const directories = droppedDirectories.value;
    droppedDirectories.value = [];
    try {
      for (const directory of directories) {
        if (directory.path) await store.appState?.activateProject(directory.path);
      }
    } catch (error) {
      showErrorToast(error);
    }
  };

  const insertDroppedDirectoryPaths = () => {
    const directories = droppedDirectories.value;
    droppedDirectories.value = [];
    if (directories.length) void attachDroppedItems(directories);
  };

  const onComposerDrop = (event: DragEvent) => {
    const dataTransfer = event.dataTransfer;
    if (!dataTransfer || !hasComposerFileDrag(dataTransfer)) return;
    event.preventDefault();
    dropTargetActive.value = false;
    if (isInputBlocked.value) return;
    const items = composerDropItems(dataTransfer, api.getDroppedFilePath);
    const directories = items.filter((item) => item.isDirectory);
    const files = items.filter((item) => !item.isDirectory);
    // A folder drop needs an explicit choice: open as project or reference it.
    if (directories.length) droppedDirectories.value = directories;
    if (files.length) void attachDroppedItems(files);
  };

  return {
    pasting,
    dropTargetActive,
    setDropTargetActive: (active: boolean) => {
      dropTargetActive.value = active;
    },
    droppedDirectories,
    pickAndAttach,
    pasteClipboardFiles,
    attachDroppedItems,
    onComposerDragEnter,
    onComposerDragOver,
    onComposerDragLeave,
    onComposerDrop,
    openDroppedFolderAsProject,
    insertDroppedDirectoryPaths,
    dismissDroppedDirectories: () => {
      droppedDirectories.value = [];
    },
  };
}

function toDraftReference(reference: ComposerFileReference): ComposerDraftSnapshot["fileReferences"][number] {
  return {
    path: reference.path,
    name: reference.name,
    kind: reference.kind,
    ...(reference.mimeType ? { mimeType: reference.mimeType } : {}),
    ...(reference.token ? { token: reference.token } : {}),
  };
}

/**
 * The module-level `showToast`, with the already-translated message
 * `t` returns. `currentAppState()` is the counterpart of
 * the store's `useAppStore.getState()`.
 */
function showToast(message: string, variant: "success" | "info"): void {
  currentAppState().showToast(message, { variant });
}

function showErrorToast(error: unknown): void {
  currentAppState().showToast(
    error instanceof Error ? error.message : String(error),
    { variant: "error" },
  );
}
