<script setup lang="ts">
/**
 * Themed tooltip trigger and floating label.
 *
 * One component covers both: the anchor element is chosen with `as`, and
 * `showWhenDisabled` is the only behavioural difference between them, and it is
 * derived from `as` rather than fixed — see the note on `showWhenDisabled`
 * below. `TooltipButton` passes `true` and `Tooltip` passes `false`, so a
 * disabled button still explains *why* it is disabled while a disabled anchor
 * shows nothing.
 *
 * The label is teleported to `document.body` rather than rendered inline. The
 * stylesheet pins `.ui-tooltip` with `position: fixed`, so an ancestor with a
 * transform or filter would otherwise become its containing block and trap it.
 * After paint the label is clamped into the viewport and flipped below the
 * anchor when there is no room above.
 *
 * The trigger's own class is supplied by the caller: every surface styles its
 * own controls. The floating label's class comes from `styles/ui-kit.css`.
 */
import { computed, nextTick, onMounted, ref, useAttrs, watch } from "vue";
import { cx } from "../lib/cx";
import { useTooltip, type TooltipPosition } from "../lib/use-tooltip";

const props = withDefaults(
  defineProps<{
    /** The tooltip text. An empty label disables the tooltip entirely. */
    label: string;
    /** Extra class on the floating label itself. */
    tooltipClassName?: string;
    /** Delay before the tooltip appears, in ms. */
    delayMs?: number;
    /** Grace window before the tooltip hides, in ms. */
    hideDelayMs?: number;
    /**
     * Anchor element. `Tooltip` (a `<span>`) and `TooltipButton` (a
     * `<button>`) are one component here, so the element is a prop. The default
     * is `"button"` because almost every call site is the button case; the one
     * plain `<Tooltip>` use, in `ModelSelectionPanes.vue`, states
     * `as="span"` itself. Some call sites rely on the default and cannot be
     * edited to state it, so the default has to match the component they meant.
     */
    as?: "span" | "button";
    /** A disabled trigger still shows its tooltip (`TooltipButton`). */
    showWhenDisabled?: boolean;
    disabled?: boolean;
    /** `TooltipButton` only: the accessible name, defaulting to the label. */
    ariaLabel?: string;
  }>(),
  {
    tooltipClassName: undefined,
    delayMs: 300,
    hideDelayMs: 100,
    as: "button",
    showWhenDisabled: undefined,
    disabled: false,
    ariaLabel: undefined,
  },
);
/*
 * The anchor is the *first* of two root nodes, so Vue cannot fall back to
 * automatic attribute inheritance: it warns that a fragment/teleport root has
 * nowhere to put them and drops `id`, `data-*` and every `aria-*` that is not
 * the `ariaLabel` prop. `TooltipButton` spreads `{...buttonProps}`
 * onto the `<button>`, so those attributes did reach the DOM,
 * and callers depend on them: `.thread-item-more[aria-expanded="true"]`
 * in `styles/sessions.css`, the `aria-labelledby` wiring on each sidebar
 * project group, and the `data-nav` / `data-action` hooks the e2e runners
 * query. Forwarding `$attrs` explicitly restores the contract.
 */
defineOptions({ inheritAttrs: false });

/**
 * The two anchor cases have opposite behaviour:
 * `TooltipButton` passes `true` as `useTooltip`'s fourth argument,
 * so a disabled control still explains *why* it is disabled,
 * while `Tooltip` passes `false` and shows nothing.
 *
 * Both live in this one component, so the behaviour is derived from
 * `as` rather than fixed: `as="button"` is the `TooltipButton` case and gets
 * `true`, `as="span"` is the plain `Tooltip` case and gets `false`. An explicit
 * `showWhenDisabled` still wins.
 *
 * Resolved once at setup rather than as a `computed`: `useTooltip` reads this
 * option as a plain boolean (`use-tooltip.ts:131`), not a ref, because it is
 * treated as a constant of the call — and `as` never changes for an instance.
 */
const showWhenDisabled = props.showWhenDisabled ?? props.as === "button";

const emit = defineEmits<{
  pointerenter: [event: PointerEvent];
  pointerleave: [event: PointerEvent];
  pointerdown: [event: PointerEvent];
  focus: [event: FocusEvent];
  blur: [event: FocusEvent];
  click: [event: MouseEvent];
}>();

const tooltip = useTooltip<HTMLElement>({
  label: () => props.label,
  disabled: () => props.disabled,
  delayMs: props.delayMs,
  hideDelayMs: props.hideDelayMs,
  showWhenDisabled,
});

const { anchorRef, open, position } = tooltip;

/** Function ref: `anchorRef` is the composable's own ref, not a template name. */
function bindAnchor(element: unknown) {
  anchorRef.value = (element as HTMLElement | null) ?? null;
}

const labelRef = ref<HTMLElement | null>(null);
const layout = ref<{ left: number; below: boolean }>({ left: 0, below: false });

/**
 * Clamp the label into the viewport and decide whether it sits above or below
 * the anchor. Re-runs on every position change, so a scroll or resize that moves
 * the anchor re-clamps on the same frame.
 */
async function measure(next: TooltipPosition) {
  await nextTick();
  const rect = labelRef.value?.getBoundingClientRect();
  if (!rect) return;
  const halfWidth = rect.width / 2;
  const minLeft = halfWidth + 8;
  const maxLeft = window.innerWidth - halfWidth - 8;
  layout.value = {
    left: Math.min(Math.max(next.left, minLeft), Math.max(minLeft, maxLeft)),
    below: next.top - rect.height < 8,
  };
}

watch(position, (next) => {
  if (next) void measure(next);
});

onMounted(() => {
  const next = position.value;
  if (next) void measure(next);
});

const floatingStyle = computed(() => {
  const next = position.value;
  if (!next) return undefined;
  return {
    left: `${layout.value.left}px`,
    top: `${layout.value.below ? next.bottom : next.top}px`,
    transform: layout.value.below ? "translateX(-50%)" : "translate(-50%, -100%)",
  };
});

const attrs = useAttrs();

/**
 * The accessible name, in the precedence: an explicit `ariaLabel` wins,
 * otherwise the tooltip label names the control.
 *
 * Call sites write `:aria-label`, which camelizes onto the declared `ariaLabel`
 * prop rather than landing in `$attrs`, so `props.ariaLabel` is the caller's
 * value and not a default. `LinkifiedText` passes `segment.text` while its
 * tooltip label is the generic "Preview URL".
 */
const accessibleName = computed(() => props.ariaLabel ?? props.label);

/**
 * Button anchors carry `type`/`aria-label`/`disabled`; span anchors do not.
 *
 * `type` and `tabindex` are only *defaults*: `{...buttonProps}` is spread
 * and `type` is never written, so a caller's value always survives.
 * Reading them from `$attrs` first keeps that. `aria-label` and `disabled` are
 * deliberately not read from `$attrs`: `:aria-label` camelizes into the
 * `ariaLabel` prop and `disabled` is a declared prop, so neither reaches
 * `$attrs` and the computed value cannot be shadowed by a stray attribute.
 */
const anchorAttrs = computed(() =>
  props.as === "button"
    ? {
        type: (attrs.type as string | undefined) ?? "button",
        "aria-label": accessibleName.value,
        disabled: props.disabled,
      }
    : { tabindex: attrs.tabindex ?? 0 },
);

function onPointerEnter(event: PointerEvent) {
  tooltip.onPointerEnter();
  emit("pointerenter", event);
}

function onPointerLeave(event: PointerEvent) {
  tooltip.onPointerLeave();
  emit("pointerleave", event);
}

function onPointerDown(event: PointerEvent) {
  tooltip.dismiss();
  emit("pointerdown", event);
}

function onFocus(event: FocusEvent) {
  tooltip.onFocus();
  emit("focus", event);
}

function onBlur(event: FocusEvent) {
  tooltip.onBlur();
  emit("blur", event);
}

function onClick(event: MouseEvent) {
  tooltip.dismiss();
  emit("click", event);
}
</script>

<template>
  <component
    :is="as"
    :ref="bindAnchor"
    v-bind="{ ...$attrs, ...anchorAttrs }"
    @pointerenter="onPointerEnter"
    @pointerleave="onPointerLeave"
    @pointerdown="onPointerDown"
    @focus="onFocus"
    @blur="onBlur"
    @click="onClick"
  >
    <slot />
  </component>
  <Teleport v-if="open && position" to="body">
    <span
      ref="labelRef"
      :class="cx('ui-tooltip', tooltipClassName)"
      role="tooltip"
      :style="floatingStyle"
    >
      {{ label }}
    </span>
  </Teleport>
</template>
