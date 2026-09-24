<script lang="ts">
/**
 * Streaming-optimized chat markdown renderer.
 *
 * The `Markdown` component. It renders markdown with `marked` plus a small set
 * of extensions, and its rendered output is a fixed contract: the same tags,
 * the same class names, the same `data-source-start` / `data-source-end`
 * anchors and an equivalent sanitize allowlist.
 *
 * Pipeline, stage by stage:
 *
 *   1. `normalizeLatexMathDelimiters(source)` once at the source level
 *      (`lib/latex-math.ts`, the `Markdown`'s `useMemo` equivalent). Length
 *      preserving, so every offset below still slices the original text.
 *   2. `parseBlocks` / the incremental tail re-lex — `marked`'s `lexer`, the
 *      same parser already imported for `useBlocks`, with the same
 *      block folding and the same CRLF offset accounting.
 *   3. Per block, `marked` block+inline tokens are walked into a hast-like
 *      tree. This replaces `remark-gfm` + `remark-math` + `remark-rehype`
 *      + `rehype-raw`: `marked`'s GFM lexer supplies the structure and this
 *      file supplies the tag/attribute mapping `mdast-util-to-hast` did.
 *      Inline `$…$` / `$$…$$` and fenced `$$` are two `marked` extensions,
 *      matching `micromark-extension-math`'s tokenizers; `\[ … \]` is
 *      promoted to display math the way `remarkLatexBracketDisplay` does,
 *      by comparing the token's span against the *original* block text.
 *   4. `linkify` — the counterpart of `remarkChatFileLinks`, built on
 *      `splitChatText` from `lib/chat-links.ts` (the same primitive
 *      `linkifyMdastTree` uses) because this tree is hast-shaped rather than
 *      mdast-shaped, so the mdast walker cannot be reused directly.
 *   5. `rehypeSourcePositions({ offset })` from `lib/markdown-source.ts`,
 *      called with the block's start offset, in the same way.
 *   6. Serialize to an HTML string, then `DOMPurify` replaces
 *      `rehype-sanitize` (see `SANITIZE_TAGS` / `SANITIZE_ATTRS` below: the
 *      tag list is fixed, and the two per-tag attribute lists — `className` and
 *      `aria-*` — are re-imposed by the hooks there).
 *   7. The sanitized DOM becomes VNodes. `rehype-katex`'s job is done here:
 *      a `language-math` element (or a `<pre>` holding one) is replaced by
 *      `katex.renderToString`, *after* sanitization, which is the required
 *      order — KaTeX's MathML must not be run through the allowlist.
 *
 * The component map (`components={markdownComponents}`) becomes tag
 * dispatch in `elementToVNode`: `pre`, `code`, `a`, `img`, `audio`, `video`
 * and `table` render through the components below, everything else through
 * `h(tag, …)`.
 *
 * Deliberate choices:
 *
 *  1. `HighlightedCode` stays in this file rather than being exported. A
 *     `.vue` file cannot export a sibling component, and no module imports it
 *     yet (the one consumer is `ToolDetails.vue`). Move it to its own file
 *     when that becomes necessary.
 *  2. The `MarkdownBlockContext` / `MarkdownBaseDirContext` pair is gone.
 *     The dispatcher constructs every component inline rather than through a
 *     plugin, so `closedFence`, `renderDiagrams`, `workspaceRoot` and
 *     `baseDir` travel as props. Same values, no behavioural difference.
 *  3. `linkify` skips `a`, `code`, `img` and `pre` subtrees, which is the
 *     hast shape of the mdast `SKIP_MDAST` set (`link`, `inlineCode`,
 *     `code`, `image`, `html`).
 *  4. Raw HTML keeps its meaning (parsed by the browser, then sanitized) but
 *     not its own anchors: the browser parser gives every element its own span,
 *     so a top-level raw element carries the whole HTML token's span here
 *     instead of its own.
 *  5. GFM footnotes are not reproduced. `marked` has no footnote syntax, but
 *     it *does* have a link-reference-definition rule whose label grammar
 *     accepts `^1`, so the real behaviour is input-dependent:
 *
 *       - `[^1]: note` — a single-token body — lexes as a `def` token. Definitions are
 *         ignored, so dropping the token would silently delete the
 *         text; `renderBlockToken` renders the body as a paragraph instead, so
 *         nothing is lost, and `[^1]` resolves as a reflink to that body the
 *         way any other reference does.
 *       - `[^1]: multi word` — any body with a space — fails marked's label
 *         grammar and stays a literal paragraph, which is also what the unmatched
 *         reference path produces.
 *
 *     Footnotes never become `<sup><a …>1</a></sup>` plus a `<section
 *     class="footnotes">` block: that shape only appeared when the definition
 *     and the reference landed in the same top-level block — an accident of
 *     per-block mounting rather than a document-level feature.
 *     Reproducing it means synthesising mdast's footnote ordering,
 *     back-references and `user-content-fn-*` ids on top of `marked`'s tokens,
 *     which is out of scope here; the lossless fallback above is
 *     the deliberate substitute.
 */
import {
  computed,
  defineComponent,
  h,
  onBeforeUnmount,
  onMounted,
  onScopeDispose,
  ref,
  useId,
  watch,
  type ComputedRef,
  type PropType,
  type VNodeChild,
} from "vue";
import { useI18n } from "vue-i18n";
import DOMPurify from "dompurify";
import katex from "katex";
import { Marked, type MarkedExtension, type Tokens } from "marked";
import "katex/dist/katex.min.css";
import { api } from "../lib/api";
import ContextMenu from "./ContextMenu.vue";
import { useContextMenu } from "../lib/context-menu-state";
import {
  resolvePreviewTarget,
  safeDecodeUri,
  splitChatText,
  toWorkspaceRel,
} from "../lib/chat-links";
import { cx } from "../lib/cx";
import { normalizeLatexMathDelimiters } from "../lib/latex-math";
import {
  rehypeSourcePositions,
  sourcePositionProps,
  type SourcePositionProps,
} from "../lib/markdown-source";
import {
  isClosedFencedCodeBlock,
  MAX_MERMAID_SOURCE_LENGTH,
  MermaidSourceTooLargeError,
  renderMermaidSvg,
} from "../lib/mermaid";
import { openHttpUrl } from "../lib/open-http-url";
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
import { useReferencedImageDataUrl } from "../lib/use-referenced-image-data-url";
import { useOpenChatFileRef } from "../hooks/use-preview-target";
import { useAppStore } from "../stores/app-store";
import {
  IconCheck,
  IconCircleAlert,
  IconCode,
  IconCopy,
  IconExternal,
  IconGlobe,
  IconImage,
  IconWorkflow,
} from "../lib/icons";
import TooltipButton from "./TooltipButton.vue";

/* ---------- hast-like tree ---------- */

type SourcePosition = {
  start: { offset: number };
  end: { offset: number };
};

type MarkdownNode = {
  type: "element" | "text" | "raw";
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: MarkdownNode[];
  value?: string;
  position?: SourcePosition;
};

type MarkdownToken = Tokens.Generic;

type BlockContext = {
  /** Normalized block text; token offsets are measured against it. */
  source: string;
  /** The same span of the untouched message, for `\[ … \]` detection. */
  original: string;
  closedFence: boolean;
  renderDiagrams: boolean;
  workspaceRoot: string | null;
  baseDir: string | undefined;
};

function textNode(value: string): MarkdownNode {
  return { type: "text", value };
}

function element(
  tagName: string,
  properties: Record<string, unknown>,
  children: MarkdownNode[],
  position?: SourcePosition,
): MarkdownNode {
  return { type: "element", tagName, properties, children, position };
}

function span(start: number, end: number): SourcePosition {
  return { start: { offset: start }, end: { offset: end } };
}

/** Trim a token's trailing line endings, the way mdast positions do. */
function trimmedEnd(source: string, start: number, end: number): number {
  let at = end;
  while (at > start && (source[at - 1] === "\n" || source[at - 1] === "\r")) at -= 1;
  return at;
}

/**
 * Locate a nested token inside its parent's window.
 *
 * Block-level tokens concatenate exactly into their block, so top-level
 * offsets are pure accumulation. Nested tokens are not: a blockquote's
 * children have their `> ` prefixes stripped and a list item's have their
 * bullets stripped, so the raw text is searched forward from the cursor. The
 * forward search is what makes the stripped prefixes fall out for free.
 */
function findToken(source: string, raw: string, from: number, limit: number): number {
  if (!raw) return from;
  const at = source.indexOf(raw, from);
  if (at < 0 || at + raw.length > limit) return from;
  return at;
}

/* ---------- markdown extensions for math (micromark-extension-math) ---------- */

/**
 * `mathFlow`: a fence of two or more `$` at the start of a line, an optional
 * meta tail that may not contain `$`, then content up to a closing fence of
 * at least the opening size.
 */
function tokenizeMathBlock(src: string): MarkdownToken | undefined {
  const opening = /^( {0,3})(\$+)([^\n$]*)(\n|$)/.exec(src);
  if (!opening) return undefined;
  const size = opening[2].length;
  if (size < 2) return undefined;

  const contentStart = opening[0].length;
  let at = contentStart;
  while (at <= src.length) {
    const lineEnd = src.indexOf("\n", at);
    const line = lineEnd < 0 ? src.slice(at) : src.slice(at, lineEnd);
    const closing = /^ {0,3}(\$+)[ \t]*$/.exec(line);
    if (closing && closing[1].length >= size) {
      return {
        type: "mathBlock",
        raw: src.slice(0, at + line.length),
        text: src.slice(contentStart, at).replace(/(?:\r?\n|\r)$/, "").replace(/^(?:\r?\n|\r)/, ""),
      };
    }
    if (lineEnd < 0) break;
    at = lineEnd + 1;
  }
  // No closing fence: micromark still ends the flow at the end of input.
  return {
    type: "mathBlock",
    raw: src,
    text: src.slice(contentStart).replace(/(?:\r?\n|\r)$/, "").replace(/^(?:\r?\n|\r)/, ""),
  };
}

/**
 * `mathText`: an opening run of `$`, then content up to a closing run of the
 * same size. One space or line ending is padding when both ends are padding,
 * and only when the region holds something else.
 */
function tokenizeMathInline(src: string): MarkdownToken | undefined {
  const opening = /^\$+/.exec(src);
  if (!opening) return undefined;
  const size = opening[0].length;

  let at = size;
  while (at < src.length) {
    if (src[at] !== "$") {
      at += 1;
      continue;
    }
    let run = 1;
    while (src[at + run] === "$") run += 1;
    if (run === size) {
      let value = src.slice(size, at);
      const head = value[0];
      const tail = value[value.length - 1];
      const pads = (char: string | undefined) => char === " " || char === "\n" || char === "\r";
      if (pads(head) && pads(tail) && /[^ \r\n]/.test(value)) value = value.slice(1, -1);
      return { type: "mathInline", raw: src.slice(0, at + run), text: value };
    }
    at += run;
  }
  return undefined;
}

const MARKDOWN_EXTENSIONS: MarkedExtension = {
  extensions: [
    {
      name: "mathBlock",
      level: "block",
      tokenizer: tokenizeMathBlock,
    },
    {
      name: "mathInline",
      level: "inline",
      // Text runs would otherwise swallow the `$` before the tokenizer sees it.
      start: (src: string) => {
        const at = src.indexOf("$");
        return at < 0 ? undefined : at;
      },
      tokenizer: tokenizeMathInline,
    },
  ],
};

const markdown = new Marked({ gfm: true });
markdown.use(MARKDOWN_EXTENSIONS);

/* ---------- token walker ---------- */

function renderMathNode(value: string, display: boolean, position?: SourcePosition): MarkdownNode {
  return element(
    "code",
    { className: ["language-math", display ? "math-display" : "math-inline"] },
    [textNode(value)],
    position,
  );
}

function renderBlockToken(
  token: MarkdownToken,
  start: number,
  end: number,
  ctx: BlockContext,
  cursor: { at: number },
): MarkdownNode[] {
  const nodes: MarkdownNode[] = [];

  switch (token.type) {
    case "space":
      break;

    case "checkbox": {
      // marked lifts the task marker out of the item text; mdast keeps it as
      // a boolean on the item and mdast-util-to-hast renders this input.
      nodes.push(
        element("input", { type: "checkbox", checked: token.checked === true, disabled: true }, []),
      );
      // mdast-util-to-hast unshifts a `" "` before the input whenever the
      // item's paragraph has content, which is always: marked only produces a
      // `checkbox` token when its `listIsTask` rule (`/^\[[ xX]\] +\S/`) sees a
      // non-space character after the marker, and that character is what the
      // following token carries. The old `cursor.at < end` guard could never
      // hold here — `walkBlocks` advances `cursor.at` to this token's own end
      // before dispatching — so tight items lost the space while loose ones
      // (which route through `walkInline`, where the guard is against the
      // paragraph's end) kept it.
      nodes.push(textNode(" "));
      break;
    }

    case "paragraph":
    case "text": {
      const children = walkInline(token.tokens ?? [], start, end, ctx, cursor);
      if (token.type === "paragraph") {
        nodes.push(element("p", {}, children, span(start, trimmedEnd(ctx.source, start, end))));
      } else {
        // A tight list item's text: mdast-util-to-hast flattens the
        // paragraph into the `<li>`, so there is no wrapper here either.
        nodes.push(...children);
      }
      break;
    }

    case "heading": {
      const depth = typeof token.depth === "number" ? token.depth : 1;
      nodes.push(
        element(
          `h${depth}`,
          {},
          walkInline(token.tokens ?? [], start, end, ctx, cursor),
          span(start, trimmedEnd(ctx.source, start, end)),
        ),
      );
      break;
    }

    case "hr":
      nodes.push(element("hr", {}, [], span(start, trimmedEnd(ctx.source, start, end))));
      break;

    case "blockquote": {
      const blockSpan = span(start, trimmedEnd(ctx.source, start, end));
      const children = walkBlocks(token.tokens ?? [], start, end, ctx, cursor, false);
      nodes.push(element("blockquote", {}, wrap(children, true), blockSpan));
      break;
    }

    case "code": {
      const codeSpan = span(start, trimmedEnd(ctx.source, start, end));
      const lang = typeof token.lang === "string" ? token.lang.split(/\s+/)[0] : "";
      const properties: Record<string, unknown> = {};
      if (lang) properties.className = [`language-${lang}`];
      nodes.push(
        element(
          "pre",
          {},
          [element("code", properties, [textNode(`${token.text ?? ""}\n`)], codeSpan)],
          codeSpan,
        ),
      );
      break;
    }

    case "mathBlock": {
      const codeSpan = span(start, trimmedEnd(ctx.source, start, end));
      nodes.push(
        element(
          "pre",
          {},
          [
            element(
              "code",
              { className: ["language-math", "math-display"] },
              [textNode(token.text ?? "")],
              codeSpan,
            ),
          ],
          codeSpan,
        ),
      );
      break;
    }

    case "list": {
      nodes.push(renderList(token, start, end, ctx, cursor));
      break;
    }

    case "table": {
      nodes.push(renderTable(token, start, end, ctx, cursor));
      break;
    }

    case "html": {
      const raw = token.text ?? token.raw;
      const blockSpan = span(start, trimmedEnd(ctx.source, start, end));
      nodes.push({ type: "raw", value: stampRawHtml(raw, blockSpan) });
      break;
    }

    case "def": {
      // See the footnote deviation in this file's header. `marked`'s
      // link-reference-definition rule accepts a footnote-shaped label, so
      // `[^1]: note` lexes as a definition where `remark-gfm` would have made
      // it a `footnoteDefinition`. A definition is ignored, so the text would
      // vanish; render the body as a paragraph instead, which is lossless.
      //
      // A definition with any other label is an ordinary CommonMark link
      // reference definition: the `definition: ignore` handler hides it
      // and its reference resolves to a link, so it stays hidden here too.
      const raw = token.raw ?? "";
      if (!String(token.tag ?? "").startsWith("^")) break;
      const separator = raw.indexOf("]:");
      const bodyAt = separator < 0 ? start : start + separator + 2;
      const body = ctx.source.slice(bodyAt, trimmedEnd(ctx.source, start, end)).trim();
      if (!body) break;
      const bodyStart = ctx.source.indexOf(body, bodyAt);
      const bodyEnd = bodyStart + body.length;
      const inline = markdown.Lexer.lexInline(
        body,
        markdown.defaults,
      ) as unknown as MarkdownToken[];
      nodes.push(
        element(
          "p",
          {},
          walkInline(inline, bodyStart, bodyEnd, ctx, { at: bodyStart }),
          span(start, bodyEnd),
        ),
      );
      break;
    }

    default:
      break;
  }

  return nodes;
}

/** Walk a block token list whose tokens live inside `[winStart, winEnd)`. */
function walkBlocks(
  tokens: MarkdownToken[],
  winStart: number,
  winEnd: number,
  ctx: BlockContext,
  cursor: { at: number },
  topLevel: boolean,
): MarkdownNode[] {
  const nodes: MarkdownNode[] = [];
  const outerCursor = cursor.at;
  cursor.at = winStart;
  for (const raw of tokens) {
    const token = raw as MarkdownToken;
    if (!token || typeof token.type !== "string") continue;
    const start = findToken(ctx.source, token.raw ?? "", cursor.at, winEnd);
    const end = Math.min(start + (token.raw ?? "").length, ctx.source.length);
    cursor.at = end;
    nodes.push(...renderBlockToken(token, start, end, ctx, cursor));
  }
  if (topLevel) {
    // `root` wraps its children with line endings between them.
    return wrap(nodes, false);
  }
  cursor.at = Math.max(cursor.at, outerCursor);
  return nodes;
}

/** `state.wrap`: line endings between children, and around them when loose. */
function wrap(nodes: MarkdownNode[], loose: boolean): MarkdownNode[] {
  const out: MarkdownNode[] = [];
  if (loose) out.push(textNode("\n"));
  nodes.forEach((node, index) => {
    if (index) out.push(textNode("\n"));
    out.push(node);
  });
  if (loose && nodes.length > 0) out.push(textNode("\n"));
  return out;
}

function renderList(
  token: MarkdownToken,
  start: number,
  end: number,
  ctx: BlockContext,
  cursor: { at: number },
): MarkdownNode {
  const ordered = token.ordered === true;
  const properties: Record<string, unknown> = {};
  if (ordered && typeof token.start === "number" && token.start !== 1) {
    properties.start = token.start;
  }

  const loose = token.loose === true;
  const items: MarkdownNode[] = [];
  const itemCursor = { at: start };
  let hasTask = false;

  for (const rawItem of token.items ?? []) {
    const item = rawItem as MarkdownToken;
    const itemStart = findToken(ctx.source, item.raw ?? "", itemCursor.at, end);
    const itemEnd = Math.min(itemStart + (item.raw ?? "").length, ctx.source.length);
    itemCursor.at = itemEnd;

    const itemLoose = loose || item.loose === true;
    const results = walkBlocks(item.tokens ?? [], itemStart, itemEnd, ctx, { at: itemStart }, false);

    // mdast-util-to-hast's listItem loop, verbatim: newline before every
    // child except a leading, tight paragraph, and a final newline unless
    // the tail is that paragraph.
    const children: MarkdownNode[] = [];
    results.forEach((child, index) => {
      const isParagraph = child.type === "element" && child.tagName === "p";
      if (itemLoose || index !== 0 || !isParagraph) children.push(textNode("\n"));
      if (!itemLoose && isParagraph) children.push(...(child.children ?? []));
      else children.push(child);
    });
    const tail = results[results.length - 1];
    const tailIsParagraph = tail?.type === "element" && tail.tagName === "p";
    if (tail && (itemLoose || !tailIsParagraph)) children.push(textNode("\n"));

    const itemProperties: Record<string, unknown> = {};
    if (item.checked !== undefined) {
      hasTask = true;
      itemProperties.className = ["task-list-item"];
    }
    items.push(
      element("li", itemProperties, children, span(itemStart, trimmedEnd(ctx.source, itemStart, itemEnd))),
    );
  }

  if (hasTask) properties.className = ["contains-task-list"];
  return element(
    ordered ? "ol" : "ul",
    properties,
    wrap(items, true),
    span(start, trimmedEnd(ctx.source, start, end)),
  );
}

/**
 * Cell spans follow micromark's GFM table tokenizer, matching `remark-gfm`'s:
 * `remark-gfm` used: each cell owns its *leading* pipe, the row's leading and
 * trailing pipes belong to the first and last cell, a pipe is only a boundary
 * when it is not backslash-escaped, and up to three spaces of indentation are
 * outside the first cell.
 *
 * `marked`'s own splitter (`te`) agrees on which pipes are boundaries — it
 * rewrites every unescaped pipe to `" |"` and splits on that pair — so the
 * spans below line up with the cell texts `marked` produced.
 */
function tableCellSpans(line: string): Array<[number, number]> {
  const indent = /^ {0,3}/.exec(line)?.[0].length ?? 0;
  // A CRLF line keeps its `\r`; micromark's cell end stops before it.
  const end = line.endsWith("\r") ? line.length - 1 : line.length;
  const pipes: number[] = [];
  for (let at = indent; at < end; at += 1) {
    if (line[at] !== "|") continue;
    let escapes = 0;
    while (at - escapes - 1 >= 0 && line[at - escapes - 1] === "\\") escapes += 1;
    if (escapes % 2 === 1) continue;
    pipes.push(at);
  }
  if (pipes.length === 0) return [[indent, end]];
  // A leading pipe starts the first cell rather than delimiting an empty one;
  // a trailing pipe is absorbed into the last cell (so it is dropped as a
  // boundary, and the span loop's `?? end` pulls the cell out to the row end).
  const boundaries = pipes[0] === indent ? pipes.slice() : [indent, ...pipes];
  const last = boundaries[boundaries.length - 1];
  if (boundaries.length > 1 && line.slice(last + 1, end).trim() === "") boundaries.pop();
  const spans: Array<[number, number]> = [];
  for (let index = 0; index < boundaries.length; index += 1) {
    spans.push([boundaries[index], boundaries[index + 1] ?? end]);
  }
  return spans;
}

function renderTable(
  token: MarkdownToken,
  start: number,
  end: number,
  ctx: BlockContext,
  cursor: { at: number },
): MarkdownNode {
  const lines: Array<{ start: number; text: string }> = [];
  let at = start;
  while (at <= end) {
    const lineEnd = ctx.source.indexOf("\n", at);
    const stop = lineEnd < 0 || lineEnd > end ? end : lineEnd;
    lines.push({ start: at, text: ctx.source.slice(at, stop) });
    if (lineEnd < 0 || lineEnd >= end) break;
    at = lineEnd + 1;
  }

  const align: Array<string | null> = Array.isArray(token.align) ? token.align : [];

  const renderRow = (
    cells: MarkdownToken[],
    line: { start: number; text: string },
    header: boolean,
    lineCursor: { at: number },
  ): MarkdownNode => {
    const spans = tableCellSpans(line.text);
    const cellNodes: MarkdownNode[] = [];
    cells.forEach((cell, index) => {
      const cellSpan = spans[index] ?? [line.text.length, line.text.length];
      const cellStart = line.start + cellSpan[0];
      const cellEnd = line.start + cellSpan[1];
      const properties: Record<string, unknown> = {};
      if (align[index]) properties.align = align[index];
      cellNodes.push(
        element(
          header ? "th" : "td",
          properties,
          walkInline(cell.tokens ?? [], cellStart, cellEnd, ctx, { at: cellStart }),
          span(cellStart, cellEnd),
        ),
      );
    });
    return element(
      "tr",
      {},
      wrap(cellNodes, true),
      span(line.start, line.start + line.text.length),
    );
  };

  const headerLine = lines[0] ?? { start, text: "" };
  const headerRow = renderRow(token.header ?? [], headerLine, true, { at: headerLine.start });
  const head = element(
    "thead",
    {},
    wrap([headerRow], true),
    span(headerLine.start, headerLine.start + headerLine.text.length),
  );
  const bodyRows: MarkdownNode[] = [];
  const bodyLines: Array<{ start: number; text: string }> = [];
  const rows = (token.rows ?? []) as MarkdownToken[][];
  rows.forEach((cells: MarkdownToken[], index: number) => {
    // The delimiter row sits between the header and the body.
    const line = lines[index + 2];
    if (!line) return;
    bodyLines.push(line);
    bodyRows.push(renderRow(cells, line, false, { at: line.start }));
  });

  const tableChildren: MarkdownNode[] = [head];
  if (bodyRows.length > 0) {
    const first = bodyLines[0];
    const last = bodyLines[bodyLines.length - 1];
    tableChildren.push(
      element(
        "tbody",
        {},
        wrap(bodyRows, true),
        span(first.start, last.start + last.text.length),
      ),
    );
  }

  cursor.at = end;
  return element(
    "table",
    {},
    wrap(tableChildren, true),
    span(start, trimmedEnd(ctx.source, start, end)),
  );
}

function inlineText(tokens: MarkdownToken[] | undefined): string {
  let out = "";
  for (const raw of tokens ?? []) {
    const token = raw as MarkdownToken;
    if (!token || typeof token.type !== "string") continue;
    switch (token.type) {
      case "text":
      case "escape":
      case "codespan":
      case "html":
        out += token.text ?? "";
        break;
      case "br":
        out += "";
        break;
      case "image":
        out += inlineText(token.tokens);
        break;
      case "checkbox":
        break;
      default:
        out += token.tokens ? inlineText(token.tokens) : (token.text ?? "");
        break;
    }
  }
  return out;
}

/** micromark's `normalizeUri`, which marked applies through `encodeURI`. */
function normalizeUri(url: string): string {
  try {
    return encodeURI(url).replace(/%25/g, "%");
  } catch {
    return url;
  }
}

function walkInline(
  tokens: MarkdownToken[],
  winStart: number,
  winEnd: number,
  ctx: BlockContext,
  cursor: { at: number },
): MarkdownNode[] {
  const nodes: MarkdownNode[] = [];
  cursor.at = winStart;

  for (const raw of tokens) {
    const token = raw as MarkdownToken;
    if (!token || typeof token.type !== "string") continue;
    const start = findToken(ctx.source, token.raw ?? "", cursor.at, winEnd);
    const end = Math.min(start + (token.raw ?? "").length, ctx.source.length);
    cursor.at = end;
    const tokenSpan = span(start, end);

    switch (token.type) {
      case "text":
      case "escape":
        nodes.push(textNode(token.text ?? ""));
        break;

      case "codespan":
        nodes.push(element("code", {}, [textNode(token.text ?? "")], tokenSpan));
        break;

      case "br":
        nodes.push(element("br", {}, [], tokenSpan));
        break;

      case "strong":
      case "em":
      case "del": {
        const tagName = token.type === "strong" ? "strong" : token.type === "em" ? "em" : "del";
        nodes.push(
          element(
            tagName,
            {},
            walkInline(token.tokens ?? [], start, end, ctx, { at: start }),
            tokenSpan,
          ),
        );
        break;
      }

      case "link": {
        const properties: Record<string, unknown> = {};
        if (token.href) properties.href = normalizeUri(String(token.href));
        if (token.title) properties.title = token.title;
        nodes.push(
          element(
            "a",
            properties,
            walkInline(token.tokens ?? [], start, end, ctx, { at: start }),
            tokenSpan,
          ),
        );
        break;
      }

      case "image": {
        const properties: Record<string, unknown> = {};
        if (token.href) properties.src = normalizeUri(String(token.href));
        properties.alt = inlineText(token.tokens);
        if (token.title) properties.title = token.title;
        nodes.push(element("img", properties, [], tokenSpan));
        break;
      }

      case "html":
        nodes.push({ type: "raw", value: token.text ?? "" });
        break;

      case "checkbox":
        nodes.push(
          element("input", { type: "checkbox", checked: token.checked === true, disabled: true }, []),
        );
        if (cursor.at < winEnd) nodes.push(textNode(" "));
        break;

      case "mathInline": {
        const display =
          ctx.original.slice(start, start + 2) === "\\[" &&
          ctx.original.slice(end - 2, end) === "\\]";
        nodes.push(renderMathNode(token.text ?? "", display, tokenSpan));
        break;
      }

      default:
        if (token.tokens) {
          nodes.push(...walkInline(token.tokens, start, end, ctx, { at: start }));
        } else {
          nodes.push(textNode(token.text ?? ""));
        }
        break;
    }
  }

  return nodes;
}

/**
 * `remarkChatFileLinks`: bare file and URL tokens become links so
 * the `a` handler can preview them. Built on `splitChatText` rather than on
 * `linkifyMdastTree` because this tree is hast-shaped; the skip set is the
 * hast spelling of the mdast `SKIP_MDAST`.
 */
const LINKIFY_SKIP = new Set(["a", "code", "img", "pre"]);

function linkify(
  nodes: MarkdownNode[],
  workspaceRoot: string | null,
  baseDir: string | undefined,
): MarkdownNode[] {
  const out: MarkdownNode[] = [];
  for (const node of nodes) {
    if (node.type === "text" && typeof node.value === "string") {
      const segments = splitChatText(node.value, workspaceRoot, baseDir);
      if (segments.length === 1 && segments[0].kind === "text") {
        out.push(node);
        continue;
      }
      for (const segment of segments) {
        if (segment.kind === "text") {
          out.push(textNode(segment.text));
          continue;
        }
        const href =
          segment.target.kind === "url" ? segment.target.url : segment.target.path;
        out.push(element("a", { href }, [textNode(segment.text)]));
      }
      continue;
    }
    if (node.type === "element" && node.tagName && !LINKIFY_SKIP.has(node.tagName) && node.children) {
      out.push({ ...node, children: linkify(node.children, workspaceRoot, baseDir) });
      continue;
    }
    out.push(node);
  }
  return out;
}

/**
 * Give a raw HTML block's top-level elements the block's span. `rehype-raw`
 * gave each one a parse5 span; one shared span is the closest this pipeline
 * can get, and it keeps the "some ancestor contains the match" invariant that
 * transcript search relies on.
 */
function stampRawHtml(raw: string, blockSpan: SourcePosition): string {
  const template = document.createElement("template");
  template.innerHTML = raw;
  for (const child of Array.from(template.content.children)) {
    child.setAttribute("data-source-start", String(blockSpan.start.offset));
    child.setAttribute("data-source-end", String(blockSpan.end.offset));
  }
  return template.innerHTML;
}

function buildTree(ctx: BlockContext): MarkdownNode[] {
  const nodes = walkBlocks(
    markdown.lexer(ctx.source) as unknown as MarkdownToken[],
    0,
    ctx.source.length,
    ctx,
    { at: 0 },
    true,
  );
  const linked = linkify(nodes, ctx.workspaceRoot, ctx.baseDir);
  const root: MarkdownNode = { type: "element", tagName: "root", properties: {}, children: linked };
  rehypeSourcePositions({ offset: 0 })(root as never);
  return linked;
}

/* ---------- serialization ---------- */

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

// marked's `escapeTestNoEncode`: an existing character reference is left alone
// so the browser decodes it exactly once, the way micromark's did.
const AMPERSAND = /&(?!(?:#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g;

function escapeText(value: string): string {
  return value.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(AMPERSAND, "&amp;");
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function serializeNodes(nodes: MarkdownNode[]): string {
  let out = "";
  for (const node of nodes) {
    if (node.type === "text") {
      out += escapeText(node.value ?? "");
      continue;
    }
    if (node.type === "raw") {
      out += node.value ?? "";
      continue;
    }
    if (!node.tagName) continue;

    let attributes = "";
    for (const [key, value] of Object.entries(node.properties ?? {})) {
      if (value === undefined || value === null || value === false) continue;
      const name = key === "className" ? "class" : key;
      if (Array.isArray(value)) {
        const joined = value.filter(Boolean).join(" ");
        if (joined) attributes += ` ${name}="${escapeAttribute(joined)}"`;
        continue;
      }
      if (value === true) {
        attributes += ` ${name}`;
        continue;
      }
      attributes += ` ${name}="${escapeAttribute(String(value))}"`;
    }
    out += `<${node.tagName}${attributes}>`;
    if (VOID_TAGS.has(node.tagName)) continue;
    out += serializeNodes(node.children ?? []);
    out += `</${node.tagName}>`;
  }
  return out;
}

/* ---------- sanitize (rehype-sanitize) ---------- */

/*
 * `hast-util-sanitize`'s `defaultSchema`, extended with the media elements it
 * renders, plus `remark-math`'s math
 * classes on `<code>` — the default `language-*` allow list drops
 * `math-display`, which would leave KaTeX rendering `\[ … \]` as inline math.
 *
 * DOMPurify takes a flat tag list and a flat attribute list, where
 * `hast-util-sanitize` took per-tag attribute lists. `SANITIZE_ATTRS` is
 * therefore the union of every entry, and `SANITIZE_TAG_ATTRS` /
 * `SANITIZE_TAG_CLASSES` re-impose the per-tag half in `purify`'s
 * `uponSanitizeAttribute` hook. Narrowing in a hook rather than by omitting
 * names from `ALLOWED_ATTR` keeps DOMPurify's own URI check in play: an
 * attribute that is not on the flat list can only survive `forceKeepAttr`,
 * which skips that check entirely.
 *
 * Without the per-tag half, `class` was accepted on every element, so raw HTML
 * could adopt arbitrary app styling *and* hijack the KaTeX path — this code
 * tests `language-math` / `math-display` / `math-inline` on any element before
 * dispatching on the tag, where the schema had already stripped those
 * classes off anything but `<code>`.
 */
const SANITIZE_TAGS = [
  "a", "b", "blockquote", "br", "code", "dd", "del", "details", "div", "dl", "dt",
  "em", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "input", "ins",
  "kbd", "li", "ol", "p", "picture", "pre", "q", "rp", "rt", "ruby", "s", "samp",
  "section", "source", "span", "strike", "strong", "sub", "summary", "sup",
  "table", "tbody", "td", "tfoot", "th", "thead", "tr", "tt", "ul", "var",
  "audio", "video",
];

/** `a`, `dl`, `img`, `ol`, `summary`, `table` and `ul` share this trio. */
const SANITIZE_ARIA_ATTRS = ["aria-describedby", "aria-label", "aria-labelledby"];

/**
 * The per-tag attribute lists, flattened from `hast-util-sanitize`'s camelCase
 * property names to the attribute names that reach the DOM.
 *
 * `a`, `code`, `h2`, `li`, `ol`, `section` and `ul` list `class` here because
 * `SANITIZE_TAG_CLASSES` decides which *values* those tags accept; `img`,
 * `audio` and `video` list it for the bare `className` entry, which
 * allows any value.
 */
const SANITIZE_TAG_ATTRS: Record<string, readonly string[]> = {
  a: [...SANITIZE_ARIA_ATTRS, "data-footnote-backref", "data-footnote-ref", "class", "href"],
  audio: ["src", "controls", "preload", "class"],
  blockquote: ["cite"],
  code: ["class"],
  del: ["cite"],
  div: ["itemscope", "itemtype"],
  dl: [...SANITIZE_ARIA_ATTRS],
  h2: ["class"],
  img: [...SANITIZE_ARIA_ATTRS, "longdesc", "src", "alt", "title", "class"],
  input: ["disabled", "type"],
  ins: ["cite"],
  li: ["class"],
  ol: [...SANITIZE_ARIA_ATTRS, "class"],
  q: ["cite"],
  section: ["data-footnotes", "class"],
  // `source`, which replaced the schema's default `srcSet`.
  source: ["src", "type"],
  summary: [...SANITIZE_ARIA_ATTRS],
  table: [...SANITIZE_ARIA_ATTRS],
  ul: [...SANITIZE_ARIA_ATTRS, "class"],
  video: ["src", "controls", "preload", "class", "poster"],
};

/**
 * The `class` values each tag accepts. `null` is the bare `className`
 * entry — `hast-util-sanitize` reads a lone string as "any value".
 */
const SANITIZE_TAG_CLASSES: Record<string, readonly (string | RegExp)[] | null> = {
  a: ["data-footnote-backref"],
  audio: null,
  code: [/^language-./, "math-inline", "math-display"],
  h2: ["sr-only"],
  img: null,
  li: ["task-list-item"],
  ol: ["contains-task-list"],
  section: ["footnotes"],
  ul: ["contains-task-list"],
  video: null,
};

/**
 * Attributes the schema listed only per tag, so the flat list cannot express
 * them. Everything else in `SANITIZE_ATTRS` came from the schema's `'*'` entry
 * and stays valid on every element.
 */
const SANITIZE_PER_TAG_ATTRS = new Set([
  ...SANITIZE_ARIA_ATTRS,
  "class", "href", "cite", "itemscope", "itemtype", "longdesc", "src",
  "disabled", "type", "data-footnote-backref", "data-footnote-ref",
  "data-footnotes", "controls", "preload", "poster",
]);

const SANITIZE_ATTRS = [
  // The schema's `'*'` entry: allowed on every element.
  "abbr", "accept", "acceptcharset", "accesskey", "action", "align", "alt", "axis",
  "border", "cellpadding", "cellspacing", "char", "charoff", "charset", "checked",
  "clear", "colspan", "color", "cols", "compact", "coords", "datetime", "dir",
  "enctype", "frame", "hspace", "headers", "height", "hreflang", "htmlfor", "id",
  "ismap", "itemprop", "label", "lang", "maxlength", "media", "method", "multiple",
  "name", "nohref", "noshade", "nowrap", "open", "prompt", "readonly", "rev",
  "rowspan", "rows", "rules", "scope", "selected", "shape", "size", "span", "start",
  "summary", "tabindex", "title", "usemap", "valign", "value", "width",
  // Per-tag entries, flattened; `SANITIZE_TAG_ATTRS` narrows them again.
  ...SANITIZE_PER_TAG_ATTRS,
  // Stamped after sanitization; see the note in `Markdown.vue`'s header.
  "data-source-start", "data-source-end",
];
const purify = DOMPurify(window);

/**
 * `SANITIZE_NAMED_PROPS` is DOMPurify's `user-content-` clobber prefix, the
 * same one `defaultSchema.clobberPrefix` applies. `ALLOWED_URI_REGEXP` mirrors
 * the schema's protocol table (http, https, mailto, irc, ircs, xmpp, and
 * relative URLs) so `data:` and `javascript:` destinations are dropped the way
 * `hast-util-sanitize` dropped them.
 *
 * `ALLOW_ARIA_ATTR: false` because the flag accepts *every* `aria-*` on every
 * element, whereas the schema allowed three names on seven tags. The three are on
 * the flat list and re-narrowed per tag by the hook below, which also matters
 * beyond the DOM: `lib/transcript-search-highlight.ts` treats
 * `[aria-hidden='true']` as non-content, so a blanket `aria-*` allowance made
 * `<span aria-hidden="true">needle</span>` searchable where the schema
 * had already stripped the attribute.
 */
const SANITIZE_CONFIG = {
  ALLOWED_TAGS: SANITIZE_TAGS,
  ALLOWED_ATTR: SANITIZE_ATTRS,
  ALLOW_ARIA_ATTR: false,
  ALLOW_DATA_ATTR: false,
  SANITIZE_NAMED_PROPS: true,
  ALLOWED_URI_REGEXP:
    /^(?:(?:https?|mailto|irc|ircs|xmpp):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
  RETURN_DOM_FRAGMENT: true,
};

purify.addHook("afterSanitizeAttributes", (node) => {
  if (node.nodeName !== "INPUT") return;
  node.setAttribute("type", "checkbox");
  node.setAttribute("disabled", "");
});

purify.addHook("uponSanitizeAttribute", (node, data) => {
  const name = data.attrName;

  // `ALLOW_DATA_ATTR: false` drops every `data-*` before the allow list is
  // consulted, so the explicit entry in `SANITIZE_ATTRS` alone is not enough
  // (verified against the installed DOMPurify). `forceKeepAttr` is the one
  // escape hatch that bypasses that gate, and the value is already validated
  // as a non-negative integer here, so the allowlist does not widen: an
  // unrelated `data-*` on the same element is still stripped.
  if (name === "data-source-start" || name === "data-source-end") {
    if (!/^\d+$/.test(data.attrValue)) {
      data.keepAttr = false;
      return;
    }
    data.forceKeepAttr = true;
    return;
  }

  const tag = node.nodeName.toLowerCase();
  const allowed = SANITIZE_TAG_ATTRS[tag];

  if (name === "class") {
    if (!allowed?.includes("class")) {
      data.keepAttr = false;
      return;
    }
    const values = SANITIZE_TAG_CLASSES[tag];
    if (values === null) return; // the bare `className`: any value
    const kept = data.attrValue.split(/\s+/).filter((token) => {
      if (!token) return false;
      return (values ?? []).some((value) =>
        typeof value === "string" ? value === token : value.test(token),
      );
    });
    if (kept.length === 0) {
      data.keepAttr = false;
      return;
    }
    data.attrValue = kept.join(" ");
    return;
  }

  if (SANITIZE_PER_TAG_ATTRS.has(name) && !allowed?.includes(name)) {
    data.keepAttr = false;
  }
});

function sanitize(html: string): DocumentFragment {
  return purify.sanitize(html, SANITIZE_CONFIG) as unknown as DocumentFragment;
}

/* ---------- syntax highlighting  ---------- */

function tokenStyle(token: { color?: string; fontStyle?: number }): Record<string, string> {
  const fontStyle = token.fontStyle ?? 0;
  const style: Record<string, string> = {};
  if (token.color) style.color = token.color;
  if (fontStyle & 1) style.fontStyle = "italic";
  if (fontStyle & 2) style.fontWeight = "bold";
  if (fontStyle & 4) style.textDecoration = "underline";
  return style;
}

function useHighlightedTokens(
  code: () => string,
  lang: () => string,
): ComputedRef<LineCache["tokens"] | null> {
  const mode = useThemeMode();
  const version = ref(getHighlightVersion());
  const unsubscribe = subscribeHighlighter(() => {
    version.value = getHighlightVersion();
  });
  onScopeDispose(unsubscribe);

  const resolved = computed(() => resolveLang(lang()));
  watch(resolved, (next) => {
    if (next) ensureLang(next);
  }, { immediate: true });

  const cache: { current: LineCache | null } = { current: null };
  return computed(() => {
    const target = resolved.value;
    if (!target) return null;
    void version.value; // re-tokenize once the grammar finishes loading
    const next = tokenizeIncremental(cache.current, code(), target, themeForMode(mode.value));
    cache.current = next;
    return next?.tokens ?? null;
  });
}

/**
 * Tokenized code body (no chrome). It exists for the
 * transcript's tool result blocks; no module imports it yet.
 */
const HighlightedCode = defineComponent({
  name: "MarkdownHighlightedCode",
  props: {
    code: { type: String, required: true },
    lang: { type: String, required: true },
  },
  setup(props) {
    const tokens = useHighlightedTokens(() => props.code, () => props.lang);
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

/* ---------- code block ---------- */

const CodeBlock = defineComponent({
  name: "MarkdownCodeBlock",
  props: {
    code: { type: String, required: true },
    lang: { type: String, required: true },
    dataSourceStart: { type: Number, default: undefined },
    dataSourceEnd: { type: Number, default: undefined },
  },
  setup(props) {
    const { t } = useI18n();
    const { copied, copy } = useCopy();
    const position = computed(() =>
      sourcePositionProps({
        "data-source-start": props.dataSourceStart,
        "data-source-end": props.dataSourceEnd,
      }),
    );
    return () =>
      h("div", { class: "code-block", ...position.value }, [
        h("div", { class: "code-block-head" }, [
          h("span", { class: "code-block-lang" }, props.lang || "text"),
          h(
            TooltipButton,
            {
              class: cx("code-copy-btn", copied.value && "copied"),
              "aria-label": t("chat.copy"),
              label: copied.value ? t("chat.copied") : t("chat.copy"),
              onClick: () => copy(props.code),
            },
            () => (copied.value ? h(IconCheck, { size: 13 }) : h(IconCopy, { size: 13 })),
          ),
        ]),
        h("pre", {}, [h("code", {}, [h(HighlightedCode, { code: props.code, lang: props.lang })])]),
      ]);
  },
});

/* ---------- mermaid ---------- */

/**
 * `useNearViewport`: start observing after mount, gate the heavy
 * work on the element coming within 240px of the viewport, and give up the
 * observer the moment it does.
 *
 * The `IntersectionObserver` has to be constructed in `onMounted`, not from a
 * `watch(., { immediate: true })`: an immediate watcher runs synchronously
 * during `setup`, when the template ref is still `null`, so the `!element`
 * branch fired at once, `nearViewport` flipped to `true` before the component
 * ever painted and no observer was ever created. That made the gate a no-op,
 * and since `renderMermaidSvg` serializes every render through one global
 * queue (`lib/mermaid.ts`), a long transcript did all its mermaid work
 * eagerly.
 */
function useNearViewport(target: { value: HTMLElement | null }) {
  const nearViewport = ref(false);
  let observer: IntersectionObserver | null = null;

  function stopObserving() {
    observer?.disconnect();
    observer = null;
  }

  function observe() {
    if (nearViewport.value) return;
    // A re-run replaces the previous observer, which is the effect cleanup.
    stopObserving();
    const element = target.value;
    if (!element || typeof IntersectionObserver === "undefined") {
      nearViewport.value = true;
      return;
    }
    observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        nearViewport.value = true;
        stopObserving();
      },
      { rootMargin: "240px 0px" },
    );
    observer.observe(element);
  }

  onMounted(observe);
  watch([nearViewport, target], observe, { flush: "post" });
  onBeforeUnmount(stopObserving);
  return nearViewport;
}

const MermaidBlock = defineComponent({
  name: "MarkdownMermaidBlock",
  props: {
    code: { type: String, required: true },
    dataSourceStart: { type: Number, default: undefined },
    dataSourceEnd: { type: Number, default: undefined },
  },
  setup(props) {
    const { t } = useI18n();
    const theme = useThemeMode();
    const reactId = useId();
    const renderId = computed(() => `mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`);
    const rootRef = ref<HTMLDivElement | null>(null);
    const nearViewport = useNearViewport(rootRef);
    const renderedSource = ref("");
    const svg = ref("");
    const loading = ref(false);
    const error = ref<"invalid" | "too-large" | null>(null);
    const showSource = ref(false);
    const { copied, copy } = useCopy();

    const position = computed(() =>
      sourcePositionProps({
        "data-source-start": props.dataSourceStart,
        "data-source-end": props.dataSourceEnd,
      }),
    );

    watch(() => props.code, () => {
      showSource.value = false;
    });

    watch(
      [() => props.code, nearViewport, renderId, theme],
      ([code], _previous, onCleanup) => {
        if (!nearViewport.value) return;
        if (code.length > MAX_MERMAID_SOURCE_LENGTH) {
          svg.value = "";
          loading.value = false;
          error.value = "too-large";
          return;
        }
        let active = true;
        onCleanup(() => {
          active = false;
        });
        if (renderedSource.value !== code) svg.value = "";
        loading.value = true;
        error.value = null;
        void renderMermaidSvg({ id: renderId.value, source: code, theme: theme.value })
          .then((next) => {
            if (!active) return;
            renderedSource.value = code;
            svg.value = next;
            loading.value = false;
          })
          .catch((cause: unknown) => {
            if (!active) return;
            svg.value = "";
            loading.value = false;
            error.value = cause instanceof MermaidSourceTooLargeError ? "too-large" : "invalid";
          });
      },
      { immediate: true },
    );

    return () => {
      const sourceVisible = showSource.value || error.value !== null;
      const statusLabel =
        error.value === "too-large" ? t("chat.diagramTooLarge") : t("chat.diagramUnavailable");
      const toggleLabel = showSource.value ? t("chat.showDiagram") : t("chat.showDiagramSource");

      const actions: VNodeChild[] = [];
      if (svg.value && !error.value) {
        actions.push(
          h(
            TooltipButton,
            {
              type: "button",
              class: cx("mermaid-action-btn", showSource.value && "active"),
              "aria-pressed": showSource.value,
              label: toggleLabel,
              "aria-label": toggleLabel,
              onClick: () => {
                showSource.value = !showSource.value;
              },
            },
            () => (showSource.value ? h(IconWorkflow, { size: 13 }) : h(IconCode, { size: 13 })),
          ),
        );
      }
      actions.push(
        h(
          TooltipButton,
          {
            type: "button",
            class: cx("mermaid-action-btn", copied.value && "copied"),
            label: copied.value ? t("chat.copied") : t("chat.copyDiagramSource"),
            "aria-label": t("chat.copyDiagramSource"),
            onClick: () => copy(props.code),
          },
          () => (copied.value ? h(IconCheck, { size: 13 }) : h(IconCopy, { size: 13 })),
        ),
      );

      let body: VNodeChild;
      if (sourceVisible) {
        body = h("pre", { class: "mermaid-source" }, [h("code", {}, props.code)]);
      } else if (svg.value) {
        body = h("div", {
          class: cx("mermaid-svg", loading.value && "refreshing"),
          role: "img",
          "aria-label": t("chat.mermaidDiagram"),
          innerHTML: svg.value,
        });
      } else {
        body = h(
          "div",
          { class: "mermaid-loading", role: "status", "aria-label": t("chat.diagramRendering") },
          [
            h("span", { "aria-hidden": "true" }),
            h("span", { "aria-hidden": "true" }),
            h("span", { "aria-hidden": "true" }),
          ],
        );
      }

      const bodyChildren: VNodeChild[] = [];
      if (error.value) {
        bodyChildren.push(
          h("div", { class: "mermaid-block-error", role: "status" }, [
            h(IconCircleAlert, { size: 14, "aria-hidden": "true" }),
            h("span", {}, statusLabel),
          ]),
        );
      }
      bodyChildren.push(body);

      return h(
        "div",
        {
          ref: rootRef,
          ...position.value,
          class: { "mermaid-block": true, error: error.value !== null },
          "aria-busy": loading.value,
        },
        [
          h("div", { class: "mermaid-block-head" }, [
            h("span", { class: "mermaid-block-title" }, [
              h(IconWorkflow, { size: 13, "aria-hidden": "true" }),
              h("span", {}, "mermaid"),
            ]),
            h("div", { class: "mermaid-block-actions" }, actions),
          ]),
          h("div", { class: "mermaid-block-body" }, bodyChildren),
        ],
      );
    };
  },
});

/* ---------- inline code, anchors, images, media, tables ---------- */

function usePreviewTitle(kind: "file" | "url"): string {
  const { t } = useI18n();
  return kind === "file" ? t("chat.previewFile") : t("chat.previewUrl");
}

/**
 * Inline code that names a workspace file (or URL) opens in the work panel;
 * everything else stays a plain code chip. Fenced blocks never reach this
 * component — the `pre` dispatch intercepts them.
 *
 * The chip's text arrives as a `text` prop rather than being read back out of
 * the default slot. `InlineCode`'s `typeof children === "string"` test is
 * written against the single-text-node shape that `hast-util-to-jsx-runtime`
 * produces when a `<code>` has exactly one text child. A Vue slot is
 * normalized to an array of VNodes, so the same test here would always be
 * false and the `chat-code-link` branch would be dead code. `text` is
 * derived at the `h(InlineCode, …)` call site from the same DOM node and with
 * the same rule, so the branch is reachable again.
 */
const InlineCode = defineComponent({
  name: "MarkdownInlineCode",
  props: {
    className: { type: String, default: undefined },
    /** The `children`, when it is a single text node. */
    text: { type: String, default: undefined },
    dataSourceStart: { type: Number, default: undefined },
    dataSourceEnd: { type: Number, default: undefined },
  },
  setup(props, { slots }) {
    const store = useAppStore();
    const openFileRef = useOpenChatFileRef();
    const baseDir = ref("");
    const fileTitle = usePreviewTitle("file");
    const urlTitle = usePreviewTitle("url");
    const target = computed(() => {
      const value = props.text;
      if (!value || props.className || value.includes("\n")) return null;
      return resolvePreviewTarget(value, store.appState?.workspace?.path ?? null, baseDir.value);
    });
    const position = computed(() =>
      sourcePositionProps({
        "data-source-start": props.dataSourceStart,
        "data-source-end": props.dataSourceEnd,
      }),
    );
    return () => {
      const code = h("code", { class: props.className, ...position.value }, slots.default?.());
      const resolved = target.value;
      if (!resolved) return code;
      return h(
        "button",
        {
          type: "button",
          class: "chat-code-link",
          title: resolved.kind === "file" ? fileTitle : urlTitle,
          onClick: () =>
            resolved.kind === "file"
              ? openFileRef(props.text ?? resolved.path, baseDir.value)
              : openHttpUrl(resolved.url),
        },
        [code],
      );
    };
  },
});

/** Preview-in-panel tooltip for file and URL chat references. */
const Anchor = defineComponent({
  name: "MarkdownAnchor",
  props: {
    href: { type: String, default: undefined },
    title: { type: String, default: undefined },
    dataSourceStart: { type: Number, default: undefined },
    dataSourceEnd: { type: Number, default: undefined },
  },
  setup(props, { slots }) {
    const { t } = useI18n();
    const store = useAppStore();
    const openFileRef = useOpenChatFileRef();
    const baseDir = ref("");

    /*
      A link keeps the renderer's own menu instead of the platform's so both
      destinations the app can send it to stay one press away. The surface is
      the shared pointer-anchored menu, which measures before it reveals,
      clamps inside the viewport, and owns dismissal and arrow-key navigation;
      only the items are link-specific.
    */
    const { contextMenu, openContextMenu, closeContextMenu } = useContextMenu();

    /*
      Copying reports through the toast host: the menu closes the moment the
      item runs, so there is no button left to carry its own copied state.
    */
    async function copyLink(target: string) {
      try {
        await navigator.clipboard.writeText(target);
        store.appState?.showToast(t("settings.linkCopied"), { variant: "success" });
      } catch {
        store.appState?.showToast(t("settings.linkCopyFailed"), { variant: "error" });
      }
    }

    function onContextMenu(event: MouseEvent) {
      const href = props.href;
      if (!href || !/^https?:\/\//i.test(href)) return;
      const target = href;
      openContextMenu(event, {
        items: [
          {
            id: "open-external",
            label: t("settings.linkContextMenuOpenExternal"),
            icon: () => h(IconExternal, { size: 14 }),
            onSelect: () => void api.browserOpenExternal(target),
          },
          {
            id: "open-workpanel",
            label: t("settings.linkContextMenuOpenWorkpanel"),
            icon: () => h(IconGlobe, { size: 14 }),
            onSelect: () => store.appState?.openUrlInWorkPanel(target),
          },
          {
            id: "copy-address",
            label: t("settings.linkContextMenuCopy"),
            icon: () => h(IconCopy, { size: 14 }),
            separatorBefore: true,
            onSelect: () => void copyLink(target),
          },
        ],
      });
    }

    function onClick(event: MouseEvent) {
      const href = props.href;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (!href) return;
      if (/^https?:\/\//i.test(href)) {
        event.preventDefault();
        openHttpUrl(href);
        return;
      }
      const root = store.appState?.workspace?.path ?? null;
      const rel = toWorkspaceRel(safeDecodeUri(href), root, baseDir.value);
      if (rel) {
        event.preventDefault();
        openFileRef(rel, baseDir.value);
      }
    }

    const position = computed(() =>
      sourcePositionProps({
        "data-source-start": props.dataSourceStart,
        "data-source-end": props.dataSourceEnd,
      }),
    );

    return () => [
      h(
        "a",
        {
          href: props.href,
          target: "_blank",
          rel: "noopener noreferrer",
          title: props.title,
          ...position.value,
          onClick,
          onContextMenu,
        },
        slots.default?.(),
      ),
      h(ContextMenu, {
        state: contextMenu.value,
        onClose: closeContextMenu,
      }),
    ];
  },
});

/**
 * Local image references can't load over the renderer origin; the host
 * resolves them into a bounded data URL so they render inline. Missing,
 * escaped, or oversized files fall back to a chip. Remote images render
 * inline and click through to the browser tab.
 */
const MarkdownImage = defineComponent({
  name: "MarkdownMarkdownImage",
  props: {
    src: { type: String, default: undefined },
    alt: { type: String, default: undefined },
    title: { type: String, default: undefined },
    dataSourceStart: { type: Number, default: undefined },
    dataSourceEnd: { type: Number, default: undefined },
  },
  setup(props) {
    const store = useAppStore();
    const openFileRef = useOpenChatFileRef();
    const baseDir = ref("");
    const fileTitle = usePreviewTitle("file");
    const urlTitle = usePreviewTitle("url");

    const source = computed(() => props.src ?? "");
    const isRemote = computed(() => /^https?:/i.test(source.value));
    const decoded = computed(() => safeDecodeUri(source.value));
    const rel = computed(() =>
      isRemote.value
        ? null
        : toWorkspaceRel(decoded.value, store.appState?.workspace?.path ?? null, baseDir.value),
    );
    const attachmentRef = computed(() => {
      const normalized = decoded.value.replace(/\\/g, "/");
      if (isRemote.value) return null;
      return /^attachments\/[0-9a-f]{64}$/i.test(normalized) ? normalized : null;
    });
    const localRef = computed(() => rel.value ?? attachmentRef.value);
    // Always run the composable before any branch so the watcher stays
    // registered when a streaming src flips between remote and local.
    const dataUrl = useReferencedImageDataUrl(() => (isRemote.value ? null : localRef.value));
    const position = computed(() =>
      sourcePositionProps({
        "data-source-start": props.dataSourceStart,
        "data-source-end": props.dataSourceEnd,
      }),
    );

    return () => {
      if (isRemote.value) {
        return h("img", {
          ...position.value,
          src: source.value,
          alt: props.alt ?? "",
          class: "chat-image-remote",
          title: urlTitle,
          onClick: () => openHttpUrl(source.value),
        });
      }
      if (dataUrl.value) {
        return h("img", {
          ...position.value,
          src: dataUrl.value,
          alt: props.alt ?? "",
          class: "chat-image-local",
          title: rel.value ? fileTitle : source.value,
          onClick: localRef.value ? () => openFileRef(localRef.value!, baseDir.value) : undefined,
        });
      }
      if (localRef.value) {
        return h(
          "button",
          {
            type: "button",
            class: "chat-image-chip",
            ...position.value,
            title: fileTitle,
            onClick: () => openFileRef(localRef.value!, baseDir.value),
          },
          [
            h(IconImage, { size: 14, "aria-hidden": "true" }),
            h("span", {}, props.alt || localRef.value.split("/").pop()),
          ],
        );
      }
      return h("img", { ...position.value, src: source.value, alt: props.alt ?? "" });
    };
  },
});

/** Inline audio player for audio URLs in markdown. */
const AudioBlock = defineComponent({
  name: "MarkdownAudioBlock",
  props: {
    src: { type: String, default: undefined },
    controls: { type: Boolean, default: undefined },
    preload: { type: String, default: undefined },
    class: { type: String, default: undefined },
    dataSourceStart: { type: Number, default: undefined },
    dataSourceEnd: { type: Number, default: undefined },
  },
  setup(props) {
    const position = computed(() =>
      sourcePositionProps({
        "data-source-start": props.dataSourceStart,
        "data-source-end": props.dataSourceEnd,
      }),
    );
    return () =>
      h("div", { class: "chat-audio" }, [
        h("audio", {
          controls: true,
          preload: "metadata",
          src: props.src,
          class: props.class,
          ...position.value,
        }),
      ]);
  },
});

/** Inline video player for video URLs in markdown. */
const VideoBlock = defineComponent({
  name: "MarkdownVideoBlock",
  props: {
    src: { type: String, default: undefined },
    controls: { type: Boolean, default: undefined },
    preload: { type: String, default: undefined },
    poster: { type: String, default: undefined },
    class: { type: String, default: undefined },
    dataSourceStart: { type: Number, default: undefined },
    dataSourceEnd: { type: Number, default: undefined },
  },
  setup(props) {
    const position = computed(() =>
      sourcePositionProps({
        "data-source-start": props.dataSourceStart,
        "data-source-end": props.dataSourceEnd,
      }),
    );
    return () =>
      h("div", { class: "chat-video" }, [
        h("video", {
          controls: true,
          preload: "metadata",
          src: props.src,
          poster: props.poster,
          class: props.class,
          ...position.value,
        }),
      ]);
  },
});

const TableBlock = defineComponent({
  name: "MarkdownTable",
  props: {
    dataSourceStart: { type: Number, default: undefined },
    dataSourceEnd: { type: Number, default: undefined },
  },
  setup(props, { slots }) {
    const position = computed(() =>
      sourcePositionProps({
        "data-source-start": props.dataSourceStart,
        "data-source-end": props.dataSourceEnd,
      }),
    );
    return () =>
      h("div", { class: "table-wrap" }, [
        h("table", { ...position.value }, slots.default?.()),
      ]);
  },
});

/* ---------- sanitized DOM to VNodes (rehype-katex + component dispatch) ---------- */

const BOOLEAN_ATTRIBUTES = new Set([
  "checked", "disabled", "open", "selected", "multiple", "controls", "readonly",
  "required", "autofocus", "loop", "muted", "default", "reversed", "scoped",
  "novalidate", "ismap",
]);

const MATH_CLASSES = ["language-math", "math-display", "math-inline"];

function domAttributes(el: Element): Record<string, unknown> {
  const attributes: Record<string, unknown> = {};
  for (const attribute of Array.from(el.attributes)) {
    const name = attribute.name;
    if (name === "data-source-start" || name === "data-source-end") continue;
    if (BOOLEAN_ATTRIBUTES.has(name)) {
      attributes[name] = true;
      continue;
    }
    attributes[name] = attribute.value;
  }
  return attributes;
}

function positionProps(el: Element): SourcePositionProps {
  const start = el.getAttribute("data-source-start");
  const end = el.getAttribute("data-source-end");
  return sourcePositionProps({
    "data-source-start": start === null ? undefined : Number(start),
    "data-source-end": end === null ? undefined : Number(end),
  });
}

function isMathElement(el: Element): boolean {
  return MATH_CLASSES.some((name) => el.classList.contains(name));
}

/** `extractCode` over the rendered `<pre>`: first element child, text only. */
function extractCode(pre: Element): { code: string; lang: string } | null {
  const child = Array.from(pre.children)[0];
  if (!child) return null;
  const className = child.getAttribute("class") ?? "";
  const lang = /language-(\S+)/.exec(className)?.[1] ?? "";
  const parts = Array.from(child.childNodes);
  if (!parts.length || parts.some((part) => part.nodeType !== Node.TEXT_NODE)) return null;
  const code = parts.map((part) => part.nodeValue ?? "").join("");
  return { code: code.replace(/\n$/, ""), lang };
}

/**
 * The `children` prop for the `code` override, or `undefined` when it
 * would not have been a plain string.
 *
 * `hast-util-to-jsx-runtime` collapses a lone child to itself and leaves two or
 * more as an array, so `InlineCode` saw a string only for a `<code>` whose only
 * child was text. Same test here, read off the parsed DOM node.
 */
function inlineCodeText(el: Element): string | undefined {
  const parts = Array.from(el.childNodes);
  if (parts.length !== 1 || parts[0].nodeType !== Node.TEXT_NODE) return undefined;
  return parts[0].nodeValue ?? "";
}

function renderMath(value: string, displayMode: boolean): VNodeChild[] {
  let html: string;
  try {
    html = katex.renderToString(value, { displayMode, throwOnError: true });
  } catch (error) {
    try {
      html = katex.renderToString(value, {
        displayMode,
        strict: "ignore",
        throwOnError: false,
      });
    } catch {
      return [
        h(
          "span",
          { class: "katex-error", style: "color:#cc0000", title: String(error) },
          value,
        ),
      ];
    }
  }
  const template = document.createElement("template");
  template.innerHTML = html;
  return domToVNodes(template.content.childNodes);
}

function elementToVNode(el: Element, ctx: BlockContext): VNodeChild | VNodeChild[] {
  const tag = el.tagName.toLowerCase();

  if (tag === "pre") {
    const code = Array.from(el.children)[0];
    if (code && code.tagName.toLowerCase() === "code" && isMathElement(code)) {
      return renderMath(el.textContent ?? "", true);
    }
    const info = extractCode(el);
    if (info) {
      const position = positionProps(el);
      if (ctx.renderDiagrams && ctx.closedFence && info.lang.toLowerCase() === "mermaid") {
        return h(MermaidBlock, { code: info.code, ...position });
      }
      return h(CodeBlock, { code: info.code, lang: info.lang, ...position });
    }
    // `domAttributes` deliberately drops the anchors so the component branches
    // below can re-attach them to their own root element; the plain `<pre>`
    // fallback has to put them back itself.
    // `<pre {...rest}>` did.
    return h("pre", { ...domAttributes(el), ...positionProps(el) }, domToVNodes(el.childNodes));
  }

  if (isMathElement(el)) {
    return renderMath(el.textContent ?? "", el.classList.contains("math-display"));
  }

  const children = () => domToVNodes(el.childNodes);
  const position = positionProps(el);

  switch (tag) {
    case "code":
      return h(
        InlineCode,
        {
          className: el.getAttribute("class") ?? undefined,
          text: inlineCodeText(el),
          ...position,
        },
        children,
      );
    case "a":
      return h(
        Anchor,
        {
          href: el.getAttribute("href") ?? undefined,
          title: el.getAttribute("title") ?? undefined,
          ...position,
        },
        children,
      );
    case "img":
      return h(
        MarkdownImage,
        {
          src: el.getAttribute("src") ?? undefined,
          alt: el.getAttribute("alt") ?? undefined,
          title: el.getAttribute("title") ?? undefined,
          ...position,
        },
      );
    case "audio":
      return h(AudioBlock, { ...domAttributes(el), ...position });
    case "video":
      return h(VideoBlock, { ...domAttributes(el), ...position });
    case "table":
      return h(TableBlock, position, children);
    default:
      return h(tag, { ...domAttributes(el), ...position }, children);
  }
}

function domToVNodes(nodes: ArrayLike<ChildNode>): VNodeChild[] {
  const out: VNodeChild[] = [];
  for (const node of Array.from(nodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      out.push(node.nodeValue ?? "");
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const converted = elementToVNode(node as Element, currentContext);
    if (Array.isArray(converted)) out.push(...converted);
    else out.push(converted);
  }
  return out;
}

/**
 * The block context the DOM walker is converting for. `elementToVNode` is
 * recursive and the dispatch needs `renderDiagrams` / `closedFence`, so the
 * active context is threaded through here rather than as an extra argument at
 * every call site.
 */
let currentContext: BlockContext = {
  source: "",
  original: "",
  closedFence: false,
  renderDiagrams: true,
  workspaceRoot: null,
  baseDir: undefined,
};

/* ---------- one block ---------- */

const BlockView = defineComponent({
  name: "MarkdownBlock",
  props: {
    raw: { type: String, required: true },
    originalRaw: { type: String, required: true },
    sourceOffset: { type: Number, required: true },
    renderDiagrams: { type: Boolean, required: true },
    workspaceRoot: { type: String as PropType<string | null>, default: null },
    baseDir: { type: String, default: undefined },
  },
  setup(props) {
    return () => {
      const ctx: BlockContext = {
        source: props.raw,
        original: props.originalRaw,
        closedFence: isClosedFencedCodeBlock(props.raw),
        renderDiagrams: props.renderDiagrams,
        workspaceRoot: props.workspaceRoot,
        baseDir: props.baseDir,
      };
      const tree = buildTree({ ...ctx, workspaceRoot: props.workspaceRoot });
      rehypeSourcePositions({ offset: props.sourceOffset })({
        type: "root",
        children: tree,
      } as never);
      currentContext = ctx;
      return domToVNodes(sanitize(serializeNodes(tree)).childNodes);
    };
  },
});

/* ---------- block splitting  ---------- */

function parseBlocks(source: string): string[] {
  const blocks: string[] = [];
  let sourceOffset = 0;
  const hasWindowsLines = source.includes("\r\n");
  for (const token of markdown.lexer(source) as unknown as MarkdownToken[]) {
    if (!token.raw) continue;
    const start = sourceOffset;
    // marked normalizes CRLF before tokenizing. Preserve original slices so
    // parser offsets and incremental block lengths still refer to stored text.
    if (hasWindowsLines) {
      for (let i = 0; i < token.raw.length; i++, sourceOffset++) {
        if (source[sourceOffset] === "\r" && source[sourceOffset + 1] === "\n") sourceOffset++;
      }
    } else {
      sourceOffset += token.raw.length;
    }
    const raw = source.slice(start, sourceOffset);
    // Fold blank-line runs into the previous block so joining blocks
    // reconstructs the source and block boundaries stay append-stable.
    if (token.type === "space" && blocks.length > 0) {
      blocks[blocks.length - 1] += raw;
    } else {
      blocks.push(raw);
    }
  }
  return blocks;
}

/**
 * Incremental re-lex: while streaming appends text, all blocks before the last
 * are settled (markdown blocks never merge backwards across a completed
 * boundary), so only the tail block is re-lexed each frame.
 */
function useBlocks(source: () => string): ComputedRef<string[]> {
  const cache: { consumed: string; blocks: string[] } = { consumed: "", blocks: [] };
  return computed(() => {
    const value = source();
    let stable: string[] = [];
    let tail = value;
    if (
      cache.blocks.length > 0 &&
      value.length >= cache.consumed.length &&
      value.startsWith(cache.consumed)
    ) {
      stable = cache.blocks.slice(0, -1);
      const lastStart = cache.consumed.length - cache.blocks[cache.blocks.length - 1].length;
      tail = value.slice(lastStart);
    }
    const blocks = tail ? [...stable, ...parseBlocks(tail)] : stable;
    cache.consumed = value;
    cache.blocks = blocks;
    return blocks;
  });
}

const MarkdownView = defineComponent({
  name: "Markdown",
  props: {
    source: { type: String, required: true },
    renderDiagrams: { type: Boolean, default: true },
    /** Workspace-relative directory of the source file, for `./` / `../` links. */
    baseDir: { type: String, default: undefined },
  },
  setup(props) {
    const store = useAppStore();
    const workspaceRoot = computed(() => store.appState?.workspace?.path ?? null);
    // Normalize once at the source level: marked's block lexer runs on the raw
    // text and would otherwise split `\[ … \]` display math whose body puts a
    // lone `=`/`-` (setext underline) or `+`/`*` (list marker) on its own line.
    // The rewrite is length-preserving, so blocks still slice the original.
    const normalized = computed(() => normalizeLatexMathDelimiters(props.source));
    const blocks = useBlocks(() => normalized.value);

    return () => {
      const source = props.source;
      let offset = 0;
      return blocks.value.map((raw, index) => {
        const start = offset;
        offset = start + raw.length;
        return h(BlockView, {
          key: index,
          raw,
          originalRaw: source.slice(start, start + raw.length),
          sourceOffset: start,
          renderDiagrams: props.renderDiagrams,
          workspaceRoot: workspaceRoot.value,
          baseDir: props.baseDir,
        });
      });
    };
  },
});


export { MarkdownView as Markdown };
export default MarkdownView;
</script>
