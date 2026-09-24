/**
 * Framework-free half of the scenic-themes destination.
 *
 * Split out of the scenic-themes destination component, which mixed this one pure
 * clamp with the presentational destination. The component itself is
 * `components/settings/PluginScenicThemesDestination.vue`.
 */

/** The range input's own 0..20 bounds, restated for non-input callers. */
export const SCENIC_BLUR_MIN = 0;
export const SCENIC_BLUR_MAX = 20;

export const clampBlur = (value: number) =>
  Math.max(SCENIC_BLUR_MIN, Math.min(SCENIC_BLUR_MAX, Math.round(value)));
