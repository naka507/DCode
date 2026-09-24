/**
 * Own the contenteditable draft lifecycle and its session-scoped cache.
 * Attachments and submission consume this controller instead of reaching into
 * the DOM or duplicating draft switching rules.
 *
 * Design notes, in the order the choices matter:
 *
 *   - `useState` -> `ref`, `useMemo` -> `computed`, `useRef` -> `ref` (a
 *     `.current` write-through on the same tick it read is what a Vue `ref`
 *     does as well, so `Ref` is the honest type here rather than
 *     `shallowRef`).
 *   - `useLayoutEffect` -> `watch(..., { flush: "post" })`, which runs after
 *     the DOM update and before paint.
 *   - The exposed state setters (`setValue`, `setCursor`,
 *     `setComposing`, `setInputFocused`, `setFileReferences`) keep their names
 *     and accept either a value or an updater, because the Composer and the
 *     submit controller call them that way.
 *   - `useAppStore.getState()` -> `currentAppState()`.
 *   - The values that have to stay fresh are accepted as
 *     `MaybeRefOrGetter`s and read through `toValue`. A composable body runs
 *     once at setup, so plain values would freeze them at their first value and
 *     the `[draftKey, referenceSessionId]` switch effect below could never fire.
 *     `activeSessionId` / `workspacePath` / `sessions` / `composerPrefill` /
 *     `prefill` / `inputBlocked` are therefore getters, and `draftKey` /
 *     `referenceSessionId` are `computed`s derived from
 *     `toValue(activeSessionId)`, tracked so the watchers that stand in for the
 *     effects run.
 */
import {
  computed,
  onScopeDispose,
  ref,
  toValue,
  watch,
  type MaybeRefOrGetter,
  type Ref,
} from "vue";
import { useI18n } from "vue-i18n";
import { rewriteIdeographicCommaTrigger } from "@dcode/shared";
import { api } from "../../../../lib/api";
import type { ComposerDraftSnapshot } from "../../../../lib/composer-smart-stop";
import {
  HOME_DRAFT_KEY,
  captureComposerDraft,
  deleteComposerDraft,
  draftKeyForSession,
  draftOwnerSessionId,
  flushScheduledHomeDraftAdopt,
  pruneComposerDrafts,
  readComposerDraft,
  writeComposerDraft,
} from "../../../../lib/composer-draft-cache";
import {
  editorSelectionRange,
  createFileReference,
  isEditableTextReference,
  isPersistedScratchReference,
  paintEditorValue,
  readEditorValue,
  setEditorCaret,
  type ComposerFileReference,
} from "../editor";
import type { ComposerPrefill } from "../model";
import { detachImageTokens, isImageReference } from "../image-attachments";
import {
  useComposerImagePreview,
  type ComposerImagePreviewController,
} from "./useComposerImagePreview";
import { currentAppState, useAppStore } from "../../../../stores/app-store";

type ComposerSession = { id: string };

/** `useState`-style setter: a value, or an updater over the current one. */
type StateSetter<T> = (value: T | ((current: T) => T)) => void;

export type ComposerDraftController = {
  imagePreview: ComposerImagePreviewController;
  removeImage: (id: string) => void;
  ref: Ref<HTMLDivElement | null>;
  draftKey: string;
  referenceSessionId: string;
  value: string;
  setValue: StateSetter<string>;
  valueRef: Ref<string>;
  cursor: number;
  setCursor: StateSetter<number>;
  composing: boolean;
  setComposing: StateSetter<boolean>;
  inputFocused: boolean;
  setInputFocused: StateSetter<boolean>;
  placeholderIndex: number;
  fileReferences: ComposerFileReference[];
  setFileReferences: StateSetter<ComposerFileReference[]>;
  activeFileReferences: ComposerFileReference[];
  referenceByToken: Map<string, ComposerFileReference>;
  fileReferencesRef: Ref<ComposerFileReference[]>;
  referenceByTokenRef: Ref<Map<string, ComposerFileReference>>;
  removeChipByTokenRef: Ref<(token: string) => void>;
  updateCursor: (next: number) => void;
  handleInput: (source: string, caret: number) => string;
  readLiveDraft: () => string;
  persistDraft: (key?: string) => void;
  paintCurrentDraft: (element: HTMLElement, nextValue: string) => void;
  commitEditorDom: () => void;
  insertNewlineInEditor: () => void;
  applyEditorDraft: (
    nextText: string,
    nextReferences: ComposerFileReference[],
    caret: number,
  ) => void;
  snapshotReferences: (sourceSessionId: string) => ComposerDraftSnapshot["fileReferences"];
  draftSnapshot: (text: string) => ComposerDraftSnapshot;
  clearDraftForKey: (key: string) => void;
  restoreDraftForKey: (key: string, snapshot: ComposerDraftSnapshot) => void;
};

type UseComposerDraftOptions = {
  variant: "home" | "docked";
  activeSessionId: MaybeRefOrGetter<string | null | undefined>;
  workspacePath: MaybeRefOrGetter<string>;
  sessions: MaybeRefOrGetter<readonly ComposerSession[]>;
  composerPrefill: MaybeRefOrGetter<{
    sessionId: string;
    text: string;
    fileReferences: ComposerDraftSnapshot["fileReferences"];
  } | null>;
  clearComposerPrefill: () => void;
  prefill?: MaybeRefOrGetter<ComposerPrefill | null | undefined>;
  invalidatePromptEnhancement: () => void;
  inputBlocked: MaybeRefOrGetter<boolean>;
};

export function useComposerDraft({
  variant,
  activeSessionId,
  workspacePath,
  sessions,
  composerPrefill,
  clearComposerPrefill,
  prefill,
  invalidatePromptEnhancement,
  inputBlocked,
}: UseComposerDraftOptions): ComposerDraftController {
  const store = useAppStore();
  const { t } = useI18n();
  const draftKey = computed(() => draftKeyForSession(toValue(activeSessionId)));
  const referenceSessionId = computed(() => toValue(activeSessionId) ?? "");
  const initialDraft = readComposerDraft(draftKey.value);
  const value = ref(initialDraft?.text ?? "");
  const fileReferences = ref<ComposerFileReference[]>(
    (initialDraft?.fileReferences ?? []).map((fileReference) =>
      createFileReferenceFromSnapshot(fileReference, referenceSessionId.value),
    ),
  );
  const cursor = ref(initialDraft?.text.length ?? 0);
  // `onSelect` fires on every caret move; avoid re-rendering for an unchanged
  // cursor so autocomplete trigger detection stays quiet.
  const updateCursor = (next: number) => {
    if (cursor.value !== next) cursor.value = next;
  };
  const composing = ref(false);
  const inputFocused = ref(false);
  const placeholderIndex = ref(0);
  const ref_ = ref<HTMLDivElement | null>(null);
  let placeholderContext = `${variant}:${toValue(activeSessionId) ?? HOME_DRAFT_KEY}`;
  let draftKeyRef = draftKey.value;

  /** One setter per state cell, accepting a value or an updater. */
  function stateSetter<T>(cell: Ref<T>): StateSetter<T> {
    return (next) => {
      cell.value = typeof next === "function" ? (next as (c: T) => T)(cell.value) : next;
    };
  }

  const setValue = stateSetter(value);
  const setCursor = stateSetter(cursor);
  const setComposing = stateSetter(composing);
  const setInputFocused = stateSetter(inputFocused);
  const setFileReferences = stateSetter(fileReferences);

  // Keep one guidance copy stable until the user changes page or session.
  watch([() => toValue(activeSessionId), () => variant], () => {
    const nextContext = `${variant}:${toValue(activeSessionId) ?? HOME_DRAFT_KEY}`;
    if (placeholderContext === nextContext) return;
    placeholderContext = nextContext;
    placeholderIndex.value = (placeholderIndex.value + 1) % 3;
  });

  const valueRef = ref(value.value);
  const fileReferencesRef = ref(fileReferences.value);
  const activeFileReferences = computed(() =>
    fileReferences.value.filter(
      (fileReference) => fileReference.sessionId === referenceSessionId.value,
    ),
  );
  const referenceByToken = computed(() => {
    const map = new Map<string, ComposerFileReference>();
    for (const fileReference of activeFileReferences.value) {
      if (fileReference.token) map.set(fileReference.token, fileReference);
    }
    return map;
  });
  const referenceByTokenRef = ref(referenceByToken.value);
  const imagePreview = useComposerImagePreview({
    references: fileReferences,
    value,
    sessionId: referenceSessionId,
    editorRef: ref_,
  });
  const removeChipByTokenRef = ref<(token: string) => void>(() => {});
  const expandTextReferenceRef = ref<(token: string) => void>(() => {});
  let pendingEditorCaret: number | null = initialDraft?.text
    ? initialDraft.text.length
    : null;
  // `null` forces the first paint because Vue does not render children into the
  // contenteditable. Native typing keeps the value synchronized without
  // rewriting the DOM or disturbing the caret.
  let editorValue: string | null = null;

  function readLiveDraft() {
    return ref_.value ? readEditorValue(ref_.value) : valueRef.value;
  }
  function persistDraft(key = draftKeyRef) {
    captureComposerDraft(key, readLiveDraft(), fileReferencesRef.value);
  }

  function paintCurrentDraft(element: HTMLElement, nextValue: string) {
    paintEditorValue(
      element,
      nextValue,
      referenceByTokenRef.value,
      (name) => t("chat.removeFileReference", { name }),
      (token) => removeChipByTokenRef.value(token),
      (token) => expandTextReferenceRef.value(token),
    );
    editorValue = nextValue;
  }

  watch(
    [value, referenceByToken],
    () => {
      const element = ref_.value;
      if (!element) return;
      /*
        Images live outside editable text (78a073a5). A restored or pre-filled
        draft can still carry image tokens, so detach them before painting:
        `detachImageTokens` strips the sentinel from the text, keeps the
        attachment (minus its token) and shifts the caret past the removal.
      */
      if (fileReferences.value.some((reference) => isImageReference(reference) && reference.token)) {
        const detached = detachImageTokens(
          value.value,
          fileReferences.value,
          pendingEditorCaret ?? cursor.value,
        );
        valueRef.value = detached.text;
        fileReferencesRef.value = detached.references;
        pendingEditorCaret = detached.caret;
        editorValue = null;
        setValue(detached.text);
        setCursor(detached.caret);
        setFileReferences(detached.references);
        return;
      }
      if (editorValue === value.value) return;
      paintCurrentDraft(element, value.value);
      const caret = pendingEditorCaret;
      if (caret !== null) {
        pendingEditorCaret = null;
        setEditorCaret(element, caret);
      }
    },
    { flush: "post" },
  );

  function onSelectionChange() {
    const element = ref_.value;
    if (!element) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const anchor = selection.anchorNode;
    if (anchor && !element.contains(anchor)) return;
    const { start } = editorSelectionRange(element);
    updateCursor(start);
  }

  document.addEventListener("selectionchange", onSelectionChange);
  onScopeDispose(() => {
    document.removeEventListener("selectionchange", onSelectionChange);
  });

  function removeChipByToken(token: string) {
    const element = ref_.value;
    if (!element) return;
    const source = readEditorValue(element);
    const index = source.indexOf(token);
    if (index === -1) return;
    const next = source.slice(0, index) + source.slice(index + 1);
    invalidatePromptEnhancement();
    // Leave the DOM value stale so the layout effect removes the chip.
    pendingEditorCaret = index;
    setValue(next);
    setCursor(index);
    setFileReferences((current) =>
      current.filter((fileReference) => fileReference.token !== token),
    );
  }
  removeChipByTokenRef.value = removeChipByToken;

  /** Commit a native contenteditable input while preserving IME correction. */
  function handleInput(source: string, caret: number): string {
    const nextValue =
      valueRef.value === "" ? rewriteIdeographicCommaTrigger(source) : source;
    invalidatePromptEnhancement();
    if (nextValue === source) {
      editorValue = nextValue;
    } else {
      // Leave the DOM value stale so the sync effect repaints the substituted
      // trigger and restores the caret after it.
      pendingEditorCaret = caret;
    }
    valueRef.value = nextValue;
    setValue(nextValue);
    setFileReferences((current) => {
      const next = current.filter(
        (fileReference) =>
          !fileReference.token || nextValue.includes(fileReference.token),
      );
      return next.length === current.length ? current : next;
    });
    updateCursor(caret);
    return nextValue;
  }

  /** Commit a manual DOM edit back into state (no input event fires). */
  function commitEditorDom() {
    const element = ref_.value;
    if (!element) return;
    const nextValue = readEditorValue(element);
    const { start } = editorSelectionRange(element);
    invalidatePromptEnhancement();
    editorValue = nextValue;
    valueRef.value = nextValue;
    setValue(nextValue);
    setFileReferences((current) => {
      const next = current.filter(
        (fileReference) =>
          !fileReference.token || nextValue.includes(fileReference.token),
      );
      return next.length === current.length ? current : next;
    });
    updateCursor(start);
  }

  /** Enter inserts a bare newline text node so the draft round-trips. */
  function insertNewlineInEditor() {
    const element = ref_.value;
    if (!element) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) {
      return;
    }
    range.deleteContents();
    const node = document.createTextNode("\n");
    range.insertNode(node);
    const after = document.createRange();
    after.setStart(node, 1);
    after.collapse(true);
    selection.removeAllRanges();
    selection.addRange(after);
    commitEditorDom();
  }

  watch([draftKey, referenceSessionId], () => {
    const previousKey = draftKeyRef;
    if (previousKey !== draftKey.value) {
      invalidatePromptEnhancement();
      persistDraft(previousKey);
      if (previousKey === HOME_DRAFT_KEY) {
        flushScheduledHomeDraftAdopt(draftKey.value);
      }
      draftKeyRef = draftKey.value;
      const nextDraft = readComposerDraft(draftKey.value);
      setValue(nextDraft?.text ?? "");
      setFileReferences(
        nextDraft?.fileReferences.map((fileReference) =>
          createFileReferenceFromSnapshot(fileReference, referenceSessionId.value),
        ) ?? [],
      );
      setCursor(nextDraft?.text.length ?? 0);
      return;
    }
    // Current drafts are serialized lazily on switch, unmount, blur, or a
    // snapshot request; plain typing does not serialize on every keystroke.
  });

  /*
    Reads `value.value`, not `valueRef.value`: `valueRef.current` was assigned
    from the current `value` state before any effect ran. Here the `valueRef`
    mirror is itself a watcher created below this one, so it would still hold
    the outgoing text on a session switch and the adopted draft would be
    clobbered in the cache. `value` and `valueRef` are otherwise always equal
    (every imperative `valueRef` write is paired with a `setValue`).
  */
  watch([draftKey, fileReferences, referenceSessionId], () => {
    captureComposerDraft(draftKey.value, value.value, fileReferences.value);
  });

  watch([draftKey, () => toValue(sessions)], () => {
    pruneComposerDrafts([
      HOME_DRAFT_KEY,
      draftKey.value,
      ...toValue(sessions).map((session) => session.id),
    ]);
  });

  onScopeDispose(() => {
    persistDraft(draftKeyRef);
  });

  function onVisibility() {
    if (document.visibilityState === "hidden") {
      persistDraft();
      return;
    }
    const element = ref_.value;
    if (!element) return;
    const live = readEditorValue(element);
    const expected = valueRef.value;
    if (live === expected) return;
    if (!live && expected) {
      paintCurrentDraft(element, expected);
      setEditorCaret(element, expected.length);
      return;
    }
    commitEditorDom();
  }
  const onWindowBlur = () => persistDraft();
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("focus", onVisibility);
  window.addEventListener("blur", onWindowBlur);
  onScopeDispose(() => {
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("focus", onVisibility);
    window.removeEventListener("blur", onWindowBlur);
  });

  watch(
    () => toValue(workspacePath),
    () => {
      const current = fileReferencesRef.value;
      const kept = current.filter((fileReference) =>
        isPersistedScratchReference(fileReference.path),
      );
      if (kept.length === current.length) return;
      const droppedTokens = new Set(
        current
          .filter(
            (fileReference) => !isPersistedScratchReference(fileReference.path),
          )
          .flatMap((fileReference) =>
            fileReference.token ? [fileReference.token] : [],
          ),
      );
      if (droppedTokens.size > 0) {
        const element = ref_.value;
        const source = element ? readEditorValue(element) : valueRef.value;
        const caret = element ? editorSelectionRange(element).start : source.length;
        let nextValue = "";
        let nextCaret = caret;
        let index = 0;
        for (const char of Array.from(source)) {
          if (droppedTokens.has(char)) {
            if (index < caret) nextCaret -= char.length;
          } else {
            nextValue += char;
          }
          index += char.length;
        }
        const nextIndex = Math.max(0, Math.min(nextCaret, nextValue.length));
        pendingEditorCaret = nextIndex;
        setValue(nextValue);
        setCursor(nextIndex);
      }
      setFileReferences(kept);
    },
  );

  watch(
    [
      () => toValue(activeSessionId),
      () => toValue(composerPrefill),
      () => clearComposerPrefill,
    ],
    () => {
      const nextPrefill = toValue(composerPrefill);
      if (!nextPrefill || nextPrefill.sessionId !== toValue(activeSessionId)) return;
      setValue(nextPrefill.text);
      setFileReferences((current) => [
        ...current.filter(
          (fileReference) => fileReference.sessionId !== nextPrefill.sessionId,
        ),
        ...nextPrefill.fileReferences.map((fileReference) =>
          createFileReferenceFromSnapshot(fileReference, nextPrefill.sessionId),
        ),
      ]);
      clearComposerPrefill();
      requestAnimationFrame(() => {
        const element = ref_.value;
        if (!element) return;
        element.focus();
        setEditorCaret(element, readEditorValue(element).length);
      });
    },
  );

  watch(
    () => toValue(prefill),
    () => {
      const nextPrefill = toValue(prefill);
      if (!nextPrefill?.text) return;
      setValue(nextPrefill.text);
      setFileReferences([]);
      requestAnimationFrame(() => {
        const element = ref_.value;
        if (!element) return;
        element.focus();
        setEditorCaret(element, readEditorValue(element).length);
      });
    },
  );

  function applyEditorDraft(
    nextText: string,
    nextReferences: ComposerFileReference[],
    caret: number,
  ) {
    /*
      Detach image tokens from the incoming draft: a picker/paste/drop import
      hands over chips, and an image must never stay inside editable text.
      `editorValue` is reset because a token may now refer to a different
      attachment even when the text is unchanged (78a073a5).
    */
    const detached = detachImageTokens(nextText, nextReferences, caret);
    nextText = detached.text;
    nextReferences = detached.references;
    caret = detached.caret;
    editorValue = null;
    pendingEditorCaret = caret;
    setValue(nextText);
    setCursor(caret);
    setFileReferences(nextReferences);
    requestAnimationFrame(() => {
      const element = ref_.value;
      if (!element) return;
      element.focus();
      setEditorCaret(element, caret);
    });
  }

  async function expandTextReference(token: string) {
    if (toValue(inputBlocked)) return;
    const reference = referenceByTokenRef.value.get(token);
    const editor = ref_.value;
    if (!reference || !isEditableTextReference(reference) || !editor) return;
    if (!readEditorValue(editor).includes(token)) return;
    const sourceSessionId = reference.sessionId;
    try {
      const result = await api.fsRead(reference.path, reference.mimeType);
      if (result.kind !== "text" || result.content === undefined) {
        const message =
          result.kind === "tooLarge"
            ? t("panel.files.tooLarge")
            : result.kind === "binary"
              ? t("panel.files.binary")
              : t("panel.files.error");
        store.appState?.showToast(message, { variant: "error" });
        return;
      }
      const liveEditor = ref_.value;
      const liveReference = referenceByTokenRef.value.get(token);
      if (
        !liveEditor ||
        (currentAppState().activeSessionId ?? "") !== sourceSessionId ||
        !liveReference ||
        liveReference.sessionId !== sourceSessionId ||
        liveReference.path !== reference.path
      ) {
        return;
      }
      const source = readEditorValue(liveEditor);
      const index = source.indexOf(token);
      if (index === -1) return;
      const nextText =
        source.slice(0, index) + result.content + source.slice(index + token.length);
      const nextReferences = fileReferencesRef.value.filter(
        (fileReference) => fileReference.token !== token,
      );
      invalidatePromptEnhancement();
      applyEditorDraft(nextText, nextReferences, index + result.content.length);
    } catch (error) {
      store.appState?.showToast(
        error instanceof Error ? error.message : String(error),
        { variant: "error" },
      );
    }
  }
  expandTextReferenceRef.value = expandTextReference;

  function snapshotReferences(sourceSessionId: string) {
    return fileReferencesRef.value
      .filter((fileReference) => fileReference.sessionId === sourceSessionId)
      .map(({ path, name, kind, mimeType, token }) => ({
        path,
        name,
        kind,
        ...(mimeType ? { mimeType } : {}),
        ...(token ? { token } : {}),
      }));
  }

  function clearDraftForKey(key: string) {
    invalidatePromptEnhancement();
    deleteComposerDraft(key);
    const currentKey = draftKeyForSession(currentAppState().activeSessionId);
    if (currentKey !== key) return;
    valueRef.value = "";
    if (ref_.value) paintCurrentDraft(ref_.value, "");
    setValue("");
    const owner = draftOwnerSessionId(key);
    /*
      Write the mirror before the setter: a rejected send can resume in the same
      tick, before Vue flushes the cleared state, and would otherwise restore
      from the stale array (78a073a5).
    */
    const remaining = fileReferencesRef.value.filter(
      (fileReference) => fileReference.sessionId !== owner,
    );
    fileReferencesRef.value = remaining;
    setFileReferences(remaining);
    setCursor(0);
  }

  function restoreDraftForKey(key: string, snapshot: ComposerDraftSnapshot) {
    const currentActiveSessionId = currentAppState().activeSessionId;
    const currentKey = draftKeyForSession(currentActiveSessionId);
    if (currentKey !== key) {
      /*
        A snapshot that carries attachments is not "empty": caching it over a
        text-only entry would silently drop the images (78a073a5).
      */
      const cached = readComposerDraft(key);
      if (!cached?.text && !cached?.fileReferences.length) writeComposerDraft(key, snapshot);
      return;
    }
    if (valueRef.value.trim()) return;
    /* Attachments alone also mean the draft is not empty. */
    if (
      fileReferencesRef.value.some(
        (fileReference) => fileReference.sessionId === (currentActiveSessionId ?? ""),
      )
    ) {
      return;
    }
    const sessionId = currentActiveSessionId ?? "";
    setValue(snapshot.text);
    setFileReferences((current) => [
      ...current.filter((fileReference) => fileReference.sessionId !== sessionId),
      ...snapshot.fileReferences.map((fileReference) =>
        createFileReferenceFromSnapshot(fileReference, sessionId),
      ),
    ]);
    setCursor(snapshot.text.length);
  }

  function draftSnapshot(text: string): ComposerDraftSnapshot {
    return {
      text: text.trim(),
      fileReferences: activeFileReferences.value
        .filter(
          (fileReference) =>
            !fileReference.token || text.includes(fileReference.token),
        )
        .map(({ path, name, kind, mimeType, token }) => ({
          path,
          name,
          kind,
          ...(mimeType ? { mimeType } : {}),
          ...(token ? { token } : {}),
        })),
    };
  }

  /*
    Live `.current` reads are returned for `valueRef` /
    `fileReferencesRef`. Vue refs are unwrapped in templates, so the controller
    exposes the same refs and the callers read `.value`; a write through
    `.current` that lands before the next read keeps working because
    a ref write is synchronous.
  */
  watch(
    value,
    () => {
      valueRef.value = value.value;
    },
    { immediate: true },
  );
  watch(
    fileReferences,
    () => {
      fileReferencesRef.value = fileReferences.value;
    },
    { immediate: true },
  );
  watch(
    referenceByToken,
    () => {
      referenceByTokenRef.value = referenceByToken.value;
    },
    { immediate: true },
  );

  /*
    `draftKey` / `referenceSessionId` are per-render strings,
    derived here from the reactive `activeSessionId` and exposed through getters
    so the controller's public shape (and every caller that reads
    `draft.draftKey` as a string) is unchanged.
  */
  return {
    imagePreview,
    removeImage: (id) => {
      if (toValue(inputBlocked)) return;
      invalidatePromptEnhancement();
      setFileReferences((current) => current.filter((reference) => reference.id !== id));
      ref_.value?.focus();
    },
    ref: ref_,
    get draftKey() {
      return draftKey.value;
    },
    get referenceSessionId() {
      return referenceSessionId.value;
    },
    get value() {
      return value.value;
    },
    setValue,
    valueRef,
    get cursor() {
      return cursor.value;
    },
    setCursor,
    get composing() {
      return composing.value;
    },
    setComposing,
    get inputFocused() {
      return inputFocused.value;
    },
    setInputFocused,
    get placeholderIndex() {
      return placeholderIndex.value;
    },
    get fileReferences() {
      return fileReferences.value;
    },
    setFileReferences,
    get activeFileReferences() {
      return activeFileReferences.value;
    },
    get referenceByToken() {
      return referenceByToken.value;
    },
    fileReferencesRef,
    referenceByTokenRef,
    removeChipByTokenRef,
    updateCursor,
    handleInput,
    readLiveDraft,
    persistDraft,
    paintCurrentDraft,
    commitEditorDom,
    insertNewlineInEditor,
    applyEditorDraft,
    snapshotReferences,
    draftSnapshot,
    clearDraftForKey,
    restoreDraftForKey,
  };
}

function createFileReferenceFromSnapshot(
  fileReference: ComposerDraftSnapshot["fileReferences"][number],
  sessionId: string,
): ComposerFileReference {
  return createFileReference(
    fileReference.path,
    fileReference.name,
    sessionId,
    fileReference,
  );
}
