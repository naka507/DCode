<script setup lang="ts">
/**
 * Notification inbox popover.
 *
 * The manual
 * `document.body` because it is positioned
 * against its trigger, not against the viewport: the `#dcode-overlays`
 * host sets `pointer-events: none` for anything that is not a direct `.overlay`
 * child, so a popover parked there could not be clicked.
 *
 * Two adaptations forced by Vue:
 *
 *   1. The trigger element is reached through `rootRef` (`querySelector`) rather
 *      than a forwarded ref: the shared `TooltipButton.vue` renders an
 *      anchor plus a teleported label, so it has no single element to expose.
 *   2. `onBeforeOpen` stays a prop and also emits `before-open`, so a caller can
 *      use whichever style it prefers.
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { AppNotification } from "@dcode/shared";
import { useAppStore } from "../stores/app-store";
import {
  inboxNotifications,
  inboxUnreadCount,
} from "../lib/notification-inbox";
import {
  IconBell,
  IconCheckCheck,
  IconCircleAlert,
  IconCircleCheck,
  IconTrash,
} from "../lib/icons";
import TooltipButton from "./TooltipButton.vue";

type NotificationFilter = "all" | "unread";

const FILTERS = ["all", "unread"] as const;

const props = defineProps<{ onBeforeOpen?: () => void }>();

const emit = defineEmits<{ "before-open": [] }>();

function formatRelativeTime(
  value: string,
  locale: string,
  justNow: string,
): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return justNow;

  const delta = timestamp - Date.now();
  const absoluteDelta = Math.abs(delta);
  if (absoluteDelta < 45_000) return justNow;

  try {
    const formatter = new Intl.RelativeTimeFormat(locale || undefined, {
      numeric: "auto",
    });
    if (absoluteDelta < 60 * 60_000) {
      return formatter.format(Math.round(delta / 60_000), "minute");
    }
    if (absoluteDelta < 24 * 60 * 60_000) {
      return formatter.format(Math.round(delta / (60 * 60_000)), "hour");
    }
    if (absoluteDelta < 7 * 24 * 60 * 60_000) {
      return formatter.format(Math.round(delta / (24 * 60 * 60_000)), "day");
    }
    return new Intl.DateTimeFormat(locale || undefined, {
      month: "short",
      day: "numeric",
      year:
        new Date(timestamp).getFullYear() === new Date().getFullYear()
          ? undefined
          : "numeric",
    }).format(timestamp);
  } catch {
    return justNow;
  }
}

const { t, locale } = useI18n();
const store = useAppStore();

const storedNotifications = computed(() => store.appState?.notifications ?? []);
// Successful completions are hidden here; they still drive the sidebar outcome
// badge and native notifications from the unfiltered store.
const notifications = computed(() =>
  inboxNotifications(storedNotifications.value),
);
const unreadCount = computed(() =>
  inboxUnreadCount(storedNotifications.value),
);

const open = ref(false);
const busy = ref(false);
const filter = ref<NotificationFilter>("all");
const popoverPos = ref<{ bottom: number; left: number } | null>(null);
const rootRef = ref<HTMLDivElement | null>(null);
const popoverRef = ref<HTMLDivElement | null>(null);

const visibleNotifications = computed(() =>
  filter.value === "unread"
    ? notifications.value.filter((notification) => !notification.readAt)
    : notifications.value,
);

/** The trigger is the one `.notification-trigger` inside this component. */
function triggerElement(): HTMLButtonElement | null {
  return rootRef.value?.querySelector<HTMLButtonElement>(".notification-trigger") ?? null;
}

function closePopover(restoreFocus = true) {
  open.value = false;
  if (restoreFocus) {
    requestAnimationFrame(() => triggerElement()?.focus());
  }
}

/**
 * Anchor the popover above the trigger. This runs as a layout
 * effect; `flush: "post"` runs it after the popover is in the DOM, and the
 * resize listener only exists while the popover is open.
 */
function placePopover() {
  const rect = triggerElement()?.getBoundingClientRect();
  if (!rect) return;
  const width = Math.min(360, window.innerWidth - 24);
  const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
  popoverPos.value = {
    bottom: Math.max(12, window.innerHeight - rect.top + 8),
    left,
  };
}

watch(
  open,
  (isOpen, _previous, onCleanup) => {
    if (!isOpen) {
      popoverPos.value = null;
      return;
    }
    placePopover();
    window.addEventListener("resize", placePopover);
    onCleanup(() => window.removeEventListener("resize", placePopover));
  },
  { flush: "post" },
);

onBeforeUnmount(() => window.removeEventListener("resize", placePopover));

// Opening refreshes the inbox, then moves focus to the first meaningful item.
watch(
  open,
  (isOpen) => {
    if (!isOpen) return;
    busy.value = true;
    void Promise.resolve(store.appState?.refreshNotifications())
      .catch(() =>
        store.appState?.showToast(t("notifications.actionFailed"), {
          variant: "error",
        }),
      )
      .finally(() => {
        busy.value = false;
        requestAnimationFrame(() => {
          popoverRef.value
            ?.querySelector<HTMLButtonElement>(
              ".notification-item.unread, .notification-item, .notification-filter.active",
            )
            ?.focus();
        });
      });
  },
  { flush: "post" },
);

// Dismissal: an outside pointer press or Escape, while the popover is open.
watch(
  open,
  (isOpen, _previous, onCleanup) => {
    if (!isOpen) return;
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.value?.contains(target)) return;
      if (popoverRef.value?.contains(target)) return;
      closePopover(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closePopover();
    };
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    });
  },
);

function onPopoverKeyDown(event: KeyboardEvent) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const container = event.currentTarget as HTMLElement | null;
  const buttons = Array.from(
    container?.querySelectorAll<HTMLButtonElement>(
      ".notification-item:not(:disabled)",
    ) ?? [],
  );
  if (!buttons.length) return;
  event.preventDefault();
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
  let next = 0;
  if (event.key === "End") next = buttons.length - 1;
  else if (event.key === "ArrowUp") {
    next = Math.max(0, current < 0 ? 0 : current - 1);
  } else if (event.key === "ArrowDown") {
    next = Math.min(buttons.length - 1, current < 0 ? 0 : current + 1);
  }
  buttons[next]?.focus();
}

function focusActiveFilter() {
  requestAnimationFrame(() => {
    popoverRef.value
      ?.querySelector<HTMLButtonElement>(".notification-filter.active")
      ?.focus();
  });
}

async function runToolbarAction(action: () => Promise<unknown> | undefined) {
  busy.value = true;
  try {
    await action();
    focusActiveFilter();
  } catch {
    store.appState?.showToast(t("notifications.actionFailed"), {
      variant: "error",
    });
  } finally {
    busy.value = false;
  }
}

async function activateNotification(notification: AppNotification) {
  closePopover();
  try {
    await store.appState?.openNotification(notification.id);
  } catch {
    store.appState?.showToast(t("notifications.actionFailed"), {
      variant: "error",
    });
  }
}

function toggleOpen() {
  if (open.value) {
    closePopover();
    return;
  }
  props.onBeforeOpen?.();
  emit("before-open");
  open.value = true;
}

const unreadLabel = computed(() =>
  unreadCount.value > 0
    ? t("notifications.openUnread", { count: unreadCount.value })
    : t("notifications.open"),
);
const emptyUnread = computed(() => filter.value === "unread");

function notificationTitle(notification: AppNotification) {
  return t(
    notification.kind === "task.failed"
      ? "notifications.failedTitle"
      : "notifications.completedTitle",
    { sessionTitle: notification.sessionTitle || t("chat.untitledTask") },
  );
}

function notificationBody(notification: AppNotification) {
  if (notification.kind !== "task.failed") {
    return t("notifications.completedBody");
  }
  return notification.errorCode
    ? t("notifications.failedBodyWithCode", { code: notification.errorCode })
    : t("notifications.failedBody");
}

function relativeTime(value: string) {
  return formatRelativeTime(value, locale.value, t("notifications.justNow"));
}
</script>

<template>
  <div ref="rootRef" class="notification-center">
    <TooltipButton
      as="button"
      type="button"
      class="footer-notification notification-trigger"
      :class="{ active: open }"
      :label="unreadLabel"
      :aria-label="unreadLabel"
      aria-haspopup="dialog"
      aria-controls="notification-popover"
      :aria-expanded="open"
      @click="toggleOpen"
    >
      <IconBell :size="14" aria-hidden="true" />
      <span v-if="unreadCount > 0" class="notification-badge" aria-hidden="true">
        {{ unreadCount > 99 ? "99+" : unreadCount }}
      </span>
    </TooltipButton>
    <span class="sr-only" role="status" aria-live="polite">{{ unreadLabel }}</span>

    <Teleport v-if="open && popoverPos" to="body">
      <div
        ref="popoverRef"
        id="notification-popover"
        class="notification-popover notification-popover-portaled"
        role="dialog"
        aria-labelledby="notification-title"
        :style="{ bottom: `${popoverPos.bottom}px`, left: `${popoverPos.left}px` }"
        @keydown="onPopoverKeyDown"
      >
        <header class="notification-header">
          <h2 id="notification-title">{{ t("notifications.title") }}</h2>
          <div class="notification-actions">
            <TooltipButton
              as="button"
              type="button"
              class="notification-action"
              :label="t('notifications.markAllRead')"
              :aria-label="t('notifications.markAllRead')"
              :disabled="busy || unreadCount === 0"
              @click="runToolbarAction(() => store.appState?.markAllNotificationsRead())"
            >
              <IconCheckCheck :size="15" aria-hidden="true" />
            </TooltipButton>
            <TooltipButton
              as="button"
              type="button"
              class="notification-action"
              :label="t('notifications.clearAll')"
              :aria-label="t('notifications.clearAll')"
              :disabled="busy || notifications.length === 0"
              @click="runToolbarAction(() => store.appState?.clearNotifications())"
            >
              <IconTrash :size="15" aria-hidden="true" />
            </TooltipButton>
          </div>
        </header>

        <div
          class="notification-filters"
          role="group"
          :aria-label="t('notifications.title')"
        >
          <button
            v-for="value in FILTERS"
            :key="value"
            type="button"
            class="notification-filter"
            :class="{ active: filter === value }"
            :aria-pressed="filter === value"
            @click="filter = value"
          >
            {{ t(`notifications.${value}`) }}
          </button>
        </div>

        <ul v-if="visibleNotifications.length > 0" class="notification-list">
          <li v-for="notification in visibleNotifications" :key="notification.id">
            <button
              type="button"
              class="notification-item"
              :class="{ unread: !notification.readAt }"
              :data-notification-id="notification.id"
              :disabled="busy"
              @click="activateNotification(notification)"
            >
              <span
                class="notification-kind-icon"
                :class="{ failed: notification.kind === 'task.failed' }"
                aria-hidden="true"
              >
                <IconCircleAlert v-if="notification.kind === 'task.failed'" :size="17" />
                <IconCircleCheck v-else :size="17" />
              </span>
              <span class="notification-copy">
                <span class="notification-item-title">{{ notificationTitle(notification) }}</span>
                <span class="notification-item-body">{{ notificationBody(notification) }}</span>
              </span>
              <time class="notification-time" :datetime="notification.createdAt">
                {{ relativeTime(notification.createdAt) }}
              </time>
              <span v-if="!notification.readAt" class="notification-unread-dot" aria-hidden="true" />
            </button>
          </li>
        </ul>
        <div v-else class="notification-empty" role="status">
          <IconBell :size="22" aria-hidden="true" />
          <strong>
            {{
              t(
                emptyUnread
                  ? "notifications.emptyUnreadTitle"
                  : "notifications.emptyTitle",
              )
            }}
          </strong>
          <span>
            {{
              t(
                emptyUnread
                  ? "notifications.emptyUnreadBody"
                  : "notifications.emptyBody",
              )
            }}
          </span>
        </div>
      </div>
    </Teleport>
  </div>
</template>
