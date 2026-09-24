/**
 * Framework-free half of the transcript row helpers.
 *
 * Plain tables and pure helpers live here beside ten presentational
 * components. A `.vue` file cannot export either to a sibling, so the module is
 * split along that seam:
 * One `{ size: 15, "aria-hidden": true }` props object is spread over the chosen
 * icon; a
 * split along that seam:
 *
 *   - here: the four action/lifecycle label tables, `PREVIEWABLE_ACTIONS`,
 *     `fileChipIcon`, and `useAutomaticDisclosure`;
 *   - one `.vue` per component, named after the component:
 *     `CopyButton.vue`, `MessageMeta.vue`, `AssistantErrorMessage.vue`,
 *     `ToolActionIcon.vue`, `FileRefChip.vue`, `MessageAttachmentImage.vue`,
 *     `LinkifiedText.vue`, `ToolCommandCopy.vue`,
 *     `DisclosureCollapseRail.vue`, `ThinkingRow.vue`.
 *
 * Every export keeps its name, so a call site only changes its import
 * path.
 */
import { ref, watch, type Component, type Ref } from "vue";
import type { ToolAction } from "../../../lib/tool-display";
import { useDisclosureAnchorNotifier } from "../../../lib/disclosure-anchor-context";
import {
  IconArchive,
  IconAudio,
  IconCode,
  IconFileText,
  IconImage,
  IconSheet,
  IconVideo,
} from "../../../lib/icons";

export const TOOL_ACTION_KEYS: Record<ToolAction, string> = {
  read: "chat.toolRead",
  list: "chat.toolListed",
  search: "chat.toolSearched",
  write: "chat.toolWrote",
  edit: "chat.toolEdited",
  run: "chat.toolRan",
  fetch: "chat.toolFetched",
  fork: "chat.toolUsed",
  delegate: "chat.toolDelegated",
  use: "chat.toolUsed",
};

/**
 * A lifecycle row says what it did to subagents, not that it "delegated":
 * `Task` is the only call that delegates (ADR 0062, ADR 0089, D268).
 */
export const LIFECYCLE_LABEL_KEYS: Record<"wait" | "list" | "stop", string> = {
  wait: "chat.subagentWaited",
  list: "chat.subagentListed",
  stop: "chat.subagentStopped",
};

/** A wait in progress is the one lifecycle row that visibly takes time. */
export const LIFECYCLE_RUNNING_KEYS: Record<"wait" | "list" | "stop", string> = {
  wait: "chat.subagentWaiting",
  list: "chat.subagentListing",
  stop: "chat.subagentStopping",
};

export const TOOL_RUNNING_KEYS: Record<ToolAction, string> = {
  read: "chat.toolReading",
  list: "chat.toolListing",
  search: "chat.toolSearching",
  write: "chat.toolWriting",
  edit: "chat.toolEditing",
  run: "chat.toolRunning",
  fetch: "chat.toolFetching",
  fork: "chat.toolUsing",
  delegate: "chat.toolDelegating",
  use: "chat.toolUsing",
};

/** Actions whose path/url argument makes sense to preview in the panel. */
export const PREVIEWABLE_ACTIONS = new Set<ToolAction>(["read", "write", "edit", "fetch"]);

/** File-family glyph for a chat chip, chosen from the name (and image kind). */
export function fileChipIcon(name: string, kind?: "image" | "file"): Component {
  if (kind === "image" || /\.(avif|bmp|gif|heic|jpe?g|png|tiff?|webp)$/i.test(name)) {
    return IconImage;
  }
  if (
    /\.(cjs|css|go|html?|java|js|json|jsx|kt|mjs|php|py|rb|rs|sh|sql|svelte|swift|toml|ts|tsx|vue|ya?ml)$/i.test(
      name,
    )
  ) {
    return IconCode;
  }
  if (/\.(7z|bz2|gz|jar|rar|tar|zip)$/i.test(name)) return IconArchive;
  if (/\.(csv|ods|xls|xlsx)$/i.test(name)) return IconSheet;
  if (/\.(flac|m4a|mp3|ogg|wav)$/i.test(name)) return IconAudio;
  if (/\.(avi|mkv|m4v|mov|mp4|webm)$/i.test(name)) return IconVideo;
  return IconFileText;
}

/**
 * Automatic disclosure is deliberately separate from user disclosure state.
 * A running process may open its latest details and close them when it settles,
 * but one user click takes ownership for the rest of that component's lifetime.
 * A `watch(..., { flush: "post" })` keeps the automatic transition from moving
 * the transcript for a painted frame.
 *
 * A *manual* toggle also hands its own title to the scroller that owns it,
 * before the state changes (#324): the height under the click may keep changing
 * for several frames, and the reader's place in the transcript is the one thing
 * that must not move while it does. The automatic transition below writes `open`
 * directly and never claims a reading position.
 */
export function useAutomaticDisclosure(
  automaticOpen: Ref<boolean> | (() => boolean),
  revealRequest?: Ref<number | undefined> | (() => number | undefined),
) {
  const readAutomatic = () =>
    typeof automaticOpen === "function" ? automaticOpen() : automaticOpen.value;
  const readReveal = () =>
    typeof revealRequest === "function" ? revealRequest() : revealRequest?.value;

  const open = ref(readAutomatic() || readReveal() !== undefined);
  const notifyAnchor = useDisclosureAnchorNotifier();
  const titleRef = ref<HTMLButtonElement | null>(null);
  let userInteracted = false;
  let previousAutomaticOpen = readAutomatic();

  watch(
    readAutomatic,
    (next) => {
      if (userInteracted) return;
      if (previousAutomaticOpen === next) return;
      previousAutomaticOpen = next;
      open.value = next;
    },
    { flush: "post" },
  );

  watch(
    readReveal,
    (next) => {
      if (next === undefined) return;
      claim();
      open.value = true;
    },
    { flush: "post" },
  );

  function claim() {
    userInteracted = true;
  }

  function toggle() {
    claim();
    notifyAnchor?.(titleRef.value);
    open.value = !open.value;
  }

  function collapse() {
    claim();
    notifyAnchor?.(titleRef.value);
    open.value = false;
  }

  return { open, toggle, collapse, claim, titleRef };
}
