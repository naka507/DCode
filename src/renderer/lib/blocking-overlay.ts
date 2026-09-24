/**
 * Blocking-overlay registry.
 *
 * Introduced by the same commit that added the composer image preview
 * (78a073a5). A native plugin view is a
 * `WebContentsView` composited *above* the renderer — including its top layer —
 * so a full-screen modal has to tell the work panel to hide the native surfaces
 * it owns. Owners are counted rather than held in a boolean because dismissing
 * one overlay must not reveal a view another overlay is still covering.
 *
 * Two implementation notes:
 *
 *  - A `shallowRef` counter replaces an external-store subscription, so
 *    `useBlockingOverlayActive()` returns a `ComputedRef` that `WorkPanel.vue`
 *    tracks the same way it tracks its other store projections.
 *  - `useBlockingOverlay()` keeps the same lifetime contract: it claims on
 *    setup and releases through `onScopeDispose`. It therefore belongs in a
 *    component that is mounted exactly while the overlay is open — which is why
 *    `ComposerInput.vue` gates `ComposerImagePreview` on `imagePreview.preview`
 *    instead of letting the dialog render itself away.
 */
import { computed, onScopeDispose, shallowRef, type ComputedRef } from "vue";

const owners = shallowRef(0);

/** True while at least one blocking overlay owns the screen. */
export const isBlockingOverlayActive = () => owners.value > 0;

/** Claim the screen for the lifetime of the current effect scope. */
export function useBlockingOverlay(): void {
  owners.value += 1;
  onScopeDispose(() => {
    owners.value -= 1;
  });
}

/** Reactive {@link isBlockingOverlayActive} for a template or computed. */
export function useBlockingOverlayActive(): ComputedRef<boolean> {
  return computed(() => owners.value > 0);
}
