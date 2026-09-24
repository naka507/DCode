<script setup lang="ts">
/**
 * Permission gate for one gated tool call, answered oldest first.
 *
 * The `PermissionCard` component. The choices that are not
 * mechanical:
 *
 *  1. **`<Trans i18nKey="permission.allowPrompt">` is a string split.** The
 *     catalogs keep their message text unchanged, so the message still
 *     carries i18next's component syntax —
 *     `Allow <highlight>{{tool}}</highlight> to run?` — which vue-i18n's
 *     message compiler treats as ordinary text; rendering it as-is would print
 *     the tags. The message is resolved with the tool name and split on the tag
 *     pair, so the highlighted run becomes the same
 * `<span class="text-text-primary">` element that map produced, without
 *     `v-html` and therefore without a sanitizer.
 *  2. **`useMemo` is a `computed`.** `argBlocks` was memoised on the tool name
 *     and the argument preview; the computed tracks the same two values.
 *  3. **The two `useEffect`s are two watchers.** The countdown effect is an
 *     `immediate` watcher whose `onCleanup` clears the interval — the same
 *     reset/tick/clear shape keyed on `receivedAt` and `requestId`. The
 *     auto-deny effect is `immediate` too, because it also ran on
 *     mount: a card whose request already expired denies without waiting for
 *     the next tick.
 *  4. **`useRef(false)` is a plain setup-scope variable.** `timeoutHandled` is
 *     never rendered; it only stops the auto-deny from firing twice, and the
 *     countdown watcher resets it exactly where the effect did.
 *  5. **Store reads and actions.** `workspace` is a `computed` over
 *     `store.appState?.sessions`, and the two actions are called off
 *     `store.appState?.` inside `resolve`, the handler path — the shape
 *     `AskToolCard.vue` already uses.
 *  6. **`` `permission-card risk-${risk}` `` is a static class plus an object
 *     binding.** The rendered class list is identical; the object form is the
 *     one the class contract can read, and the three names are the ones
 *     `styles/messages.css` defines.
 *  7. **`ToolDetailBlocks` is the *named* export of `./ToolDetails.vue`** — the
 *     same named import used at the call site. That file exports two components and
 *     documents why its named export is the real one.
 *
 * Every key this card asks for is present in
 * both catalogs, so no inline fallback is carried.
 */
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  permissionSecondsLeft,
  type PendingPermission,
} from "../lib/pending-permissions";
import { useAppStore } from "../stores/app-store";
import { buildToolPresentation } from "../lib/tool-presentation";
import { ToolDetailBlocks } from "./ToolDetails.vue";
import Button from "./ui/Button.vue";

const props = withDefaults(
  defineProps<{
    permission: PendingPermission;
    /** Requests waiting behind this one; the user answers them in order. */
    queued?: number;
  }>(),
  { queued: 0 },
);

const { t } = useI18n();
const store = useAppStore();

/** Project path of the session that asked, shown as the card's context. */
const workspace = computed(() =>
  store.appState?.sessions.find(
    (session) => session.id === props.permission.sessionId,
  )?.projectPath,
);

const secondsLeft = ref(permissionSecondsLeft(props.permission.receivedAt));
const resolving = ref(false);
/** `useRef(false)`: not rendered, only guards the auto-deny (see note 4). */
let timeoutHandled = false;

const restoreComposerFocus = () => {
  window.requestAnimationFrame(() => {
    document.querySelector<HTMLTextAreaElement>(".composer-input")?.focus();
  });
};

const resolve = async (
  decision: "allow-once" | "allow-session" | "deny",
) => {
  if (resolving.value) return;
  resolving.value = true;
  try {
    await store.appState?.resolvePermission(
      props.permission.sessionId,
      props.permission.requestId,
      decision,
    );
  } catch (error) {
    store.appState?.showToast(
      error instanceof Error ? error.message : String(error),
      { variant: "error" },
    );
    resolving.value = false;
  } finally {
    restoreComposerFocus();
  }
};

watch(
  [() => props.permission.receivedAt, () => props.permission.requestId],
  (_current, _previous, onCleanup) => {
    timeoutHandled = false;
    const update = () => {
      secondsLeft.value = permissionSecondsLeft(props.permission.receivedAt);
    };
    update();
    const timer = window.setInterval(update, 1000);
    onCleanup(() => window.clearInterval(timer));
  },
  { immediate: true },
);

watch(
  [resolving, secondsLeft],
  () => {
    if (secondsLeft.value > 0 || timeoutHandled || resolving.value) return;
    timeoutHandled = true;
    void resolve("deny");
  },
  { immediate: true },
);

/*
 * Same structured presentation as the transcript tool rows: a command reads as
 * shell, file content as code, everything else as labeled fields.
 */
const argBlocks = computed(() =>
  buildToolPresentation({
    toolName: props.permission.toolName,
    toolArgs: props.permission.argsPreview,
  }),
);

const risk = computed(() => props.permission.risk || "high");

/** The `<highlight>` tag pair the catalogs wrap the tool name in (note 1). */
const ALLOW_PROMPT_TAG = /<highlight>([\s\S]*?)<\/highlight>/;

const allowPrompt = computed(() => {
  const message = t("permission.allowPrompt", {
    tool: props.permission.toolName,
  });
  const match = ALLOW_PROMPT_TAG.exec(message);
  if (!match) return { before: message, tool: "", after: "" };
  return {
    before: message.slice(0, match.index),
    tool: match[1],
    after: message.slice(match.index + match[0].length),
  };
});
</script>

<template>
  <section
    class="permission-card"
    :class="{
      'risk-high': risk === 'high',
      'risk-medium': risk === 'medium',
      'risk-low': risk === 'low',
    }"
    role="region"
    :aria-label="t('permission.title')"
  >
    <div class="permission-card-header">
      <span class="permission-card-title" role="status" aria-live="polite">
        {{ t("permission.title") }}
      </span>
      <span v-if="queued > 0" class="permission-card-queued">
        {{ t("permission.queued", { count: queued }) }}
      </span>
      <span
        class="permission-risk"
        :class="{
          'risk-high': risk === 'high',
          'risk-medium': risk === 'medium',
          'risk-low': risk === 'low',
        }"
      >
        {{ t(`permission.risk.${risk}`) }}
      </span>
    </div>
    <div v-if="permission.agentName" class="permission-card-agent">
      {{ t("permission.fromSubagent", { agent: permission.agentName }) }}
    </div>
    <div class="permission-card-prompt">
      {{ allowPrompt.before }}<span
        v-if="allowPrompt.tool"
        class="text-text-primary"
        >{{ allowPrompt.tool }}</span
      >{{ allowPrompt.after }}
    </div>
    <div v-if="permission.reason" class="permission-card-reason">
      {{ permission.reason }}
    </div>
    <div v-if="argBlocks.length > 0" class="permission-card-args">
      <ToolDetailBlocks :blocks="argBlocks" />
    </div>
    <div class="permission-card-meta">
      <span :title="workspace">
        {{
          t("permission.workspace", {
            workspace: workspace || t("permission.temporarySession"),
          })
        }}
      </span>
      <span role="timer">
        {{ t("permission.countdown", { seconds: secondsLeft }) }}
      </span>
    </div>
    <div class="permission-card-actions">
      <Button variant="ghost" :disabled="resolving" @click="void resolve('deny')">
        {{ t("permission.deny") }}
      </Button>
      <Button
        variant="secondary"
        :disabled="resolving"
        @click="void resolve('allow-session')"
      >
        {{ t("permission.allowSession") }}
      </Button>
      <Button
        variant="primary"
        :disabled="resolving"
        @click="void resolve('allow-once')"
      >
        {{ t("permission.allowOnce") }}
      </Button>
    </div>
  </section>
</template>
