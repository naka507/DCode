<script setup lang="ts">
/**
 * A pointer-anchored context menu for renderer surfaces.
 *
 * `AnchoredMenu` places a surface against a control's rect, which a right-click
 * cannot provide, so this is the pointer-anchored member of the same family. It
 * follows the same rules every other renderer-owned dropdown follows: it
 * teleports to `document.body` as a viewport-fixed layer (a transformed or
 * `overflow: hidden` ancestor cannot trap it), it is measured before it is
 * revealed so it never flashes at the viewport origin, it clamps inside the
 * viewport, and it closes on an outside press, Escape, or a scroll of anything
 * behind it. `is-open` gates visibility because a `visibility: hidden` surface
 * cannot take focus.
 *
 * `useContextMenu()` is exported (it owns the open request)
 * plus a `<ContextMenu state onClose>` component whose items were data carrying
 * their own `onSelect`. The request composable lives in
 * `lib/context-menu-state.ts`; this file is the single surface, and items are
 * still data — `onSelect` receives the selection snapshot taken at open time.
 */
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import {
  placeContextMenu,
  type ContextMenuPlacement,
} from "../lib/context-menu";
import type { ContextMenuState } from "../lib/context-menu-state";

const props = defineProps<{
  state: ContextMenuState | null;
}>();

const emit = defineEmits<{ close: [] }>();

const menuRef = ref<HTMLElement | null>(null);
const placement = ref<ContextMenuPlacement | null>(null);
let restoreFocus: HTMLElement | null = null;
let focusFrame = 0;
let observer: ResizeObserver | null = null;

/**
 * Measured before reveal so the first paint is already the final position.
 * Content that resizes after reveal (a longer label, a late font) is
 * re-clamped rather than left hanging past the edge.
 */
function measure(): void {
  const menu = menuRef.value;
  const state = props.state;
  if (!menu || !state) return;
  const rect = menu.getBoundingClientRect();
  const next = placeContextMenu(
    state.point,
    { width: rect.width, height: rect.height },
    { width: window.innerWidth, height: window.innerHeight },
  );
  const previous = placement.value;
  if (previous && previous.top === next.top && previous.left === next.left) {
    return;
  }
  placement.value = next;
}

function focusFirstItem(): void {
  focusFrame = requestAnimationFrame(() => {
    menuRef.value
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
      ?.focus();
  });
}

function releaseSurface(): void {
  placement.value = null;
  observer?.disconnect();
  observer = null;
  cancelAnimationFrame(focusFrame);
  // Focus returns to whatever the right-click interrupted, so closing never
  // strands focus on `<body>`.
  if (restoreFocus?.isConnected) restoreFocus.focus();
  restoreFocus = null;
}

/**
 * Bind the listeners, measure, and place focus once per open.
 *
 * The earlier implementation spread this over four `useEffect`/`useLayoutEffect` hooks; one
 * watcher over the open state is the same contract, and the `nextTick` is what
 * makes it a layout-effect equivalent: the surface is in the DOM before it is
 * measured, so the reveal and the final position land in the same paint.
 */
watch(
  () => props.state,
  async (state) => {
    if (!state) {
      releaseSurface();
      return;
    }
    if (!restoreFocus) {
      restoreFocus =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    }
    await nextTick();
    measure();
    const menu = menuRef.value;
    if (!menu) return;
    observer?.disconnect();
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => measure());
      observer.observe(menu);
    }
    focusFirstItem();
  },
);

function onOutside(event: Event): void {
  const target = event.target as Node | null;
  if (target && menuRef.value?.contains(target)) return;
  emit("close");
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  // Stop so a surrounding overlay does not also close on this Escape.
  event.preventDefault();
  event.stopPropagation();
  emit("close");
}

/**
 * Tab leaves the menu rather than walking its items; the arrows, Home and End
 * move focus, so the hover fill has to follow focus or the active row is
 * invisible.
 */
function onMenuKeyDown(event: KeyboardEvent): void {
  if (event.key === "Tab") {
    emit("close");
    return;
  }
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const items = Array.from(
    (event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]:not(:disabled)',
    ),
  );
  if (!items.length) return;
  event.preventDefault();
  const current = items.indexOf(document.activeElement as HTMLButtonElement);
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
          items.length;
  items[next]?.focus();
}

function runItem(id: string): void {
  const state: ContextMenuState | null = props.state;
  const item = state?.items.find((candidate) => candidate.id === id);
  if (!state || !item) return;
  // Close first: an item that opens a dialog must not leave a menu layered
  // over it.
  emit("close");
  item.onSelect(state.selection);
}

function onMenuContextMenu(event: MouseEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

/*
  Capture phase on purpose: a nested surface that stops propagation on its own
  press would otherwise leave this menu open behind it.
*/
window.addEventListener("pointerdown", onOutside, true);
window.addEventListener("contextmenu", onOutside, true);
window.addEventListener("scroll", onOutside, true);
window.addEventListener("resize", onOutside);
window.addEventListener("blur", onOutside);
window.addEventListener("keydown", onKeyDown, true);

onBeforeUnmount(() => {
  observer?.disconnect();
  cancelAnimationFrame(focusFrame);
  window.removeEventListener("pointerdown", onOutside, true);
  window.removeEventListener("contextmenu", onOutside, true);
  window.removeEventListener("scroll", onOutside, true);
  window.removeEventListener("resize", onOutside);
  window.removeEventListener("blur", onOutside);
  window.removeEventListener("keydown", onKeyDown, true);
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="props.state"
      ref="menuRef"
      class="context-menu"
      :class="{ 'is-open': placement }"
      role="menu"
      :aria-label="props.state.label"
      :style="
        placement
          ? { top: `${placement.top}px`, left: `${placement.left}px` }
          : undefined
      "
      @keydown="onMenuKeyDown"
      @contextmenu="onMenuContextMenu"
    >
      <template v-for="(item, index) in props.state.items" :key="item.id">
        <div
          v-if="item.separatorBefore && index > 0"
          class="context-menu-separator"
          role="separator"
        />
        <button
          type="button"
          role="menuitem"
          class="context-menu-item"
          :class="{ danger: item.danger }"
          :data-context-menu-item="item.id"
          :disabled="item.disabled"
          @click="runItem(item.id)"
        >
          <span v-if="item.icon" class="context-menu-icon" aria-hidden="true">
            <component :is="item.icon" />
          </span>
          <span class="context-menu-label">{{ item.label }}</span>
        </button>
      </template>
    </div>
  </Teleport>
</template>
