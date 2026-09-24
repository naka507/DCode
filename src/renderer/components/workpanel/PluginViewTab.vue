<script setup lang="ts">
/**
 * A plugin-contributed work panel view (ADR 0104).
 *
 * The surface itself is a main-process `WebContentsView`, the same isolated
 * page a `ui.panel` window hosts; this component renders nothing into it. It
 * measures the placeholder rect and drives visibility. The view composites
 * above renderer content, so a panel-wide blocking overlay still hides it.
 * The work-panel menu temporarily blocks the active view while open, which
 * keeps the menu inside the dock without changing plugin bounds or pushing the
 * plugin body down.
 *
 * The `PluginViewTab` component. The decisions that are
 * not mechanical:
 *
 *  1. **The mount effects are `onMounted` plus a post-flush `watch`.** Two of the
 *     three effects read `surfaceRef`, and `flush: "post"` alone is not enough
 *     to cover their first run: `watch` with `immediate: true` invokes the
 *     callback *synchronously at setup* (verified against `@vue/reactivity`
 *     3.5, where `job(true)` is called from the watcher's own creation rather
 *     than through the scheduler), which is before the template has rendered
 *     and therefore before the ref is assigned. `onMounted` reproduces
 *     the post-commit first run and the watcher covers the re-runs.
 *  2. **Teardown is an explicit holder, not a returned function.** A `watch`
 *     callback's return value is not a cleanup in Vue — only the `onCleanup`
 *     callback it is handed is (`watchHandle.stop = watchHandle`; the return is
 *     discarded). The teardown also ran *before* each re-run, not only on
 *     unmount, so each effect calls its previous teardown at the top of its body
 *     and the unmount hook calls the last one. That is the same order without
 *     depending on `onCleanup` timing relative to the mount hook.
 *  3. **The visibility effect's early return is kept.** It did nothing
 *     when the surface was absent or the view had failed; the failed branch
 *     renders `WorkTabEmpty` instead of the placeholder, so `surfaceRef` is
 *     `null` there and the early return is the same guard.
 *  4. **The create-view effect needs no DOM**, so it is the one effect that
 *     keeps `immediate: true`, and it uses `onCleanup` — its teardown only
 *     invalidates a pending promise resolution, so it never has to interleave
 *     with a mount hook.
 *  5. **`pluginViewIcon` returns `null`, not a fallback component.** The
 *     map returned `IconPlug` itself for an unknown token; in this tree the
 *     lookup reports the miss and the caller supplies the fallback, which is
 *     what `lib/plugin-view-icons.ts` documents.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { api } from "../../lib/api";
import { pluginViewIcon } from "../../lib/plugin-view-icons";
import { IconPlug } from "../../lib/icons";
import WorkTabEmpty from "./WorkTabEmpty.vue";

const props = withDefaults(
  defineProps<{
    pluginId: string;
    viewId: string;
    title: string;
    icon?: string;
    blocked?: boolean;
    sessionId?: string;
    location?: string;
  }>(),
  {
    icon: undefined,
    blocked: false,
    sessionId: undefined,
    location: undefined,
  },
);

const { t } = useI18n();
const surfaceRef = ref<HTMLDivElement | null>(null);
const failed = ref(false);

/** The failed state's tile: the plugin's own icon token, else the plug glyph. */
const failureIcon = computed(() => pluginViewIcon(props.icon) ?? IconPlug);

/*
 * Create the view, and re-create it whenever the plugin's lifecycle changed
 * underneath us: a crash, a development reload, or a re-enable all destroy the
 * previous web contents while this tab stays open.
 */
watch(
  () => [props.pluginId, props.viewId, props.sessionId, props.location] as const,
  (_current, _previous, onCleanup) => {
    const pluginId = props.pluginId;
    const viewId = props.viewId;
    const sessionId = props.sessionId;
    const location = props.location;
    let current = true;
    void api.pluginViewOpen(pluginId, viewId, { sessionId, location }).then(
      () => {
        if (current) failed.value = false;
      },
      () => {
        if (current) failed.value = true;
      },
    );
    onCleanup(() => {
      current = false;
    });
  },
  { immediate: true },
);

watch(
  () => props.pluginId,
  (_current, _previous, onCleanup) => {
    const pluginId = props.pluginId;
    onCleanup(
      api.onPluginChanged((event) => {
        if (event?.pluginId && event.pluginId !== pluginId) return;
        void api.pluginViewOpen(pluginId, props.viewId, {
          sessionId: props.sessionId,
          location: props.location,
        }).then(
          () => {
            failed.value = false;
          },
          () => {
            failed.value = true;
          },
        );
      }),
    );
  },
  { immediate: true },
);

/** Show the guest unless the panel is blocked or the view failed to load. */
let visibilityTeardown: (() => void) | undefined;

function syncVisibility(): void {
  visibilityTeardown?.();
  visibilityTeardown = undefined;
  const surface = surfaceRef.value;
  if (!surface || failed.value) return;
  const pluginId = props.pluginId;
  const viewId = props.viewId;
  const sessionId = props.sessionId;
  void api.pluginViewSetVisible(pluginId, viewId, !props.blocked, sessionId);
  visibilityTeardown = () => {
    void api.pluginViewSetVisible(pluginId, viewId, false, sessionId);
  };
}

onMounted(syncVisibility);
watch(
  () => [props.pluginId, props.viewId, props.blocked, failed.value, props.sessionId],
  syncVisibility,
  { flush: "post" },
);
onBeforeUnmount(() => {
  visibilityTeardown?.();
  visibilityTeardown = undefined;
});

/** Report the placeholder's rect, coalesced to one frame per change. */
let boundsTeardown: (() => void) | undefined;

function observeSurface(): void {
  boundsTeardown?.();
  boundsTeardown = undefined;
  const surface = surfaceRef.value;
  if (!surface || failed.value) return;
  let frame = 0;
  const report = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const rect = surface.getBoundingClientRect();
      void api.pluginViewSetBounds({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      });
    });
  };
  const observer = new ResizeObserver(report);
  observer.observe(surface);
  window.addEventListener("resize", report);
  report();
  boundsTeardown = () => {
    observer.disconnect();
    window.removeEventListener("resize", report);
    cancelAnimationFrame(frame);
  };
}

onMounted(observeSurface);
watch(
  () => [props.pluginId, props.viewId, failed.value],
  observeSurface,
  { flush: "post" },
);
onBeforeUnmount(() => {
  boundsTeardown?.();
  boundsTeardown = undefined;
});
</script>

<template>
  <div class="work-plugin-view">
    <WorkTabEmpty
      v-if="failed"
      :icon="failureIcon"
      :title="title"
      :body="t('panel.pluginView.failed')"
    />
    <div v-else ref="surfaceRef" class="work-plugin-view-surface" />
  </div>
</template>
