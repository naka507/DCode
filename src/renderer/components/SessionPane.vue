<script setup lang="ts">
/**
 * One retained conversation pane (ADR 0137).
 *
 * The chat surface mounts one of these per retained session and keys it on the
 * session id, so a pane's transcript DOM, scroll offset, and mounted-row window
 * belong to that session for the pane's whole lifetime. Switching sessions then
 * reveals an already-painted pane instead of re-pointing one shared transcript
 * at different data, which is what made the chat area flash.
 *
 * A pane reads the live `messages` projection while it owns the store-active
 * session, and its retained snapshot once another session takes over. That way
 * leaving a session never blanks the pane the user can come back to.
 *
 * The `SessionPane` component.
 *
 * The decisions that are not mechanical:
 *
 *  1. **`useTranscriptView` and the store selectors are read once, as
 *     `computed`s.** The earlier version's selectors re-ran on every render; the
 *     hook and `store.appState` are reactive, so the values below track the same
 *     reads. `sessionId` is passed as a getter because the hook's parameter is
 *     `MaybeRefOrGetter` — a plain string would freeze the reading range at the
 *     first id this instance ever saw.
 *  2. **The pane's members are destructured.** A composable returns a plain
 *     object holding refs, and template auto-unwrapping only reaches the
 *     top-level bindings of a `<script setup>` block — `transcript.messages`
 *     would hand the child a `Ref` object, `messages` hands it the array.
 *  3. **`aria-hidden` and `inert` are bound to `undefined` when the pane is
 *     visible**, which removes the attribute from the DOM. A bare
 *     `aria-hidden` in a Vue template would render `""` rather than `"true"`.
 *  4. **The callbacks are function props, not emits** — see the note in
 *     `ChatTranscript.vue`: the scroller chains `.finally()` on what
 *     `onLoadOlder` returns, which an emitted handler cannot provide.
 */
import { computed } from "vue";
import { headAsk } from "../lib/pending-asks";
import {
  headPermission,
  sessionPermissions,
} from "../lib/pending-permissions";
import { useTranscriptView } from "../hooks/use-transcript-view";
import { useAppStore } from "../stores/app-store";
import { ChatTranscript } from "./ChatTranscript";

const props = defineProps<{
  sessionId: string;
  visible: boolean;
}>();

const store = useAppStore();

const {
  messages,
  hasMoreBefore,
  hasMoreAfter,
  focus,
  parentMessage,
  historical,
  loading,
} = useTranscriptView(() => props.sessionId);

const isRunning = computed(
  () => store.appState?.runningSessions[props.sessionId] ?? false,
);
const pendingPermission = computed(() =>
  headPermission(
    store.appState?.pendingPermissions ?? {},
    props.sessionId,
  ),
);
const queuedPermissions = computed(() =>
  Math.max(
    0,
    sessionPermissions(
      store.appState?.pendingPermissions ?? {},
      props.sessionId,
    ).length - 1,
  ),
);
const askPending = computed(() =>
  Boolean(headAsk(store.appState?.pendingAsks ?? {}, props.sessionId)),
);
const planningState = computed(
  () => store.appState?.planningStates[props.sessionId],
);

/**
 * A search hit inside a delegate's rows is addressed by its parent `Task` row,
 * because the delegate's own row is nested and not independently scrollable.
 */
const searchTarget = computed(() =>
  focus.value && parentMessage.value
    ? { ...focus.value, messageId: parentMessage.value.id, query: "" }
    : focus.value,
);

function loadOlder(): Promise<void> {
  return store.appState?.loadTranscriptPage(props.sessionId, "before") ?? Promise.resolve();
}

function loadNewer(): Promise<void> {
  return store.appState?.loadTranscriptPage(props.sessionId, "after") ?? Promise.resolve();
}

function returnToLatest(): void {
  store.appState?.returnToLatestTranscript(props.sessionId);
}
</script>

<template>
  <div
    class="session-pane"
    :data-session-pane="props.sessionId"
    :data-visible="props.visible ? 'true' : 'false'"
    :aria-hidden="props.visible ? undefined : 'true'"
    :inert="props.visible ? undefined : true"
  >
    <ChatTranscript
      :session-id="props.sessionId"
      :messages="messages"
      :has-more-before="hasMoreBefore"
      :on-load-older="loadOlder"
      :search-target="searchTarget"
      :reading-window="historical"
      :has-more-after="hasMoreAfter"
      :on-load-newer="loadNewer"
      :on-return-to-latest="returnToLatest"
      :navigation-loading="loading"
      :is-running="isRunning"
      :pending-permission="historical ? undefined : pendingPermission"
      :queued-permissions="queuedPermissions"
      :ask-pending="historical ? false : askPending"
      :planning-state="historical ? undefined : planningState"
      :pane-visible="props.visible"
    />
  </div>
</template>
