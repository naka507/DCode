<script setup lang="ts">
/**
 * A trigger-anchored floating menu for renderer surfaces.
 *
 * Settings cards clip their overflow (`.settings-panel` draws the frame with
 * `overflow: hidden`), so an anchored surface cannot be an absolutely
 * positioned child: it teleports to `document.body` as a fixed layer and is
 * placed from the trigger's rect. The placement, close and reposition rules
 * follow the font picker, which solved the same problem first.
 *
 * The menu is measured before it is revealed, so `is-open` gates visibility:
 * a `visibility: hidden` surface cannot take focus, and an unmeasured one
 * would flash at the viewport origin.
 *
 * The trigger is a scoped slot rather than a render prop: a Vue template cannot
 * return markup from a composable, so the slot hands the caller `setAnchor` — a
 * function ref accepting either the element itself or a component instance
 * (whose `$el` is the anchor).
 */
import { computed, ref, watch } from "vue";

const MARGIN = 8;
const GAP = 6;

const props = withDefaults(
  defineProps<{
    open: boolean;
    /** Class for the portaled surface; `is-open` is added once measured. */
    menuClassName: string;
    label: string;
    role?: "listbox" | "menu" | "dialog";
    /** Extra class for the row-level wrapper that owns the trigger. */
    className?: string;
    /** Aligns the menu's right edge with the trigger's; defaults to left. */
    align?: "start" | "end";
    /**
     * Where to put focus after the menu is measured. `selected` keeps Enter on
     * the current option (default-model picker). `input` is for searchable menus.
     */
    initialFocus?: "selected" | "input" | "none";
    /** Prefer opening above the anchor for composer-style bottom docks. */
    side?: "top" | "bottom";
    /** Keep the surface the same width as the anchor, e.g. autocomplete. */
    matchAnchorWidth?: boolean;
    /**
     * When false, closing does not move focus back to the trigger. Used when a
     * selection just revealed another field that should take focus instead.
     */
    restoreFocus?: boolean;
    /**
     * External anchor for surfaces that render no trigger here
     * (`ComposerAutocomplete` anchors on the composer shell). It wins over the
     * `setAnchor` slot ref when both are present.
     */
    anchor?: HTMLElement | null;
  }>(),
  {
    role: "listbox",
    className: undefined,
    align: "start",
    initialFocus: "selected",
    side: "bottom",
    matchAnchorWidth: false,
    restoreFocus: true,
    anchor: null,
  },
);

const emit = defineEmits<{
  close: [];
  "menu-keydown": [event: KeyboardEvent];
}>();

const rootRef = ref<HTMLElement | null>(null);
const triggerEl = ref<HTMLElement | null>(null);
const menuRef = ref<HTMLElement | null>(null);
const position = ref<{ top: number; left: number; width?: number } | null>(null);
/** Focus is placed once per open, not on every reposition. */
const focusDone = ref(false);

/** The anchor is the explicit prop when given, otherwise the trigger slot. */
function anchorEl(): HTMLElement | null {
  return props.anchor ?? triggerEl.value;
}

/**
 * Function ref for the trigger.
 *
 * A component trigger whose root is a fragment (`TooltipButton` renders its
 * anchor plus a teleported label) reports the fragment's start anchor as
 * `$el`, so the real trigger is the first element node after it. A single
 * element root, and a plain element, are used as they are.
 */
function setAnchor(value: unknown) {
  if (value instanceof HTMLElement) {
    triggerEl.value = value;
    return;
  }
  const element = (value as { $el?: unknown } | null)?.$el;
  if (element instanceof HTMLElement) {
    triggerEl.value = element;
    return;
  }
  const sibling =
    element instanceof Node ? (element as CharacterData).nextElementSibling : null;
  triggerEl.value = sibling instanceof HTMLElement ? sibling : null;
}

const menuStyle = computed(() => {
  const next = position.value;
  if (!next) return undefined;
  return {
    top: `${next.top}px`,
    left: `${next.left}px`,
    ...(next.width === undefined ? {} : { width: `${next.width}px` }),
  };
});

function updatePosition() {
  const anchor = anchorEl();
  const menu = menuRef.value;
  if (!anchor || !menu) return;
  const anchorRect = anchor.getBoundingClientRect();
  // A trigger scrolled out of the settings viewport has no sensible anchor.
  if (anchorRect.bottom <= 0 || anchorRect.top >= window.innerHeight) {
    emit("close");
    return;
  }
  const menuRect = menu.getBoundingClientRect();
  const width = props.matchAnchorWidth ? anchorRect.width : undefined;
  const surfaceWidth = width ?? menuRect.width;
  const maxLeft = Math.max(MARGIN, window.innerWidth - surfaceWidth - MARGIN);
  const preferredLeft =
    props.align === "end" ? anchorRect.right - surfaceWidth : anchorRect.left;
  const left = Math.min(Math.max(MARGIN, preferredLeft), maxLeft);
  const below = anchorRect.bottom + GAP;
  const above = anchorRect.top - menuRect.height - GAP;
  const maxTop = Math.max(MARGIN, window.innerHeight - menuRect.height - MARGIN);
  const preferredTop = props.side === "top" ? above : below;
  const fallbackTop = props.side === "top" ? below : above;
  const preferredFits = preferredTop >= MARGIN && preferredTop <= maxTop;
  const fallbackFits = fallbackTop >= MARGIN && fallbackTop <= maxTop;
  const top = preferredFits
    ? preferredTop
    : fallbackFits
      ? fallbackTop
      : Math.min(Math.max(MARGIN, preferredTop), maxTop);
  const previous = position.value;
  if (
    previous &&
    previous.top === top &&
    previous.left === left &&
    previous.width === width
  ) {
    return;
  }
  position.value = { top, left, width };
}

let frame: number | null = null;
function schedulePosition() {
  if (frame !== null) window.cancelAnimationFrame(frame);
  frame = window.requestAnimationFrame(() => {
    frame = null;
    updatePosition();
  });
}

// `useLayoutEffect` semantics: measure before the browser paints the surface.
watch(
  () => [props.open, props.align, props.side, props.matchAnchorWidth] as const,
  () => {
    if (props.open) schedulePosition();
  },
  { immediate: true, flush: "post" },
);

watch(
  () => props.open,
  (open) => {
    if (open) return;
    position.value = null;
    focusDone.value = false;
  },
);

// Closing returns focus to the trigger so Tab order does not jump to <body>.
watch(
  () => props.open,
  (open) => {
    if (open) return;
    if (props.restoreFocus) anchorEl()?.focus();
  },
  { flush: "post" },
);

watch(
  () => props.open,
  (open, _previous, onCleanup) => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !rootRef.value?.contains(target) &&
        !anchorEl()?.contains(target) &&
        !menuRef.value?.contains(target)
      ) {
        emit("close");
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Capture + stop so a parent overlay (add-provider dialog) does not
      // close on the same Escape that dismisses this menu.
      event.preventDefault();
      event.stopPropagation();
      emit("close");
    };
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey, true);
    onCleanup(() => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey, true);
    });
  },
);

let observer: ResizeObserver | null = null;
watch(
  () => [props.open, menuRef.value, triggerEl.value, props.anchor] as const,
  () => {
    observer?.disconnect();
    observer = null;
    if (!props.open || typeof ResizeObserver === "undefined") return;
    observer = new ResizeObserver(() => updatePosition());
    if (menuRef.value) observer.observe(menuRef.value);
    const anchor = anchorEl();
    if (anchor) observer.observe(anchor);
  },
  { flush: "post" },
);

/*
  Move focus into the menu once it is measured and visible: a keyboard user
  who opened it would otherwise still be on the trigger, and a
  `visibility: hidden` surface cannot take focus. The current option is
  preferred so Enter re-confirms rather than silently picking the first row;
  searchable menus opt into the filter field instead.
*/
watch(
  () => [props.open, position.value, props.initialFocus, props.anchor] as const,
  () => {
    if (!props.open || !position.value || focusDone.value) return;
    if (props.initialFocus === "none") {
      focusDone.value = true;
      return;
    }
    focusDone.value = true;
    window.requestAnimationFrame(() => {
      const menu = menuRef.value;
      if (!menu) return;
      if (props.initialFocus === "input") {
        menu.querySelector<HTMLElement>("input:not([disabled])")?.focus();
        return;
      }
      const current = menu.querySelector<HTMLElement>(
        '[aria-selected="true"]:not([disabled])',
      );
      const target =
        current ?? menu.querySelector<HTMLElement>("button:not([disabled])");
      target?.focus();
    });
  },
  { flush: "post" },
);

watch(
  () => props.open,
  (open, _previous, onCleanup) => {
    if (!open) return;
    const onViewportChange = (event: Event) => {
      // Scrolling inside the menu cannot move a fixed layer, so skip it rather
      // than forcing a layout read on every scroll tick.
      const target = event.target as Node | null;
      if (target && menuRef.value?.contains(target)) return;
      updatePosition();
    };
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    onCleanup(() => {
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    });
  },
);
</script>

<template>
  <div ref="rootRef" :class="className">
    <slot name="trigger" :set-anchor="setAnchor" />
    <Teleport v-if="open" to="body">
      <div
        ref="menuRef"
        :class="[menuClassName, position ? 'is-open' : '']"
        :role="role"
        :aria-label="label"
        :style="menuStyle"
        @keydown="emit('menu-keydown', $event)"
      >
        <slot />
      </div>
    </Teleport>
  </div>
</template>
