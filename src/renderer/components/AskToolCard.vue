<script setup lang="ts">
/**
 * Inline asktool card: the model's questions, one at a time.
 *
 * The `AskToolCard` component. The draft arithmetic, the per-question status
 * derivation and the submit/skip/next sequencing are kept unchanged; only the
 * reactive plumbing differs:
 *
 *  1. **`useMemo` is a `computed`.** `statuses` was memoised on `drafts`; the
 *     Vue equivalent tracks the same ref and recomputes on the same change.
 *  2. **Every `setDrafts(previous => …)` is a functional ref write.** The
 *     updater maps the previous array, so `updateDraft` reads `drafts.value` at
 *     call time exactly as the updater did.
 *  3. **`submit`/`answers` take the draft array explicitly.** The previous version passed
 *     `drafts` as a defaulted argument so a caller could submit the *next*
 *     drafts before they had been committed (`next`/`skip` compute the array,
 *     then submit it). The same defaulted parameter works here, reading
 *     `drafts.value` when the caller omits it; the decline-all path passes the
 *     explicit answer list.
 *  4. **`autoFocus` is a function ref.** The previous version focused the node when it was
 *     mounted; the input is `v-if`-gated on `customSelected`, so a function ref
 *     fires at the same moment and leaves no attribute in the DOM.
 *  5. **The indicator's state class is a binding, not string concatenation.**
 *     The previous version built `` `asktool-indicator ${status} ${current ? "current" : ""}` ``;
 *     a static class plus `:class="[status, { current: … }]"` renders the same
 *     class list from the same values.
 *  6. **`onXxx` props are emits.** `Button`'s `onClick` is the native `click`
 *     handler of `ui/Button.vue`, so `@click` reaches the same
 *     element.
 */
import { computed, ref, type ComponentPublicInstance } from "vue";
import { useI18n } from "vue-i18n";
import type { AskToolQuestion } from "@dcode/shared";
import type { PendingAsk } from "../lib/pending-asks";
import { useAppStore } from "../stores/app-store";
import Button from "./ui/Button.vue";

type DraftAnswer = {
  values: string[];
  customSelected: boolean;
  customText: string;
  skipped: boolean;
};

const CUSTOM_OPTION = "__asktool_custom__";

function emptyDrafts(questions: AskToolQuestion[]): DraftAnswer[] {
  return questions.map(() => ({
    values: [],
    customSelected: false,
    customText: "",
    skipped: false,
  }));
}

const props = withDefaults(
  defineProps<{ request: PendingAsk; queued?: number }>(),
  { queued: 0 },
);

const { t } = useI18n();
const store = useAppStore();

const index = ref(0);
const drafts = ref<DraftAnswer[]>(emptyDrafts(props.request.questions));
const resolving = ref(false);
const current = computed(() => props.request.questions[index.value]);
const currentDraft = computed(() => drafts.value[index.value]);

const currentValues = (draft: DraftAnswer): string[] => [
  ...draft.values,
  ...(draft.customSelected && draft.customText.trim()
    ? [draft.customText.trim()]
    : []),
];

const statuses = computed(() =>
  drafts.value.map((draft) => {
    if (draft.skipped) return "skipped" as const;
    return currentValues(draft).length > 0
      ? ("answered" as const)
      : ("unanswered" as const);
  }),
);

const updateDraft = (update: (draft: DraftAnswer) => DraftAnswer) => {
  drafts.value = drafts.value.map((draft, draftIndex) =>
    draftIndex === index.value ? update(draft) : draft,
  );
};

const selectOption = (option: string) => {
  updateDraft((draft) => {
    if (option === CUSTOM_OPTION) {
      return {
        ...draft,
        customSelected: !draft.customSelected,
        skipped: false,
        ...(current.value.multiSelect ? {} : { values: [] }),
      };
    }
    if (current.value.multiSelect) {
      return {
        ...draft,
        values: draft.values.includes(option)
          ? draft.values.filter((value) => value !== option)
          : [...draft.values, option],
        skipped: false,
      };
    }
    return {
      ...draft,
      values: [option],
      customSelected: false,
      customText: "",
      skipped: false,
    };
  });
};

const answers = (nextDrafts = drafts.value): Array<string[] | null> =>
  nextDrafts.map((draft) => {
    const values = currentValues(draft);
    return values.length > 0 && !draft.skipped ? values : null;
  });

const submit = async (
  nextDrafts = drafts.value,
  explicitAnswers?: Array<string[] | null>,
) => {
  if (resolving.value) return;
  resolving.value = true;
  try {
    await store.appState?.resolveAsk(props.request.sessionId, {
      requestId: props.request.requestId,
      sessionId: props.request.sessionId,
      answers: explicitAnswers ?? answers(nextDrafts),
    });
  } catch (error) {
    store.appState?.showToast(
      error instanceof Error ? error.message : String(error),
      { variant: "error" },
    );
    resolving.value = false;
  }
};

const next = () => {
  const nextDrafts = drafts.value.map((draft, draftIndex) =>
    draftIndex === index.value && currentValues(draft).length === 0
      ? { ...draft, skipped: true }
      : draft,
  );
  drafts.value = nextDrafts;
  if (index.value === props.request.questions.length - 1) void submit(nextDrafts);
  else index.value += 1;
};

const skip = () => {
  const nextDrafts = drafts.value.map((draft, draftIndex) =>
    draftIndex === index.value
      ? { ...draft, skipped: true, values: [], customSelected: false }
      : draft,
  );
  drafts.value = nextDrafts;
  if (index.value === props.request.questions.length - 1) void submit(nextDrafts);
  else index.value += 1;
};

/*
  Focus the node on insertion without writing an attribute, the way
  `autoFocus` did. A function ref also runs on every *patch* (verified in the
  installed `@vue/runtime-core`: `setRef` calls it unconditionally), so
  focusing on each call would pull focus back from the option the user just
  clicked. Tracking the attached element's identity focuses once per insertion;
  the unmount call passes `null`, so re-selecting "custom" focuses again.
*/
let focusedCustomInput: HTMLInputElement | null = null;
function focusCustomInput(element: Element | ComponentPublicInstance | null) {
  if (!(element instanceof HTMLInputElement)) {
    focusedCustomInput = null;
    return;
  }
  if (focusedCustomInput === element) return;
  focusedCustomInput = element;
  element.focus();
}

function onCustomInput(event: Event) {
  const value = (event.target as HTMLInputElement).value;
  updateDraft((draft) => ({ ...draft, customText: value, skipped: false }));
}

function decline() {
  void submit(
    drafts.value,
    props.request.questions.map(() => null),
  );
}
</script>

<template>
  <section class="asktool-card" role="region" :aria-label="t('askTool.title')">
    <div class="asktool-card-header">
      <div>
        <div class="asktool-card-title" role="status" aria-live="polite">
          {{ t("askTool.title") }}
        </div>
        <div class="asktool-card-progress">
          {{ t("askTool.progress", { current: index + 1, total: request.questions.length }) }}
          <span v-if="queued > 0"> · {{ t("askTool.queued", { count: queued }) }}</span>
        </div>
      </div>
      <button
        type="button"
        class="asktool-decline"
        :disabled="resolving"
        @click="decline"
      >
        {{ t("askTool.decline") }}
      </button>
    </div>

    <div class="asktool-indicators" :aria-label="t('askTool.indicatorLabel')">
      <button
        v-for="(status, statusIndex) in statuses"
        :key="`${request.requestId}-${statusIndex}`"
        type="button"
        class="asktool-indicator"
        :class="[status, { current: statusIndex === index }]"
        :aria-label="t(`askTool.status.${status}`, { number: statusIndex + 1 })"
        :aria-current="statusIndex === index ? 'step' : undefined"
        @click="index = statusIndex"
      />
    </div>

    <div class="asktool-question-number">
      {{ t("askTool.questionNumber", { number: index + 1 }) }}
    </div>
    <h3 class="asktool-question">{{ current.question }}</h3>
    <div class="asktool-options" :role="current.multiSelect ? 'group' : 'radiogroup'">
      <button
        v-for="option in current.options"
        :key="option"
        type="button"
        class="asktool-option"
        :class="{ selected: currentDraft.values.includes(option) }"
        :aria-pressed="
          current.multiSelect ? currentDraft.values.includes(option) : undefined
        "
        :aria-checked="
          !current.multiSelect ? currentDraft.values.includes(option) : undefined
        "
        :role="current.multiSelect ? 'checkbox' : 'radio'"
        @click="selectOption(option)"
      >
        <span class="asktool-option-mark" aria-hidden="true">
          {{ currentDraft.values.includes(option) ? "✓" : "" }}
        </span>
        <span>{{ option }}</span>
      </button>
      <button
        type="button"
        class="asktool-option asktool-custom-option"
        :class="{ selected: currentDraft.customSelected }"
        :aria-pressed="
          current.multiSelect ? currentDraft.customSelected : undefined
        "
        :aria-checked="
          !current.multiSelect ? currentDraft.customSelected : undefined
        "
        :role="current.multiSelect ? 'checkbox' : 'radio'"
        @click="selectOption(CUSTOM_OPTION)"
      >
        <span class="asktool-option-mark" aria-hidden="true">
          {{ currentDraft.customSelected ? "✓" : "" }}
        </span>
        <span>{{ t("askTool.customOption") }}</span>
      </button>
    </div>
    <input
      v-if="currentDraft.customSelected"
      :ref="focusCustomInput"
      class="asktool-custom-input"
      :value="currentDraft.customText"
      :placeholder="t('askTool.customPlaceholder')"
      :aria-label="t('askTool.customOption')"
      @input="onCustomInput"
    />

    <div class="asktool-card-actions">
      <Button variant="ghost" :disabled="resolving" @click="skip">
        {{ t("askTool.skip") }}
      </Button>
      <Button variant="primary" :disabled="resolving" @click="next">
        {{
          index === request.questions.length - 1
            ? t("askTool.submit")
            : t("askTool.next")
        }}
      </Button>
    </div>
  </section>
</template>
