<script setup lang="ts">
/**
 * Work panel — the dock that hosts the review, files, plugin-view, and subagent
 * surfaces, plus its tab strip, resize handle, and tool launcher.
 *
 * The `WorkPanel` component. The props/emits below are the call contract
 * `AppShell.vue` already passes, so the names stay
 * unchanged — `onExitAnimationEnd` and friends become the emits listed here,
 * and the shell keeps its kebab-case attribute spelling.
 *
 * The decisions that are not mechanical:
 *
 *  1. **Store reads are `computed`s over `store.appState`.** The earlier version selected
 *     each field with `useAppStore((s) => s.field)`; `appState` is a
 *     `shallowRef`, so a `computed` over `store.appState?.field` is the same
 *     tracked read. The actions live on the state payload, not on the store
 *     instance — the Pinia store's setup returns only
 *     `appState` / `setState` / `subscribe` / `commitInitialState` — so
 *     the `useAppStore.getState().openWorkPanelTab(tab)` is
 *     `store.appState?.openWorkPanelTab(tab)` here, the idiom the rest of this
 *     tree already uses for actions.
 *  2. **`useLayoutEffect` is `onMounted` plus a post-flush `watch`.** The earlier version
 *     ran three layout effects: auto-collapse, tab-strip scroll, and the exit
 *     bookkeeping. A pre-flush watcher would run them a render early, before the
 *     DOM they read exists, so each is `onMounted` (first application, when the
 *     refs are assigned) plus `watch(., { flush: "post" })` (subsequent
 *     changes) — the shape `components/ConversationWidthHandles.vue` uses for
 *     the same reason. `useEffect` pairs that only touch the document
 *     (`data-work-panel-resizing`) are plain watchers.
 *  3. **Numeric `style` values need explicit units.** `px` is appended
 *     to a numeric `width` / `maxWidth` / `paddingLeft`; Vue assigns the value
 *     to `element.style` verbatim, so every numeric style here is written as a
 *     `${n}px` string. The `--work-panel-width` custom property is a string for
 *     the same reason (`setProperty` would otherwise receive `360`).
 *  4. **`newTabButtonRef` becomes a scoped query.** `TooltipButton` renders a
 *     fragment (the anchor plus a teleported label), so a template `ref` on it
 *     yields the component instance rather than the `<button>`. The earlier version
 *     forwarded the ref through its own `TooltipButton`; here the button is
 *     reached through the panel root by its own class, the way
 *     `components/NotificationCenter.vue` reaches its trigger. The tab buttons
 *     are plain `<button>`s, so they keep real element refs in a `Map`.
 *  5. **`ToolIcon` is inlined in the template.** The earlier version declared it so JSX
 *     could branch on the icon; a `v-if` / `v-else` pair renders the same two
 *     outcomes without a second component.
 *  6. **`aria-hidden="true"` is written explicitly** on the launcher tile: a bare
 *     attribute in a Vue template renders as `""`, not `"true"`, so the value is
 *     spelled out.
 *  7. **A component re-renders only when its reactive dependencies change**,
 *     and the module-private `tabLabel` /
 *     `workPanelTools` helpers stay in this file: the brief for this surface is
 *     exactly these files, and neither `lib/work-panel-tabs.ts` nor
 *     `lib/work-panel-resize.ts` covers them (they own the tab factories, the
 *     sanitizer and the width budget, which are reused as-is).
 *  8. **The subagent branch renders its back button whenever a selection
 *     exists.** The guard was on `subagentPanel && onCloseSubagentPanel`
 *     because the callback was optional; an emit is always callable, so the
 *     presence of the selection is the whole condition.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch, type Component } from "vue";
import { useI18n } from "vue-i18n";
import type { PluginViewMeta } from "@dcode/shared";
import {
  isKnownWorkPanelTab,
  parsePluginViewRef,
  pluginWorkPanelTab,
  toolWorkPanelTab,
  type WorkPanelTab,
} from "../../lib/work-panel-tabs";
import { pluginViewIcon, pluginViewInitial } from "../../lib/plugin-view-icons";
import {
  MAIN_PANE_MIN_WIDTH,
  WORK_PANEL_COMPACT_MIN_WIDTH,
  WORK_PANEL_MIN_WIDTH,
  clampWorkPanelWidth,
  workPanelLayout,
  workPanelResetWidth,
  workPanelWidthBounds,
} from "../../lib/work-panel-resize";
import { useAppStore } from "../../stores/app-store";
import type { SubagentPanelSelection } from "../../lib/subagent-panel";
import {
  IconBot,
  IconChevronLeft,
  IconClose,
  IconDiff,
  IconFileText,
  IconPanelMaximize,
  IconPanelRestore,
  IconPlug,
  IconPlus,
} from "../../lib/icons";
import { useBlockingOverlayActive } from "../../lib/blocking-overlay";
import TooltipButton from "../TooltipButton.vue";
import FilesTab from "./FilesTab.vue";
import PluginViewTab from "./PluginViewTab.vue";
import ReviewTab from "./ReviewTab.vue";
import SubagentPanel from "./SubagentPanel.vue";

const TAB_ICONS: Record<WorkPanelTab["kind"], Component> = {
  new: IconPlus,
  review: IconDiff,
  file: IconFileText,
  plugin: IconPlug,
};

type WorkPanelResizeState = {
  pointerId: number;
  startClientX: number;
  startWidth: number;
  minimumWidth: number;
  currentWidth: number;
  frame: number;
};

type WorkPanelTool = {
  id: string;
  tab: WorkPanelTab;
  label: string;
  icon: Component | null;
  initial?: string;
  description?: string;
  shortcut?: string;
};

const props = withDefaults(
  defineProps<{
    /**
     * Hides every native surface in the panel. Both the preview browser and a
     * plugin view are `WebContentsView`s composited above renderer content, so a
     * blocking overlay must suppress them alike.
     */
    panelBlocked?: boolean;
    /** Plays `work-panel-out`; the parent unmounts after `animationend`. */
    exiting?: boolean;
    /** Temporarily replaces the resource body with the selected subagent. */
    subagentPanel?: SubagentPanelSelection | null;
    /** Current renderer shell width used for the three-column budget. */
    containerWidth?: number;
    /** Sidebar state is part of the shared shell budget. */
    sidebarCollapsed?: boolean;
    /** Keeps the dock in the budget while `sidebar-out` still occupies flex space. */
    sidebarExiting?: boolean;
    sidebarWidth?: number;
    /** Preview mode: the panel takes MainChat's width as well. */
    maximized?: boolean;
  }>(),
  {
    panelBlocked: false,
    exiting: false,
    subagentPanel: null,
    containerWidth: 0,
    sidebarCollapsed: false,
    sidebarExiting: false,
    sidebarWidth: 0,
    maximized: false,
  },
);

const emit = defineEmits<{
  "exit-animation-end": [];
  "close-subagent-panel": [];
  "auto-collapse-sidebar": [];
  "toggle-maximize": [];
}>();

const { t } = useI18n();

/** Native surfaces must hide under a blocking overlay, same as while exiting. */
const blockingOverlayActive = useBlockingOverlayActive();
const store = useAppStore();

const tabs = computed(() =>
  (store.appState?.workPanelTabs ?? []).filter(isKnownWorkPanelTab),
);
const activeTabId = computed(() => store.appState?.activeWorkPanelTabId ?? null);
const activeSessionId = computed(() => store.appState?.activeSessionId);
const pluginViews = computed<PluginViewMeta[]>(() => store.appState?.pluginViews ?? []);
const width = computed(() => store.appState?.workPanelWidth ?? 0);

const activeTab = computed(
  () => tabs.value.find((tab) => tab.id === activeTabId.value) ?? null,
);
const activePluginView = computed(() =>
  activeTab.value?.kind === "plugin"
    ? pluginViews.value.find((view) => view.ref === activeTab.value?.resource)
    : undefined,
);
/** `parsePluginViewRef` is nullable, so the plugin pane is gated on this too. */
const activePluginRef = computed(() =>
  activeTab.value?.kind === "plugin"
    ? parsePluginViewRef(activeTab.value.resource)
    : null,
);
const activeLabel = computed(() =>
  activeTab.value ? tabLabel(activeTab.value) : t("panel.title"),
);

const tools = computed(() => workPanelTools());

/**
 * A view whose plugin was disabled mid-session no longer resolves; fall back to
 * its id rather than leaving the tab blank until it closes.
 */
function tabLabel(tab: WorkPanelTab): string {
  if (tab.kind === "plugin") {
    const view = pluginViews.value.find((candidate) => candidate.ref === tab.resource);
    return view?.title ?? tab.resource ?? t("panel.tabs.plugin");
  }
  if (tab.kind === "new") return t("panel.new.title");
  if (tab.kind !== "file") return t(`panel.tabs.${tab.kind}`);
  const path = tab.resource ?? "";
  return path.split("/").filter(Boolean).pop() || t("panel.tabs.file");
}

/**
 * Review is the only host-owned launcher. Files, Browser, and every future tool
 * are plugin-contributed views, so their list stays data-driven.
 */
function workPanelTools(): WorkPanelTool[] {
  return [
    {
      id: "review",
      tab: toolWorkPanelTab("review"),
      label: t("panel.tabs.review"),
      icon: IconDiff,
    },
    ...pluginViews.value.map((view) => {
      const Icon = pluginViewIcon(view.icon);
      return {
        id: view.ref,
        tab: pluginWorkPanelTab(view.pluginId, view.viewId),
        label: view.title,
        icon: Icon,
        ...(Icon ? {} : { initial: pluginViewInitial(view.title) }),
        description: view.pluginName,
      };
    }),
  ];
}

/** The tab's own icon: a plugin token when it resolves, else the kind's icon. */
function tabIcon(tab: WorkPanelTab): Component {
  if (tab.kind === "plugin") {
    const icon = pluginViewIcon(
      pluginViews.value.find((view) => view.ref === tab.resource)?.icon,
    );
    return icon ?? TAB_ICONS.plugin;
  }
  return TAB_ICONS[tab.kind];
}

/* ------------------------------------------------------------------ */
/* Panel width and the three-column budget                             */
/* ------------------------------------------------------------------ */

const panelDragWidth = ref<number | null>(null);
let panelResizeState: WorkPanelResizeState | null = null;

const requestedPanelWidth = computed(() => panelDragWidth.value ?? width.value);
const panelMinimum = computed(() =>
  requestedPanelWidth.value < WORK_PANEL_MIN_WIDTH
    ? WORK_PANEL_COMPACT_MIN_WIDTH
    : WORK_PANEL_MIN_WIDTH,
);
/*
 * The first render can precede ResizeObserver's first notification. Use a
 * conservative shell estimate for that frame; the measured width takes over
 * before a user can interact with the divider.
 */
const sidebarOccupiesBudget = computed(
  () => !props.sidebarCollapsed || props.sidebarExiting,
);
const budgetWidth = computed(() =>
  props.containerWidth > 0
    ? props.containerWidth
    : requestedPanelWidth.value +
      (sidebarOccupiesBudget.value ? props.sidebarWidth : 0) +
      MAIN_PANE_MIN_WIDTH,
);
const layout = computed(() =>
  workPanelLayout({
    containerWidth: budgetWidth.value,
    sidebarWidth: props.sidebarWidth,
    sidebarCollapsed: !sidebarOccupiesBudget.value,
    requestedPanelWidth: requestedPanelWidth.value,
    maximized: props.maximized,
  }),
);
const renderPanelWidth = computed(() => layout.value.panelWidth);
const isResizing = computed(() => panelDragWidth.value !== null);

const panelStyle = computed(() => ({
  width: `${renderPanelWidth.value}px`,
  maxWidth: `${layout.value.maxPanelWidth}px`,
  "--work-panel-width": `${renderPanelWidth.value}px`,
}));

const resizeMin = computed(() =>
  Math.min(
    panelMinimum.value,
    Math.max(WORK_PANEL_COMPACT_MIN_WIDTH, layout.value.maxPanelWidth),
  ),
);
const resizeMax = computed(() =>
  Math.max(
    Math.min(panelMinimum.value, layout.value.maxPanelWidth),
    layout.value.maxPanelWidth,
  ),
);
const resizeNow = computed(() =>
  Math.round(panelDragWidth.value ?? renderPanelWidth.value),
);

/* ------------------------------------------------------------------ */
/* Exit animation                                                      */
/* ------------------------------------------------------------------ */

const nativeSurfaceReadyForExit = ref(false);
const exitAnimationReady = computed(
  () => props.exiting && nativeSurfaceReadyForExit.value,
);

/**
 * Plugin views (and the host guest clamped to them) hide via `blocked` before
 * the dock CSS animation starts, so the class change waits for the frame after
 * `exiting` lands — which is what the effect did by running post-render.
 */
watch(
  () => props.exiting,
  (next) => {
    nativeSurfaceReadyForExit.value = next;
  },
  { immediate: true, flush: "post" },
);

function onPanelAnimationEnd(event: AnimationEvent): void {
  if (!exitAnimationReady.value) return;
  if (event.target !== event.currentTarget) return;
  if (!event.animationName.startsWith("work-panel-out")) return;
  emit("exit-animation-end");
}

/** Called on the first frame where the main pane would hit its hard floor. */
function maybeCollapseSidebar(): void {
  if (props.exiting || !layout.value.shouldCollapseSidebar) return;
  emit("auto-collapse-sidebar");
}

onMounted(maybeCollapseSidebar);
watch(
  () => !props.exiting && layout.value.shouldCollapseSidebar,
  maybeCollapseSidebar,
  { flush: "post" },
);

/* ------------------------------------------------------------------ */
/* Tab strip                                                           */
/* ------------------------------------------------------------------ */

const tabButtonRefs = new Map<string, HTMLButtonElement>();
const panelRootRef = ref<HTMLElement | null>(null);

function setTabButton(tabId: string, node: unknown): void {
  if (node instanceof HTMLButtonElement) tabButtonRefs.set(tabId, node);
  else tabButtonRefs.delete(tabId);
}

/**
 * The new-tab control is a `TooltipButton`, whose root is a fragment, so it is
 * reached through the panel root rather than through a template ref.
 */
function focusNewTabButton(): void {
  panelRootRef.value
    ?.querySelector<HTMLButtonElement>(".work-panel-new-tab")
    ?.focus();
}

function scrollActiveTabIntoView(): void {
  const id = activeTabId.value;
  if (!id) return;
  tabButtonRefs.get(id)?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

onMounted(scrollActiveTabIntoView);
watch(
  () => [activeTabId.value, tabs.value.length] as const,
  scrollActiveTabIntoView,
  { flush: "post" },
);

function activateTab(tabId: string): void {
  store.appState?.activateWorkPanelTab(tabId);
}

function selectTool(item: WorkPanelTool, sourceTabId?: string): void {
  if (sourceTabId) {
    store.appState?.replaceWorkPanelTab(sourceTabId, item.tab);
    return;
  }
  const existing = tabs.value.find((tab) => tab.id === item.tab.id);
  if (existing) activateTab(existing.id);
  else store.appState?.openWorkPanelTab(item.tab);
}

function closeTabAndFocus(tabId: string): void {
  const index = tabs.value.findIndex((tab) => tab.id === tabId);
  const nextTab =
    index >= 0 ? (tabs.value[index + 1] ?? tabs.value[index - 1]) : undefined;
  store.appState?.closeWorkPanelTab(tabId);
  requestAnimationFrame(() => {
    if (nextTab) tabButtonRefs.get(nextTab.id)?.focus();
    else focusNewTabButton();
  });
}

function onTabKeyDown(event: KeyboardEvent, tabId: string): void {
  const index = tabs.value.findIndex((tab) => tab.id === tabId);
  if (index < 0) return;
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    closeTabAndFocus(tabId);
    return;
  }
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const nextIndex =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.value.length - 1
        : event.key === "ArrowLeft"
          ? (index - 1 + tabs.value.length) % tabs.value.length
          : (index + 1) % tabs.value.length;
  const nextTab = tabs.value[nextIndex];
  if (!nextTab) return;
  activateTab(nextTab.id);
  requestAnimationFrame(() => tabButtonRefs.get(nextTab.id)?.focus());
}

function onTabAuxClick(event: MouseEvent, tabId: string): void {
  if (event.button !== 1) return;
  event.preventDefault();
  closeTabAndFocus(tabId);
}

function onTabStripWheel(event: WheelEvent): void {
  const strip = event.currentTarget as HTMLDivElement;
  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
  if (strip.scrollWidth <= strip.clientWidth) return;
  strip.scrollLeft += event.deltaY;
  event.preventDefault();
}

/* ------------------------------------------------------------------ */
/* Resize handle                                                       */
/* ------------------------------------------------------------------ */

function setWidth(next: number): void {
  store.appState?.setWorkPanelWidth(next);
}

/** The effect: the whole document shows the resize cursor mid-drag. */
watch(
  isResizing,
  (resizing) => {
    if (resizing) {
      document.documentElement.setAttribute("data-work-panel-resizing", "true");
    } else {
      document.documentElement.removeAttribute("data-work-panel-resizing");
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  if (panelResizeState?.frame) cancelAnimationFrame(panelResizeState.frame);
  panelResizeState = null;
  document.documentElement.removeAttribute("data-work-panel-resizing");
});

function finishPanelResize(
  target: HTMLDivElement,
  pointerId: number,
  cancelled: boolean,
): void {
  const drag = panelResizeState;
  if (drag?.pointerId !== pointerId) return;
  panelResizeState = null;
  if (drag.frame) cancelAnimationFrame(drag.frame);
  if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
  panelDragWidth.value = null;
  if (!cancelled && drag.currentWidth !== drag.startWidth) {
    setWidth(drag.currentWidth);
  }
}

function onPanelResizeStart(event: PointerEvent): void {
  // While maximized there is no second column to trade width with.
  if (props.maximized) return;
  if (event.button !== 0 || panelResizeState) return;
  event.preventDefault();
  event.stopPropagation();
  const target = event.currentTarget as HTMLDivElement;
  target.focus({ preventScroll: true });
  const startWidth = clampWorkPanelWidth(renderPanelWidth.value, panelMinimum.value);
  panelResizeState = {
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startWidth,
    minimumWidth: panelMinimum.value,
    currentWidth: startWidth,
    frame: 0,
  };
  panelDragWidth.value = startWidth;
  target.setPointerCapture(event.pointerId);
}

function onPanelResizeMove(event: PointerEvent): void {
  const drag = panelResizeState;
  if (drag?.pointerId !== event.pointerId) return;
  drag.currentWidth = clampWorkPanelWidth(
    drag.startWidth + drag.startClientX - event.clientX,
    drag.minimumWidth,
  );
  if (drag.frame) return;
  drag.frame = requestAnimationFrame(() => {
    if (panelResizeState !== drag) return;
    drag.frame = 0;
    panelDragWidth.value = drag.currentWidth;
  });
}

function onPanelResizeCommit(event: PointerEvent): void {
  finishPanelResize(event.currentTarget as HTMLDivElement, event.pointerId, false);
}

function onPanelResizeCancel(event: PointerEvent): void {
  finishPanelResize(event.currentTarget as HTMLDivElement, event.pointerId, true);
}

function onPanelResizeKeyDown(event: KeyboardEvent): void {
  const drag = panelResizeState;
  if (event.key === "Escape" && drag) {
    event.preventDefault();
    finishPanelResize(event.currentTarget as HTMLDivElement, drag.pointerId, true);
    return;
  }
  // While maximized there is no second column to trade width with.
  if (props.maximized) return;
  const step = event.shiftKey ? 32 : 16;
  const { minimum, maximum } = workPanelWidthBounds(
    panelMinimum.value,
    layout.value.maxPanelWidth,
  );
  let nextWidth: number | null = null;
  if (event.key === "ArrowLeft") nextWidth = renderPanelWidth.value + step;
  else if (event.key === "ArrowRight") nextWidth = renderPanelWidth.value - step;
  else if (event.key === "Home") nextWidth = minimum;
  else if (event.key === "End") nextWidth = maximum;
  if (nextWidth === null) return;
  event.preventDefault();
  setWidth(clampWorkPanelWidth(nextWidth, minimum));
}

/**
 * Double-click reset: the default width, kept inside the same live bounds the
 * keyboard path uses, so a reset never breaches the MainChat floor or reopens a
 * compact panel wider than the window allows. A gesture that is still open (a
 * second pointer) must not overwrite the reset when it is finally released.
 */
function onPanelResizeReset(event: MouseEvent): void {
  // While maximized there is no second column to trade width with.
  if (props.maximized) return;
  const drag = panelResizeState;
  if (drag) finishPanelResize(event.currentTarget as HTMLDivElement, drag.pointerId, true);
  panelDragWidth.value = null;
  setWidth(workPanelResetWidth(panelMinimum.value, layout.value.maxPanelWidth));
}
</script>

<template>
  <aside
    ref="panelRootRef"
    class="work-panel"
    :class="{
      'is-maximized': maximized,
      'is-exit-pending': exiting && !exitAnimationReady,
      'is-exiting': exitAnimationReady,
    }"
    :style="panelStyle"
    data-testid="work-panel"
    :data-resizing="isResizing ? 'true' : undefined"
    :data-exiting="exiting ? 'true' : undefined"
    @animationend="onPanelAnimationEnd"
  >
    <div
      class="work-panel-resize no-drag"
      role="separator"
      aria-orientation="vertical"
      :aria-label="t('panel.resize')"
      :aria-valuemin="resizeMin"
      :aria-valuemax="resizeMax"
      :aria-valuenow="resizeNow"
      :aria-disabled="maximized || undefined"
      :data-maximized="maximized ? 'true' : undefined"
      :tabindex="0"
      @pointerdown="onPanelResizeStart"
      @pointermove="onPanelResizeMove"
      @pointerup="onPanelResizeCommit"
      @pointercancel="onPanelResizeCancel"
      @lostpointercapture="onPanelResizeCancel"
      @keydown="onPanelResizeKeyDown"
      @dblclick="onPanelResizeReset"
    />
    <div class="work-panel-main">
      <header class="work-panel-header">
        <div class="work-panel-tab-strip-wrap no-drag">
          <div
            v-if="subagentPanel"
            class="work-panel-subagent-heading"
            :aria-label="t('panel.subagent')"
          >
            <IconBot :size="15" />
            <span>{{ t("panel.subagent") }}</span>
          </div>
          <div
            v-else
            class="work-panel-tab-strip"
            role="tablist"
            :aria-label="t('panel.tabsLabel')"
            @wheel="onTabStripWheel"
          >
            <div
              v-for="tab in tabs"
              :key="tab.id"
              class="work-panel-tab"
              :class="{ active: tab.id === activeTabId }"
            >
              <button
                :ref="(node) => setTabButton(tab.id, node)"
                type="button"
                role="tab"
                :id="`work-panel-tab-${tab.id}`"
                :aria-selected="tab.id === activeTabId"
                :aria-controls="`work-panel-surface-${tab.id}`"
                :tabindex="tab.id === activeTabId ? 0 : -1"
                class="work-panel-tab-button"
                :title="tab.resource ?? tabLabel(tab)"
                @click="activateTab(tab.id)"
                @auxclick="onTabAuxClick($event, tab.id)"
                @keydown="onTabKeyDown($event, tab.id)"
              >
                <component :is="tabIcon(tab)" :size="14" />
                <span class="work-panel-tab-label">{{ tabLabel(tab) }}</span>
              </button>
              <button
                type="button"
                class="work-panel-tab-close"
                :aria-label="t('panel.closeTab', { name: tabLabel(tab) })"
                :title="t('panel.closeTab', { name: tabLabel(tab) })"
                @pointerdown.stop
                @click="closeTabAndFocus(tab.id)"
              >
                <IconClose :size="12" />
              </button>
            </div>
          </div>
        </div>
        <div class="work-panel-actions no-drag">
          <TooltipButton
            v-if="subagentPanel"
            type="button"
            class="work-panel-subagent-back"
            :label="t('panel.subagentClose')"
            :aria-label="t('panel.subagentClose')"
            @click="emit('close-subagent-panel')"
          >
            <IconChevronLeft :size="15" />
          </TooltipButton>
          <TooltipButton
            v-else
            type="button"
            class="work-panel-new-tab"
            :label="t('panel.new.open')"
            :aria-label="t('panel.new.open')"
            @click="store.appState?.openNewWorkPanelTab()"
          >
            <IconPlus :size="16" />
          </TooltipButton>
          <TooltipButton
            type="button"
            class="work-panel-maximize"
            :label="t(maximized ? 'panel.restore' : 'panel.maximize')"
            :aria-label="t(maximized ? 'panel.restore' : 'panel.maximize')"
            :aria-pressed="maximized"
            @click="emit('toggle-maximize')"
          >
            <IconPanelRestore v-if="maximized" :size="15" />
            <IconPanelMaximize v-else :size="15" />
          </TooltipButton>
        </div>
      </header>
      <div class="work-panel-body">
        <SubagentPanel v-if="subagentPanel" :selection="subagentPanel" />
        <div
          v-if="!subagentPanel && activeTab && activeTab.kind === 'review'"
          :id="`work-panel-surface-${activeTab.id}`"
          class="work-panel-tabpane"
          role="tabpanel"
          :aria-labelledby="`work-panel-tab-${activeTab.id}`"
        >
          <ReviewTab />
        </div>
        <div
          v-else-if="!subagentPanel && activeTab && activeTab.kind === 'file'"
          :key="activeTab.id"
          :id="`work-panel-surface-${activeTab.id}`"
          class="work-panel-tabpane"
          role="tabpanel"
          :aria-labelledby="`work-panel-tab-${activeTab.id}`"
        >
          <FilesTab />
        </div>
        <div
          v-else-if="
            !subagentPanel &&
            activeTab &&
            activeTab.kind === 'plugin' &&
            activePluginRef
          "
          :key="activeTab.id"
          :id="`work-panel-surface-${activeTab.id}`"
          class="work-panel-tabpane"
          role="tabpanel"
          :aria-labelledby="`work-panel-tab-${activeTab.id}`"
        >
          <PluginViewTab
            :plugin-id="activePluginRef.pluginId"
            :view-id="activePluginRef.viewId"
            :title="activeLabel"
            :icon="activePluginView?.icon"
            :session-id="activeSessionId ?? undefined"
            :location="activeTab.location"
            :blocked="exiting || panelBlocked || blockingOverlayActive"
          />
        </div>
        <div
          v-else-if="!subagentPanel && (!activeTab || activeTab.kind === 'new')"
          class="work-panel-tabpane"
          data-testid="work-panel-empty"
          :id="activeTab ? `work-panel-surface-${activeTab.id}` : undefined"
          :role="activeTab ? 'tabpanel' : undefined"
          :aria-labelledby="
            activeTab ? `work-panel-tab-${activeTab.id}` : undefined
          "
        >
          <div class="work-panel-launcher">
            <div class="work-panel-launcher-title">{{ t("panel.new.title") }}</div>
            <div
              class="work-panel-launcher-list"
              role="group"
              :aria-label="t('panel.toolsAndPanels')"
            >
              <button
                v-for="item in tools"
                :key="item.id"
                type="button"
                class="work-panel-launcher-row"
                :data-work-panel-launcher-item="item.id"
                @click="
                  selectTool(item, activeTab?.kind === 'new' ? activeTab.id : undefined)
                "
              >
                <span class="work-panel-launcher-icon" aria-hidden="true">
                  <component v-if="item.icon" :is="item.icon" :size="15" />
                  <span v-else class="work-panel-view-initial">{{ item.initial }}</span>
                </span>
                <span class="work-panel-launcher-label">{{ item.label }}</span>
                <kbd v-if="item.shortcut">{{ item.shortcut }}</kbd>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </aside>
</template>
