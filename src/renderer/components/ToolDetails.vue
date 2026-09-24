<script lang="ts">
/**
 * Structured tool presentation: the expanded body of a tool row and the
 * outcome badges of its collapsed head (D192).
 *
 * The `ToolDetails` module exports two components from one module —
 * `ToolDetailBlocks` (rendered by `ToolRow`
 * and `PermissionCard`) and `ToolChips` (rendered by `ToolRow`). Both were
 * *named* imports, so both are named exports here, and `ToolDetailBlocks`
 * is the default as well.
 *
 * **This file uses a plain `<script>` block, not `<script setup>`, on purpose.**
 * A `<script setup>` block makes the SFC compiler build the default export as a
 * *new* object (`_defineComponent({ ...__default__, setup })`), so a named
 * export of the same component would be a different object that never receives
 * the compiled `render` — `import { ToolDetailBlocks } from "./ToolDetails.vue"`
 * would then render nothing at all, silently. The two consumers use
 * exactly that named import, so the component is defined once here and exported
 * under both names, and the template resolves its bindings through the
 * instance proxy. `components/Markdown.vue` is the same shape for the same
 * reason.
 *
 * **The named export is a self re-export, and that is load-bearing.** A plain
 * `export { ToolDetailBlocks }` of the identifier defined above is a *different*
 * object than the SFC's default: `@vitejs/plugin-vue` attaches the compiled
 * render to the default with `_export_sfc(component, [["render", …]])`, and
 * that call is `@__PURE__`-annotated, so a consumer importing only the named
 * binding lets the bundler drop it and receives a component with no render at
 * all. `out/renderer` then contains no `tool-block` class and every expanded
 * tool row is empty. `export { default as ToolDetailBlocks } from
 * "./ToolDetails.vue"` re-exports the *compiled* component instead, which is
 * what `AssistantTurn.vue`, `ActivityGroup.vue` and `ToolRow.vue` already do for
 * their siblings. `tests/renderer-template-bindings.test.mjs` guards the shape.
 *
 * The other decisions that are not mechanical:
 *
 *  1. **Three components, and two of them are render functions.** An SFC has a
 *     single template block, so the pieces that need their own state or their
 *     own VNodes are `defineComponent` render functions in the script:
 *       - `BlockHead` owns the per-block copy state. It cannot be folded into
 *         the parent: one head is mounted per block, so two heads can
 *         show "copied" at once, and one shared `useCopy()` ref would only ever
 *         mark the last one.
 *       - `ToolChips` maps chips to badges and has no markup of its own.
 *       - `HighlightedCode` is a shared token renderer. dcode
 *         keeps its copy private to `components/Markdown.vue` (that file's own
 *         header records the decision) and this module must not edit it, so the
 *         ~20-line wrapper is repeated here while the highlighting itself is
 *         the shared `lib/shiki.ts` pipeline — `tokenizeIncremental` over the
 *         incremental line cache, `subscribeHighlighter` for grammar readiness
 *         and `themeForMode` for the theme, exactly what `Markdown.vue` drives.
 *  2. **`FileList`, `MatchList` and `MoreNote` are inlined in the template.**
 *     They were separate components only because they were rendered as children. The two things
 *     `FileList` and `MatchList` each read — the workspace root and the preview
 *     opener — are read once here, because both read the same store path and
 *     the same opener.
 *  3. **`t("a.b", "Fallback")` becomes `t("a.b")`.** Every key is present in
 *     the catalogs, so the fallback would only ever hide a missing one.
 *  4. **`aria-hidden` is written `aria-hidden="true"`.** A bare attribute in a
 *     Vue template renders as `""`, so the explicit value is required.
 *  5. A Vue component re-renders only when a
 *     value its render reads changes.
 *  6. `sr-only` is the Tailwind accessibility utility used for a
 *     plain row's channel name. The shared stylesheet never defines it, the same
 *     exemption `StartupSplash` / `NotificationCenter` / `PlanApprovalBar`
 *     already carry.
 */
import {
  computed,
  defineComponent,
  h,
  onScopeDispose,
  ref,
  watch,
  type PropType,
  type VNodeChild,
} from "vue";
import { useI18n } from "vue-i18n";
import { toWorkspaceRel } from "../lib/chat-links";
import { cx } from "../lib/cx";
import { IconCheck, IconCircleAlert, IconCopy, IconInfo } from "../lib/icons";
import {
  ensureLang,
  getHighlightVersion,
  resolveLang,
  subscribeHighlighter,
  themeForMode,
  tokenizeIncremental,
  type LineCache,
} from "../lib/shiki";
import { useCopy } from "../lib/use-copy";
import { useThemeMode } from "../lib/use-theme-mode";
import type { ToolBlock, ToolChip } from "../lib/tool-presentation";
import { useOpenPreviewTarget } from "../hooks/use-preview-target";
import { useAppStore } from "../stores/app-store";
import TooltipButton from "./TooltipButton.vue";

/* ---------- syntax highlighting (see note 1) ---------- */

/** Tokens to inline styles; the mapping `Markdown.vue` uses. */
function tokenStyle(token: { color?: string; fontStyle?: number }): Record<string, string> {
  const fontStyle = token.fontStyle ?? 0;
  const style: Record<string, string> = {};
  if (token.color) style.color = token.color;
  if (fontStyle & 1) style.fontStyle = "italic";
  if (fontStyle & 2) style.fontWeight = "bold";
  if (fontStyle & 4) style.textDecoration = "underline";
  return style;
}

/**
 * Tokenized code body, no chrome. It is local here rather than shared —
 * see note 1.
 */
const HighlightedCode = defineComponent({
  name: "ToolHighlightedCode",
  props: {
    code: { type: String, required: true },
    lang: { type: String, required: true },
  },
  setup(props) {
    const mode = useThemeMode();
    const version = ref(getHighlightVersion());
    const unsubscribe = subscribeHighlighter(() => {
      version.value = getHighlightVersion();
    });
    onScopeDispose(unsubscribe);

    const resolved = computed(() => resolveLang(props.lang));
    watch(
      resolved,
      (next) => {
        if (next) ensureLang(next);
      },
      { immediate: true },
    );

    const cache: { current: LineCache | null } = { current: null };
    const tokens = computed(() => {
      const target = resolved.value;
      if (!target) return null;
      // Re-tokenize once the grammar finishes lazy-loading.
      void version.value;
      const next = tokenizeIncremental(
        cache.current,
        props.code,
        target,
        themeForMode(mode.value),
      );
      cache.current = next;
      return next?.tokens ?? null;
    });

    return () => {
      const lines = tokens.value;
      if (!lines) return [props.code];
      const out: VNodeChild[] = [];
      lines.forEach((line, index) => {
        if (index > 0) out.push("\n");
        out.push(
          h(
            "span",
            {},
            line.map((token, tokenIndex) =>
              h("span", { key: tokenIndex, style: tokenStyle(token) }, token.content),
            ),
          ),
        );
      });
      return out;
    };
  },
});

/* ---------- block head ---------- */

/** A block's heading plus its copy affordance; owns the `copied` state. */
const BlockHead = defineComponent({
  name: "ToolBlockHead",
  props: {
    label: { type: String, required: true },
    copy: { type: String, required: true },
  },
  setup(props) {
    const { t } = useI18n();
    const { copied, copy } = useCopy();
    return () =>
      h("div", { class: "tool-row-section-head" }, [
        h("span", null, props.label),
        h(
          TooltipButton,
          {
            class: cx("tool-row-copy", copied.value && "copied"),
            label: copied.value ? t("chat.copied") : t("chat.copy"),
            ariaLabel: `${t("chat.copy")} ${props.label}`,
            onClick: () => copy(props.copy),
          },
          () => (copied.value ? h(IconCheck, { size: 12 }) : h(IconCopy, { size: 12 })),
        ),
      ]);
  },
});

/* ---------- chips ---------- */

const CHIP_LABEL_KEYS: Record<ToolChip["role"], string> = {
  exit: "chat.toolChipExit",
  matches: "chat.toolChipMatches",
  files: "chat.toolChipFiles",
  replacements: "chat.toolChipReplacements",
  truncated: "chat.toolChipTruncated",
  scratch: "chat.toolChipScratch",
  lines: "chat.toolChipLines",
  size: "chat.toolChipSize",
};

/** Collapsed-row outcome badges: exit code, hit counts, truncation. */
const ToolChips = defineComponent({
  name: "ToolChips",
  props: {
    chips: { type: Array as PropType<ToolChip[]>, required: true },
  },
  setup(props) {
    const { t } = useI18n();
    return () => {
      if (props.chips.length === 0) return null;
      return h(
        "span",
        { class: "tool-row-chips" },
        props.chips.map((chip) =>
          h(
            "span",
            { class: cx("tool-chip", chip.role === "exit" && "is-error"), key: chip.role },
            t(CHIP_LABEL_KEYS[chip.role], {
              ...("count" in chip ? { count: chip.count } : {}),
              ...("text" in chip
                ? chip.role === "lines"
                  ? { range: chip.text }
                  : { size: chip.text }
                : {}),
            }),
          ),
        ),
      );
    };
  },
});

/* ---------- the row body ---------- */

const BLOCK_LABEL_KEYS: Record<ToolBlock["role"], string> = {
  content: "chat.toolBlockContent",
  written: "chat.toolBlockWritten",
  command: "chat.toolBlockCommand",
  stdout: "chat.toolBlockStdout",
  stderr: "chat.toolBlockStderr",
  diff: "chat.toolBlockDiff",
  files: "chat.toolBlockFiles",
  matches: "chat.toolBlockMatches",
  details: "chat.toolBlockDetails",
  notice: "chat.toolBlockNotice",
  error: "chat.toolBlockError",
  output: "chat.toolOutput",
  input: "chat.toolInput",
};

/** Everything a block can put on the clipboard, per kind. */
function blockCopyText(block: ToolBlock): string {
  switch (block.kind) {
    case "code":
      return block.text;
    case "diff":
      return block.copy;
    case "files":
      return block.paths.join("\n");
    case "matches":
      return block.groups
        .flatMap((group) =>
          group.lines.map((line) => `${group.path}:${line.line}: ${line.text}`),
        )
        .join("\n");
    case "fields":
      return block.rows.map((row) => `${row.label}: ${row.value}`).join("\n");
    case "note":
      return block.code ? `${block.code}: ${block.text}` : block.text;
  }
}

const ToolDetailBlocks = defineComponent({
  name: "ToolDetailBlocks",
  components: { HighlightedCode, BlockHead, TooltipButton, IconCircleAlert, IconInfo },
  props: {
    blocks: { type: Array as PropType<ToolBlock[]>, required: true },
    plain: { type: Boolean, default: false },
  },
  setup(props) {
    const { t } = useI18n();
    const store = useAppStore();
    const openTarget = useOpenPreviewTarget();

    /** The workspace root every listed path is made relative to. */
    const root = computed(() => store.appState?.workspace?.path);

    /** A block's heading: its own raw key, else the role's translated name. */
    function labelOf(block: ToolBlock): string {
      return block.label ?? t(BLOCK_LABEL_KEYS[block.role]);
    }

    /** Workspace-relative path, or null when it is not one this can open. */
    function relOf(path: string): string | null {
      return toWorkspaceRel(path, root.value);
    }

    function openFile(path: string): void {
      const rel = relOf(path);
      if (rel) openTarget({ kind: "file", path: rel });
    }

    // A plain `<script>` block has no compiler-generated binding metadata, so
    // the template reaches these through the instance proxy: everything it
    // names has to be returned from here.
    return { props, t, cx, labelOf, relOf, openFile, blockCopyText };
  },
});

export { ToolChips };
export { default as ToolDetailBlocks } from "./ToolDetails.vue";
export default ToolDetailBlocks;
</script>

<template>
  <section
    v-for="(block, index) in props.blocks"
    :key="`${block.role}-${block.label ?? index}`"
    class="tool-block"
    :class="{ 'is-plain': props.plain }"
  >
    <!--
      A run row's body is the output and nothing else (D227), so the heading
      and its frame are gone. The channel still needs a name for anyone who
      cannot see that stderr is the tinted one.
    -->
    <span v-if="props.plain" class="sr-only">{{ labelOf(block) }}</span>
    <BlockHead v-else :label="labelOf(block)" :copy="blockCopyText(block)" />

    <pre
      v-if="block.kind === 'code'"
      class="tool-row-content"
      :class="{ 'is-error': block.tone === 'error' }"
    ><HighlightedCode v-if="block.highlight" :code="block.text" :lang="block.lang" /><template v-else>{{ block.text }}</template></pre>

    <div v-else-if="block.kind === 'diff'" class="tool-diff">
      <div class="diff-hunk">
        <div
          v-for="(line, lineIndex) in block.lines"
          :key="lineIndex"
          :class="cx('diff-line', line.type)"
        >
          <span class="diff-line-sign" aria-hidden="true">{{
            line.type === "add" ? "+" : line.type === "del" ? "−" : " "
          }}</span>
          <span class="diff-line-text">{{ line.text }}</span>
        </div>
      </div>
      <div v-if="block.hidden > 0" class="tool-block-more">
        {{ t("chat.toolBlockMore", { count: block.hidden }) }}
      </div>
    </div>

    <template v-else-if="block.kind === 'files'">
      <div class="tool-file-list">
        <template v-for="(path, pathIndex) in block.paths" :key="`${path}-${pathIndex}`">
          <span v-if="!relOf(path)" class="tool-file-item">{{ path }}</span>
          <TooltipButton
            v-else
            type="button"
            class="tool-file-item is-linked"
            :label="t('chat.previewFile')"
            @click="openFile(path)"
            >{{ path }}</TooltipButton
          >
        </template>
      </div>
      <div v-if="block.hidden > 0" class="tool-block-more">
        {{ t("chat.toolBlockMore", { count: block.hidden }) }}
      </div>
    </template>

    <template v-else-if="block.kind === 'matches'">
      <div class="tool-match-list">
        <div
          v-for="(group, groupIndex) in block.groups"
          :key="`${group.path}-${groupIndex}`"
          class="tool-match-group"
        >
          <TooltipButton
            v-if="relOf(group.path)"
            type="button"
            class="tool-match-path is-linked"
            :label="t('chat.previewFile')"
            @click="openFile(group.path)"
            >{{ group.path }}</TooltipButton
          >
          <span v-else class="tool-match-path">{{ group.path }}</span>
          <div
            v-for="(line, lineIndex) in group.lines"
            :key="`${line.line}-${lineIndex}`"
            class="tool-match-line"
          >
            <span class="tool-match-line-no">{{ line.line }}</span>
            <span class="tool-match-line-text">{{ line.text }}</span>
          </div>
        </div>
      </div>
      <div v-if="block.hidden > 0" class="tool-block-more">
        {{ t("chat.toolBlockMore", { count: block.hidden }) }}
      </div>
    </template>

    <dl v-else-if="block.kind === 'fields'" class="tool-fields">
      <div v-for="row in block.rows" :key="row.label" class="tool-field">
        <dt class="tool-field-label">{{ row.label }}</dt>
        <dd class="tool-field-value">{{ row.value }}</dd>
      </div>
    </dl>

    <div
      v-else-if="block.kind === 'note'"
      class="tool-note"
      :class="{ 'is-error': block.role === 'error' }"
    >
      <IconCircleAlert v-if="block.role === 'error'" :size="13" />
      <IconInfo v-else :size="13" />
      <span class="tool-note-text">{{
        block.code ? `${block.text} (${block.code})` : block.text
      }}</span>
    </div>
  </section>
</template>
