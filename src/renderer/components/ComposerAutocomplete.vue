<script setup lang="ts">
/**
 * Composer autocomplete panel (D123–D125, spec 08 §11.8): full composer width
 * above the input, focus stays in the textarea — rows accept on mousedown so
 * the caret never leaves the draft.
 *
 * The `ComposerAutocomplete` component. The decisions that are not
 * mechanical:
 *
 *  1. **`Highlighted` is a precomputed part list, not a nested component.**
 * The template renders a fragment of `<span>`s — one per fuzzy-match range
 *     plus one per gap. `highlightParts` builds that same sequence as data and
 *     the template renders it with one `v-for`, so the DOM keeps both the
 *     `<span class="composer-ac-hl">` highlights and the plain `<span>` gaps.
 * 2. **The row list is built once, in a `computed`.** Group labels and rows
 *     would otherwise be pushed into one array while rendering. The sequence depends only
 *     on the item list and the highlight, so it is derived up front — group
 * label first, then its rows.
 * 3. **`anchorRef` accepts a ref, a getter, or the element.** The earlier version took a
 *     `RefObject<HTMLElement | null>` and read `.current`; `AnchoredMenu` takes
 *     an `anchor` element, and a ref used in a template binding is unwrapped
 *     before it reaches a prop, so all three forms are accepted — the same
 *     idiom `ConversationMinimap` uses for its scroller.
 *  4. **`onAccept` is the `accept` emit; `onClose` is the menu's `close`.**
 *     `AnchoredMenu` owns the close gesture and emits it, so the controller's
 *     own `close` is the handler rather than a prop.
 *  5. **Controller members are read in the script, through `toValue`.** The
 *     controller is a plain object of refs (`use-composer-autocomplete.ts`) and
 *     Vue unwraps only top-level setup bindings, so `props.ac.open` in a
 *     template would be the ref object — i.e. always truthy. The destructured
 *     bindings are what the template sees, and they do unwrap.
 *  6. **The scroll effect is an `onMounted` plus a `flush: "post"` watcher.**
 * `scrollIntoView` runs after every commit that touched `open` or
 *     `highlight`, the first of which is the open itself; `onMounted` covers
 *     that first run (the component exists only while open) and the post-flush
 *     watcher covers the rest — a default pre-flush watcher would query the
 *     list before the new highlight had rendered.
 *  7. Rows accept on `mousedown` with `preventDefault`, and hover sets the
 * highlight on `mousemove`, wired the same way.
 */
import { computed, isRef, onMounted, ref, toValue, watch, type Ref } from "vue";
import { useI18n } from "vue-i18n";
import type { ComposerCommand } from "@dcode/shared";
import type {
  AutocompleteItem,
  ComposerAutocompleteController,
} from "../hooks/use-composer-autocomplete";
import {
  IconBookOpen,
  IconFileText,
  IconFolder,
  IconPlug,
  IconSlash,
  IconSparkles,
} from "../lib/icons";
import AnchoredMenu from "./settings/AnchoredMenu.vue";

/** The anchor, however the caller is able to hand it over. See note 3. */
type AnchorSource =
  | Ref<HTMLElement | null>
  | (() => HTMLElement | null)
  | HTMLElement
  | null;

const props = defineProps<{
  anchorRef: AnchorSource;
  ac: ComposerAutocompleteController;
}>();

const emit = defineEmits<{ accept: [index: number] }>();

const { t } = useI18n();

const ac = props.ac;
const { open, mode, highlight, setHighlight, truncated, noWorkspace, close } = ac;

const listRef = ref<HTMLDivElement | null>(null);

/** One rendered piece of a command name: matched, or plain. */
type HighlightPart = { text: string; highlighted: boolean };

/**
 * the `Highlighted`, as data: the text split into the fuzzy-match ranges
 * and the gaps between them. No ranges yields one plain part, which is what
 * the `ranges.length === 0` early return rendered.
 */
function highlightParts(
  text: string,
  ranges: ReadonlyArray<[number, number]>,
): HighlightPart[] {
  if (ranges.length === 0) return [{ text, highlighted: false }];
  const parts: HighlightPart[] = [];
  let at = 0;
  for (const [start, end] of ranges) {
    if (start > at) {
      parts.push({ text: text.slice(at, start), highlighted: false });
    }
    parts.push({ text: text.slice(start, end), highlighted: true });
    at = end;
  }
  if (at < text.length) parts.push({ text: text.slice(at), highlighted: false });
  return parts;
}

const GROUP_KEYS: Record<ComposerCommand["kind"], string> = {
  template: "chat.slashGroupTemplates",
  builtin: "chat.slashGroupApp",
  plugin: "chat.slashGroupPlugins",
  extension: "chat.slashGroupExtensions",
  skill: "chat.slashGroupSkills",
};

/** The `CommandIcon`, as a component lookup for `<component :is>`. */
function commandIcon(kind: ComposerCommand["kind"]) {
  if (kind === "template") return IconSlash;
  if (kind === "skill") return IconBookOpen;
  if (kind === "plugin" || kind === "extension") return IconPlug;
  return IconSparkles;
}

/** A group label, a command row, or a file row. See note 2. */
type AcRow =
  | { kind: "group"; key: string; label: string }
  | {
      kind: "command";
      key: string;
      index: number;
      active: boolean;
      command: ComposerCommand;
      parts: HighlightPart[];
    }
  | {
      kind: "path";
      key: string;
      index: number;
      active: boolean;
      displayName: string;
      path: string;
      isDir: boolean;
    };

const rows = computed<AcRow[]>(() => {
  const out: AcRow[] = [];
  let lastGroup: string | null = null;
  toValue(ac.items).forEach((item: AutocompleteItem, index) => {
    const active = index === toValue(highlight);
    if (item.kind === "command") {
      const group = item.command.kind;
      if (group !== lastGroup) {
        lastGroup = group;
        out.push({
          kind: "group",
          key: `g:${group}`,
          label: t(GROUP_KEYS[group]),
        });
      }
      out.push({
        kind: "command",
        key: `c:${item.command.kind}:${item.command.name}`,
        index,
        active,
        command: item.command,
        parts: highlightParts(item.command.name, item.match.ranges),
      });
      return;
    }
    const isDir = item.entry.kind === "dir";
    const name = item.entry.path.split("/").pop() ?? item.entry.path;
    out.push({
      kind: "path",
      key: `p:${item.entry.path}`,
      index,
      active,
      displayName: `${name}${isDir ? "/" : ""}`,
      path: item.entry.path,
      isDir,
    });
  });
  return out;
});

const emptyKey = computed(() =>
  toValue(mode) === "file"
    ? toValue(noWorkspace)
      ? "chat.fileNoWorkspace"
      : "chat.fileEmpty"
    : "chat.slashEmpty",
);

const menuLabel = computed(() =>
  t(toValue(mode) === "file" ? "chat.fileMenu" : "chat.slashMenu"),
);

const anchor = computed<HTMLElement | null>(() => {
  const source = props.anchorRef;
  if (isRef(source)) return source.value;
  if (typeof source === "function") return source();
  return source ?? null;
});

/**
 * the scroll effect, on the same two dependencies, plus the mount half.
 *
 * the effect ran after every commit that touched `open` or `highlight`,
 * including the one that first opened the menu; `onMounted` is that first run
 * (the component only exists while open), and the `flush: "post"` watcher is
 * every later one — a default pre-flush watcher would query the list before the
 * new highlight had rendered.
 */
function scrollHighlightIntoView() {
  if (!toValue(open)) return;
  listRef.value
    ?.querySelector(`[data-ac-index="${toValue(highlight)}"]`)
    ?.scrollIntoView({ block: "nearest" });
}

onMounted(scrollHighlightIntoView);

watch(
  () => [toValue(open), toValue(highlight)] as const,
  scrollHighlightIntoView,
  { flush: "post" },
);

/** Mousedown keeps focus in the textarea (input-retained overlay). */
function onRowMouseDown(event: MouseEvent, index: number) {
  event.preventDefault();
  emit("accept", index);
}
</script>

<template>
  <!--
    The component renders nothing while closed, so the menu (and the row refs) only
    exist while it is open. `v-if` keeps that: mounting positions the surface,
    unmounting tears its listeners down, and no wrapper is left in the DOM.
  -->
  <AnchoredMenu
    class="composer-autocomplete-anchor"
    v-if="open"
    :open="open"
    :anchor="anchor"
    menu-class-name="composer-autocomplete"
    :label="menuLabel"
    role="listbox"
    side="top"
    match-anchor-width
    initial-focus="none"
    @close="close"
  >
    <div ref="listRef" class="composer-ac-list">
      <template v-if="rows.length > 0">
        <template v-for="row in rows" :key="row.key">
          <div v-if="row.kind === 'group'" class="composer-model-group-label">
            {{ row.label }}
          </div>
          <button
            v-else-if="row.kind === 'command'"
            type="button"
            role="option"
            :aria-selected="row.active"
            :data-ac-index="row.index"
            class="composer-plus-item composer-ac-item"
            :class="{ 'kb-active': row.active }"
            @mousedown="onRowMouseDown($event, row.index)"
            @mousemove="setHighlight(row.index)"
          >
            <span class="composer-ac-icon">
              <component :is="commandIcon(row.command.kind)" :size="14" />
            </span>
            <span class="composer-ac-name">
              /<span
                v-for="(part, partIndex) in row.parts"
                :key="partIndex"
                :class="part.highlighted ? 'composer-ac-hl' : undefined"
                >{{ part.text }}</span
              >
            </span>
            <span
              v-if="
                row.command.kind === 'skill' &&
                row.command.title !== row.command.name
              "
              class="composer-ac-hint"
              >{{ row.command.title }}</span
            >
            <span v-if="row.command.argumentHint" class="composer-ac-hint">{{
              row.command.argumentHint
            }}</span>
            <span v-if="row.command.description" class="composer-ac-desc">{{
              row.command.description
            }}</span>
          </button>
          <button
            v-else
            type="button"
            role="option"
            :aria-selected="row.active"
            :data-ac-index="row.index"
            class="composer-plus-item composer-ac-item"
            :class="{ 'kb-active': row.active }"
            :aria-label="`${row.displayName} — ${row.path}`"
            :title="row.path"
            @mousedown="onRowMouseDown($event, row.index)"
            @mousemove="setHighlight(row.index)"
          >
            <span class="composer-ac-icon">
              <IconFolder v-if="row.isDir" :size="14" />
              <IconFileText v-else :size="14" />
            </span>
            <span class="composer-ac-name">{{ row.displayName }}</span>
          </button>
        </template>
      </template>
      <div v-else class="composer-model-empty">{{ t(emptyKey) }}</div>
    </div>
    <div class="composer-ac-footer">
      <span>{{ t("chat.acHint") }}</span>
      <span v-if="truncated" class="composer-ac-truncated">{{
        t("chat.fileTruncated")
      }}</span>
    </div>
  </AnchoredMenu>
</template>
