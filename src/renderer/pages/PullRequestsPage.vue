<script setup lang="ts">
/**
 * Pull requests destination.
 *
 * The `PullRequestsPage` component. The decisions that are not
 * mechanical:
 *
 *  1. **The store is read through `store.appState`.** Four
 *     selector hooks (`workspace`, `openProject`, `newSession`, `setPage`,
 *     `sendPrompt`); here the state is a `computed` over the `shallowRef` and
 *     the actions are reached through the same composed object inside the
 *     handlers, exactly as `OnboardingChecklist.vue` and `SearchDialog.vue` do.
 *     `getState()` is never called from a component.
 *  2. **The mount fetch is `watch(., { immediate: true })`.** A
 *     `useEffect(., [workspace?.path])` ran on mount and again whenever the
 *     active project changed; `immediate` reproduces the mount run, and the
 *     watched getter is the same `workspace?.path` dependency.
 *  3. **`useMemo` becomes `computed`.** `filtered` and `counts` are the same
 *     derivations, with `counts` consumed by the tab labels below.
 *  4. **The tab strip's template-literal class becomes static + object
 *     `:class`.** `` `dest-filter ${filter === id ? "active" : ""}` `` renders
 *     exactly `class="dest-filter"` / `class="dest-filter active"`; the split is
 *     what the class contract can read.
 *  5. **`TooltipButton`'s prop is `label`, not `tooltip`.** dcode folds
 *     the `Tooltip` and `TooltipButton` into `components/TooltipButton.vue`
 *     and names the text prop `label`; `ariaLabel` keeps its name and still wins
 *     the accessible name.
 *  6. **The row meta line is a helper, not an inline expression.** The
 *     inlined `[author, head && base ? "head → base" : null].filter(Boolean).join(" · ")`;
 *     the same array is built in `rowMeta` so the template stays a single
 *     interpolation. The separator is U+00B7 with spaces, verbatim.
 *  7. This page is not memoized. The default export is what `AppShell.vue`'s
 *     `defineAsyncComponent(() => import(...))` resolves.
 *     `defineAsyncComponent(() => import(...))` resolves.
 */
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { PullRequestSummary } from "@dcode/shared";
import { useAppStore } from "../stores/app-store";
import { api } from "../lib/api";
import Badge from "../components/ui/Badge.vue";
import Button from "../components/ui/Button.vue";
import Panel from "../components/ui/Panel.vue";
import TooltipButton from "../components/TooltipButton.vue";
import { IconExternal, IconPullRequest } from "../lib/icons";

type Filter = "open" | "draft" | "all";

const { t } = useI18n();
const store = useAppStore();

const workspace = computed(() => store.appState?.workspace);

const pulls = ref<PullRequestSummary[]>([]);
const error = ref<string | null>(null);
const loading = ref(false);
const filter = ref<Filter>("open");

async function refresh() {
  loading.value = true;
  try {
    const res = await api.listPullRequests();
    pulls.value = res.pulls || [];
    error.value = res.error || null;
  } catch (e) {
    pulls.value = [];
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

/* See note 2: `immediate` is the mount run. */
watch(
  () => workspace.value?.path,
  () => {
    void refresh();
  },
  { immediate: true },
);

const filtered = computed(() => {
  if (filter.value === "all") return pulls.value;
  if (filter.value === "draft") return pulls.value.filter((p) => p.isDraft);
  return pulls.value.filter((p) => !p.isDraft);
});

const counts = computed(() => {
  const draft = pulls.value.filter((p) => p.isDraft).length;
  return {
    open: pulls.value.length - draft,
    draft,
    all: pulls.value.length,
  };
});

/* The filter array is built once here rather than inline in the render; the order and labels are kept. */
const filterTabs = computed(() => [
  { id: "open" as const, label: t("pulls.filterOpen"), count: counts.value.open },
  { id: "draft" as const, label: t("pulls.filterDraft"), count: counts.value.draft },
  { id: "all" as const, label: t("pulls.filterAll"), count: counts.value.all },
]);

function setFilter(id: Filter) {
  filter.value = id;
}

/** See note 6: `[author, "head → base"].filter(Boolean).join(" · ")`. */
function rowMeta(pr: PullRequestSummary): string {
  return [
    pr.author,
    pr.headRefName && pr.baseRefName
      ? `${pr.headRefName} → ${pr.baseRefName}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Header action: open a session and ask it to survey the repository's PRs. */
async function reviewRepository() {
  await store.appState?.newSession();
  store.appState?.setPage("chat");
  await store.appState?.sendPrompt(
    "List open pull requests and current branch status for this repository. Summarize what needs review.",
  );
}

/** Row action: the same flow scoped to one pull request. */
async function reviewPullRequest(pr: PullRequestSummary) {
  await store.appState?.newSession();
  store.appState?.setPage("chat");
  await store.appState?.sendPrompt(
    `Review pull request #${pr.number}${pr.title ? ` (${pr.title})` : ""}. Summarize changes, risks, and suggested next steps.`,
  );
}
</script>

<template>
  <div class="thread-scroll">
    <div class="page-frame">
      <div class="page-header">
        <div>
          <h1 class="page-title">{{ t("pulls.title") }}</h1>
        </div>
        <div class="flex gap-2">
          <Button variant="secondary" :disabled="loading" @click="void refresh()">
            {{ loading ? "…" : t("pulls.refresh") }}
          </Button>
          <Button v-if="workspace?.path" variant="primary" @click="reviewRepository">
            {{ t("pulls.review") }}
          </Button>
        </div>
      </div>

      <div v-if="workspace?.path" class="dest-toolbar">
        <div class="dest-filters" role="tablist" :aria-label="t('pulls.filters')">
          <button
            v-for="tab in filterTabs"
            :key="tab.id"
            type="button"
            role="tab"
            :aria-selected="filter === tab.id"
            class="dest-filter"
            :class="{ active: filter === tab.id }"
            @click="setFilter(tab.id)"
          >
            {{ tab.label }}
            <span class="ml-1 text-text-muted">{{ tab.count }}</span>
          </button>
        </div>
      </div>

      <Panel v-if="!workspace?.path" class="page-card page-empty">
        <div class="page-empty-icon">
          <IconPullRequest :size="20" />
        </div>
        <div class="text-base-plus font-medium">{{ t("pulls.emptyTitle") }}</div>
        <Button class="mt-5" variant="primary" @click="void store.appState?.openProject()">
          {{ t("project.open") }}
        </Button>
      </Panel>
      <Panel v-else-if="filtered.length === 0" class="page-card page-empty">
        <div class="page-empty-icon">
          <IconPullRequest :size="20" />
        </div>
        <div class="text-base-plus font-medium">{{ t("pulls.emptyTitle") }}</div>
        <div v-if="error && error !== 'NO_WORKSPACE'" class="mt-2 max-w-md text-md text-text-secondary">
          {{ error }}
        </div>
      </Panel>
      <div v-else class="dest-list">
        <div v-for="pr in filtered" :key="pr.number" class="dest-row">
          <div class="dest-row-icon">
            <IconPullRequest :size="16" />
          </div>
          <div class="dest-row-body">
            <div class="dest-row-title">
              <span class="font-mono text-sm font-normal text-text-muted">
                #{{ pr.number }}
              </span>
              <span class="min-w-0 truncate">{{ pr.title }}</span>
              <Badge v-if="pr.isDraft" tone="warning">{{ t("pulls.draft") }}</Badge>
              <Badge v-else tone="success">{{ t("pulls.open") }}</Badge>
            </div>
            <div class="dest-row-meta">
              {{ rowMeta(pr) }}
            </div>
          </div>
          <div class="dest-row-actions">
            <TooltipButton
              as="button"
              type="button"
              class="icon-btn icon-btn-square"
              :label="t('pulls.open')"
              :aria-label="t('pulls.open')"
              @click="void api.browserOpenExternal(pr.url)"
            >
              <IconExternal :size="15" />
            </TooltipButton>
            <Button size="sm" variant="secondary" @click="reviewPullRequest(pr)">
              {{ t("pulls.review") }}
            </Button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
