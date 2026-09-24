<script setup lang="ts">
/**
 * Scheduled destinations view.
 *
 * The `ScheduledPage` component. The decisions that are not mechanical:
 *
 * 1. **The four selector hooks become reads off the composed store.** The
 *     destructured `showToast`, `selectSession`, `setPage` and `sendPrompt` out
 *     of `useAppStore`; here they are reached through `store.appState` inside
 *     the handlers, the same way `PullRequestsPage.vue` and
 *     `OnboardingChecklist.vue` do. `getState()` is never called from a
 *     component.
 * 2. **The mount fetch is `onMounted`.** The `useEffect(., [])` has no
 *     dependencies at all, so it is a single mount run and not a watcher.
 *  3. **`i18n.resolvedLanguage ?? i18n.language` becomes the vue-i18n
 *     `locale`.** Both name the active locale, and `toLocaleString` accepts it
 *     directly; the `|| undefined` fallback is the one `NotificationCenter.vue`
 *     uses so an empty locale still resolves to the runtime default.
 *  4. **The `<Select>`/`<Input>`/`<Textarea>` values are `:value` plus an
 * `@input` / `@change` handler, not `v-model`.** The page passes a
 *     controlled `value` and a change handler; the primitives forward both
 *     through attribute fallthrough, so the DOM is the same one.
 * 5. This page is not memoized. The default export is required by
 *     `AppShell.vue`'s `defineAsyncComponent(() => import(...))`.
 *
 * The utility class names (`space-y-3`, `text-md-plus`, `flex`, ...) are copied
 * verbatim from the markup; the hand-written partials under
 * `src/renderer/styles/` never defined them, so they are allowlisted for this
 * file in `tests/helpers/class-contract.mjs`.
 */
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { ScheduledTask } from "@dcode/shared";
import { useAppStore } from "../stores/app-store";
import { api } from "../lib/api";
import Badge from "../components/ui/Badge.vue";
import Button from "../components/ui/Button.vue";
import Field from "../components/ui/Field.vue";
import Input from "../components/ui/Input.vue";
import Panel from "../components/ui/Panel.vue";
import Select from "../components/ui/Select.vue";
import Textarea from "../components/ui/Textarea.vue";
import { IconClock } from "../lib/icons";

const { t, locale } = useI18n();
const store = useAppStore();

const tasks = ref<ScheduledTask[]>([]);
const title = ref("");
const prompt = ref("");
const cadence = ref<ScheduledTask["cadence"]>("manual");
const loading = ref(false);

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    const res = await api.listScheduled();
    tasks.value = res.tasks || [];
  } catch (e) {
    store.appState?.showToast(e instanceof Error ? e.message : String(e), {
      variant: "error",
    });
  } finally {
    loading.value = false;
  }
}

/* See note 2: `useEffect(., [])` is a single mount run. */
onMounted(() => {
  void refresh();
});

function cadenceLabel(value: ScheduledTask["cadence"]): string {
  if (value === "hourly") return t("scheduled.cadenceHourly");
  if (value === "daily") return t("scheduled.cadenceDaily");
  if (value === "weekly") return t("scheduled.cadenceWeekly");
  return t("scheduled.cadenceManual");
}

/* See note 3: the active locale, with the runtime default when it is unset. */
function lastRunLabel(task: ScheduledTask): string {
  return task.lastRunAt
    ? new Date(task.lastRunAt).toLocaleString(locale.value || undefined)
    : t("scheduled.never");
}

function onTitleInput(event: Event): void {
  title.value = (event.target as HTMLInputElement).value;
}

function onPromptInput(event: Event): void {
  prompt.value = (event.target as HTMLTextAreaElement).value;
}

function onCadenceChange(event: Event): void {
  cadence.value = (event.target as HTMLSelectElement)
    .value as ScheduledTask["cadence"];
}

async function createTask(): Promise<void> {
  try {
    await api.createScheduled({
      title: title.value.trim() || t("chat.untitledTask"),
      prompt: prompt.value.trim(),
      cadence: cadence.value,
      enabled: true,
    });
    title.value = "";
    prompt.value = "";
    cadence.value = "manual";
    await refresh();
    store.appState?.showToast(t("scheduled.create"), { variant: "success" });
  } catch (e) {
    store.appState?.showToast(e instanceof Error ? e.message : String(e), {
      variant: "error",
    });
  }
}

async function runNow(task: ScheduledTask): Promise<void> {
  try {
    const res = await api.runScheduled(task.id);
    await store.appState?.selectSession(res.sessionId);
    store.appState?.setPage("chat");
    await store.appState?.sendPrompt(res.prompt);
    await refresh();
  } catch (e) {
    store.appState?.showToast(e instanceof Error ? e.message : String(e), {
      variant: "error",
    });
  }
}

 /* Neither of these is guarded, so a rejected call stays unhandled. */
async function toggleTask(task: ScheduledTask): Promise<void> {
  await api.updateScheduled({ id: task.id, enabled: !task.enabled });
  await refresh();
}

async function deleteTask(task: ScheduledTask): Promise<void> {
  await api.deleteScheduled(task.id);
  await refresh();
}
</script>

<template>
  <div class="thread-scroll">
    <div class="page-frame">
      <div class="page-header">
        <div>
          <h1 class="page-title">{{ t("scheduled.title") }}</h1>
        </div>
      </div>

      <div class="dest-create space-y-3">
        <div class="text-md-plus font-medium">{{ t("scheduled.create") }}</div>
        <Field :label="t('nav.newTask')">
          <Input
            :value="title"
            :placeholder="t('chat.untitledTask')"
            @input="onTitleInput"
          />
        </Field>
        <Field :label="t('scheduled.prompt')">
          <Textarea
            :rows="3"
            :value="prompt"
            :placeholder="t('scheduled.promptPlaceholder')"
            @input="onPromptInput"
          />
        </Field>
        <div class="flex flex-wrap items-end gap-3">
          <div class="min-w-[160px] flex-1">
            <Field :label="t('scheduled.cadence')">
              <Select :value="cadence" @change="onCadenceChange">
                <option value="manual">{{ t("scheduled.cadenceManual") }}</option>
                <option value="hourly">{{ t("scheduled.cadenceHourly") }}</option>
                <option value="daily">{{ t("scheduled.cadenceDaily") }}</option>
                <option value="weekly">{{ t("scheduled.cadenceWeekly") }}</option>
              </Select>
            </Field>
          </div>
          <Button
            variant="primary"
            :disabled="loading || !prompt.trim()"
            @click="void createTask()"
          >
            {{ t("scheduled.create") }}
          </Button>
        </div>
      </div>

      <div class="dest-section-label">{{ t("scheduled.tasks") }}</div>

      <Panel v-if="tasks.length === 0" class="page-card page-empty">
        <div class="page-empty-icon">
          <IconClock :size="20" />
        </div>
        <div class="text-base-plus font-medium">{{ t("scheduled.emptyTitle") }}</div>
      </Panel>
      <div v-else class="dest-list">
        <div v-for="task in tasks" :key="task.id" class="dest-row">
          <div class="dest-row-icon">
            <IconClock :size="16" />
          </div>
          <div class="dest-row-body">
            <div class="dest-row-title">
              <span class="min-w-0 truncate">{{ task.title }}</span>
              <Badge :tone="task.enabled ? 'success' : 'neutral'">
                {{ task.enabled ? t("scheduled.enabled") : t("scheduled.disabled") }}
              </Badge>
              <Badge tone="neutral">{{ cadenceLabel(task.cadence) }}</Badge>
            </div>
            <div class="dest-row-meta line-clamp-2">{{ task.prompt }}</div>
            <div class="dest-row-meta">
              {{ t("scheduled.lastRun") }}:
              {{ lastRunLabel(task) }}
            </div>
          </div>
          <div class="dest-row-actions">
            <Button
              size="sm"
              variant="primary"
              @click="void runNow(task)"
            >
              {{ t("scheduled.runNow") }}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              @click="void toggleTask(task)"
            >
              {{ task.enabled ? t("scheduled.disabled") : t("scheduled.enabled") }}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              @click="void deleteTask(task)"
            >
              {{ t("scheduled.delete") }}
            </Button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
