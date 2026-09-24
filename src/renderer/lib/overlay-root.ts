/**
 * Viewport-fixed host for floating surfaces.
 *
 * Modals must not
 * render inside the app tree: a transformed or filtered ancestor makes
 * `position: fixed` resolve against that ancestor instead of the viewport, which
 * traps a dialog inside a scrolled or clipped pane. The host is created on first
 * use and appended to `<html>`, so it is never a child of a transformed element.
 *
 * The `#dcode-overlays` rules in `styles/ui-kit.css` style this host
 * (`pointer-events: none` on the host, `auto` on a direct `.overlay` child), so
 * the id is part of the contract, not an implementation detail.
 */
const OVERLAY_ROOT_ID = "dcode-overlays";

/** The overlay host, created on first call. */
export function overlayRoot(): HTMLElement {
  const existing = document.getElementById(OVERLAY_ROOT_ID);
  if (existing instanceof HTMLElement) return existing;
  const root = document.createElement("div");
  root.id = OVERLAY_ROOT_ID;
  document.documentElement.appendChild(root);
  return root;
}
