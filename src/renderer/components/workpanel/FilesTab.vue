<script setup lang="ts">
/**
 * Files tab — the workspace file browser and its text/image viewer.
 *
 * The `FilesTab` component. The viewer's syntax highlighting is the shared
 * `lib/shiki.ts` pipeline (`tokenizeIncremental` over the incremental line cache,
 * `subscribeHighlighter` for grammar readiness, `themeForMode` for the theme),
 * exactly as `components/ToolDetails.vue` and `components/Markdown.vue` drive it.
 *
 * The decisions that are not mechanical:
 *
 * 1. **`HighlightedText` is folded into this component.** It used to be declared
 *     as a module-private second component so a store subscription could
 *     re-render just the code body; here the theme and highlighter readiness are
 *     the shared `lib/use-theme-mode.ts` ref and a subscription ref, and the
 *     token cache is a `computed`. That keeps the viewer markup — and therefore
 *     `file-viewer-code` / `file-viewer-line` / `file-viewer-cap` — in the
 *     template, where `tests/vue-class-contract.test.mjs` reads it. The
 *     `computed` is lazy, so `ensureLang` still only runs when the code body is
 * actually rendered, which is when the component mounted.
 *  2. **`renderDir` is the same recursive function, rendered through one
 *     local render-function component.** The tree nests each directory's rows
 *     inside that directory's wrapper `<div>`, which a single template `v-for`
 *     cannot express and this component's file list may not grow a new `.vue` for.
 *     The rows are therefore built with `h()` and mounted by `FileTreeRoot`,
 *     whose fragment root leaves them as direct children of `.file-tree` exactly
 *     as the markup did. The class names are copied verbatim from the
 *     markup; only their location differs (`components/ToolDetails.vue` renders
 *     its three sub-components the same way, for the same reason).
 *  3. **Numeric `style` values become `${n}px` strings.** A numeric `paddingLeft`
 *     would be appended with `px`; Vue assigns the value to `element.style`
 *     verbatim.
 * 4. **The workspace-reset guard is a plain watcher.** `prevRoot` used to be kept
 *     and compared, because an effect also runs on a strict-mode remount and an
 *     unconditional reset would wipe the selection a
 *     chat file request had just made. A non-immediate Vue watcher only runs on
 *     a real root change, so the ref is unnecessary and the same guarantee holds.
 * 5. **The directory-loading and file-request effects are watchers.** The
 *     `loadDir`/`openFile` helpers are `useCallback`s listed in the dep arrays; they are
 *     stable `setup`-scope closures here, so the watchers depend on the values
 *     that actually change.
 *  6. **`aria-hidden="true"` is written explicitly** on the folder caret: a bare
 *     attribute in a Vue template renders as `""`.
 */
import {
  computed,
  defineComponent,
  h,
  onScopeDispose,
  ref,
  watch,
  type VNode,
} from "vue";
import { useI18n } from "vue-i18n";
import type { FsEntry, FsReadResult } from "@dcode/shared";
import { api } from "../../lib/api";
import { fileDirOf } from "../../lib/chat-links";
import { cx } from "../../lib/cx";
import {
  ensureLang,
  getHighlightVersion,
  resolveLang,
  subscribeHighlighter,
  themeForMode,
  tokenizeIncremental,
  type LineCache,
} from "../../lib/shiki";
import { useThemeMode } from "../../lib/use-theme-mode";
import { useAppStore } from "../../stores/app-store";
import {
  IconChevronLeft,
  IconChevronRight,
  IconExternal,
  IconFileText,
  IconFolder,
} from "../../lib/icons";
import Markdown from "../Markdown.vue";
import TooltipButton from "../TooltipButton.vue";
import WorkTabEmpty from "./WorkTabEmpty.vue";

const VIEWER_LINE_CAP = 5000;

const EXT_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  css: "css",
  html: "html",
  md: "markdown",
  rs: "rust",
  py: "python",
  go: "go",
  sh: "shellscript",
  zsh: "shellscript",
  bash: "shellscript",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  sql: "sql",
  swift: "swift",
  kt: "kotlin",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
};

function langForPath(path: string): string | null {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const lang = EXT_LANG[ext] ?? ext;
  return resolveLang(lang);
}

function isMarkdownPath(path: string): boolean {
  return /\.(?:md|markdown)$/i.test(path);
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

type DirState = { entries: FsEntry[]; error?: boolean };

// Module-level so a chat preview request fires once, not again on every
// files-tab remount (the tab unmounts when another tool is selected).
let handledFileRequestSeq = 0;

const { t } = useI18n();
const store = useAppStore();

const workspace = computed(() => store.appState?.workspace);
const fileRequest = computed(() => store.appState?.workPanelFileRequest ?? null);
const root = computed(() => workspace.value?.path ?? null);

const dirs = ref<Record<string, DirState>>({});
const expanded = ref<Set<string>>(new Set());
const selected = ref<string | null>(null);
const file = ref<FsReadResult | null>(null);
const fileError = ref(false);

/** Workspace switches reset all browsing state. */
watch(root, () => {
  dirs.value = {};
  expanded.value = new Set();
  selected.value = null;
  file.value = null;
  fileError.value = false;
});

async function loadDir(rel: string): Promise<void> {
  if (!root.value) return;
  try {
    const res = await api.fsList(rel);
    dirs.value = { ...dirs.value, [rel]: { entries: res.entries } };
  } catch {
    dirs.value = { ...dirs.value, [rel]: { entries: [], error: true } };
  }
}

/** The root directory loads as soon as a workspace exists. */
watch(
  [root, dirs],
  () => {
    if (root.value && !dirs.value[""]) void loadDir("");
  },
  { immediate: true },
);

function toggleDir(rel: string): void {
  const next = new Set(expanded.value);
  if (next.has(rel)) next.delete(rel);
  else next.add(rel);
  expanded.value = next;
  if (!dirs.value[rel]) void loadDir(rel);
}

async function openFile(rel: string, mimeType?: string): Promise<void> {
  selected.value = rel;
  file.value = null;
  fileError.value = false;
  try {
    file.value = await api.fsRead(rel, mimeType);
  } catch {
    fileError.value = true;
  }
}

/*
 * Chat-initiated previews: open the file and expand its ancestor folders so
 * "back" lands on a tree that reveals it. Attachment blobs and absolute scratch
 * paths live outside the workspace tree.
 */
watch([fileRequest, root], () => {
  const request = fileRequest.value;
  if (!request || !root.value) return;
  if (request.seq === handledFileRequestSeq) return;
  handledFileRequestSeq = request.seq;
  const path = request.path;
  const isExternal =
    path.startsWith("attachments/") ||
    path.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(path) ||
    path.startsWith("\\\\");
  if (!isExternal) {
    const parts = path.split("/").slice(0, -1);
    const ancestors: string[] = [];
    let acc = "";
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      ancestors.push(acc);
    }
    expanded.value = new Set([...expanded.value, ...ancestors]);
    for (const dir of ancestors) void loadDir(dir);
  }
  void openFile(path, request.mimeType);
});

/* ------------------------------------------------------------------ */
/* Tree                                                                */
/* ------------------------------------------------------------------ */

function renderDir(rel: string, depth: number): VNode[] {
  const state = dirs.value[rel];
  const pad = 12 + depth * 14;
  if (!state) {
    return [
      h(
        "div",
        { class: "file-tree-note", style: { paddingLeft: `${pad}px` }, key: `${rel}:loading` },
        t("panel.files.loading"),
      ),
    ];
  }
  if (state.entries.length === 0) {
    return [
      h(
        "div",
        { class: "file-tree-note", style: { paddingLeft: `${pad}px` }, key: `${rel}:empty` },
        state.error ? t("panel.files.error") : t("panel.files.empty"),
      ),
    ];
  }
  return state.entries.map((entry) => {
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.kind === "dir") {
      const open = expanded.value.has(childRel);
      return h("div", { key: childRel }, [
        h(
          "button",
          {
            type: "button",
            class: "file-tree-row",
            style: { paddingLeft: `${pad}px` },
            onClick: () => toggleDir(childRel),
          },
          [
            h(
              "span",
              { class: cx("file-tree-caret", open && "open"), "aria-hidden": "true" },
              [h(IconChevronRight, { size: 12 })],
            ),
            h(IconFolder, { size: 14 }),
            h("span", { class: "file-tree-name" }, entry.name),
          ],
        ),
        ...(open ? renderDir(childRel, depth + 1) : []),
      ]);
    }
    return h(
      "button",
      {
        key: childRel,
        type: "button",
        class: cx("file-tree-row", selected.value === childRel && "active"),
        style: { paddingLeft: `${pad + 16}px` },
        onClick: () => void openFile(childRel),
        title: childRel,
      },
      [
        h(IconFileText, { size: 14 }),
        h("span", { class: "file-tree-name" }, entry.name),
      ],
    );
  });
}

/** The earlier version's `renderDir("", 0)`, mounted as a fragment (see note 2). */
const FileTreeRoot = defineComponent({
  name: "FileTreeRoot",
  setup() {
    return () => renderDir("", 0);
  },
});

/* ------------------------------------------------------------------ */
/* Viewer                                                             */
/* ------------------------------------------------------------------ */

const mode = useThemeMode();
const highlightVersion = ref(getHighlightVersion());
const unsubscribeHighlighter = subscribeHighlighter(() => {
  highlightVersion.value = getHighlightVersion();
});
onScopeDispose(unsubscribeHighlighter);

const content = computed(() => file.value?.content ?? "");
const rawLines = computed(() => content.value.split("\n"));
const viewerCapped = computed(() => rawLines.value.length > VIEWER_LINE_CAP);
const viewerVisible = computed(() =>
  viewerCapped.value
    ? rawLines.value.slice(0, VIEWER_LINE_CAP).join("\n")
    : content.value,
);
const viewerLines = computed(() => viewerVisible.value.split("\n"));

const viewerTokens = computed<LineCache | null>(() => {
  // Re-tokenize once the grammar finishes lazy-loading.
  void highlightVersion.value;
  const path = selected.value;
  const lang = path ? langForPath(path) : null;
  if (!lang) return null;
  ensureLang(lang);
  return tokenizeIncremental(null, viewerVisible.value, lang, themeForMode(mode.value));
});
</script>

<template>
  <WorkTabEmpty
    v-if="!root"
    :icon="IconFolder"
    :title="t('panel.files.noWorkspace')"
    :body="t('panel.files.noWorkspaceHint')"
  />
  <div v-else-if="selected !== null" class="file-viewer">
    <div class="file-viewer-header">
      <TooltipButton
        type="button"
        class="icon-btn icon-btn-square"
        :label="t('panel.files.back')"
        :aria-label="t('panel.files.back')"
        @click="
          selected = null;
          file = null;
        "
      >
        <IconChevronLeft :size="14" />
      </TooltipButton>
      <span class="file-viewer-path" :title="selected">{{ selected }}</span>
      <span v-if="file" class="file-viewer-size">{{ formatSize(file.size) }}</span>
      <TooltipButton
        type="button"
        class="icon-btn icon-btn-square"
        :label="t('panel.files.reveal')"
        :aria-label="t('panel.files.reveal')"
        @click="void api.fsReveal(selected)"
      >
        <IconExternal :size="14" />
      </TooltipButton>
    </div>
    <div class="file-viewer-body">
      <WorkTabEmpty
        v-if="fileError"
        :icon="IconFileText"
        :title="t('panel.files.error')"
      />
      <div v-else-if="!file" class="file-tree-note">{{ t("panel.files.loading") }}</div>
      <div
        v-else-if="file.kind === 'text' && isMarkdownPath(selected)"
        class="file-viewer-markdown prose-chat"
      >
        <Markdown :source="file.content ?? ''" :base-dir="fileDirOf(selected)" />
      </div>
      <pre v-else-if="file.kind === 'text'" class="file-viewer-code">
        <template v-if="viewerTokens">
          <div
            v-for="(row, i) in viewerTokens.tokens"
            :key="i"
            class="file-viewer-line"
          >
            <template v-if="row.length === 0">{{ "\n" }}</template>
            <span
              v-for="(token, j) in row"
              :key="j"
              :style="{ color: token.color }"
            >{{ token.content }}</span>
          </div>
        </template>
        <template v-else>
          <div v-for="(line, i) in viewerLines" :key="i" class="file-viewer-line">{{
            line || "\n"
          }}</div>
        </template>
        <div v-if="viewerCapped" class="file-viewer-cap">…</div>
      </pre>
      <div v-else-if="file.kind === 'image'" class="file-viewer-image">
        <img :src="file.dataUrl" :alt="selected" />
      </div>
      <WorkTabEmpty
        v-else
        :icon="IconFileText"
        :title="
          file.kind === 'tooLarge'
            ? t('panel.files.tooLarge')
            : t('panel.files.binary')
        "
      />
    </div>
  </div>
  <div v-else class="file-tree">
    <component :is="FileTreeRoot" />
  </div>
</template>
