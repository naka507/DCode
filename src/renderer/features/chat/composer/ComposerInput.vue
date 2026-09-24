<script setup lang="ts">
/**
 * Rich contenteditable input; draft state and async operations stay outside.
 *
 * The `ComposerInput` component.
 *
 * The decisions that are not mechanical:
 *
 * 1. **The callback props become emits.** Ten `onXxx` functions used to be taken;
 *     they are `emit(...)` here with the house kebab names
 *     (`onAcceptCompletion` -> `accept-completion`, `onInsertNewline` ->
 *     `insert-newline`, `onCompositionStart` -> `composition-start`, and so on).
 *     `onSubmit(steering?)` keeps its optional payload: the alt+enter branch
 *     sends `runActive`, the plain enter branch sends nothing, exactly as
 * `onSubmit(runActive)` and `onSubmit()` were called.
 *  2. **`inputRef` stays a ref, and the caller must pass the ref OBJECT.**
 * It used to be typed `RefObject<HTMLDivElement | null>` and attached with
 *     `ref={inputRef}`; the template attaches the same object with
 *     `:ref="props.inputRef"`. Reading it off the props proxy is safe: props are
 *     shallowly reactive, so a ref-valued prop is *not* unwrapped the way a ref
 *     inside a `reactive` object would be. The caller's side is the trap: a
 *     template binding unwraps a setup ref, so `:input-ref="inputRef"` passes
 *     the *element* (null on the first render) and Vue's `setRef` then warns
 *     "Invalid template ref type" without ever filling the parent's ref. Pass a
 *     member expression (`:input-ref="host.inputRef"`), which is handed over as
 *     the ref itself, or a getter-free object holding it.
 *  3. **`composerAc` members are read through `toValue`.** The controller is a
 *     plain object of `ComputedRef`s (`use-composer-autocomplete.ts`), and Vue
 *     only unwraps top-level setup bindings — `props.composerAc.open` in a
 *     template would be the ref object, i.e. always truthy. Every read happens
 *     in this script, so the `.value` ban for refs destructured out of a
 *     composable is respected as well.
 *  4. **`onBeforeInput` reads the native event.** A synthetic
 *     event whose `nativeEvent` was the `InputEvent` used to be passed; Vue hands
 *     the `InputEvent` itself, so the `inputType` check reads it directly.
 *  5. **Framework-specific props are gone.** `suppressContentEditableWarning` wrote
 *     nothing to the DOM and has no equivalent here. A bare `aria-hidden` is
 *     written as `"true"`, because a bare Vue attribute renders `""`.
 *  6. **`key={placeholderKey}` is kept as `:key`.** It is load-bearing: a key
 *     change makes Vue replace the element, which restarts the
 *     `composer-placeholder-fade-in` animation the stylesheet pins to
 *     `.composer-placeholder`.
 * 7. **The native deletion guard is a `watch` on the editor ref.** The guard used
 *     to be installed from a `useLayoutEffect` on `inputRef.current`
 *     (f3843754); a Vue template ref is filled after mount, so the effect is a
 *     post-flush watch that installs on the first non-null element and
 *     disposes through `onCleanup`.
 */
import { toValue, watch, type Ref } from "vue";
import type { ComposerAutocompleteController } from "../../../hooks/use-composer-autocomplete";
import { editorSelectionRange, readEditorValue } from "./editor";
import { installComposerDeletionGuard } from "./native-deletion";
import ComposerImagePreview from "./ComposerImagePreview.vue";
import type { ComposerImagePreviewController } from "./hooks/useComposerImagePreview";

const props = defineProps<{
  /** Optional: only the chat composer owns a preview controller. */
  imagePreview?: ComposerImagePreviewController;
  inputRef: Ref<HTMLDivElement | null>;
  value: string;
  placeholderText: string;
  placeholderKey: string;
  inputBlocked: boolean;
  pasting: boolean;
  enterToSend: boolean;
  runActive: boolean;
  composerAc: ComposerAutocompleteController;
}>();

const emit = defineEmits<{
  paste: [event: ClipboardEvent];
  "accept-completion": [index: number];
  submit: [steering?: boolean];
  "insert-newline": [];
  input: [source: string, caret: number];
  "composition-start": [];
  "composition-end": [event: CompositionEvent];
  focus: [];
  blur: [];
}>();

/*
  The deletion guard is installed from a `watch` on the editor
  ref. Vue runs a template ref callback on mount and on every patch, so a
  `watch` on the ref with `{ flush: "post", immediate: true }` is the closest
  counterpart: it installs once the element exists, reinstalls if the element
  is replaced, and disposes the native listeners through `onCleanup`.
*/
watch(
  props.inputRef,
  (editor, _previous, onCleanup) => {
    if (!editor) return;
    onCleanup(installComposerDeletionGuard(editor));
  },
  { flush: "post", immediate: true },
);

/** `onBeforeInput`: an Enter that inserts a paragraph becomes a bare newline. */
function onBeforeInput(event: InputEvent) {
  if (event.inputType === "insertParagraph" || event.inputType === "insertLineBreak") {
    event.preventDefault();
    emit("insert-newline");
  }
}

/** `onInput`: commit the editor's DOM text and the caret's draft offset. */
function onInput(event: Event) {
  const element = event.currentTarget as HTMLDivElement;
  const source = readEditorValue(element);
  const { start } = editorSelectionRange(element);
  emit("input", source, start);
}

function onKeyDown(event: KeyboardEvent) {
  // An Enter that confirms an IME candidate must commit text, never send it or
  // drive autocomplete (D125).
  if (event.isComposing || event.keyCode === 229) return;
  const ac = props.composerAc;
  if (
    event.key === "Enter" &&
    event.altKey &&
    !event.shiftKey &&
    !event.metaKey &&
    !event.ctrlKey
  ) {
    event.preventDefault();
    ac.close();
    emit("submit", props.runActive);
    return;
  }
  if (toValue(ac.open) && event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    ac.close();
    return;
  }
  if (toValue(ac.hasItems)) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const count = toValue(ac.items).length;
      ac.setHighlight((ac.highlight.value + delta + count) % count);
      return;
    }
    if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey) {
      event.preventDefault();
      emit("accept-completion", ac.highlight.value);
      return;
    }
  }
  if (
    event.key === "Enter" &&
    !event.shiftKey &&
    (props.enterToSend || event.metaKey || event.ctrlKey)
  ) {
    event.preventDefault();
    emit("submit");
  }
}
</script>

<template>
  <div class="composer-input-wrap">
    <!--
      Gated here, not inside the dialog: the preview claims the blocking-overlay
      registry for its own lifetime, so it must only exist while it is open.
    -->
    <ComposerImagePreview
      v-if="props.imagePreview?.preview"
      :controller="props.imagePreview"
    />
    <div class="composer-input-stage">
      <!-- Vue does not render children into this node; the editor
        module paints atomic attachment chips imperatively. -->
      <div
        :ref="props.inputRef"
        class="composer-input"
        role="textbox"
        aria-multiline="true"
        :aria-readonly="props.inputBlocked"
        :aria-busy="props.pasting"
        :aria-placeholder="props.placeholderText"
        :contenteditable="!props.inputBlocked"
        spellcheck="false"
        autocorrect="off"
        autocapitalize="off"
        translate="no"
        @paste="emit('paste', $event)"
        @beforeinput="onBeforeInput"
        @input="onInput"
        @compositionstart="emit('composition-start')"
        @compositionend="emit('composition-end', $event)"
        @focus="emit('focus')"
        @blur="emit('blur')"
        @keydown="onKeyDown"
      />
      <span
        v-if="props.value.length === 0"
        :key="props.placeholderKey"
        class="composer-placeholder"
        aria-hidden="true"
      >
        {{ props.placeholderText }}
      </span>
    </div>
  </div>
</template>
