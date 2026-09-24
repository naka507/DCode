<script setup lang="ts">
/**
 * One recorded workspace change: a collapsed row carrying the git-status
 * letter, the path and the +/- counts, expanding into the diff and a rollback
 * control.
 *
 * The `ReviewChangeCard` component.
 *
 * The decisions that are not mechanical:
 *
 * 1. **`DiffBody` is this file's other half, not a child component.** It was
 *     declared in the same module and rendered from the open branch; an
 *     SFC cannot hold a second component, and a separate file would be a new
 *     module, so the body lives in this template behind
 * `v-if="open"` — which is also exactly when it is mounted.
 *  2. **The change record is a `computed`.** `reviewChangeFromMessage(message)`
 * is pure, so the two calls per render (once in the card, once in
 *     `DiffBody`) become one computed read by both halves. The card's single
 * `if (!change) return null` gates the root `<section>`; the second
 *     gate inside `DiffBody` cannot be reached without it, so the body's three
 *     branches (binary, truncated, hunks, else "no line details") render in the
 *     same `v-if` / `v-else-if` / `v-else` order and nothing else changes.
 * 3. **`rollbackWorkspaceChange` is read off the store at call time.** The action
 *     is selected with `useAppStore((state) => state.rollbackWorkspaceChange)`;
 *     the Vue store exposes `appState` as a `shallowRef`, and the action itself
 *     never changes identity, so it is called through `store.appState?` when the
 *     button is pressed. `rollingBack` / `rollbackStatus` are refs, and the
 *     local `change` inside `runRollback` replaces the non-null binding the
 *     closure captured.
 * 4. **The status mark's modifier is an object binding.** The modifier is written
 *     as `` cx("review-change-card-mark", `is-${change.status}`) ``; the three
 *     modifiers are carried verbatim, but the template-literal form is what the
 *     class-name contract reports as the fragment `is-` instead of the names, so
 *     the three literal keys are written out. The rendered class list is
 *     identical.
 *  5. **`cx` stays in the template.** `cx("review-change-card", compact &&
 * "is-compact", open && "open")` composes a list in script; the
 *     `lib/cx.ts` helper is used from the template, the idiom `Sidebar.vue` and
 * `StartupSplash.vue` already use. The `diff-line` rows keep
 *     `` cx("diff-line", line.type) `` verbatim, which is also why `context` is
 *     never reported as an undefined class: it is a runtime value, not a name
 * the markup spelled out either.
 *  6. **`aria-hidden="true"` is explicit.** A bare `aria-hidden` on the caret
 *     and the status mark would render as `""`, so the explicit `"true"` is
 *     written.
 *  7. A Vue component re-renders only when the values
 *     its template reads change.
 */
import { computed, ref, useId } from "vue";
import { useI18n } from "vue-i18n";
import type {
  ReviewChangeStatus,
  ReviewRollbackStatus,
  UiMessage,
} from "@dcode/shared";
import { reviewChangeFromMessage } from "../lib/workspace-review";
import { useAppStore } from "../stores/app-store";
import { cx } from "../lib/cx";
import { IconCheck, IconChevronRight, IconSnapshot } from "../lib/icons";

/* Git-status letters carry the status without relying on color alone; the
   localized word stays in the row's accessible name. */
const STATUS_MARKS: Record<ReviewChangeStatus, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
};

const props = withDefaults(
  defineProps<{
    message: UiMessage;
    compact?: boolean;
  }>(),
  { compact: false },
);

const { t } = useI18n();
const store = useAppStore();

const detailsId = useId();
const open = ref(false);

/** The first `const change = reviewChangeFromMessage(message)`. */
const change = computed(() => reviewChangeFromMessage(props.message));

const rollingBack = ref(false);
const rollbackStatus = ref<ReviewRollbackStatus | null>(null);

function toggle(): void {
  open.value = !open.value;
}

const statusLabel = computed(() =>
  change.value ? t(`panel.review.status.${change.value.status}`) : "",
);

const baseLabel = computed(() => {
  const record = change.value;
  if (!record) return "";
  return t(open.value ? "chat.reviewChangeHide" : "chat.reviewChangeShow", {
    status: statusLabel.value,
    path: record.path,
    additions: record.additions,
    deletions: record.deletions,
  });
});

/*
 * The collapsed row shows a rolled-back change struck through, so the state
 * has to reach the accessible name too.
 */
const accessibleLabel = computed(() =>
  change.value?.state === "rolledBack"
    ? `${baseLabel.value} · ${t("panel.review.rolledBack")}`
    : baseLabel.value,
);

async function runRollback(): Promise<void> {
  const record = change.value;
  if (
    !record ||
    !record.reversible ||
    record.state === "rolledBack" ||
    rollingBack.value
  ) {
    return;
  }
  rollingBack.value = true;
  rollbackStatus.value = null;
  const result = await store.appState?.rollbackWorkspaceChange(
    props.message.id,
    record.snapshotId,
  );
  rollingBack.value = false;
  if (result) rollbackStatus.value = result.status;
}
</script>

<template>
  <section
    v-if="change"
    class="review-change-card"
    :class="cx(compact && 'is-compact', open && 'open')"
    :data-state="change.state"
    :data-status="change.status"
  >
    <button
      type="button"
      class="review-change-card-header"
      :aria-expanded="open"
      :aria-controls="detailsId"
      :aria-label="accessibleLabel"
      :title="accessibleLabel"
      @click="toggle"
    >
      <span class="review-change-card-caret" aria-hidden="true">
        <IconChevronRight :size="11" />
      </span>
      <span
        class="review-change-card-mark"
        :class="{
          'is-added': change.status === 'added',
          'is-modified': change.status === 'modified',
          'is-deleted': change.status === 'deleted',
        }"
        aria-hidden="true"
      >
        {{ STATUS_MARKS[change.status] }}
      </span>
      <span class="review-change-card-path" :title="change.path">
        {{ change.path }}
      </span>
      <span
        class="review-change-card-counts diff-counts"
        :aria-label="t('chat.reviewChangeCounts', change)"
      >
        <span v-if="change.additions > 0" class="diff-count-add">
          +{{ change.additions }}
        </span>
        <span v-if="change.deletions > 0" class="diff-count-del">
          −{{ change.deletions }}
        </span>
      </span>
    </button>
    <div v-if="open" :id="detailsId" class="review-change-card-body">
      <div class="review-change-card-body-content">
        <div v-if="change.binary" class="review-change-note">
          {{ t("panel.review.binary") }}
        </div>
        <div v-else-if="change.truncated" class="review-change-note">
          {{ t("panel.review.tooLarge") }}
        </div>
        <div v-else-if="change.hunks.length > 0" class="review-change-diff">
          <div
            v-for="(hunk, hunkIndex) in change.hunks"
            :key="`${hunk.header}-${hunkIndex}`"
            class="diff-hunk"
          >
            <div class="diff-line hunk">
              <span class="diff-line-text">{{ hunk.header }}</span>
            </div>
            <div
              v-for="(line, lineIndex) in hunk.lines"
              :key="lineIndex"
              :class="cx('diff-line', line.type)"
            >
              <span class="diff-line-sign" aria-hidden="true">
                {{ line.type === "add" ? "+" : line.type === "del" ? "−" : " " }}
              </span>
              <span class="diff-line-text">{{ line.text }}</span>
            </div>
          </div>
        </div>
        <div v-else class="review-change-note">
          {{ t("panel.review.noLineDetails") }}
        </div>

        <div class="review-change-card-actions" :class="cx(compact && 'is-compact')">
          <div
            v-if="rollbackStatus === 'conflict'"
            class="review-change-rollback-note is-warning"
          >
            {{ t("panel.review.rollbackConflict") }}
          </div>
          <div v-else-if="rollbackStatus === 'unavailable'" class="review-change-rollback-note">
            {{ t("panel.review.rollbackUnavailable") }}
          </div>
          <span v-if="change.state === 'rolledBack'" class="review-change-state is-rolled-back">
            <IconCheck :size="13" />
            {{ t("panel.review.rolledBack") }}
          </span>
          <button
            v-else-if="change.reversible"
            type="button"
            class="review-change-rollback"
            :disabled="rollingBack"
            @click="void runRollback()"
          >
            <IconSnapshot :size="13" />
            {{ rollingBack ? t("panel.review.rollingBack") : t("panel.review.rollback") }}
          </button>
          <span v-else class="review-change-rollback-note">
            {{ t("panel.review.rollbackUnavailable") }}
          </span>
        </div>
      </div>
    </div>
  </section>
</template>
