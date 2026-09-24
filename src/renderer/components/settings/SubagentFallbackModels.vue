<script setup lang="ts">
/**
 * Ordered alternatives use the same configured-model catalog as the primary.
 *
 * The `SubagentFallbackModels` surface. (52 lines). Two differences,
 * both framework-level:
 *
 * 1. **`onChange` is an `emit`.** The earlier implementation took an `onChange` callback prop;
 *     the sheet listens with `@change`.
 *  2. **`allowInherit={false}` / `orphanPin={null}` are explicit bindings.** A
 *     literal `false` passed as a bare attribute would arrive as `""` on a
 *     boolean prop, and `null` has to be bound so Vue does not read the string
 *     `"null"`.
 *
 * The layout utilities (`space-y-2`, `flex`, `items-center`, `gap-2`,
 * `min-w-0`, `flex-1`, `break-all`, `text-sm`) are copied verbatim from the
 * earlier markup; the hand-written partials under `src/renderer/styles/` never
 * defined them, so they are allowlisted for this file in
 * `tests/helpers/class-contract.mjs`.
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import Button from "../ui/Button.vue";
import Field from "../ui/Field.vue";
import SubagentModelPicker from "./SubagentModelPicker.vue";
import {
  groupSubagentModelChoices,
  subagentModelSelectValue,
  type SubagentModelChoice,
} from "./subagent-models";

const props = defineProps<{
  primary: string;
  values: string[];
  choices: SubagentModelChoice[];
}>();

const emit = defineEmits<{ change: [values: string[]] }>();

const { t } = useI18n();

const available = computed(() => {
  const selected = new Set(
    [props.primary, ...props.values].map((pin) => subagentModelSelectValue(pin, props.choices)),
  );
  return props.choices.filter((choice) => !selected.has(choice.value));
});

const groups = computed(() => groupSubagentModelChoices(available.value));

function move(index: number, delta: number) {
  const next = [...props.values];
  [next[index], next[index + delta]] = [next[index + delta], next[index]];
  emit("change", next);
}

function remove(index: number) {
  emit(
    "change",
    props.values.filter((_, position) => position !== index),
  );
}
</script>

<template>
  <Field
    :label="t('extensions.subagents.fallbackModels')"
    :hint="t('extensions.subagents.fallbackModelsHint')"
  >
    <ol class="space-y-2">
      <li
        v-for="(pin, index) in values"
        :key="`${index}:${pin}`"
        class="flex items-center gap-2"
      >
        <span class="min-w-0 flex-1 break-all text-sm">{{ index + 1 }}. {{ pin }}</span>
        <Button
          size="sm"
          variant="secondary"
          :disabled="index === 0"
          :aria-label="t('extensions.subagents.fallbackMoveUp', { model: pin })"
          @click="move(index, -1)"
        >
          ↑
        </Button>
        <Button
          size="sm"
          variant="secondary"
          :disabled="index === values.length - 1"
          :aria-label="t('extensions.subagents.fallbackMoveDown', { model: pin })"
          @click="move(index, 1)"
        >
          ↓
        </Button>
        <Button
          size="sm"
          variant="secondary"
          :aria-label="t('extensions.subagents.fallbackRemove', { model: pin })"
          @click="remove(index)"
        >
          ×
        </Button>
      </li>
    </ol>
    <SubagentModelPicker
      value=""
      :groups="groups"
      :orphan-pin="null"
      :allow-inherit="false"
      :disabled="available.length === 0"
      :label="t('extensions.subagents.fallbackAdd')"
      :empty-label="t('extensions.subagents.fallbackAdd')"
      @change="(pin) => emit('change', [...values, pin])"
    />
  </Field>
</template>
