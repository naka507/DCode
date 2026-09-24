<script setup lang="ts">
/**
 * Provenance row for a message delivered from another session: the kind label,
 * a button that jumps to the source session, and the source session id.
 *
 * The `SessionMessageOrigin` component.
 *
 * The two store action selectors are read off the store's
 * `appState` at the call site, exactly as the other reactive slices do, and the
 * `name` / `kindKey` derivations become `computed` values because both depend on
 * the `origin` prop. The bare `aria-hidden` is written as
 * `aria-hidden="true"`, because a bare attribute in a Vue template renders
 * as `""`.
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { SessionMessageOrigin as SessionMessageOriginData } from "@dcode/shared";
import { IconBranch } from "../../../lib/icons";
import { useAppStore } from "../../../stores/app-store";

const props = defineProps<{ origin: SessionMessageOriginData }>();

const { t } = useI18n();
const store = useAppStore();

/** The source's title when it has one, otherwise the raw session id. */
const name = computed(
  () => props.origin.sourceTitle || props.origin.sourceSessionId,
);

const kindKey = computed(() =>
  props.origin.kind === "task"
    ? "sessionCollaboration.taskMessage"
    : props.origin.kind === "completion"
      ? "sessionCollaboration.completionMessage"
      : "sessionCollaboration.agentMessage",
);

function openSource() {
  void store.appState?.selectSession(props.origin.sourceSessionId).catch((error: unknown) => {
    store.appState?.showToast(
      error instanceof Error ? error.message : String(error),
      { variant: "error" },
    );
  });
}
</script>

<template>
  <div class="session-message-origin" :data-session-message-kind="origin.kind">
    <span class="session-message-kind"
      ><IconBranch :size="13" aria-hidden="true" />{{ t(kindKey) }}</span
    >
    <button
      type="button"
      class="session-message-source"
      :aria-label="t('sessionCollaboration.openSource', { name })"
      @click="openSource"
    >
      {{ t("sessionCollaboration.receivedFrom", { name }) }}
    </button>
    <code class="session-message-session-id">{{ origin.sourceSessionId }}</code>
  </div>
</template>
