<script setup lang="ts">
/**
 * One toast card.
 *
 * It is a component of
 * its own because each toast owns its auto-dismiss timer: the remaining time is
 * carried per instance across hover pauses, so a shared parent timer would
 * restart or cancel the wrong toast.
 *
 * Styling comes entirely from `styles/overlays.css`.
 */
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useAppStore } from "../stores/app-store";
import type { ToastItem, ToastVariant } from "../stores/app-state";
import {
  IconCircleAlert,
  IconCircleCheck,
  IconClose,
  IconInfo,
  IconTriangleAlert,
} from "../lib/icons";
import TooltipButton from "./TooltipButton.vue";

const props = defineProps<{ item: ToastItem }>();

const { t } = useI18n();
const store = useAppStore();

const VARIANT_ICON: Record<ToastVariant, typeof IconInfo> = {
  info: IconInfo,
  success: IconCircleCheck,
  warning: IconTriangleAlert,
  error: IconCircleAlert,
};

const variantIcon = computed(() => VARIANT_ICON[props.item.variant]);

const closing = ref(false);
// Hover pauses the auto-dismiss timer; remaining time survives re-hovers.
const remainingRef = ref(props.item.duration);
const startedAtRef = ref(0);
const timerRef = ref<number | null>(null);

function beginClose() {
  closing.value = true;
}

function pauseTimer() {
  if (timerRef.value === null) return;
  window.clearTimeout(timerRef.value);
  timerRef.value = null;
  remainingRef.value -= Date.now() - startedAtRef.value;
}

function resumeTimer() {
  if (props.item.duration === 0 || closing.value) return;
  startedAtRef.value = Date.now();
  timerRef.value = window.setTimeout(beginClose, Math.max(remainingRef.value, 0));
}

/**
 * Re-arms on mount and whenever the timer's own inputs change, tearing the
 * previous timer down first.
 */
watch(
  [() => props.item.duration, closing],
  (_next, _previous, onCleanup) => {
    resumeTimer();
    onCleanup(pauseTimer);
  },
  { immediate: true },
);

/** Actions live on the raw state, not on the store wrapper. */
function dismissToast(id: number) {
  store.appState?.dismissToast(id);
}

function onAnimationEnd(event: AnimationEvent) {
  if (event.animationName === "toast-out") dismissToast(props.item.id);
}
</script>

<template>
  <div
    class="toast"
    :class="[item.variant, closing ? 'closing' : '']"
    :role="item.variant === 'error' || item.variant === 'warning' ? 'alert' : 'status'"
    @mouseenter="pauseTimer"
    @mouseleave="resumeTimer"
    @animationend="onAnimationEnd"
  >
    <span class="toast-icon" aria-hidden="true">
      <component :is="variantIcon" :size="16" />
    </span>
    <span class="toast-message selectable">{{ item.message }}</span>
    <TooltipButton
      as="button"
      type="button"
      class="toast-dismiss"
      :label="t('toast.dismiss')"
      :aria-label="t('toast.dismiss')"
      @click="beginClose"
    >
      <IconClose :size="13" />
    </TooltipButton>
  </div>
</template>
