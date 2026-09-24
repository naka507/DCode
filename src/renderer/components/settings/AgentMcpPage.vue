<script setup lang="ts">
/**
 * Agent MCP settings page.
 *
 * The `AgentMcpPage` component. One
 * panel holds both levels, and each row is a live control: the switch, the
 * handshake test, the OAuth login and the move between levels all run against
 * the host, while the status badges come from the `statuses` half of the same
 * collection.
 *
 * The implementation decisions that are not mechanical:
 *
 *  1. **The row render function becomes one `computed` of row view models.**
 *     The `renderRow` derives `status` / `busy` / `testing` /
 *     `authorizing` / `isArmed` / `isHttp` / `hasAuthHeader` / `isOAuth` /
 *     `needsAuth` and the overflow-menu item list inside the JSX map callback.
 *     A Vue template cannot declare locals per iteration, so `rows` derives them
 *     once, the way `pages/ProjectsPage.vue` does.
 *  2. **The `is-${status.state}` modifier is an object binding of literal
 *     names.** A template literal would build the badge class; the class-name
 *     contract reads a template literal's static text verbatim and would report
 *     the glued fragment `is-`.
 *     Only `ready` / `connecting` / `failed` have a rule in `settings.css`
 *     (`.idle` never had one in either tree), so only those three are named.
 *  3. **`pendingOAuthRef` is a plain module-scope-free local ref.** The login was
 *     kept in a `useRef` so the unmount effect could unsubscribe
 *     it; a Vue ref is a stable object with the same lifetime, and the cleanup
 *     is `onUnmounted`.
 *  4. **`onXxx` props become emits.** `CapabilityToolbar` takes `filter-change` /
 *     `search-change`, `AgentProjectPicker` takes `change`, `CapabilityRowMenu`
 *     takes `open-change`, and `McpEditorSheet` takes `update:draft` / `close` /
 *     `save` / `test`.
 *  5. **`t(key, "Fallback")` is `t(key)`** — every key ships in the catalogs —
 *     and bare `aria-hidden` is written `aria-hidden="true"`.
 *  6. **The store read is `store.appState?.showToast`**, never
 *     `store.getState()`.
 *
 * `McpEditorSheet` is imported from `../extensions/McpEditorSheet.vue` exactly
 * as the page imported it from `../extensions/McpEditorSheet`.
 */
import { computed, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  GLOBAL_SCOPE,
  type AgentCapabilityLevel,
  type McpServerRecord,
  type McpServerStatus,
} from "@dcode/shared";
import { api } from "../../lib/api";
import { useAppStore } from "../../stores/app-store";
import type { ToastOptions } from "../../stores/app-state";
import { useArmedDelete } from "../../hooks/use-armed-delete";
import { useHostCollection } from "../../hooks/use-host-collection";
import {
  IconArrowUpDown,
  IconKey,
  IconPencil,
  IconPlay,
  IconPlus,
  IconServer,
  IconTerminal,
  IconTrash,
} from "../../lib/icons";
import TooltipButton from "../TooltipButton.vue";
import McpEditorSheet, {
  draftFromRecord,
  draftToInput,
  emptyMcpDraft,
  type McpDraft,
} from "../extensions/McpEditorSheet.vue";
import {
  AgentCapabilityPage,
  AgentProjectPicker,
  CapabilityButton,
  CapabilityEmpty,
  CapabilityGroupHeader,
  CapabilityPanel,
  CapabilityRow,
  CapabilityRowMenu,
  CapabilityToggle,
  CapabilityToolbar,
  matchesCapabilitySearch,
  projectDisplayName,
  useAgentProjects,
  type CapabilityFilter,
  type CapabilityMenuItem,
} from "./AgentCapabilityLayout.vue";

const GLOBAL_MCP_PATH = "~/.agents/servers";

/** Where the project level's folder lives, spelled out when no project is open. */
function projectMcpPath(projectPath: string | null): string {
  return projectPath ? `${projectPath}/.agents/servers` : "<project-root>/.agents/servers";
}

/** The live status of one server, if the host reported one. */
function statusFor(
  statuses: readonly McpServerStatus[],
  server: McpServerRecord,
): McpServerStatus | undefined {
  return statuses.find((status) => status.serverId === server.id);
}

type McpEditorState = {
  draft: McpDraft;
  editing: McpServerRecord | null;
  level: AgentCapabilityLevel;
};

type McpCollection = {
  global: McpServerRecord[];
  project: McpServerRecord[];
  statuses: McpServerStatus[];
};

const EMPTY_MCP_COLLECTION: McpCollection = { global: [], project: [], statuses: [] };

/** One server, flattened for the template. */
type McpRow = {
  key: string;
  name: string;
  enabled: boolean;
  busy: boolean;
  testing: boolean;
  menuOpen: boolean;
  description: string;
  level: AgentCapabilityLevel;
  isHttp: boolean;
  command?: string;
  glyphState?: string;
  /** `ready` / `connecting` / `failed`, or null when there is no badge. */
  statusState: string | null;
  statusLabel: string;
  needsAuth: boolean;
  hasOauth: boolean;
  authorizing: boolean;
  items: CapabilityMenuItem[];
  server: McpServerRecord;
};

const { t } = useI18n();
const store = useAppStore();
const { selectedProjectPath, setSelectedProjectPath, options } = useAgentProjects();

const { data, setData, loading, refreshing, reload } = useHostCollection(
  async (): Promise<McpCollection> => {
    const projectPath = selectedProjectPath.value;
    const [global, project] = await Promise.all([
      api.listMcpServers({
        level: "global",
        ...(projectPath ? { projectPath } : {}),
      }),
      projectPath
        ? api.listMcpServers({ level: "project", projectPath })
        : Promise.resolve({
            servers: [] as McpServerRecord[],
            statuses: [] as McpServerStatus[],
          }),
    ]);
    return {
      global: global.servers ?? [],
      project: project.servers ?? [],
      statuses: [...(global.statuses ?? []), ...(project.statuses ?? [])],
    };
  },
  EMPTY_MCP_COLLECTION,
  (error) => showToast(error instanceof Error ? error.message : String(error), { variant: "error" }),
);

const globalServers = computed(() => data.value.global);
const projectServers = computed(() => data.value.project);
const statuses = computed(() => data.value.statuses);

function setStatuses(update: (current: McpServerStatus[]) => McpServerStatus[]) {
  setData((current) => ({ ...current, statuses: update(current.statuses) }));
}

const filter = ref<CapabilityFilter>("all");
const search = ref("");
const busyId = ref<string | null>(null);
const menuFor = ref<string | null>(null);
const editor = ref<McpEditorState | null>(null);
const saving = ref(false);
const testingId = ref<string | null>(null);
const { armed, setArmed } = useArmedDelete();
const authorizingId = ref<string | null>(null);

/** The live login, so unmounting the page can drop its subscription. */
const pendingOAuth = ref<{ unsubscribe: () => void } | null>(null);

onUnmounted(() => {
  pendingOAuth.value?.unsubscribe();
  pendingOAuth.value = null;
});

function showToast(message: string, options?: ToastOptions) {
  store.appState?.showToast(message, options);
}

/** A row's identity: the same id can exist at both levels. */
function rowKey(level: AgentCapabilityLevel, id: string): string {
  return `${level}:${id}`;
}

function levelQuery(level: AgentCapabilityLevel) {
  return {
    level,
    ...(selectedProjectPath.value ? { projectPath: selectedProjectPath.value } : {}),
  };
}

function patchRow(level: AgentCapabilityLevel, id: string, patch: Partial<McpServerRecord>) {
  setData((current) => ({
    ...current,
    [level]: current[level].map((row) => (row.id === id ? { ...row, ...patch } : row)),
  }));
}

/** New servers land at whichever level the filter is pointing at. */
const targetLevel = computed<AgentCapabilityLevel>(() =>
  filter.value === "project" ? "project" : "global",
);

function openCreate() {
  if (targetLevel.value === "project" && !selectedProjectPath.value) {
    showToast(t("settings.selectProjectFirst"), { variant: "error" });
    return;
  }
  editor.value = {
    draft: {
      ...emptyMcpDraft(),
      scope:
        targetLevel.value === "global"
          ? GLOBAL_SCOPE
          : { mode: "projects", projects: [selectedProjectPath.value!] },
    },
    editing: null,
    level: targetLevel.value,
  };
}

function openEdit(server: McpServerRecord, level: AgentCapabilityLevel) {
  menuFor.value = null;
  editor.value = { draft: draftFromRecord(server), editing: server, level };
}

async function save() {
  const current = editor.value;
  if (!current) return;
  const projectPath =
    current.level === "project" ? selectedProjectPath.value ?? undefined : undefined;
  const candidateId = current.draft.id.trim();
  const candidateLabel = current.draft.label.trim().toLocaleLowerCase();
  const sameLevel = (current.level === "global" ? globalServers.value : projectServers.value).some(
    (server) =>
      server.id !== current.editing?.id &&
      (server.id === candidateId ||
        (!!candidateLabel && server.label.trim().toLocaleLowerCase() === candidateLabel)),
  );
  if (sameLevel) {
    showToast(t("settings.mcpDuplicate"), { variant: "error" });
    return;
  }
  saving.value = true;
  try {
    await api.upsertMcpServer(
      draftToInput(current.draft, { level: current.level, projectPath }),
    );
    await reload();
    showToast(
      t(current.editing ? "settings.mcpSaved" : "settings.mcpAdded", {
        name: current.draft.label || current.draft.id,
      }),
      { variant: "success" },
    );
    editor.value = null;
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), { variant: "error" });
  } finally {
    saving.value = false;
  }
}

async function toggle(server: McpServerRecord, level: AgentCapabilityLevel) {
  const key = rowKey(level, server.id);
  if (busyId.value) return;
  const next = !server.enabled;
  busyId.value = key;
  // Flip locally first: the host is the authority, but a round-trip of latency
  // on a switch reads as a broken control.
  patchRow(level, server.id, { enabled: next });
  try {
    await api.setMcpServerEnabled(server.id, next, levelQuery(level));
    showToast(
      t(next ? "settings.capabilityEnabled" : "settings.capabilityDisabled", {
        name: server.label || server.id,
      }),
      { variant: "success" },
    );
  } catch (error) {
    patchRow(level, server.id, { enabled: server.enabled });
    showToast(error instanceof Error ? error.message : String(error), { variant: "error" });
  } finally {
    busyId.value = null;
  }
}

async function testConnection(server: McpServerRecord, level: AgentCapabilityLevel) {
  if (testingId.value) return;
  testingId.value = server.id;
  try {
    const result = await api.testMcpServer(server.id, {
      level,
      ...(level === "project" && selectedProjectPath.value
        ? { projectPath: selectedProjectPath.value }
        : {}),
    });
    setStatuses((current) => [
      ...current.filter((status) => status.serverId !== server.id),
      result.status,
    ]);
    if (result.status.state === "ready") {
      showToast(t("extensions.mcp.testReady", { count: result.status.toolCount }), {
        variant: "success",
      });
    } else if (result.status.authRequired) {
      showToast(t("extensions.mcp.authRequired"), { variant: "error" });
    } else if (result.status.state === "failed") {
      showToast(result.status.message || t("extensions.mcp.testFailed"), { variant: "error" });
    }
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), { variant: "error" });
  } finally {
    testingId.value = null;
  }
}

async function authorizeServer(server: McpServerRecord, level: AgentCapabilityLevel) {
  if (authorizingId.value || pendingOAuth.value) return;
  authorizingId.value = server.id;
  let activeLoginId: string | null = null;
  let unsubscribed = false;
  let unsubscribe = () => {};

  const finish = () => {
    if (unsubscribed) return;
    unsubscribed = true;
    unsubscribe();
    if (pendingOAuth.value?.unsubscribe === unsubscribe) {
      pendingOAuth.value = null;
    }
  };

  const cleanup = () => {
    finish();
    authorizingId.value = null;
  };

  unsubscribe = api.onMcpOAuth((event) => {
    if (activeLoginId && event.loginId !== activeLoginId) return;
    if (event.serverId !== server.id) return;

    if (event.kind === "done") {
      setStatuses((current) => [
        ...current.filter((status) => status.serverId !== server.id),
        event.status,
      ]);
      showToast(t("extensions.mcp.authReady", { count: event.status.toolCount }), {
        variant: "success",
      });
      cleanup();
    } else if (event.kind === "error") {
      showToast(event.message || t("extensions.mcp.authFailed"), { variant: "error" });
      cleanup();
    } else if (event.kind === "cancelled") {
      cleanup();
    }
  });
  pendingOAuth.value = { unsubscribe };

  try {
    showToast(t("extensions.mcp.authorizing"), { variant: "info" });
    const result = await api.startMcpOAuth(server.id, {
      level,
      ...(level === "project" && selectedProjectPath.value
        ? { projectPath: selectedProjectPath.value }
        : {}),
    });
    activeLoginId = result.loginId;
    if (!result.ok) {
      showToast(t("extensions.mcp.authFailed"), { variant: "error" });
      cleanup();
    }
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), { variant: "error" });
    cleanup();
  }
}

async function remove(server: McpServerRecord, level: AgentCapabilityLevel) {
  busyId.value = rowKey(level, server.id);
  try {
    await api.removeMcpServer(server.id, levelQuery(level));
    await reload();
    showToast(t("settings.capabilityDeleted", { name: server.label || server.id }), {
      variant: "success",
    });
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), { variant: "error" });
  } finally {
    busyId.value = null;
    setArmed(null);
  }
}

const visible = computed(() => {
  const match = (server: McpServerRecord) =>
    matchesCapabilitySearch(
      search.value,
      server.label,
      server.id,
      server.description,
      server.transport === "http" ? server.url : server.command,
    );
  return {
    global: globalServers.value.filter(match),
    project: projectServers.value.filter(match),
  };
});

const counts = computed(() => ({
  all: visible.value.global.length + visible.value.project.length,
  global: visible.value.global.length,
  project: visible.value.project.length,
}));

const projectName = computed(
  () =>
    options.value.find((project) => project.path === selectedProjectPath.value)?.name ??
    (selectedProjectPath.value ? projectDisplayName(selectedProjectPath.value) : undefined),
);

/** Where a move sends a row, named the way the toast should say it. */
const moveTargets = computed<Partial<Record<AgentCapabilityLevel, string>>>(() => ({
  global: t("settings.globalLevel"),
  project: selectedProjectPath.value
    ? `${t("settings.projectLevel")} · ${
        projectName.value ?? projectDisplayName(selectedProjectPath.value)
      }`
    : undefined,
}));

/** The label the row's own move item carries, or null when it has no destination. */
function moveLabel(level: AgentCapabilityLevel): string | null {
  const to: AgentCapabilityLevel = level === "global" ? "project" : "global";
  if (!moveTargets.value[to]) return null;
  return level === "global"
    ? t("settings.capabilityMoveToProject", {
        project: projectName.value ?? projectDisplayName(selectedProjectPath.value ?? ""),
      })
    : t("settings.capabilityMoveToGlobal");
}

/**
 * Move one row to the other level. The project picker owns the destination,
 * so the same action reads "Move into <project>" on a global row and "Move to
 * Global" on a project one.
 *
 * The host moves the document rather than copying it, and a destination that
 * already holds the id or name renames the arriving server, so the toast
 * reports the new name instead of pretending the id survived.
 */
async function move(server: McpServerRecord, level: AgentCapabilityLevel) {
  const to: AgentCapabilityLevel = level === "global" ? "project" : "global";
  const target = moveTargets.value[to];
  if (!target) {
    showToast(t("settings.selectProjectFirst"), { variant: "error" });
    return;
  }
  busyId.value = rowKey(level, server.id);
  try {
    const result = await api.transferMcpServer({
      id: server.id,
      from: levelQuery(level),
      to: levelQuery(to),
    });
    await reload();
    const name = server.label || server.id;
    const arrived = result.server;
    showToast(
      arrived && arrived.id !== server.id
        ? t("settings.capabilityMovedRenamed", {
            name,
            target,
            newName: arrived.label || arrived.id,
          })
        : t("settings.capabilityMoved", { name, target }),
      { variant: "success" },
    );
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), { variant: "error" });
  } finally {
    busyId.value = null;
  }
}

/** The rows of one level, with the badges and menu items each one carries. */
function rowsFor(level: AgentCapabilityLevel): McpRow[] {
  const source = level === "global" ? visible.value.global : visible.value.project;
  return source.map((server) => {
    const key = rowKey(level, server.id);
    const name = server.label || server.id;
    const status = statusFor(statuses.value, server);
    const busy = busyId.value === key;
    const testing = testingId.value === server.id;
    const authorizing = authorizingId.value === server.id;
    const isArmed = armed.value === key;
    const isHttp = server.transport === "http";
    const hasAuthHeader = Boolean(
      server.headers &&
        Object.keys(server.headers).some((header) => header.toLowerCase() === "authorization"),
    );
    const isOAuth = isHttp && (Boolean(status?.hasOauth) || !hasAuthHeader);
    const needsAuth =
      isHttp &&
      !hasAuthHeader &&
      !status?.hasOauth &&
      (Boolean(status?.authRequired) || status?.state !== "ready");
    const label = moveLabel(level);
    const items: CapabilityMenuItem[] = [
      {
        key: "test",
        label: t("extensions.mcp.test"),
        icon: IconPlay,
        disabled: testing || authorizing,
        onSelect: () => {
          menuFor.value = null;
          void testConnection(server, level);
        },
      },
      ...(isOAuth
        ? [
            {
              key: "authorize",
              label: status?.hasOauth
                ? t("extensions.mcp.reauthorize")
                : t("extensions.mcp.authorize"),
              icon: IconKey,
              disabled: testing || authorizing,
              onSelect: () => {
                menuFor.value = null;
                void authorizeServer(server, level);
              },
            } satisfies CapabilityMenuItem,
          ]
        : []),
      /**
       * A move needs a destination, so a global row offers it only while the
       * picker names a project; a project row always has Global to go back to.
       */
      ...(label
        ? [
            {
              key: "move",
              label,
              icon: IconArrowUpDown,
              onSelect: () => {
                menuFor.value = null;
                void move(server, level);
              },
            } satisfies CapabilityMenuItem,
          ]
        : []),
      {
        key: "remove",
        label: isArmed ? t("settings.capabilityRemoveConfirm") : t("extensions.mcp.remove"),
        icon: IconTrash,
        danger: true,
        onSelect: () => {
          if (isArmed) {
            menuFor.value = null;
            void remove(server, level);
          } else {
            setArmed(key);
          }
        },
      },
    ];
    return {
      key,
      name,
      enabled: server.enabled,
      busy,
      testing,
      menuOpen: menuFor.value === key,
      description: server.description || t("settings.noCapabilityDescription"),
      level,
      isHttp,
      command: isHttp ? server.url : server.command,
      glyphState: status?.state,
      statusState: status && status.state !== "idle" ? status.state : null,
      statusLabel:
        status?.state === "ready"
          ? t("extensions.mcp.toolCount", { count: status.toolCount })
          : status
            ? t(`extensions.mcp.state.${status.state}`)
            : "",
      needsAuth,
      hasOauth: Boolean(status?.hasOauth),
      authorizing,
      items,
      server,
    };
  });
}

const globalRows = computed(() => rowsFor("global"));
const projectRows = computed(() => rowsFor("project"));

const showGlobal = computed(() => filter.value !== "project");
const showProject = computed(() => filter.value !== "global");

const addTitle = computed(() =>
  targetLevel.value === "project"
    ? t("settings.capabilityCreateInProject")
    : t("settings.capabilityCreateInGlobal"),
);

const noMatches = computed(() => counts.value.all === 0 && Boolean(search.value.trim()));

/** The status of the server the editor is open on, if the host reported one. */
const editorStatus = computed(() => {
  const editing = editor.value?.editing;
  return editing ? statusFor(statuses.value, editing) : undefined;
});
const editorTesting = computed(
  () => Boolean(editor.value?.editing) && testingId.value === editor.value?.editing?.id,
);

function closeEditor() {
  if (!saving.value && !testingId.value) editor.value = null;
}

function setEditorDraft(draft: McpDraft) {
  if (editor.value) editor.value = { ...editor.value, draft };
}

function testEditing() {
  const current = editor.value;
  if (current?.editing) void testConnection(current.editing, current.level);
}

/** One shared `onOpenChange`: only one row's menu can be open, and a close disarms. */
function setMenuOpen(key: string, open: boolean) {
  menuFor.value = open ? key : null;
  if (!open) setArmed(null);
}
</script>

<template>
  <AgentCapabilityPage>
    <template #toolbar>
      <CapabilityToolbar
        :filter="filter"
        :counts="counts"
        :search="search"
        :search-placeholder="t('extensions.mcp.searchPlaceholder')"
        @filter-change="filter = $event"
        @search-change="search = $event"
      >
        <template #project-picker>
          <AgentProjectPicker
            :value="selectedProjectPath"
            :options="options"
            :label="t('settings.selectProject')"
            @change="setSelectedProjectPath"
          />
        </template>
        <template #actions>
          <CapabilityButton variant="primary" :title="addTitle" @click="openCreate">
            <IconPlus :size="14" />
            {{ t("settings.addMcp") }}
          </CapabilityButton>
        </template>
      </CapabilityToolbar>
    </template>

    <CapabilityPanel
      :loading="loading"
      :refreshing="refreshing"
      :loading-label="t('settings.loadingCapabilities')"
    >
      <CapabilityEmpty v-if="noMatches" :message="t('settings.capabilityNoMatches')">
        <template #icon>
          <IconServer :size="18" />
        </template>
      </CapabilityEmpty>

      <template v-else>
        <template v-if="showGlobal">
          <CapabilityGroupHeader
            :label="t('settings.globalLevel')"
            :path="GLOBAL_MCP_PATH"
            :count="visible.global.length"
          />
          <CapabilityEmpty v-if="globalRows.length === 0" :message="t('settings.mcpEmpty')">
            <template #icon>
              <IconServer :size="18" />
            </template>
            <template #action>
              <CapabilityButton variant="primary" :title="addTitle" @click="openCreate">
                <IconPlus :size="14" />
                {{ t("settings.addMcp") }}
              </CapabilityButton>
            </template>
          </CapabilityEmpty>
          <CapabilityRow
            v-for="row in globalRows"
            v-else
            :key="row.key"
            :name="row.name"
            :off="!row.enabled"
            :menu-open="row.menuOpen"
            :command="row.command"
            :glyph-state="row.glyphState"
            :description="row.description"
          >
            <template #glyph>
              <IconServer v-if="row.isHttp" :size="16" />
              <IconTerminal v-else :size="16" />
            </template>
            <template #badges>
              <span class="agent-capability-badge is-level">
                {{ t("settings.capabilityFilterGlobal") }}
              </span>
              <span class="agent-capability-badge">
                {{ row.isHttp ? t("settings.transportHttp") : t("settings.transportStdio") }}
              </span>
              <span
                v-if="row.statusState"
                class="agent-capability-badge is-status"
                :class="{
                  'is-ready': row.statusState === 'ready',
                  'is-connecting': row.statusState === 'connecting',
                  'is-failed': row.statusState === 'failed',
                }"
              >
                <span class="agent-capability-status-dot" aria-hidden="true" />
                {{ row.statusLabel }}
              </span>
              <span v-if="row.needsAuth" class="agent-capability-badge is-status is-failed">
                {{ t("extensions.mcp.authRequired") }}
              </span>
              <span v-else-if="row.hasOauth" class="agent-capability-badge is-status is-ready">
                {{ t("extensions.mcp.oauthBadge") }}
              </span>
            </template>
            <template #actions>
              <TooltipButton
                v-if="row.needsAuth"
                as="button"
                type="button"
                class="settings-icon-button is-action-highlight"
                :aria-label="t('extensions.mcp.authorize')"
                :label="
                  row.authorizing
                    ? t('extensions.mcp.authorizing')
                    : t('extensions.mcp.authorize')
                "
                :disabled="row.busy || row.authorizing"
                @click="void authorizeServer(row.server, row.level)"
              >
                <IconKey :size="15" />
              </TooltipButton>
              <TooltipButton
                as="button"
                type="button"
                class="settings-icon-button"
                :aria-label="t('settings.editMcpOf', { name: row.name })"
                :label="t('settings.editMcp')"
                :disabled="row.busy"
                @click="openEdit(row.server, row.level)"
              >
                <IconPencil :size="15" />
              </TooltipButton>
              <CapabilityRowMenu
                :label="t('extensions.mcp.rowActions', { name: row.name })"
                :items="row.items"
                :disabled="row.busy"
                :open="row.menuOpen"
                @open-change="setMenuOpen(row.key, $event)"
              />
              <CapabilityToggle
                :checked="row.enabled"
                :busy="row.busy || row.testing"
                :label="t('settings.toggleCapability', { name: row.name })"
                @change="void toggle(row.server, row.level)"
              />
            </template>
          </CapabilityRow>
        </template>

        <template v-if="showProject">
          <CapabilityGroupHeader
            :label="t('settings.projectLevel')"
            :path="projectMcpPath(selectedProjectPath)"
            :count="visible.project.length"
          />
          <CapabilityEmpty
            v-if="!selectedProjectPath"
            :message="t('settings.selectProjectFirst')"
          />
          <CapabilityEmpty
            v-else-if="projectRows.length === 0"
            :message="t('settings.mcpEmpty')"
          >
            <template #icon>
              <IconServer :size="18" />
            </template>
          </CapabilityEmpty>
          <CapabilityRow
            v-for="row in projectRows"
            v-else
            :key="row.key"
            :name="row.name"
            :off="!row.enabled"
            :menu-open="row.menuOpen"
            :command="row.command"
            :glyph-state="row.glyphState"
            :description="row.description"
          >
            <template #glyph>
              <IconServer v-if="row.isHttp" :size="16" />
              <IconTerminal v-else :size="16" />
            </template>
            <template #badges>
              <span class="agent-capability-badge is-level">
                {{ t("settings.capabilityFilterProject") }}
              </span>
              <span class="agent-capability-badge">
                {{ row.isHttp ? t("settings.transportHttp") : t("settings.transportStdio") }}
              </span>
              <span
                v-if="row.statusState"
                class="agent-capability-badge is-status"
                :class="{
                  'is-ready': row.statusState === 'ready',
                  'is-connecting': row.statusState === 'connecting',
                  'is-failed': row.statusState === 'failed',
                }"
              >
                <span class="agent-capability-status-dot" aria-hidden="true" />
                {{ row.statusLabel }}
              </span>
              <span v-if="row.needsAuth" class="agent-capability-badge is-status is-failed">
                {{ t("extensions.mcp.authRequired") }}
              </span>
              <span v-else-if="row.hasOauth" class="agent-capability-badge is-status is-ready">
                {{ t("extensions.mcp.oauthBadge") }}
              </span>
            </template>
            <template #actions>
              <TooltipButton
                v-if="row.needsAuth"
                as="button"
                type="button"
                class="settings-icon-button is-action-highlight"
                :aria-label="t('extensions.mcp.authorize')"
                :label="
                  row.authorizing
                    ? t('extensions.mcp.authorizing')
                    : t('extensions.mcp.authorize')
                "
                :disabled="row.busy || row.authorizing"
                @click="void authorizeServer(row.server, row.level)"
              >
                <IconKey :size="15" />
              </TooltipButton>
              <TooltipButton
                as="button"
                type="button"
                class="settings-icon-button"
                :aria-label="t('settings.editMcpOf', { name: row.name })"
                :label="t('settings.editMcp')"
                :disabled="row.busy"
                @click="openEdit(row.server, row.level)"
              >
                <IconPencil :size="15" />
              </TooltipButton>
              <CapabilityRowMenu
                :label="t('extensions.mcp.rowActions', { name: row.name })"
                :items="row.items"
                :disabled="row.busy"
                :open="row.menuOpen"
                @open-change="setMenuOpen(row.key, $event)"
              />
              <CapabilityToggle
                :checked="row.enabled"
                :busy="row.busy || row.testing"
                :label="t('settings.toggleCapability', { name: row.name })"
                @change="void toggle(row.server, row.level)"
              />
            </template>
          </CapabilityRow>
        </template>
      </template>
    </CapabilityPanel>

    <McpEditorSheet
      v-if="editor"
      :draft="editor.draft"
      :editing="editor.editing"
      :saving="saving"
      :status="editorStatus"
      :testing="editorTesting"
      :projects="[]"
      :current-project-path="selectedProjectPath"
      :management-level="editor.level"
      :management-project-name="projectName"
      @update:draft="setEditorDraft"
      @close="closeEditor"
      @save="void save()"
      @test="testEditing"
    />
  </AgentCapabilityPage>
</template>
