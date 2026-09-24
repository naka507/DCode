/**
 * The open request for the pointer-anchored context menu.
 *
 * The context-menu state lives outside the component that renders it: it owns
 * `useState<ContextMenuState | null>`, returns `{ contextMenu, openContextMenu,
 * closeContextMenu }`, and normalized the event (preventDefault + stopPropagation,
 * pointer-or-focus anchoring, selection snapshot) so no call site could forget
 * one of the three. The Vue surface is a component, so the state lives here and
 * `ContextMenu.vue` renders it; `useContextMenu()` keeps the exact API.
 */
import { ref, type Ref } from "vue";
import type { Component } from "vue";

export type ContextMenuItem = {
  /** Stable identity for list keys and for tests naming a row. */
  id: string;
  label: string;
  icon?: Component;
  disabled?: boolean;
  /** Destructive item: error ink, and never adjacent to what it undoes. */
  danger?: boolean;
  /** Hairline above this item, splitting the menu into groups. */
  separatorBefore?: boolean;
  onSelect: (selection: string) => void;
};

export type ContextMenuPoint = { x: number; y: number };

export type ContextMenuRequest = {
  /**
   * Accessible name for the surface, e.g. "Message actions". Optional because a
   * menu whose items already name their target (a link's own actions) reads
   * correctly unnamed; an unnamed *and* ambiguous menu is the caller's bug.
   */
  label?: string;
  items: ContextMenuItem[];
};

export type ContextMenuState = ContextMenuRequest & {
  /** Where the pointer asked for the surface. */
  point: ContextMenuPoint;
  /** Live selection at open time; empty when the caret was collapsed. */
  selection: string;
};

export type ContextMenuController = {
  contextMenu: Ref<ContextMenuState | null>;
  openContextMenu: (event: MouseEvent, request: ContextMenuRequest) => void;
  closeContextMenu: () => void;
};

/**
 * Keyboard-opened menus (Shift+F10, the context-menu key) report no pointer
 * coordinates, so they anchor near the focused node instead of the origin.
 */
function pointForEvent(event: MouseEvent): ContextMenuPoint {
  if (event.clientX !== 0 || event.clientY !== 0) {
    return { x: event.clientX, y: event.clientY };
  }
  const target = event.currentTarget;
  if (!(target instanceof HTMLElement)) return { x: 0, y: 0 };
  const rect = target.getBoundingClientRect();
  return {
    x: rect.left + Math.min(24, rect.width / 2),
    y: rect.top + Math.min(24, rect.height / 2),
  };
}

/**
 * A selection in the composer or another row is not "this turn's excerpt".
 * Anchor or focus inside the right-clicked node is enough: a range that
 * starts in this row still belongs to Copy here.
 */
function snapshotSelection(root: EventTarget | null): string {
  const live = window.getSelection();
  if (!live || live.rangeCount === 0 || live.isCollapsed) return "";
  const text = live.toString();
  if (!text || !(root instanceof Node)) return "";
  const { anchorNode, focusNode } = live;
  if (
    (anchorNode && root.contains(anchorNode)) ||
    (focusNode && root.contains(focusNode))
  ) {
    return text;
  }
  return "";
}

export function useContextMenu(): ContextMenuController {
  const contextMenu = ref<ContextMenuState | null>(null);

  function closeContextMenu(): void {
    contextMenu.value = null;
  }

  /*
    Every caller wants the same three effects: the platform's own menu must not
    also appear, an ancestor surface must not react to the same right-click, and
    the live selection must be snapshotted before the menu takes focus —
    focusing a menuitem collapses the range, and Copy would then only see the
    whole turn. Applying all three here means no call site can forget one.
  */
  function openContextMenu(event: MouseEvent, request: ContextMenuRequest): void {
    if (!request.items.length) return;
    event.preventDefault();
    event.stopPropagation();
    contextMenu.value = {
      ...request,
      point: pointForEvent(event),
      selection: snapshotSelection(event.currentTarget),
    };
  }

  return { contextMenu, openContextMenu, closeContextMenu };
}
