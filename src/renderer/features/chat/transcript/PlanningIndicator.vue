<script setup lang="ts">
/**
 * The proposal-planning status row: the same three-dot mark as the working
 * indicator, with the copy for the proposal kind being planned.
 *
 * The `PlanningIndicator` component.
 *
 * The implementation decisions that are not mechanical:
 *
 *  1. **`t(\`${kind}.planning\`)` keeps the shape.** The key is built from
 *     the `ProposalKind` ("plan" | "goal") and both are present in every shipped
 *     catalog, so no fallback is needed.
 *  2. **`aria-hidden="true"` is explicit** on the glyph wrapper: a bare
 *     attribute in a Vue template renders as `""`, so the explicit value is
 *     required.
 */
import { useI18n } from "vue-i18n";
import type { ProposalKind } from "@dcode/shared";

const props = defineProps<{ kind: ProposalKind }>();

const { t } = useI18n();
</script>

<template>
  <div
    class="planning-state-indicator"
    role="status"
    aria-live="polite"
    :data-kind="props.kind"
    data-testid="planning-indicator"
  >
    <span class="working-indicator-mark" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
    <span>{{ t(`${props.kind}.planning`) }}</span>
  </div>
</template>
