/**
 * Product changelog for dcode releases.
 *
 * English is the source of truth. The translated catalogs mirror the same
 * versions and bullet counts so in-app "what's new" can follow the active UI
 * locale without a network fetch or renderer-supplied feed URL.
 *
 * Update this file before cutting a release tag. Stable product versions only —
 * omit pre-releases.
 *
 * 1.0.0 is the first release, so the catalog starts here and lists what the
 * app does.
 */

export type ChangelogLocale = "en" | "zh-CN";

export type ChangelogEntry = {
  /** Semver without a leading `v`, matching the app package version. */
  version: string;
  /** Optional ISO date (YYYY-MM-DD) of the release. */
  date?: string;
  /** Short user-facing highlights; keep each line one idea. */
  highlights: string[];
};

const enEntries: ChangelogEntry[] = [
  {
    version: "1.0.1",
    date: "2026-09-24",
    highlights: [
      "Incremental subagent result streaming: early convergence wakes the main window as each subagent finishes without waiting for all to complete.",
      "Dedicated subagent status capsule embedded in chat transcript with vertical stacking for concurrent tasks.",
      "Subagent task name display with CSS fixed-width truncation (6em) and native ellipsis.",
      "Smart history suppression: completed subagent capsules automatically hide when browsing chat history.",
      "Standardized subagent execution records in transcript with unified metadata chips and right-aligned status.",
    ],
  },
  {
    version: "1.0.0",
    date: "2026-09-22",
    highlights: [
      "First release of dcode: an agent workspace for working with models, running tools, and reviewing the result.",
      "Chat and Agent modes, with streaming replies, thinking levels, and per-model settings.",
      "Workspace tools with permission gating: terminal, file editing, browser, and git review.",
      "Projects: group folders into one named project, keep several open at once, and manage them in the archive.",
      "Bring your own models: configure a provider and endpoint, then choose which models appear and in what order.",
      "Pair and manage remote hosts over SSH, including password login, install, and reconnect on launch.",
      "Skills and MCP servers, with scanning and batch import from other agent tools.",
      "Plugins extend the work panel, and a development kit is included for building them.",
      "Prompt enhancement with a configurable template, model, and reasoning level.",
      "English and 简体中文 interfaces, light and dark themes, and configurable keybindings.",
      "A Rust host core handles storage, secrets, sessions, and notifications.",
      "Update checks read the repository you configure; no vendor service is contacted by default.",
    ],
  },
];

const zhCNEntries: ChangelogEntry[] = [
  {
    version: "1.0.1",
    date: "2026-09-24",
    highlights: [
      "多子智能体结果增量就绪即唤醒：任一子智能体完成立即唤醒主窗口流式输出，无需等待全部完成。",
      "子智能体状态栏内嵌至对话记录内部右侧，支持多任务纵向堆叠并随滚动自适应展示。",
      "状态栏支持展示子智能体任务名称，采用 CSS 固定 6em 视觉截断与原生省略号。",
      "历史记录智能抑制：向上翻阅对话历史时自动隐匿已完成的状态胶囊，避免遮挡阅读。",
      "对话记录中子智能体执行行统一规范：元数据容器包裹步骤与耗时，尾部右对齐执行结果。",
    ],
  },
  {
    version: "1.0.0",
    date: "2026-09-22",
    highlights: [
      "dcode 首个版本：一个用于与模型协作、运行工具并审查结果的 Agent 工作台。",
      "Chat 与 Agent 两种模式，支持流式回复、思考级别以及按模型单独设置。",
      "工作区工具均带权限确认：终端、文件编辑、浏览器与 Git 审查。",
      "项目：把多个文件夹归为一个命名项目，可同时打开多个，并在归档中统一管理。",
      "自带模型：配置服务商与端点后，自行选择要显示的模型及其顺序。",
      "通过 SSH 配对和管理远程主机，支持密码登录、安装以及启动时重连。",
      "Skills 与 MCP 服务器，可从其他 Agent 工具扫描并批量导入。",
      "插件可扩展工作面板，并附带插件开发套件。",
      "提示词增强：模板、模型与推理强度均可配置。",
      "界面支持 English 与简体中文，提供明暗主题和可自定义快捷键。",
      "Rust 宿主核心负责存储、密钥、会话与通知。",
      "更新检查只读取你配置的仓库地址，默认不联系任何厂商服务。",
    ],
  },
];

/** Locale → newest-first product notes. */
export const CHANGELOG: Record<ChangelogLocale, readonly ChangelogEntry[]> = {
  en: enEntries,
  "zh-CN": zhCNEntries,
};

/** Normalize `v1.0.0` / whitespace to the catalog key form. */
export function normalizeChangelogVersion(
  version: string | null | undefined,
): string {
  return String(version ?? "")
    .trim()
    .replace(/^v/i, "");
}

export function resolveChangelogLocale(
  input?: string | null,
): ChangelogLocale {
  const value = (input || "").replaceAll("_", "-").toLowerCase();
  // Every Chinese variant — Traditional included — reads the Simplified
  // catalog, which is the only Chinese changelog that ships.
  if (value.startsWith("zh")) return "zh-CN";
  return "en";
}

export function getChangelogEntry(
  version: string | null | undefined,
  locale: ChangelogLocale = "en",
): ChangelogEntry | undefined {
  const key = normalizeChangelogVersion(version);
  if (!key) return undefined;
  const catalog = CHANGELOG[locale] ?? CHANGELOG.en;
  return catalog.find((entry) => entry.version === key);
}

/**
 * Format highlights as plain multi-line text for UpdateState / compact UI.
 * Returns undefined when the version has no catalog entry or empty highlights.
 */
export function formatChangelogNotes(
  version: string | null | undefined,
  localeInput?: string | null,
): string | undefined {
  const locale = resolveChangelogLocale(localeInput);
  const entry =
    getChangelogEntry(version, locale) ??
    (locale === "en" ? undefined : getChangelogEntry(version, "en"));
  if (!entry?.highlights.length) return undefined;
  return entry.highlights.map((line) => `• ${line}`).join("\n");
}
