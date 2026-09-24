<script setup lang="ts">
/**
 * Editable key/value rows for MCP env vars and HTTP headers.
 *
 * The `KeyValueRows` component. A textarea of
 * `KEY=value` lines is cheaper to build and worse to use: it offers no per-row
 * delete, no alignment, and no way to mask a token. Rows keep their own
 * identity, so editing one credential never disturbs another.
 *
 * The two framework-free conversions (`pairsToRecord`, `recordToPairs`) and the
 * `KeyValuePair` type live in `./key-value-rows`. They are *not* re-exported
 * from here: `<script setup>` may
 * not contain a value export (`export type` is the only kind the compiler
 * allows), and every consumer already imports them from `./key-value-rows`
 * directly — `McpEditorSheet.vue`, `ProviderHeadersEditor.vue`,
 * `ProviderSetupDialog.vue`, `VendorAccountDialog.vue` and `mcp-editor.ts`.
 *
 * Deliberate choices:
 *  - `useId()` gives this instance a stable
 *    prefix for the row keys.
 * - `onChange` stays a callback prop, not an emit. The single `onChange`
 *    took the whole next array, which is a value contract rather than an event
 *    one, and `ProviderHeadersEditor` reads it as a plain function — the same
 *    choice the settings rows make for `saveSettings`.
 *  - `TooltipButton`'s prop is `label` (not `tooltip`) and its `ariaLabel`; the
 * component defaults `as` to `"button"`, which is the anchor
 *    rendered here.
 */
import { useId } from "vue";
import { useI18n } from "vue-i18n";
import TooltipButton from "../TooltipButton.vue";
import { IconPlus, IconX } from "../../lib/icons";
import type { KeyValuePair } from "./key-value-rows";

const props = withDefaults(
  defineProps<{
    pairs: KeyValuePair[];
    onChange: (next: KeyValuePair[]) => void;
    keyPlaceholder: string;
    valuePlaceholder: string;
    addLabel: string;
    /** Masks values, for tokens the user would not want shoulder-surfed. */
    secret?: boolean;
  }>(),
  { secret: false },
);

const { t } = useI18n();
const groupId = useId();

function setAt(index: number, patch: Partial<KeyValuePair>) {
  props.onChange(
    props.pairs.map((pair, i) => (i === index ? { ...pair, ...patch } : pair)),
  );
}

function removeAt(index: number) {
  props.onChange(props.pairs.filter((_, i) => i !== index));
}

function addRow() {
  props.onChange([...props.pairs, { key: "", value: "" }]);
}
</script>

<template>
  <div class="kv-rows">
    <div v-for="(pair, index) in pairs" :key="`${groupId}-${index}`" class="kv-row">
      <input
        class="field-input kv-key"
        :value="pair.key"
        :placeholder="keyPlaceholder"
        spellcheck="false"
        autocapitalize="off"
        autocorrect="off"
        :aria-label="keyPlaceholder"
        @input="setAt(index, { key: ($event.target as HTMLInputElement).value })"
      />
      <input
        class="field-input kv-value"
        :value="pair.value"
        :type="secret ? 'password' : 'text'"
        :placeholder="valuePlaceholder"
        spellcheck="false"
        autocapitalize="off"
        autocorrect="off"
        :aria-label="valuePlaceholder"
        @input="setAt(index, { value: ($event.target as HTMLInputElement).value })"
      />
      <TooltipButton
        type="button"
        class="kv-remove"
        :aria-label="t('extensions.mcp.removeRow')"
        :label="t('extensions.mcp.removeRow')"
        @click="removeAt(index)"
      >
        <IconX :size="12" />
      </TooltipButton>
    </div>
    <button
      type="button"
      class="kv-add"
      :class="{ 'is-first': pairs.length === 0 }"
      @click="addRow"
    >
      <IconPlus :size="12" />
      {{ addLabel }}
    </button>
  </div>
</template>
