<script setup lang="ts">
/**
 * Global UI font picker (Settings → Basics → Appearance). Offers the
 * system default and installed system families; the app bundles no fonts of
 * its own. The selected stack is persisted as `AppSettings.fontFamily`
 * and applied to `--font-sans` by App. Selecting the localized system-default
 * option persists an empty stack, which every consumer treats as the built-in
 * token stack. The closed trigger and search haystack use
 * `settings.fontSystemDefault` so the English catalog label in `fonts.ts` never
 * reaches the UI.
 *
 * The `FontFamilyRow` component. Despite its
 * size it is one component: the 440 lines are the virtual-scrolling menu, and
 * the module exports nothing else, so there is no framework-free half to split
 * out (the layout algebra already lives in `lib/font-list.ts`).
 *
 * Deliberate choices:
 *  - The menu is teleported to `document.body` with `<Teleport to="body">`. It is
 * `v-if`-gated on `open`, so it is inserted and removed exactly when the portal
 *    is mounted and unmounted.
 * - A post-flush `watch` runs after
 *    the DOM update, which is when the menu has a measurable box; `immediate`
 *    keeps the first open measured like the initial layout pass.
 *  - Every effect dependency array becomes the `watch` source tuple, and
 *    the returned cleanup is the watch's `onCleanup` (which Vue also runs on
 *    unmount), so the listeners are torn down on unmount.
 *  - The two `useRef` values nothing renders (`viewportRef`, `scrollFrameRef`)
 *    are plain `let` bindings.
 *  - `` `settings-font-menu${menuPosition ? " is-open" : ""}` `` becomes a static
 *    `class` plus an object `:class`, and the item's joined array becomes the
 *    same pair, so the class contract reads real names instead of a glued
 *    fragment.
 *  - `onKeyDown` receives the DOM `KeyboardEvent`.
 *
 * `settings-font-viewport` is a literal class in the markup that
 * neither stylesheet ever defined; it is allowlisted for this file in
 * `tests/helpers/class-contract.mjs`.
 */
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { AppSettings } from "@dcode/shared";
import {
  buildFontOptions,
  loadSystemFonts,
  readableFontFamily,
} from "../../lib/fonts";
import {
  buildFontListLayout,
  FONT_GROUP_ROW_HEIGHT,
  FONT_OPTION_ROW_HEIGHT,
  visibleRowRange,
  type FontListRow,
} from "../../lib/font-list";
import { IconCheck, IconChevronDown, IconSearch } from "../../lib/icons";

const props = defineProps<{
  settings: AppSettings;
  saveSettings: (patch: Partial<AppSettings>) => Promise<void>;
}>();

const { t } = useI18n();

const open = ref(false);
const query = ref("");
const systemFonts = ref<string[] | null>(null);
const loadError = ref(false);
const highlight = ref(-1);
const menuPosition = ref<{ top: number; left: number } | null>(null);
const rootRef = ref<HTMLDivElement | null>(null);
const triggerRef = ref<HTMLButtonElement | null>(null);
const menuRef = ref<HTMLDivElement | null>(null);
const searchRef = ref<HTMLInputElement | null>(null);
const listRef = ref<HTMLDivElement | null>(null);
const scrollTop = ref(0);

/* See note 4: nothing renders these two, so they are plain bindings. */
let viewportHeight = 320;
let scrollFrame = 0;

function closeMenu() {
  open.value = false;
  menuPosition.value = null;
}

onMounted(() => {
  let cancelled = false;
  void loadSystemFonts()
    .then((fonts) => {
      if (!cancelled) systemFonts.value = fonts;
    })
    .catch(() => {
      if (!cancelled) loadError.value = true;
    });
  onUnmounted(() => {
    cancelled = true;
  });
});

/* Outside pointer and Escape close the menu while it is open. */
watch(open, (isOpen, _previous, onCleanup) => {
  if (!isOpen) return;
  const onPointer = (event: MouseEvent) => {
    const target = event.target as Node;
    if (
      !rootRef.value?.contains(target) &&
      !menuRef.value?.contains(target)
    ) {
      closeMenu();
    }
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") closeMenu();
  };
  window.addEventListener("mousedown", onPointer);
  window.addEventListener("keydown", onKey);
  onCleanup(() => {
    window.removeEventListener("mousedown", onPointer);
    window.removeEventListener("keydown", onKey);
  });
});

watch(open, (isOpen) => {
  if (isOpen) query.value = "";
});

// Focus only once the portaled menu is measured and revealed; a hidden
// (visibility: hidden) menu cannot receive focus.
watch(
  () => [open.value, menuPosition.value] as const,
  () => {
    if (!open.value || !menuPosition.value) return;
    requestAnimationFrame(() => searchRef.value?.focus());
  },
);

function updateMenuPosition() {
  const trigger = triggerRef.value;
  const menu = menuRef.value;
  if (!trigger || !menu) return;
  const triggerRect = trigger.getBoundingClientRect();
  const triggerVisible =
    triggerRect.bottom > 0 && triggerRect.top < window.innerHeight;
  if (!triggerVisible) {
    closeMenu();
    return;
  }
  const menuRect = menu.getBoundingClientRect();
  const margin = 8;
  const gap = 6;
  const maxLeft = Math.max(
    margin,
    window.innerWidth - menuRect.width - margin,
  );
  const left = Math.min(Math.max(margin, triggerRect.left), maxLeft);
  const below = triggerRect.bottom + gap;
  const above = triggerRect.top - menuRect.height - gap;
  const maxTop = Math.max(
    margin,
    window.innerHeight - menuRect.height - margin,
  );
  const top =
    below <= maxTop
      ? Math.max(margin, below)
      : above >= margin
        ? above
        : Math.min(below, maxTop);
  const previous = menuPosition.value;
  menuPosition.value =
    previous && previous.top === top && previous.left === left
      ? previous
      : { top, left };
}

const options = computed(() =>
  buildFontOptions(systemFonts.value ?? [], props.settings.fontFamily),
);
const selectedValue = computed(() => props.settings.fontFamily ?? "");
const selectedOption = computed(
  () => options.value.find((option) => option.value === selectedValue.value) ?? null,
);
const defaultLabel = computed(() => t("settings.fontSystemDefault"));
const selectedLabel = computed(() =>
  selectedOption.value?.group === "default" || selectedValue.value === ""
    ? defaultLabel.value
    : (selectedOption.value?.label ?? readableFontFamily(props.settings.fontFamily ?? "")),
);
const selectedFamily = computed(
  () => selectedOption.value?.family ?? readableFontFamily(selectedValue.value),
);

const filtered = computed(() => {
  const needle = query.value.trim().toLowerCase();
  if (!needle) return options.value;
  return options.value.filter((option) => {
    const haystack =
      option.group === "default"
        ? `${defaultLabel.value} ${option.label}`.toLowerCase()
        : option.label.toLowerCase();
    return haystack.includes(needle);
  });
});

function groupLabel(group: string) {
  if (group === "system") return t("settings.fontSystem");
  if (group === "custom") return t("settings.fontCustom");
  return t("settings.fontSystemDefault");
}

const layout = computed(() => buildFontListLayout(filtered.value, groupLabel));
const visibleRange = computed(() =>
  visibleRowRange(layout.value, scrollTop.value, viewportHeight),
);

// The windowed rows are absolutely positioned inside the viewport box, so every
// one of these offsets is a length. Vue writes them to CSSOM verbatim and
// CSSOM drops a unitless length silently, which would stack every row at the
// top of the list.
const viewportStyle = computed(() => ({
  height: `${layout.value.totalHeight}px`,
  position: "relative" as const,
}));

const groupRowStyle = (row: FontListRow) => ({
  position: "absolute" as const,
  top: `${layout.value.offsets[row.index]}px`,
  left: "6px",
  right: "6px",
  height: `${FONT_GROUP_ROW_HEIGHT}px`,
});

const optionRowStyle = (row: FontListRow, family: string) => ({
  position: "absolute" as const,
  top: `${layout.value.offsets[row.index]}px`,
  left: "6px",
  right: "6px",
  height: `${FONT_OPTION_ROW_HEIGHT}px`,
  fontFamily: family || undefined,
});

watch(
  () => [open.value, filtered.value, systemFonts.value] as const,
  (_next, _previous, onCleanup) => {
    if (!open.value) return;
    const frame = window.requestAnimationFrame(updateMenuPosition);
    onCleanup(() => window.cancelAnimationFrame(frame));
  },
  { immediate: true, flush: "post" },
);

watch(open, (isOpen, _previous, onCleanup) => {
  if (!isOpen) return;
  const onViewportChange = (event: Event) => {
    // Scrolling inside the font list cannot move the fixed menu; skip it
    // so the handler does not force a layout read on every scroll tick.
    const target = event.target as Node | null;
    if (target && menuRef.value?.contains(target)) return;
    updateMenuPosition();
  };
  window.addEventListener("resize", onViewportChange);
  window.addEventListener("scroll", onViewportChange, true);
  onCleanup(() => {
    window.removeEventListener("resize", onViewportChange);
    window.removeEventListener("scroll", onViewportChange, true);
  });
});

watch(
  () => [open.value, filtered.value, selectedValue.value] as const,
  () => {
    if (!open.value) return;
    const index = filtered.value.findIndex(
      (option) => option.value === selectedValue.value,
    );
    highlight.value = index >= 0 ? index : 0;
  },
);

watch(
  () => [open.value, filtered.value] as const,
  () => {
    if (!open.value) return;
    scrollTop.value = 0;
    if (listRef.value) listRef.value.scrollTop = 0;
  },
);

watch(open, (isOpen) => {
  if (!isOpen) return;
  const list = listRef.value;
  if (list) viewportHeight = list.clientHeight || 320;
});

// Scroll the highlighted option into the rendered window. The window only
// holds visible rows, so the old querySelector + scrollIntoView approach
// cannot reach off-window rows; offsets make the jump exact instead.
watch(
  () => [open.value, highlight.value, layout.value] as const,
  () => {
    if (!open.value || highlight.value < 0) return;
    const list = listRef.value;
    if (!list) return;
    const rowIndex = layout.value.optionRowIndex[highlight.value];
    if (rowIndex === undefined) return;
    const top = layout.value.offsets[rowIndex]!;
    const height = layout.value.heights[rowIndex]!;
    const viewport = viewportHeight || list.clientHeight || 320;
    if (top < list.scrollTop) {
      list.scrollTop = top;
    } else if (top + height > list.scrollTop + viewport) {
      list.scrollTop = top + height - viewport;
    }
  },
);

onUnmounted(() => {
  if (scrollFrame) cancelAnimationFrame(scrollFrame);
});

function onListScroll() {
  const list = listRef.value;
  if (!list) return;
  viewportHeight = list.clientHeight || 320;
  if (scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0;
    setScrollTop(list.scrollTop);
  });
}

/* Split out so the rAF callback above reads the same state setter the original used. */
function setScrollTop(value: number) {
  scrollTop.value = value;
}

async function selectOption(value: string) {
  closeMenu();
  try {
    await props.saveSettings(value ? { fontFamily: value } : { fontFamily: "" });
  } catch {
    // The generic settings row treats save failures as transient; the
    // store is only updated on success.
  }
}

function onKeyDown(event: KeyboardEvent) {
  if (!open.value) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    if (!filtered.value.length) return;
    const delta = event.key === "ArrowDown" ? 1 : -1;
    const current = highlight.value;
    highlight.value =
      current < 0
        ? delta > 0
          ? 0
          : filtered.value.length - 1
        : (current + delta + filtered.value.length) % filtered.value.length;
  } else if (event.key === "Enter") {
    const target = event.target as HTMLElement;
    if (target.tagName === "BUTTON") return;
    const option = filtered.value[highlight.value];
    if (option) {
      event.preventDefault();
      void selectOption(option.value);
    }
  }
}
</script>

<template>
  <div class="settings-row">
    <div class="settings-row-copy">
      <div class="settings-row-title">{{ t("settings.font") }}</div>
    </div>
    <div class="settings-row-control">
      <div ref="rootRef" class="settings-font" @keydown="onKeyDown">
        <button
          ref="triggerRef"
          type="button"
          class="settings-font-trigger"
          aria-haspopup="listbox"
          :aria-expanded="open"
          @click="open = !open"
        >
          <span
            class="settings-font-trigger-label"
            :style="{ fontFamily: selectedFamily || undefined }"
          >
            {{ selectedLabel }}
          </span>
          <IconChevronDown :size="14" />
        </button>
        <Teleport v-if="open" to="body">
          <div
            ref="menuRef"
            class="settings-font-menu"
            :class="{ 'is-open': menuPosition }"
            role="listbox"
            :aria-label="t('settings.font')"
            :style="
              menuPosition
                ? { top: `${menuPosition.top}px`, left: `${menuPosition.left}px` }
                : undefined
            "
            @keydown="onKeyDown"
          >
            <div class="settings-font-search">
              <IconSearch :size="13" />
              <input
                ref="searchRef"
                type="text"
                :value="query"
                :placeholder="t('settings.fontSearchPlaceholder')"
                spellcheck="false"
                autocorrect="off"
                autocapitalize="off"
                @input="query = ($event.target as HTMLInputElement).value"
              />
            </div>
            <div v-if="loadError && !systemFonts" class="settings-font-empty">
              {{ t("settings.fontLoadError") }}
            </div>
            <div v-else-if="filtered.length === 0" class="settings-font-empty">
              {{ t("settings.noResults") }}
            </div>
            <div v-else ref="listRef" class="settings-font-list" @scroll="onListScroll">
              <div
                class="settings-font-viewport"
                :style="viewportStyle"
              >
                <template
                  v-for="row in layout.rows.slice(visibleRange.start, visibleRange.end)"
                  :key="row.id"
                >
                  <div
                    v-if="row.kind === 'group'"
                    class="settings-font-group-label"
                    :style="groupRowStyle(row)"
                  >
                    {{ row.label }}
                  </div>
                  <button
                    v-else
                    type="button"
                    role="option"
                    :aria-selected="row.option.value === selectedValue"
                    :data-font-index="row.optionIndex"
                    class="settings-font-item"
                    :class="{
                      'kb-active': row.optionIndex === highlight,
                      active: row.option.value === selectedValue,
                    }"
                    :style="optionRowStyle(row, row.option.family)"
                    @click="void selectOption(row.option.value)"
                    @mouseenter="highlight = row.optionIndex"
                  >
                    <span class="settings-font-item-label">
                      {{
                        row.option.group === "default"
                          ? t("settings.fontSystemDefault")
                          : row.option.label
                      }}
                    </span>
                    <IconCheck
                      v-if="row.option.value === selectedValue"
                      :size="14"
                      class="settings-font-check"
                    />
                  </button>
                </template>
              </div>
            </div>
          </div>
        </Teleport>
      </div>
    </div>
  </div>
</template>
