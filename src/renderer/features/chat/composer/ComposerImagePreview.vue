<script setup lang="ts">
/**
 * Full-screen image preview for unsent attachments.
 *
 * The `ComposerImagePreview` component. The file
 * holds two components — the exported gate (`controller.preview ? <dialog/> :
 * null`) and the dialog itself. The gate is the parent's `v-if` here (see
 * `ComposerInput.vue`), because the blocking-overlay claim below belongs to the
 * dialog's lifetime, not to the composer's: claiming it in this component's
 * setup while the dialog were still hidden would suppress every native
 * work-panel surface for the whole session. The markup, class names, and
 * behaviour are unchanged.
 *
 * The implementation decisions that are not mechanical:
 *
 *  1. **`createPortal(node, document.body)` is `<Teleport to="body">`.** Both
 *     put the dialog outside the app tree so a transformed ancestor cannot trap
 *     it, and both keep the native `<dialog>` top layer.
 *  2. **The mount effect and its cleanup are `onMounted` / `onBeforeUnmount`.**
 *     The dependency was a stable per-request identity (`select`
 *     spreads the request and keeps the same `restoreFocus` closure), so the
 *     effect ran exactly once per mounted dialog. The unmount side reads a
 *     captured binding rather than `preview`: by the time the parent unmounts
 *     this component `controller.preview` is already `null`, while a cleanup
 *     closure would still see the last non-null value.
 *  3. **The decode runs on mount and on every `src` change.** The
 *     equivalent effect also ran for the first `src`. A Vue `watch` with no
 *     `immediate` would skip that first value, so the mount path calls
 *     the same function — otherwise a dialog opened on an already-loaded data
 *     URL would never measure the image (a cached image fires no new `load`
 *     event, which is exactly what the code comment described). Staleness is
 *     tracked with a token instead of a mutable `current` flag.
 *  4. **The wheel listener is attached once, not re-registered per render.**
 *     The dependency list was `[src, natural, zoom, fit, pan.offset.x,
 *     pan.offset.y]` so its handler closed over the current values; reading the
 *     same state through the refs inside the handler is equivalent and does not
 *     churn a non-passive listener on every pan.
 *  5. **`onCancel` / `onClick` / `onKeyDown` become native bindings.** The
 *     dialog is teleported out of the app root, so `stopPropagation()` on
 *     `keydown` keeps dialog navigation local — Escape must not abort an agent
 *     run — exactly as the code comment described.
 *  6. **`data-dragging={pan.dragging || undefined}` is kept as `|| undefined`.**
 *     Vue removes an attribute bound to `undefined`, while `false` would render
 *     `data-dragging="false"` and the CSS rule would still match.
 *  7. **The fit control is a method, not an inline assignment.** A template
 *     expression cannot assign to a `ref` binding the way the
 *     `setManualZoom(null); pan.reset()` pair did.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  IconChevronLeft,
  IconChevronRight,
  IconClose,
  IconDownload,
  IconMinus,
  IconPlus,
} from "../../../lib/icons";
import { useBlockingOverlay } from "../../../lib/blocking-overlay";
import { useImagePreviewPan } from "./hooks/useImagePreviewPan";
import type { ComposerImagePreviewController } from "./hooks/useComposerImagePreview";

const props = defineProps<{ controller: ComposerImagePreviewController }>();

const { t } = useI18n();

/*
  `controller.preview` is a getter over the composable's computeds, so this
  computed re-evaluates only when the request, the visible images, the source map
  or the session changes, and keeps one object identity in between — which is
  what lets the template and the watchers below agree on "the same preview".
*/
const preview = computed(() => props.controller.preview);

const dialogRef = ref<HTMLDialogElement | null>(null);
const viewportRef = ref<HTMLDivElement | null>(null);
const imageRef = ref<HTMLImageElement | null>(null);
const viewport = ref({ width: 0, height: 0 });
const size = ref<{ src: string; width: number; height: number } | null>(null);
const manualZoom = ref<{ src: string; value: number } | null>(null);
const failedSrc = ref<string | null>(null);

const index = computed(() =>
  preview.value ? preview.value.images.findIndex((image) => image.id === preview.value?.id) : -1,
);
const reference = computed(() =>
  preview.value && index.value >= 0 ? preview.value.images[index.value] : undefined,
);
const src = computed(() => preview.value?.source.src);
const natural = computed(() =>
  size.value && size.value.src === src.value ? size.value : null,
);
const fit = computed(() =>
  natural.value && viewport.value.width > 0 && viewport.value.height > 0
    ? Math.min(
        1,
        viewport.value.width / natural.value.width,
        viewport.value.height / natural.value.height,
      )
    : 1,
);
const zoom = computed(() =>
  manualZoom.value && manualZoom.value.src === src.value ? manualZoom.value.value : fit.value,
);
const failed = computed(
  () =>
    preview.value?.source.status === "error" ||
    (src.value != null && failedSrc.value === src.value),
);
/*
  Keep a recoverable part of the image in view: the pan limit is the overflow
  past a 32px margin on each side, so the image can never be dragged fully off.
*/
const bounds = computed(() => ({
  x: natural.value
    ? Math.max(
        0,
        (viewport.value.width + natural.value.width * zoom.value) / 2 -
          Math.min(32, (natural.value.width * zoom.value) / 2),
      )
    : 0,
  y: natural.value
    ? Math.max(
        0,
        (viewport.value.height + natural.value.height * zoom.value) / 2 -
          Math.min(32, (natural.value.height * zoom.value) / 2),
      )
    : 0,
}));

const pan = useImagePreviewPan(
  () => preview.value?.id ?? "",
  () => src.value,
  () => bounds.value,
);

useBlockingOverlay();

/** The `restoreFocus` of the last non-null preview, for the unmount cleanup. */
let lastRestoreFocus: (() => void) | null = null;
watch(
  preview,
  (value) => {
    if (value) lastRestoreFocus = value.restoreFocus;
  },
  { immediate: true },
);

/*
  A thumbnail may already have decoded the same data URL before this element
  mounts. Decode also covers cached images without a new load event.
*/
let decodeToken = 0;
function decodeSource(current: string | undefined): void {
  const image = imageRef.value;
  if (!current || !image) return;
  decodeToken += 1;
  const token = decodeToken;
  void image.decode().then(
    () => {
      if (token !== decodeToken || image.naturalWidth === 0) return;
      size.value = { src: current, width: image.naturalWidth, height: image.naturalHeight };
    },
    () => {
      if (token === decodeToken) failedSrc.value = current;
    },
  );
}

let viewportObserver: ResizeObserver | undefined;

onMounted(() => {
  dialogRef.value?.showModal();
  const element = viewportRef.value;
  if (element) {
    const resize = () => {
      viewport.value = { width: element.clientWidth, height: element.clientHeight };
    };
    resize();
    viewportObserver = new ResizeObserver(resize);
    viewportObserver.observe(element);
    element.addEventListener("wheel", onWheel, { passive: false });
  }
  // The first `src` never reaches the watcher below without `immediate`.
  decodeSource(src.value);
});

onBeforeUnmount(() => {
  viewportRef.value?.removeEventListener("wheel", onWheel);
  viewportObserver?.disconnect();
  viewportObserver = undefined;
  dialogRef.value?.close();
  lastRestoreFocus?.();
});

/** Post-flush so the replaced `:key="src"` element is already in the ref. */
watch(
  src,
  async (current) => {
    await nextTick();
    decodeSource(current);
  },
  { flush: "post" },
);

/** A new image or a new selection starts centered and un-zoomed. */
watch([() => preview.value?.id, src], () => {
  const element = viewportRef.value;
  if (element) {
    element.scrollLeft = 0;
    element.scrollTop = 0;
  }
  manualZoom.value = null;
});

function changeZoom(value: number): void {
  const current = src.value;
  if (!current) return;
  manualZoom.value = {
    src: current,
    value: Math.min(8, Math.max(Math.min(0.1, fit.value), value)),
  };
}

function onWheel(event: WheelEvent): void {
  const element = viewportRef.value;
  if (!src.value || !natural.value || !element) return;
  event.preventDefault();
  event.stopPropagation();
  const vertical = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1;
  const delta = event.deltaY * vertical;
  if (event.ctrlKey) {
    changeZoom(zoom.value * Math.exp(-delta / 300));
    return;
  }
  const horizontal = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientWidth : 1;
  pan.moveBy(-event.deltaX * horizontal, -delta);
}

function move(direction: number): void {
  const next = preview.value?.images[index.value + direction];
  if (next) props.controller.select(next.id);
}

function dismissBackground(event: MouseEvent): void {
  if (event.target === event.currentTarget) props.controller.close();
}

/** Keep dialog navigation local; Escape must not abort an agent run. */
function onDialogKeyDown(event: KeyboardEvent): void {
  event.stopPropagation();
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    move(event.key === "ArrowLeft" ? -1 : 1);
  }
}

function onCancel(event: Event): void {
  event.preventDefault();
  props.controller.close();
}

function onImageLoad(event: Event): void {
  const image = event.currentTarget;
  const current = src.value;
  if (!(image instanceof HTMLImageElement) || !current) return;
  size.value = { src: current, width: image.naturalWidth, height: image.naturalHeight };
}

function onImageError(): void {
  failedSrc.value = src.value ?? null;
}

function retry(): void {
  failedSrc.value = null;
  size.value = null;
  props.controller.retry();
}

function fitImage(): void {
  manualZoom.value = null;
  pan.reset();
}

const imageStyle = computed(() => ({
  ...(natural.value
    ? {
        width: `${natural.value.width * zoom.value}px`,
        height: `${natural.value.height * zoom.value}px`,
      }
    : {}),
  transform: `translate(-50%, -50%) translate(${pan.offset.x}px, ${pan.offset.y}px)`,
}));
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="dialogRef"
      class="composer-image-preview"
      :aria-label="t('chat.imagePreview.title')"
      @cancel="onCancel"
      @click="dismissBackground"
      @keydown="onDialogKeyDown"
    >
      <header class="composer-image-preview-header">
        <span class="composer-image-preview-name">{{ reference?.name }}</span>
        <a
          v-if="src && !failed"
          :href="src"
          :download="reference?.name"
          :aria-label="t('chat.imagePreview.download')"
          :title="t('chat.imagePreview.download')"
        >
          <IconDownload :size="18" />
        </a>
        <button
          type="button"
          autofocus
          :aria-label="t('common.close')"
          :title="t('common.close')"
          @click="props.controller.close"
        >
          <IconClose :size="20" />
        </button>
      </header>
      <div
        ref="viewportRef"
        class="composer-image-preview-viewport"
        @click="dismissBackground"
        @click.capture="pan.onClickCapture"
        @pointerdown.capture="pan.onPointerDownCapture"
      >
        <div v-if="failed" class="composer-image-preview-status" role="status">
          <p>{{ t("chat.imagePreview.error") }}</p>
          <button type="button" @click="retry">{{ t("chat.imagePreview.retry") }}</button>
        </div>
        <img
          v-else-if="src"
          ref="imageRef"
          :key="src"
          :src="src"
          :alt="reference?.name"
          :draggable="false"
          :data-dragging="pan.dragging || undefined"
          :style="imageStyle"
          @pointerdown="pan.onImagePointerDown"
          @pointermove="pan.onImagePointerMove"
          @pointerup="pan.onImagePointerUp"
          @pointercancel="pan.onImagePointerCancel"
          @lostpointercapture="pan.onImageLostPointerCapture"
          @load="onImageLoad"
          @error="onImageError"
        />
        <div v-else class="composer-image-preview-status" role="status">
          {{ t("common.loading") }}
        </div>
      </div>
      <footer class="composer-image-preview-controls">
        <template v-if="preview && preview.images.length > 1">
          <button
            type="button"
            :disabled="index === 0"
            :aria-label="t('chat.imagePreview.previous')"
            @click="move(-1)"
          >
            <IconChevronLeft :size="18" />
          </button>
          <span role="status">
            {{
              t("chat.imagePreview.position", {
                current: index + 1,
                total: preview.images.length,
              })
            }}
          </span>
          <button
            type="button"
            :disabled="index === preview.images.length - 1"
            :aria-label="t('chat.imagePreview.next')"
            @click="move(1)"
          >
            <IconChevronRight :size="18" />
          </button>
        </template>
        <button
          type="button"
          :disabled="!natural || failed || zoom <= Math.min(0.1, fit)"
          :aria-label="t('menu.zoomOut')"
          @click="changeZoom(zoom / 1.25)"
        >
          <IconMinus :size="18" />
        </button>
        <output>{{ Math.round(zoom * 100) }}%</output>
        <button
          type="button"
          :disabled="!natural || failed || zoom >= 8"
          :aria-label="t('menu.zoomIn')"
          @click="changeZoom(zoom * 1.25)"
        >
          <IconPlus :size="18" />
        </button>
        <button type="button" :disabled="!natural || failed" @click="fitImage">
          {{ t("chat.imagePreview.fit") }}
        </button>
      </footer>
    </dialog>
  </Teleport>
</template>
