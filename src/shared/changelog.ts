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
    version: "1.0.5",
    date: "2026-09-25",
    highlights: [
      "Backend context capacity breakdown: transitioned context breakdown and token occupancy calculation from frontend heuristics to Agent Runtime sidecar.",
      "Exact token conservation & allocation: character-proportional token allocation guarantees that prompt, skills, tools, messages, and reasoning sum exactly to total request occupancy.",
      "Eliminated capacity shrinkage & token swings: stabilized context occupancy against provider cache hits/misses and nested reasoning tokens, ensuring monotonicity until compaction.",
      "Physical schema & prompt measurement for Skills and MCP: measures active plugin skill instructions and external MCP tool schemas directly to reflect their true token footprints.",
      "Reliable reasoning token extraction: accurately extracts provider reasoning tokens and falls back to thinking stream estimation, preventing reasoning rows from vanishing or zeroing out.",
    ],
  },
  {
    version: "1.0.4",
    date: "2026-09-25",
    highlights: [
      "Core engineering skills catalog: integrated dcode/vue-best-practices, dcode/react-best-practices, dcode/agent-browser, dcode/dogfood, and dcode/electron with on-demand zero-overhead loading via the Skill tool.",
      "Curated MCP preset catalog & remote sync: one-click preset chips for Context7, GitHub, Memory, Fetch, SQLite, Postgres, Filesystem, Puppeteer, Docker, with cross-platform command sanitization and path translation for SSH remote hosts.",
      "Work panel terminal plugin: interactive shell runner with cross-platform shell auto-detection (PowerShell/CMD/Bash/Zsh), quick action pills, command history navigation, and native agent tool execution.",
      "Work panel documents plugin: rich Markdown reader with automatic reading metrics, interactive table of contents outline, preview/raw toggle, and embedded PDF viewer.",
    ],
  },
  {
    version: "1.0.3",
    date: "2026-09-24",
    highlights: [
      "Plan mode closed-loop execution & status capsule: top-right floating execution capsule in transcript with live phase/step progress and activity indicators.",
      "Interactive plan detail popover: click the status capsule to view complete phase checklists, progress percentage, view artifact, and copy execution reports without expanding the wide work panel.",
      "Safe managed mode: autonomous file operations (read, write, delete) within authorized workspace & memory scopes, with non-interrupting fail-fast rejection for out-of-scope paths.",
      "Enhanced context window & capacity inspector: real-time token tracking, segmented breakdown of reasoning/tools/system prompts, and local silent microcompaction.",
    ],
  },
  {
    version: "1.0.2",
    date: "2026-09-24",
    highlights: [
      "Subagent SWE role standardization: standardized IDs to coder, reviewer, tester, researcher, designer with full backward compatibility.",
      "Intelligent subagent alias resolution and fuzzy matching in runtime to prevent unknown subagent errors.",
      "Optimized subagent thinking levels to significantly reduce execution latency.",
    ],
  },
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
      "First release of DCode: an agent workspace for working with models, running tools, and reviewing the result.",
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
    version: "1.0.5",
    date: "2026-09-25",
    highlights: [
      "上下文容量统计彻底后端化：业务计算逻辑完全从前端 Vue 启发式猜测转移至后端 Agent Runtime (Node.js Sidecar)，杜绝业务残留。",
      "严格 Token 物理守恒与按比例分配：系统提示词、技能、系统工具、MCP 工具、消息历史与思考推理总和严格等于请求总占用，消除数据漂移。",
      "消除容量意外缩水与剧烈波动：重构底层占用计算公式，消除缓存命中与思考 Token 重复累加导致的容量忽大忽小与缓存失效骤降问题。",
      "技能 (Skills) 与 MCP 工具物理级真实呈现：基于物理 Schema 与提示词字符精准度量，真实展示技能目录与第三方 MCP 工具的上下文占比。",
      "思考推理 (Reasoning) 精准度量与保底：深度提取厂商推理 Token 并结合实时流式字符估算，杜绝思考数据归零或被隐藏。",
    ],
  },
  {
    version: "1.0.4",
    date: "2026-09-25",
    highlights: [
      "核心工程技能包按需加载：内置 dcode/vue-best-practices、dcode/react-best-practices、dcode/agent-browser、dcode/dogfood 与 dcode/electron，通过 Skill 工具动态激活，闲置时零上下文与零内存损耗。",
      "精选 MCP 预设中心与跨平台远端同步：内置 Context7、GitHub、Memory、Fetch、SQLite、Postgres 等 9 大常用预设并支持一键填充，通过 SSH 远端主机同步时自动转换跨平台路径与可执行命令。",
      "工作面板内置终端插件 (terminal)：集成交互式 Shell 终端，跨平台自动探测平台默认 Shell（PowerShell/CMD/Bash/Zsh），提供快捷指令卡片、历史命令回溯及智能体工具直连执行能力。",
      "工作面板内置文档插件 (documents)：集成丰富文档阅读与大纲导航面板，支持 Markdown 阅读时长与字数统计、分级大纲目录跳转、源码与预览切换，并原生支持 PDF 渲染浏览。",
    ],
  },
  {
    version: "1.0.3",
    date: "2026-09-24",
    highlights: [
      "计划模式全闭环与状态胶囊：会话右上角浮动状态胶囊，实时展示当前执行阶段、步骤名称及运行脉冲动画。",
      "轻量计划详情气泡卡片：点击胶囊展开轻量悬浮面板查看完整步骤清单与进度，支持一键定位文档与复制报告，不挤占工作区。",
      "安全托管模式与作用域防护：在项目工作区与记忆目录内享有自主读写与删除权限，越界路径底层静默拒绝且不打断上层任务。",
      "上下文容量洞察与显式用量统计：实时统计会话 Token 占用，细分思考推理、工具与系统提示词比例，配合微型压缩延缓上下文溢出。",
    ],
  },
  {
    version: "1.0.2",
    date: "2026-09-24",
    highlights: [
      "子智能体标准角色化设计：统一规范为 coder、reviewer、tester、researcher、designer，并提供完全向后兼容。",
      "运行时别名容错与匹配：彻底杜绝因大模型输出别名或中文名称导致的未知子智能体报错。",
      "优化子智能体思考等级：大幅降低子智能体执行耗时，消除不必要的长时间思考等待。",
    ],
  },
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
      "DCode 首个版本：一个用于与模型协作、运行工具并审查结果的 Agent 工作台。",
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
