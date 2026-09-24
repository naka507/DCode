/**
 * Composer autocomplete state machine (D123–D125): trigger detection over
 * draft+cursor, lazily fetched command/file sources, local fuzzy filtering,
 * and insert-on-accept. IME freezing and key routing live in the Composer;
 * this composable only refuses to update while `composing` is true.
 *
 * The state cells are refs / computed values, the effects are `watch` with
 * `onCleanup`, and the store read goes through the Pinia store's `appState`.
 * `resolveComposerCommand` is deliberately *not* a composable — it is called
 * from submit-time dispatch — so it reads the same committed state through
 * `currentAppState()`.
 *
 * The controller's member names are unchanged. `ComposerAutocomplete.vue`
 * is the one consumer, so it receives the controller as a prop and reads each
 * member through `toValue`, which is why every derived member stays a
 * `ComputedRef` rather than being unwrapped here.
 * is the one consumer, so it receives the controller as a prop and reads each
 * member through `toValue`, which is why every derived member stays a
 * `ComputedRef` rather than being unwrapped here.
 */
import {
  computed,
  ref,
  toValue,
  watch,
  type ComputedRef,
  type MaybeRefOrGetter,
  type Ref,
} from "vue";
import {
  applyCompletion,
  compareMatches,
  detectTrigger,
  fileReferenceLabel,
  formatCommandInsert,
  formatFileInsert,
  fuzzyMatchCommand,
  fuzzyMatchPath,
  selectBestMatches,
  type ComposerCommand,
  type ComposerTrigger,
  type FsIndexEntry,
  type FuzzyMatch,
} from "@dcode/shared";
import { api } from "../lib/api";
import { currentAppState, useAppStore } from "../stores/app-store";

const MAX_FILE_ITEMS = 50;
const SOURCE_TTL_MS = 10_000;

export type AutocompleteItem =
  | { kind: "command"; command: ComposerCommand; match: FuzzyMatch }
  | { kind: "path"; entry: FsIndexEntry; match: FuzzyMatch };

/** Module-level TTL caches so re-triggering stays IPC-free. */
let commandsCache: { key: string; at: number; commands: ComposerCommand[] } | null =
  null;
let filesCache: {
  key: string;
  at: number;
  entries: FsIndexEntry[];
  truncated: boolean;
} | null = null;

const COMMAND_GROUP_ORDER = {
  template: 0,
  builtin: 1,
  plugin: 2,
  extension: 3,
  skill: 4,
} as const;

function filterCommands(
  commands: ComposerCommand[],
  query: string,
): AutocompleteItem[] {
  const matched: Array<{
    command: ComposerCommand;
    match: FuzzyMatch;
    sortText: string;
  }> = [];
  for (const command of commands) {
    const byName = fuzzyMatchCommand(query, command.name);
    if (byName) {
      matched.push({ command, match: byName, sortText: command.name });
      continue;
    }
    // Title/description hits keep the row findable, without name highlights.
    const byTitle =
      fuzzyMatchCommand(query, command.title) ??
      (command.description
        ? fuzzyMatchCommand(query, command.description)
        : null);
    if (byTitle) {
      matched.push({
        command,
        match: { score: Math.max(0, byTitle.score - 20), ranges: [] },
        sortText: command.name,
      });
    }
  }
  matched.sort((a, b) => {
    const groupDelta =
      COMMAND_GROUP_ORDER[a.command.kind] - COMMAND_GROUP_ORDER[b.command.kind];
    if (groupDelta !== 0) return groupDelta;
    return compareMatches(
      { score: a.match.score, text: a.sortText },
      { score: b.match.score, text: b.sortText },
    );
  });
  return matched.map(({ command, match }) => ({ kind: "command", command, match }));
}

function filterFiles(entries: FsIndexEntry[], query: string): AutocompleteItem[] {
  const matched: Array<{ entry: FsIndexEntry; match: FuzzyMatch }> = [];
  for (const entry of entries) {
    const match = fuzzyMatchPath(query, entry.path, entry.kind);
    if (match) matched.push({ entry, match });
  }
  // The index can hold thousands of entries while the menu shows at most
  // MAX_FILE_ITEMS, so only the bounded top slice is ever ordered.
  return selectBestMatches(matched, MAX_FILE_ITEMS, ({ entry, match }) => ({
    score: match.score,
    text: entry.path,
  })).map(({ entry, match }) => ({ kind: "path", entry, match }));
}

/**
 * Resolve a typed "/name" against the merged command and skill list at send
 * time (builtin/plugin dispatch and skill validation); templates and unknown
 * names return as-is/null and stay on the prompt path. Reuses the menu's TTL
 * cache when warm.
 */
export async function resolveComposerCommand(
  name: string,
): Promise<ComposerCommand | null> {
  const key = currentAppState().workspace?.path ?? "";
  if (
    !commandsCache ||
    commandsCache.key !== key ||
    Date.now() - commandsCache.at > SOURCE_TTL_MS
  ) {
    try {
      const res = await api.composerCommands();
      commandsCache = { key, at: Date.now(), commands: res.commands };
    } catch {
      return null;
    }
  }
  return commandsCache.commands.find((c) => c.name === name) ?? null;
}

/** The controller's members, as refs and plain functions. */
export type ComposerAutocompleteController = {
  open: ComputedRef<boolean>;
  mode: ComputedRef<"slash" | "file" | null>;
  query: ComputedRef<string>;
  items: ComputedRef<AutocompleteItem[]>;
  hasItems: ComputedRef<boolean>;
  highlight: Ref<number>;
  setHighlight: (value: number | ((current: number) => number)) => void;
  truncated: ComputedRef<boolean>;
  noWorkspace: ComputedRef<boolean>;
  close: () => void;
  accept: (index: number) =>
    | {
        value: string;
        cursor: number;
        fileReference?: { path: string; name: string };
      }
    | null;
};

export function useComposerAutocomplete({
  value,
  cursor,
  composing,
  enabled,
}: {
  value: MaybeRefOrGetter<string>;
  cursor: MaybeRefOrGetter<number>;
  composing: MaybeRefOrGetter<boolean>;
  enabled: MaybeRefOrGetter<boolean>;
}): ComposerAutocompleteController {
  const store = useAppStore();
  const workspaceKey = computed(() => store.appState?.workspace?.path ?? "");
  const hasWorkspace = computed(() => workspaceKey.value !== "");
  const commands = ref<ComposerCommand[] | null>(null);
  const files = ref<{ entries: FsIndexEntry[]; truncated: boolean } | null>(null);
  const highlight = ref(0);
  const dismissedKey = ref<string | null>(null);
  /** Frozen trigger during IME composition (D125). */
  const frozen = ref<ComposerTrigger | null>(null);

  const liveTrigger = computed(() =>
    toValue(enabled) ? detectTrigger(toValue(value), toValue(cursor)) : null,
  );
  // During IME composition the menu freezes: no opening, closing, or
  // re-filtering until compositionend re-evaluates (D125).
  const trigger = computed(() =>
    toValue(composing) ? frozen.value : liveTrigger.value,
  );
  watch(
    [() => toValue(composing), liveTrigger],
    () => {
      if (!toValue(composing)) frozen.value = liveTrigger.value;
    },
    { immediate: true },
  );

  const triggerKey = computed(() =>
    trigger.value ? `${trigger.value.mode}:${trigger.value.tokenStart}` : null,
  );
  const dismissed = computed(
    () => triggerKey.value !== null && triggerKey.value === dismissedKey.value,
  );

  // Escape-dismissal clears once the trigger token goes away.
  watch([triggerKey, dismissedKey], () => {
    if (dismissedKey.value && triggerKey.value !== dismissedKey.value) {
      dismissedKey.value = null;
    }
  });

  // Lazy source fetch with a short TTL, keyed by workspace.
  watch(
    [() => trigger.value?.mode, dismissed, workspaceKey, hasWorkspace],
    (_next, _previous, onCleanup) => {
      const active = trigger.value;
      if (!active || dismissed.value) return;
      const now = Date.now();
      if (active.mode === "slash") {
        if (
          commandsCache &&
          commandsCache.key === workspaceKey.value &&
          now - commandsCache.at < SOURCE_TTL_MS
        ) {
          commands.value = commandsCache.commands;
          return;
        }
        let cancelled = false;
        onCleanup(() => {
          cancelled = true;
        });
        void api
          .composerCommands()
          .then((res) => {
            commandsCache = {
              key: workspaceKey.value,
              at: Date.now(),
              commands: res.commands,
            };
            if (!cancelled) commands.value = res.commands;
          })
          .catch(() => {
            if (!cancelled) commands.value = [];
          });
        return;
      }
      if (!hasWorkspace.value) {
        files.value = { entries: [], truncated: false };
        return;
      }
      if (
        filesCache &&
        filesCache.key === workspaceKey.value &&
        now - filesCache.at < SOURCE_TTL_MS
      ) {
        files.value = {
          entries: filesCache.entries,
          truncated: filesCache.truncated,
        };
        return;
      }
      let cancelled = false;
      onCleanup(() => {
        cancelled = true;
      });
      void api
        .fsIndex()
        .then((res) => {
          filesCache = {
            key: workspaceKey.value,
            at: Date.now(),
            entries: res.entries,
            truncated: res.truncated,
          };
          if (!cancelled) {
            files.value = { entries: res.entries, truncated: res.truncated };
          }
        })
        .catch(() => {
          if (!cancelled) files.value = { entries: [], truncated: false };
        });
    },
    { immediate: true },
  );

  const allItems = computed<AutocompleteItem[]>(() => {
    const active = trigger.value;
    if (!active || dismissed.value) return [];
    if (active.mode === "slash") {
      return commands.value ? filterCommands(commands.value, active.query) : [];
    }
    return files.value ? filterFiles(files.value.entries, active.query) : [];
  });

  // New query or mode restarts keyboard navigation at the top hit.
  const itemsKey = computed(() =>
    trigger.value ? `${trigger.value.mode}:${trigger.value.query}` : "",
  );
  watch(itemsKey, () => {
    highlight.value = 0;
  });

  const sourceReady = computed(
    () =>
      trigger.value !== null &&
      (trigger.value.mode === "slash"
        ? commands.value !== null
        : files.value !== null),
  );
  const open = computed(
    () => trigger.value !== null && !dismissed.value && sourceReady.value,
  );
  const items = computed(() => (open.value ? allItems.value : []));

  function setHighlight(next: number | ((current: number) => number)) {
    highlight.value = typeof next === "function" ? next(highlight.value) : next;
  }

  function close() {
    if (triggerKey.value) dismissedKey.value = triggerKey.value;
  }

  function accept(
    index: number,
  ):
    | { value: string; cursor: number; fileReference?: { path: string; name: string } }
    | null {
    const active = trigger.value;
    if (!active) return null;
    const item = items.value[index];
    if (!item) return null;
    if (item.kind === "path" && item.entry.kind === "file") {
      return {
        ...applyCompletion(toValue(value), active, ""),
        fileReference: {
          path: item.entry.path,
          name: fileReferenceLabel(item.entry.path),
        },
      };
    }
    const insert =
      item.kind === "command"
        ? formatCommandInsert(item.command.name)
        : formatFileInsert(item.entry.path, item.entry.kind);
    return applyCompletion(toValue(value), active, insert);
  }

  return {
    open,
    mode: computed(() => (open.value && trigger.value ? trigger.value.mode : null)),
    query: computed(() => (open.value && trigger.value ? trigger.value.query : "")),
    items,
    hasItems: computed(() => open.value && items.value.length > 0),
    highlight,
    setHighlight,
    truncated: computed(() =>
      open.value && trigger.value?.mode === "file"
        ? (files.value?.truncated ?? false)
        : false,
    ),
    noWorkspace: computed(
      () => open.value && trigger.value?.mode === "file" && !hasWorkspace.value,
    ),
    close,
    accept,
  };
}
