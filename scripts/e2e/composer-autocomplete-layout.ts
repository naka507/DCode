/**
 * Composer slash-menu layout fixture (E2E-088b) for the Vue renderer.
 *
 * The components are Vue 3 SFCs, so the probe is assembled with `createApp` /
 * `h`, and the app's own vue-i18n instance (`src/renderer/i18n.ts`) is installed
 * rather than a private i18next instance.
 *
 * Every adaptation is an API bridge, not a weakened check:
 *
 *  1. **`anchorRef` is an `AnchorSource`.** `ComposerAutocomplete.vue` accepts a
 *     ref, a getter, the element, or null. The template ref object is handed over
 *     unchanged; the component resolves it with `isRef`.
 *  2. **`ac` is the `ComposerAutocompleteController`** — a plain object of
 *     `ComputedRef`s (`use-composer-autocomplete.ts`). A Vue render function needs
 *     the object to stay identical and its refs to change instead, so
 *     `items`/`mode` are computed from a `view` cell the probe drives.
 *  3. **State writes commit asynchronously.** `await nextTick()` is the way to
 *     await that commit, and it is used at every site that needs the just-written
 *     state visible. The settle sequence itself — `document.fonts.ready`, a
 *     double `requestAnimationFrame`, waiting on `document.getAnimations()`, then
 *     settling again — is unchanged, so the timing assertions keep the same
 *     meaning.
 *  4. **`onAccept` is the component's `accept` emit**, wired through `h` as
 *     `onAccept`, matching the callback prop the component declares.
 */
import { computed, createApp, h, nextTick, reactive, ref } from "vue";
import { i18n } from "../../src/renderer/i18n";
import ComposerAutocomplete from "../../src/renderer/components/ComposerAutocomplete.vue";
import type {
  AutocompleteItem,
  ComposerAutocompleteController,
} from "../../src/renderer/hooks/use-composer-autocomplete";

const host = document.createElement("div");
document.body.append(host);
const anchorRef = ref<HTMLTextAreaElement | null>(null);
const view = reactive({ width: 320, fileMode: false });
const noop = () => {};
let accepted = -1;
const command = (
  name: string,
  description?: string,
  extra: Record<string, unknown> = {},
): AutocompleteItem => ({
  kind: "command",
  command: { name, title: name, kind: "skill", description, ...extra },
  match: { score: 1, ranges: [[0, 2]] },
});
const longDescription =
  "Review the codebase, find regressions, and propose focused fixes. ".repeat(
    16,
  );
const items: AutocompleteItem[] = [
  command("caveman", longDescription),
  command("qa-agent", "审查代码并验证功能。".repeat(80)),
  command("short", "Brief description"),
  command("bare"),
  command("review", longDescription, {
    title: "Code review",
    argumentHint: "<path>",
  }),
  command("template", longDescription, {
    kind: "template",
    argumentHint: "<file>",
  }),
  command("very-long-command-".repeat(20), longDescription),
];
/** The probe's `ac`: stable identity, ref-driven contents. See note 2. */
const ac: ComposerAutocompleteController = {
  open: computed(() => true),
  mode: computed(() => (view.fileMode ? "file" : "slash")),
  query: computed(() => ""),
  items: computed<AutocompleteItem[]>(() =>
    view.fileMode
      ? [
          {
            kind: "path",
            entry: {
              path: `nested/${"long-file-name-".repeat(30)}.ts`,
              kind: "file",
            },
            match: { score: 1, ranges: [] },
          },
        ]
      : items,
  ),
  hasItems: computed(() => true),
  highlight: ref(0),
  setHighlight: noop,
  truncated: computed(() => false),
  noWorkspace: computed(() => false),
  close: noop,
  accept: () => null,
};
const app = createApp({
  render: () => [
    h("textarea", {
      ref: anchorRef,
      "aria-label": "Composer",
      value: "/",
      style: {
        position: "absolute",
        left: "24px",
        top: "520px",
        width: `${view.width}px`,
        height: "60px",
      },
    }),
    h(ComposerAutocomplete, {
      anchorRef,
      ac,
      onAccept: (index: number) => {
        accepted = index;
      },
    }),
  ],
});
app.use(i18n);
app.mount(host);
const settle = async () => {
  await document.fonts.ready;
  await new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );
};
declare global {
  var autocompleteLayoutProbe: (
    width: number,
    fileMode?: boolean,
  ) => Promise<unknown>;
}
globalThis.autocompleteLayoutProbe = async (width, fileMode = false) => {
  // A just-written view has to be visible before measuring; `nextTick()` does that.
  view.width = width;
  view.fileMode = fileMode;
  await nextTick();
  await settle();
  await Promise.all(
    document.getAnimations().map((animation) => animation.finished.catch(() => {})),
  );
  await settle();
  const input = document.querySelector("textarea")!;
  input.focus();
  const menu = document.querySelector<HTMLElement>(".composer-autocomplete")!;
  const rows = [...document.querySelectorAll<HTMLElement>(".composer-ac-item")];
  const measurements = rows.map((row) => {
    const name = row.querySelector<HTMLElement>(".composer-ac-name")!;
    const desc = row.querySelector<HTMLElement>(".composer-ac-desc");
    return {
      name: name.textContent,
      nameWidth: name.clientWidth,
      nameContent: name.scrollWidth,
      descriptionWidth: desc?.clientWidth,
      descriptionContent: desc?.scrollWidth,
      rowWidth: row.clientWidth,
      rowContent: row.scrollWidth,
    };
  });
  const failures: string[] = [];
  if (getComputedStyle(rows[0]).display !== "flex")
    failures.push("production row styles missing");
  if (
    getComputedStyle(menu).visibility !== "visible" ||
    getComputedStyle(menu).opacity !== "1"
  )
    failures.push("menu is not visible");
  if (Math.abs(menu.getBoundingClientRect().width - width) > 1)
    failures.push("menu lost anchor width");
  for (const [index, row] of measurements.entries()) {
    if (row.rowContent > row.rowWidth + 1) failures.push(`row ${index} overflows`);
    if (!fileMode && index < items.length - 1 && row.nameContent > row.nameWidth + 1)
      failures.push(`command ${row.name} is truncated`);
    if (
      !fileMode &&
      [0, 1, 4, 5].includes(index) &&
      !(row.descriptionContent! > row.descriptionWidth!)
    )
      failures.push(`long description ${index} is not truncated`);
  }
  const oversizedName = measurements[fileMode ? 0 : measurements.length - 1];
  if (oversizedName.nameContent <= oversizedName.nameWidth)
    failures.push("oversized name no longer truncates");
  if (fileMode && measurements[0].nameWidth < width - 70)
    failures.push("file name no longer uses available width");
  accepted = -1;
  rows[0].dispatchEvent(
    new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
  );
  if (accepted !== 0 || document.activeElement !== input)
    failures.push("acceptance lost row identity or input focus");
  if (
    !fileMode &&
    rows[0].querySelector(".composer-ac-hl")?.textContent !== "ca"
  )
    failures.push("name highlight lost");
  return {
    ok: failures.length === 0,
    width,
    viewport: innerWidth,
    fileMode,
    measurements,
    failures,
  };
};
