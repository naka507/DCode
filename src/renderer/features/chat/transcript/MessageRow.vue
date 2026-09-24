<script setup lang="ts">
/**
 * One transcript row: a user prompt (optionally being edited), an assistant
 * answer, and the action bar under either.
 *
 * The `MessageRow` component.
 *
 * The decisions that are not mechanical:
 *
 *  1. **A component re-renders only when the values its template reads change**,
 *     so no wrapper is needed.
 * 2. **The `useState` pair is a `ref` + a `computed` seed.** `editValue` used to
 *     be initialized from `editSeed` once, then re-read `editSeed` on
 *     cancel and on the edit button; here `editSeed` is a `computed` and
 *     `editValue` still captures it at setup, so both call sites stay honest.
 * 3. **`useMemo` for the extra attachments is a `computed`.** The type
 *     predicate narrows the segment union; the loop below narrows it for free
 *     and collects the same file targets.
 *  4. **`autoFocus` is a function ref that focuses once per insertion.** The node
 *     was focused when it mounted and never wrote an `autofocus`
 *     attribute; the form is `v-if`'d on `editing`, so a function ref fires on
 *     the same commit. A Vue function ref runs on every patch
 *     too, so the ref compares the element's identity and focuses only when it
 *     changes. Same idiom as `components/SearchDialog.vue`.
 *  5. **`data-source-start` / `data-source-end` on the slash-command chip are
 * literal here, not props.** They used to be written as constants on the
 *     `<code>` element; `lib/transcript-search-highlight.ts` finds a match by
 *     querying `[data-source-start][data-source-end]`, so the two attributes
 *     are load-bearing exactly as written. (The camelization trap this port has
 *     been bitten by applies to *declared props*, not to literal attributes.)
 *  6. **The store's action selectors become `store.appState?.<action>`.**
 *     `appState` is a `shallowRef` on the Pinia store; `getState()` is not part
 *     of its surface.
 * 7. **The bare attributes are written out.** There is no bare
 *     `aria-hidden` in this file; `aria-busy` and `data-row-role` are bound to
 *     `undefined` when absent, which removes the attribute the way an
 *     `undefined` binding does.
 */
import { computed, ref, type ComponentPublicInstance } from "vue";
import { useI18n } from "vue-i18n";
import type { UiMessage } from "@dcode/shared";
import { useOpenChatFileRef } from "../../../hooks/use-preview-target";
import { splitChatText } from "../../../lib/chat-links";
import {
  IconChevronLeft,
  IconChevronRight,
  IconPencil,
  IconTrash,
} from "../../../lib/icons";
import { useAppStore } from "../../../stores/app-store";
import Markdown from "../../../components/Markdown.vue";
import TooltipButton from "../../../components/TooltipButton.vue";
import SessionMessageOrigin from "./SessionMessageOrigin.vue";
import CopyButton from "./CopyButton.vue";
import FileRefChip from "./FileRefChip.vue";
import LinkifiedText from "./LinkifiedText.vue";
import MessageAttachmentImage from "./MessageAttachmentImage.vue";
import { userMessageMenuItems } from "./menu-items";
import {
  useChatTextActions,
  useTranscriptMenu,
} from "../../../lib/transcript-menu-context";

const props = defineProps<{
  message: UiMessage;
  isRunning: boolean;
}>();

const { t } = useI18n();
const store = useAppStore();
const openFileRef = useOpenChatFileRef();
const openTranscriptMenu = useTranscriptMenu();
const { copyText, selectText } = useChatTextActions();

const isUser = computed(() => props.message.role === "user");
const isSessionMessage = computed(() => Boolean(props.message.sessionMessage));
const editableUserMessage = computed(
  () => isUser.value && !isSessionMessage.value,
);
const workspaceRoot = computed(() => store.appState?.workspace?.path);

// Slash prompts are stored expanded; editing works on the typed form so the
// resent turn re-expands the template (D123).
const editSeed = computed(
  () =>
    (editableUserMessage.value && props.message.command) ||
    (props.message.content || ""),
);

const editing = ref(false);
const editValue = ref(editSeed.value);
const retryingEdit = ref(false);

const copyLabel = computed(() => t("chat.copy"));
const editLabel = computed(() => t("chat.editMessage"));
const deleteLabel = computed(() => t("chat.deleteMessage"));

// Runtime chunks are already progressive. Rendering that source directly
// avoids a second per-frame state loop while Markdown memoizes stable blocks.
const displayed = computed(() => props.message.content || "");
const hasAnswer = computed(() => Boolean((props.message.content || "").trim()));
const revisionCount = computed(() => props.message.revisionCount ?? 0);
const activeRevision = computed(
  () => props.message.activeRevision ?? revisionCount.value,
);
const showRevisionPager = computed(
  () => editableUserMessage.value && revisionCount.value > 1,
);

const rowLabel = computed(() =>
  t(
    isSessionMessage.value
      ? "sessionCollaboration.agentMessage"
      : isUser.value
        ? "chat.userMessage"
        : "chat.assistantMessage",
  ),
);

/** Line count of the editor, clamped to the 3–12 range. */
const editRows = computed(() =>
  Math.min(12, Math.max(3, editValue.value.split("\n").length)),
);

const canSubmitEdit = computed(
  () =>
    !retryingEdit.value &&
    (Boolean(editValue.value.trim()) || Boolean(props.message.attachments?.length)),
);

/**
 * Attachments that the message body did not already render inline as a chip.
 * the type predicate becomes a narrowing loop, which collects the same
 * file targets.
 */
const extraAttachments = computed(() => {
  const attachments = props.message.attachments;
  if (!attachments?.length) return [];
  const inline = new Set<string>();
  for (const segment of splitChatText(
    String(props.message.content || ""),
    workspaceRoot.value,
  )) {
    if (segment.kind === "target" && segment.target.kind === "file") {
      inline.add(segment.target.path);
    }
  }
  return attachments.filter((attachment) => !inline.has(attachment.ref));
});

/*
  The `autoFocus` behaviour, which writes no attribute: focus when the element is
  inserted. A Vue function ref runs on every patch of the vnode, not only on
  mount, so focusing unconditionally would steal focus back from whatever the
  user just clicked on any re-render (a keystroke updates `:value`, and
  `retryingEdit` toggles on Retry). Tracking the attached element's identity
  focuses exactly once per insertion: the unmount call passes `null`, so
  cancelling and re-opening the editor focuses the new textarea again.
*/
let focusedEditor: HTMLTextAreaElement | null = null;
function focusEditor(element: Element | ComponentPublicInstance | null) {
  if (!(element instanceof HTMLTextAreaElement)) {
    focusedEditor = null;
    return;
  }
  if (focusedEditor === element) return;
  focusedEditor = element;
  element.focus();
}

function cancelEdit() {
  editValue.value = editSeed.value;
  editing.value = false;
}

async function retryEdit() {
  const next = editValue.value.trim();
  if (!editableUserMessage.value || retryingEdit.value || (!next && !props.message.attachments?.length))
    return;
  retryingEdit.value = true;
  const saved = await store.appState?.editUserMessage(
    props.message.id,
    next,
    props.message.attachments,
  );
  retryingEdit.value = false;
  if (saved) editing.value = false;
}

function onEditKeyDown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    cancelEdit();
  } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    void retryEdit();
  }
}

function startEdit() {
  editValue.value = editSeed.value;
  editing.value = true;
}

function onEditInput(event: Event) {
  editValue.value = (event.target as HTMLTextAreaElement).value;
}
/*
  The pointer path to the actions the hover row already offers. Only a human
  turn is owned here: an assistant answer belongs to its turn, so this row
  must not answer for one — it would offer Copy without the Regenerate and
  Branch items that live on the turn.
*/
function onContextMenu(event: MouseEvent): void {
  if (!isUser.value) return;
  const target = event.currentTarget;
  openTranscriptMenu(event, {
    label: t("chat.messageMenu"),
    items: userMessageMenuItems({
      t,
      text: props.message.content || "",
      selectTarget:
        target instanceof HTMLElement
          ? target.querySelector<HTMLElement>(".message-bubble")
          : null,
      editable: editableUserMessage.value,
      running: props.isRunning,
      revision: showRevisionPager.value
        ? { count: revisionCount.value, active: activeRevision.value }
        : null,
      actions: { copyText, selectText },
      onEdit: startEdit,
      onDelete: () => void store.appState?.deleteMessage(props.message.id),
      onActivateRevision: (index) =>
        void store.appState?.activateMessageRevision(props.message.id, index),
    }),
  });
}
</script>

<template>
  <div
    class="message-row"
    :class="isSessionMessage ? 'session-message' : isUser ? 'user' : message.role"
    :data-minimap-id="message.id"
    :data-message-id="message.id"
    @contextmenu="onContextMenu"
    :data-row-role="isSessionMessage ? undefined : 'user'"
    role="article"
    :aria-label="rowLabel"
  >
    <div class="message-col">
      <SessionMessageOrigin
        v-if="message.sessionMessage"
        :origin="message.sessionMessage"
      />
      <div v-if="isUser || displayed" class="message-bubble">
        <form
          v-if="editing && editableUserMessage"
          class="message-edit"
          :aria-busy="retryingEdit || undefined"
          @submit.prevent="void retryEdit()"
        >
          <textarea
            :ref="focusEditor"
            class="message-edit-input selectable"
            :value="editValue"
            :rows="editRows"
            :aria-label="editLabel"
            spellcheck="false"
            autocorrect="off"
            autocapitalize="off"
            :disabled="retryingEdit"
            @input="onEditInput"
            @keydown="onEditKeyDown"
          />
          <div class="message-edit-actions">
            <button
              type="button"
              class="icon-btn message-edit-cancel"
              :disabled="retryingEdit"
              @click="cancelEdit"
            >
              {{ t("chat.cancelEdit") }}
            </button>
            <button
              type="submit"
              class="send-btn message-edit-submit"
              :disabled="!canSubmitEdit"
            >
              {{ retryingEdit ? t("chat.retryingEdit") : t("chat.retryEdit") }}
            </button>
          </div>
        </form>
        <template v-else-if="isUser">
          <div
            v-if="extraAttachments.length"
            class="message-attachments"
            role="list"
            :aria-label="t('chat.messageAttachments')"
          >
            <template
              v-for="attachment in extraAttachments"
              :key="`${attachment.ref}:${attachment.name}`"
            >
              <MessageAttachmentImage
                v-if="attachment.kind === 'image'"
                :attachment="attachment"
                :on-open-file="openFileRef"
              />
              <span v-else role="listitem">
                <FileRefChip
                  :name="attachment.name"
                  :path="attachment.ref"
                  :kind="attachment.kind"
                  :on-open="openFileRef"
                />
              </span>
            </template>
          </div>
          <div v-if="message.content" class="message-user-text selectable">
            <!-- Slash invocations show the typed form as a chip; the expanded
              template body lives in `content` (hover reveals it) and is what
              regenerate/reseed replay (D123). -->
            <code
              v-if="editableUserMessage && message.command"
              class="chat-command-chip"
              :data-source-start="0"
              :data-source-end="message.content.length"
              :title="String(message.content || '')"
            >{{ message.command }}</code>
            <LinkifiedText
              v-else
              :text="String(message.content || '')"
              :attachments="message.attachments"
            />
          </div>
        </template>
        <div v-else class="prose-chat">
          <Markdown :source="displayed" />
        </div>
      </div>
      <div v-if="!editing && (hasAnswer || showRevisionPager)" class="message-actions">
        <div
          v-if="showRevisionPager"
          class="message-revision-pager"
          role="group"
          :aria-label="t('chat.revisions')"
        >
          <TooltipButton
            class="copy-btn icon revision-nav"
            :label="t('chat.revisionPrev')"
            :aria-label="t('chat.revisionPrev')"
            :disabled="isRunning || activeRevision <= 1"
            @click="
              void store.appState?.activateMessageRevision(
                message.id,
                Math.max(1, activeRevision - 1),
              )
            "
          >
            <IconChevronLeft :size="13" />
          </TooltipButton>
          <span class="message-revision-label">
            {{ t("chat.revisionPager", { current: activeRevision, total: revisionCount }) }}
          </span>
          <TooltipButton
            class="copy-btn icon revision-nav"
            :label="t('chat.revisionNext')"
            :aria-label="t('chat.revisionNext')"
            :disabled="isRunning || activeRevision >= revisionCount"
            @click="
              void store.appState?.activateMessageRevision(
                message.id,
                Math.min(revisionCount, activeRevision + 1),
              )
            "
          >
            <IconChevronRight :size="13" />
          </TooltipButton>
        </div>
        <CopyButton v-if="hasAnswer" :text="message.content" :label="copyLabel" />
        <TooltipButton
          v-if="editableUserMessage"
          class="copy-btn icon"
          :label="editLabel"
          :aria-label="editLabel"
          :disabled="isRunning"
          @click="startEdit"
        >
          <IconPencil :size="13" />
        </TooltipButton>
        <TooltipButton
          v-if="editableUserMessage"
          class="copy-btn icon danger"
          :label="deleteLabel"
          :aria-label="deleteLabel"
          :disabled="isRunning"
          @click="void store.appState?.deleteMessage(message.id)"
        >
          <IconTrash :size="13" />
        </TooltipButton>
      </div>
    </div>
  </div>
</template>
