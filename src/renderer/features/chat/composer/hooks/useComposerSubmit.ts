/**
 * Own prompt enhancement and send orchestration. It deliberately receives the
 * draft controller as a narrow dependency so command dispatch and optimistic
 * draft clearing remain independent from editor rendering.
 *
 * Design notes, in the order the choices matter:
 *
 *   - `useState` -> `ref`; cells that only guard async work (the
 *     enhancement version and the in-flight request token) stay plain `let`
 *     bindings, because nothing renders from them — the same call the draft
 *     controller makes for its own non-reactive cells.
 *   - `useAppStore.getState()` -> `currentAppState()`.
 *   - `t` is not an option: the hook reads `useI18n()` the way
 *     `useComposerDraft` does. `t("a.b")` replaces `t("a.b", "Fallback")`
 *     because every key is guaranteed present in the catalogs.
 *   - The prop-shaped inputs are `MaybeRefOrGetter` and are read through
 *     `toValue()` at the moment each handler runs, so they stay fresh. A plain
 *     value, a `ref` and a `computed` all satisfy that, so no call site loses
 *     freshness.
 *   - `draft.ref.current` -> `draft.ref.value`.
 *   - `sendPrompt` / `steerPrompt` / `showToast` stay options so the Composer
 *     wires its own store selectors.
 */
import { ref, toValue, type MaybeRefOrGetter, type Ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  canonicalThinkingLevel,
  restoreInlineComposerFileReferenceTokens,
  serializeComposerFileReferences,
  serializeInlineComposerFileReferences,
  stripInlineComposerFileReferenceTokens,
} from "@dcode/shared";
import type { AppState } from "../../../../stores/app-store";
import { currentAppState } from "../../../../stores/app-store";
import { api } from "../../../../lib/api";
import { draftKeyForSession } from "../../../../lib/composer-draft-cache";
import { runExtensionCommand, runPaletteCommand } from "../../../../lib/commands";
import { resolveComposerCommand } from "../../../../hooks/use-composer-autocomplete";
import { readEditorValue, setEditorCaret, type ComposerFileReference } from "../editor";
import type { ComposerDraftController } from "./useComposerDraft";

type UseComposerSubmitOptions = {
  value: MaybeRefOrGetter<string>;
  draftKey: MaybeRefOrGetter<string>;
  activeSessionId: MaybeRefOrGetter<string | null | undefined>;
  providerId?: MaybeRefOrGetter<string | undefined>;
  modelId?: MaybeRefOrGetter<string | undefined>;
  thinkingLevel: MaybeRefOrGetter<
    Parameters<AppState["configureActiveSession"]>[0]["thinkingLevel"]
  >;
  modelReady: MaybeRefOrGetter<boolean>;
  sendBlocked: MaybeRefOrGetter<boolean>;
  pasting: MaybeRefOrGetter<boolean>;
  activeFileReferences: MaybeRefOrGetter<ComposerFileReference[]>;
  sendPrompt: AppState["sendPrompt"];
  steerPrompt: AppState["steerPrompt"];
  showToast: AppState["showToast"];
  draft: Pick<
    ComposerDraftController,
    | "ref"
    | "draftSnapshot"
    | "clearDraftForKey"
    | "restoreDraftForKey"
    | "setValue"
    | "setCursor"
  >;
};

export type ComposerSubmitController = {
  enhancingPrompt: Ref<boolean>;
  enhancementUndoText: Ref<string | null>;
  enhancementError: Ref<{ message: string; code: string } | null>;
  clearEnhancementError: () => void;
  invalidatePromptEnhancement: () => void;
  enhancePrompt: () => Promise<void>;
  undoPromptEnhancement: () => void;
  submit: (steering?: boolean) => Promise<void>;
};

export function useComposerSubmit({
  value,
  draftKey,
  activeSessionId,
  providerId,
  modelId,
  thinkingLevel,
  modelReady,
  sendBlocked,
  pasting,
  activeFileReferences,
  sendPrompt,
  steerPrompt,
  showToast,
  draft,
}: UseComposerSubmitOptions): ComposerSubmitController {
  const { t } = useI18n();
  const enhancingPrompt = ref(false);
  const enhancementUndoText = ref<string | null>(null);
  const enhancementError = ref<{ message: string; code: string } | null>(null);
  let enhancementVersion = 0;
  let enhancementRequest: symbol | null = null;

  const invalidatePromptEnhancement = () => {
    enhancementVersion += 1;
    enhancementUndoText.value = null;
    enhancementError.value = null;
  };

  const enhancePrompt = async () => {
    const references = toValue(activeFileReferences);
    const sourceText = toValue(value);
    const textToEnhance = stripInlineComposerFileReferenceTokens(
      sourceText,
      references,
    );
    const sourceKey = toValue(draftKey);
    const sourceVersion = enhancementVersion;
    if (
      !textToEnhance.trim() ||
      textToEnhance.trim().startsWith("/") ||
      !toValue(modelReady) ||
      toValue(sendBlocked) ||
      enhancingPrompt.value
    ) {
      return;
    }

    const requestToken = Symbol("prompt-enhancement");
    enhancementRequest = requestToken;
    enhancingPrompt.value = true;
    enhancementUndoText.value = null;
    enhancementError.value = null;
    try {
      const result = await api.enhancePrompt({
        sessionId: toValue(activeSessionId),
        draft: textToEnhance,
        providerId: toValue(providerId),
        modelId: toValue(modelId),
        thinkingLevel: canonicalThinkingLevel(toValue(thinkingLevel)),
      });
      const currentKey = draftKeyForSession(currentAppState().activeSessionId);
      if (
        enhancementRequest !== requestToken ||
        currentKey !== sourceKey ||
        enhancementVersion !== sourceVersion
      ) {
        return;
      }
      const modelDraft = result.enhancedDraft.trim();
      if (!modelDraft || !stripInlineComposerFileReferenceTokens(modelDraft, references).trim()) {
        throw Object.assign(new Error("The model returned an empty enhanced draft."), {
          code: "PROMPT_ENHANCEMENT_EMPTY",
        });
      }
      const enhancedDraft = restoreInlineComposerFileReferenceTokens(
        sourceText,
        modelDraft,
        references,
      );
      enhancementVersion += 1;
      draft.setValue(enhancedDraft);
      draft.setCursor(enhancedDraft.length);
      enhancementUndoText.value = sourceText;
      requestAnimationFrame(() => {
        const element = draft.ref.value;
        if (!element) return;
        element.focus();
        setEditorCaret(element, enhancedDraft.length);
      });
    } catch (error) {
      const currentKey = draftKeyForSession(currentAppState().activeSessionId);
      if (
        enhancementRequest !== requestToken ||
        currentKey !== sourceKey ||
        enhancementVersion !== sourceVersion
      ) {
        return;
      }
      const typed = error as Error & { code?: string };
      enhancementError.value = {
        message:
          typed.code === "TIMEOUT"
            ? t("chat.enhancementTimeout")
            : typed.message || t("chat.enhancementFailed"),
        code: typed.code || "PROMPT_ENHANCEMENT_FAILED",
      };
    } finally {
      if (enhancementRequest === requestToken) enhancingPrompt.value = false;
    }
  };

  const undoPromptEnhancement = () => {
    const undoText = enhancementUndoText.value;
    if (undoText === null) return;
    invalidatePromptEnhancement();
    draft.setValue(undoText);
    draft.setCursor(undoText.length);
    requestAnimationFrame(() => {
      const element = draft.ref.value;
      if (!element) return;
      element.focus();
      setEditorCaret(element, undoText.length);
    });
  };

  const submit = async (steering = false) => {
    const references = toValue(activeFileReferences);
    const editor = draft.ref.value;
    const text = editor ? readEditorValue(editor) : toValue(value);
    const inlineContent = serializeInlineComposerFileReferences(text, references);
    const serializedContent = serializeComposerFileReferences(text, references);
    if (!serializedContent) return;
    if (toValue(sendBlocked)) {
      if (toValue(pasting)) showToast(t("chat.pasteInProgress"), { variant: "info" });
      return;
    }
    invalidatePromptEnhancement();
    const submittedDraftKey = toValue(draftKey);
    // Slash dispatch stays local for builtin and extension commands, while
    // templates, skills, and unknown aliases continue as normal prompt text.
    if (!steering && serializedContent.startsWith("/")) {
      const commandEnd = serializedContent.search(/\s/);
      const name = serializedContent.slice(
        1,
        commandEnd === -1 ? undefined : commandEnd,
      );
      const command = name ? await resolveComposerCommand(name) : null;
      if (command && command.kind !== "template" && command.id) {
        const commandBody =
          commandEnd === -1 ? "" : serializedContent.slice(commandEnd).trim();
        const isModeCommand =
          command.id === "builtin.mode.agent" ||
          command.id === "builtin.mode.plan" ||
          command.id === "builtin.mode.goal";
        if (isModeCommand && commandBody) {
          try {
            await runPaletteCommand(command.id);
            const visibleDraft = text.trim();
            const visibleCommandEnd = visibleDraft.search(/\s/);
            const visibleCommandBody =
              visibleCommandEnd === -1
                ? ""
                : visibleDraft.slice(visibleCommandEnd).trim();
            const accepted = await sendPrompt(
              serializeInlineComposerFileReferences(visibleCommandBody, references),
              draft.draftSnapshot(visibleCommandBody),
            );
            if (accepted) draft.clearDraftForKey(submittedDraftKey);
          } catch (error) {
            showToast(error instanceof Error ? error.message : String(error), {
              variant: "error",
            });
          }
          return;
        }
        if (command.kind === "extension") {
          try {
            await runExtensionCommand(command.name, commandBody);
            draft.clearDraftForKey(submittedDraftKey);
          } catch (error) {
            showToast(error instanceof Error ? error.message : String(error), {
              variant: "error",
            });
          }
          return;
        }
        if (!commandBody) {
          try {
            if (command.kind === "builtin") await runPaletteCommand(command.id);
            else await api.executeCommand(command.id);
            draft.clearDraftForKey(submittedDraftKey);
          } catch (error) {
            showToast(error instanceof Error ? error.message : String(error), {
              variant: "error",
            });
          }
          return;
        }
      }
    }
    if (!steering && !toValue(modelReady)) {
      showToast(t("errors.MODEL_NOT_CONFIGURED"), { variant: "error" });
      return;
    }
    const submittedDraft = draft.draftSnapshot(text);
    draft.clearDraftForKey(submittedDraftKey);
    const accepted = steering
      ? await steerPrompt(inlineContent, submittedDraft)
      : await sendPrompt(inlineContent, submittedDraft);
    if (!accepted) draft.restoreDraftForKey(submittedDraftKey, submittedDraft);
  };

  return {
    enhancingPrompt,
    enhancementUndoText,
    enhancementError,
    clearEnhancementError: () => {
      enhancementError.value = null;
    },
    invalidatePromptEnhancement,
    enhancePrompt,
    undoPromptEnhancement,
    submit,
  };
}
