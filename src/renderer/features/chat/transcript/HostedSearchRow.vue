<script setup lang="ts">
/**
 * One provider-hosted web search round, rendered on the same tool-row idiom
 * as thinking and tool calls: icon + name + summary header, chevron
 * disclosure, sources in the body. Sources link out as plain text — no
 * favicon fetches — so reading a transcript never leaks source hostnames to
 * a third party nor renders broken image placeholders (#579).
 *
 * The `HostedSearchRow` component.
 *
 * The decisions that are not mechanical:
 *
 *  1. **The prop is one round, not the whole message.** The row is
 *     keyed by round rather than by message, so `message: UiMessage` became
 *     `round: HostedSearchRound` and the caller (`ActivityGroupRows.vue`) now
 *     renders one row per round.
 *  2. **`useAutomaticDisclosure` takes a getter.** Its `automaticOpen` argument
 *     is `autoOpen && !failed` (39cde7c0), which changes with the streamed
 *     round; a plain boolean would freeze the first render's value. The gate no
 *     longer asks for `status === "completed"`: the row is opened because the
 *     activity group named it the last detailed row, and only a failed round
 *     stays collapsed.
 *  3. **`onUserInteraction` is the `user-interaction` emit.** The earlier version's
 *     only caller (`ActivityGroup`) passes `claimDisclosure` to stop the
 *     automatic disclosure from overriding a user's own toggle.
 *  4. **Sources are plain `<a>` links.** Both the favicon
 *     component and `openHttpUrl` are gone: `target="_blank"` plus
 *     `rel="noopener noreferrer"` is the whole behaviour.
 *  5. **`showAll` is gone.** The pre-revert "View N more sources" *button*
 *     became a non-interactive `<span class="hosted-search-more">` at HEAD.
 *  6. **`aria-hidden="true"` is explicit.** A bare
 *     `aria-hidden` on the glyph wrappers would render as `""` in a Vue
 *     template, so the value is spelled out.
 *  7. A Vue component re-renders only when the
 *     values its template reads change.
 */
import { computed, useId } from "vue";
import { useI18n } from "vue-i18n";
import type { HostedSearchRound } from "@dcode/shared";
import { IconChevronRight, IconCircleAlert, IconGlobe } from "../../../lib/icons";
import DisclosureCollapseRail from "./DisclosureCollapseRail.vue";
import { useAutomaticDisclosure } from "./shared";

/** The preview count, `5`. */
const HOSTED_SEARCH_PREVIEW_COUNT = 5;

const props = withDefaults(
  defineProps<{
    round: HostedSearchRound;
    streaming: boolean;
    autoOpen?: boolean;
  }>(),
  { autoOpen: false },
);

const emit = defineEmits<{ "user-interaction": [] }>();

const { t } = useI18n();
const detailsId = useId();

/** The bare hostname, `www.` stripped. */
function sourceHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

const searching = computed(
  () => props.streaming && props.round.status === "searching",
);
const failed = computed(() => props.round.status === "failed");

const disclosure = useAutomaticDisclosure(() => props.autoOpen && !failed.value);
const { open, toggle, collapse, titleRef } = disclosure;

function toggleRow(): void {
  emit("user-interaction");
  toggle();
}

function collapseRow(): void {
  emit("user-interaction");
  collapse();
}

const sources = computed(() => props.round.sources ?? []);

/**
 * The opened page leads the body list; dedupe against extracted sources.
 * `filter((source) => source.url !== round.url)`.
 */
const links = computed(() => [
  ...(props.round.url ? [{ url: props.round.url }] : []),
  ...sources.value.filter((source) => source.url !== props.round.url),
]);

const shown = computed(() => links.value.slice(0, HOSTED_SEARCH_PREVIEW_COUNT));
const hidden = computed(() => Math.max(0, links.value.length - shown.value.length));
const expandable = computed(() => Boolean(props.round.query) || links.value.length > 0);

const summary = computed(
  () =>
    props.round.query ??
    (props.round.url
      ? sourceHost(props.round.url)
      : sources.value.length > 0
        ? t("chat.webSearchSources", { count: sources.value.length })
        : ""),
);

const name = computed(() =>
  failed.value
    ? t("chat.webSearchFailed")
    : searching.value
      ? t("chat.webSearching")
      : props.round.kind === "openPage"
        ? t("chat.webOpenPage")
        : props.round.kind === "findInPage"
          ? t("chat.webFindInPage")
          : t("chat.webSearch"),
);

/**
 * One row per rendered source. The host span is rendered only when the source
 * carried its own title
 * (`host && source.title`), falling back to the host or the raw URL as the
 * label otherwise.
 */
const shownRows = computed(() =>
  shown.value.map((source) => {
    const host = sourceHost(source.url);
    return {
      url: source.url,
      host,
      label: source.title || host || source.url,
      showHost: Boolean(host && source.title),
    };
  }),
);
</script>

<template>
  <div class="tool-row hosted-search" :class="{ open }">
    <button
      type="button"
      ref="titleRef"
      class="tool-row-header"
      :aria-expanded="open"
      :aria-controls="expandable ? detailsId : undefined"
      :disabled="!expandable"
      @click="toggleRow"
    >
      <span class="tool-row-icon" aria-hidden="true">
        <IconCircleAlert v-if="failed" :size="15" />
        <IconGlobe v-else :size="15" />
      </span>
      <span
        class="tool-row-name"
        :class="{ running: searching, 'turn-process-error': failed }"
      >
        {{ name }}
      </span>
      <span v-if="summary" class="tool-row-summary">{{ summary }}</span>
      <span v-if="expandable" class="tool-row-caret" aria-hidden="true">
        <IconChevronRight :size="12" />
      </span>
    </button>
    <div v-if="open && expandable" :id="detailsId" class="tool-row-body">
      <DisclosureCollapseRail
        :label="t('chat.collapseDetails')"
        :on-collapse="collapseRow"
      />
      <div v-if="round.query" class="hosted-search-query selectable">
        {{ round.query }}
      </div>
      <ul v-if="shownRows.length > 0" class="hosted-search-sources">
        <li v-for="row in shownRows" :key="row.url">
          <a :href="row.url" target="_blank" rel="noopener noreferrer">
            <span class="hosted-search-source-title">{{ row.label }}</span>
            <span v-if="row.showHost" class="hosted-search-source-host">
              {{ row.host }}
            </span>
          </a>
        </li>
      </ul>
      <span v-if="hidden > 0" class="hosted-search-more">
        {{ t("chat.webSearchMore", { count: hidden }) }}
      </span>
    </div>
  </div>
</template>
