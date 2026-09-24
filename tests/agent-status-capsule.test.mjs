import assert from "node:assert/strict";
import { register } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));

const {
  localizeAgentName,
  delegateAgentName,
  truncateTaskName,
  extractSubagentTaskName,
  formatSubagentStatusTitle,
} = await import("../src/renderer/features/chat/transcript/model.ts");
const { getToolAction } = await import("../src/renderer/lib/tool-display.ts");

test("localizeAgentName maps English identifiers to localized Chinese subagent names", () => {
  assert.equal(localizeAgentName("reviewer", true), "审查");
  assert.equal(localizeAgentName("code-reviewer", true), "审查");
  assert.equal(localizeAgentName("test-runner", true), "测试");
  assert.equal(localizeAgentName("tester", true), "测试");
  assert.equal(localizeAgentName("explorer", true), "探索");
  assert.equal(localizeAgentName("fixer", true), "修复");
  assert.equal(localizeAgentName("ui-designer", true), "设计");
});

test("localizeAgentName maps Chinese identifiers to English names", () => {
  assert.equal(localizeAgentName("审查", false), "Review");
  assert.equal(localizeAgentName("测试", false), "Test");
  assert.equal(localizeAgentName("探索", false), "Explore");
  assert.equal(localizeAgentName("修复", false), "Fix");
  assert.equal(localizeAgentName("设计", false), "Design");
});

test("tool action categorization identifies run, read, write, thinking correctly", () => {
  assert.equal(getToolAction("bash"), "run");
  assert.equal(getToolAction("runCommand"), "run");
  assert.equal(getToolAction("readFile"), "read");
  assert.equal(getToolAction("read"), "read");
  assert.equal(getToolAction("grep"), "search");
  assert.equal(getToolAction("listFiles"), "list");
  assert.equal(getToolAction("webSearch"), "fetch");
  assert.equal(getToolAction("writeFile"), "write");
  assert.equal(getToolAction("editFile"), "edit");
});

test("network error pattern identifies network faults, 429, timeouts, and connection refused", () => {
  const NETWORK_OR_WAITING_PATTERN =
    /ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EPIPE|ENETUNREACH|EHOSTUNREACH|UND_ERR|fetch failed|socket hang up|network error|connection error|connection refused|dns|rate_limit|rate limit|429|timeout|retry|waiting/i;

  assert.ok(NETWORK_OR_WAITING_PATTERN.test("connect ECONNREFUSED 127.0.0.1:11434"));
  assert.ok(NETWORK_OR_WAITING_PATTERN.test("fetch failed"));
  assert.ok(NETWORK_OR_WAITING_PATTERN.test("Rate limit exceeded (429)"));
  assert.ok(NETWORK_OR_WAITING_PATTERN.test("gateway timeout"));
  assert.ok(NETWORK_OR_WAITING_PATTERN.test("getaddrinfo ENOTFOUND api.openai.com"));
  assert.ok(NETWORK_OR_WAITING_PATTERN.test("Retrying after 5s"));
  assert.ok(!NETWORK_OR_WAITING_PATTERN.test("SyntaxError: unexpected token"));
});

test("renderActivityRows filters out wait lifecycle tool calls from transcript", async () => {
  const { renderActivityRows } = await import(
    "../src/renderer/features/chat/transcript/activity-group.ts"
  );
  const items = [
    {
      kind: "tool",
      message: {
        id: "m1",
        role: "tool",
        toolName: "taskwait",
        toolStatus: "running",
      },
    },
    {
      kind: "tool",
      message: {
        id: "m2",
        role: "tool",
        toolName: "readFile",
        toolStatus: "success",
      },
    },
    {
      kind: "tool",
      message: {
        id: "m3",
        role: "tool",
        toolName: "taskwait",
        toolStatus: "success",
      },
    },
  ];

  const rows = renderActivityRows(items, false);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].key, "m2");
});

test("agent status bar is mounted inside thread-wrap in ChatTranscript and styled vertically", async () => {
  const { readFileSync } = await import("node:fs");
  const transcriptContent = readFileSync(
    join(here, "../src/renderer/features/chat/transcript/ChatTranscript.vue"),
    "utf-8",
  );
  const chatSurfaceContent = readFileSync(
    join(here, "../src/renderer/components/ChatSurface.vue"),
    "utf-8",
  );
  const chromeCss = readFileSync(
    join(here, "../src/renderer/styles/chrome.css"),
    "utf-8",
  );

  // ChatSurface should not mount AgentStatusCapsule
  assert.ok(!chatSurfaceContent.includes("<AgentStatusCapsule"));

  // ChatTranscript should mount AgentStatusCapsule
  assert.ok(transcriptContent.includes("<AgentStatusCapsule"));
  assert.ok(transcriptContent.includes("subagentsActive"));

  // chrome.css should define column layout for agent-status-bar positioned below toolbar
  assert.match(chromeCss, /\.agent-status-bar\s*\{[^}]*flex-direction:\s*column/);
  assert.match(chromeCss, /\.agent-status-bar\s*\{[^}]*top:\s*calc\(var\(--ds-toolbar-height\)\s*\+\s*12px\)/);
  assert.match(chromeCss, /\.agent-status-bar\s*\{[^}]*right:\s*18px/);
});

test("waiting-subagents phase returns '等待智能体执行' global status label and switches timely on resume", async () => {
  const { runActivityLabel } = await import(
    "../src/renderer/features/chat/transcript/activity-group.ts"
  );
  const zhTranslations = {
    "chat.waitingForAgents": "等待智能体执行",
    "chat.waitingForModel": "等待模型响应",
    "chat.startingTurn": "正在开始…",
  };
  const mockT = (key) => zhTranslations[key] || key;

  // 1. When main window actively waits for subagents:
  const waitingLabel = runActivityLabel(
    {
      phase: "waiting-subagents",
      since: Date.now(),
      subagentCount: 2,
    },
    mockT,
  );
  assert.equal(waitingLabel, "等待智能体执行");

  // 2. When one subagent finishes and reports back, main window resumes (e.g. waiting for model):
  const resumingLabel = runActivityLabel(
    {
      phase: "waiting-model",
      since: Date.now(),
    },
    mockT,
  );
  assert.equal(resumingLabel, "等待模型响应");
});

test("subagent tool row unifies with standard tool row structure, caret disclosure, and open state", async () => {
  const { readFileSync } = await import("node:fs");
  const toolRowContent = readFileSync(
    join(here, "../src/renderer/features/chat/transcript/ToolRow.vue"),
    "utf-8",
  );

  // Caret must NOT be excluded for subagent rows
  assert.ok(
    toolRowContent.includes('v-if="!runHead && hasDetails" class="tool-row-caret"'),
    "ToolRow must render caret for all detailed non-run tool rows including subagents",
  );
  assert.ok(
    !toolRowContent.includes('!runHead && hasDetails && !isDelegate'),
    "ToolRow must not suppress caret on isDelegate",
  );

  // renderedOpen must bind panelOpen for isDelegate to rotate the caret when open
  assert.ok(
    toolRowContent.includes("isTopology.value || isDelegate.value ? panelOpen.value : open.value"),
    "renderedOpen must reflect panelOpen for subagents so .open class is attached",
  );

  // Tooltip must offer viewExecutionInSidebar for isDelegate
  assert.ok(
    toolRowContent.includes("isDelegate ? t('chat.viewExecutionInSidebar') : (summary || rawName)"),
    "ToolRow header must have viewExecutionInSidebar title for subagents",
  );
});

test("truncateTaskName limits task name to 6 characters and appends '...' when exceeded", () => {
  assert.equal(truncateTaskName("查看代码"), "查看代码");
  assert.equal(truncateTaskName("审查项目结构"), "审查项目结构"); // 6 chars, exact
  assert.equal(truncateTaskName("分析项目代码架构"), "分析项目代码..."); // 8 chars -> 6 chars + "..."
  assert.equal(truncateTaskName("   代码重构与优化测试   "), "代码重构与优..."); // trimmed -> 6 chars + "..."
  assert.equal(truncateTaskName(""), "");
});

test("formatSubagentStatusTitle strips '智能体' and formats as '探索：xxx任务名' without dynamic JS truncation", () => {
  // 1. Chinese explore agent with task:
  const msg1 = {
    id: "m1",
    role: "tool",
    toolName: "Task",
    toolArgs: { agent: "explorer", task: "代码审查" },
  };
  const title1 = formatSubagentStatusTitle({ message: msg1, isZh: true });
  assert.equal(title1, "探索：代码审查");
  assert.ok(!title1.includes("智能体"), "Title must not include '智能体'");

  // 2. Long task name is preserved in JS (length of 6 Chinese characters is handled in CSS):
  const msg2 = {
    id: "m2",
    role: "tool",
    toolName: "Task",
    toolArgs: { agent: "explorer", task: "分析项目代码架构" },
  };
  const title2 = formatSubagentStatusTitle({ message: msg2, isZh: true });
  assert.equal(title2, "探索：分析项目代码架构");

  // 3. Avoid duplicate "探索：" prefix when task already starts with "探索":
  const msg3 = {
    id: "m3",
    role: "tool",
    toolName: "Task",
    toolArgs: { agent: "explorer", task: "探索：全局状态优化" },
  };
  const title3 = formatSubagentStatusTitle({ message: msg3, isZh: true });
  assert.equal(title3, "探索：全局状态优化");

  // 4. Subagent without task description falls back to bare agent name without dangling colon:
  const msg4 = {
    id: "m4",
    role: "tool",
    toolName: "Task",
    toolArgs: { agent: "explorer" },
  };
  const title4 = formatSubagentStatusTitle({ message: msg4, isZh: true });
  assert.equal(title4, "探索");

  // 5. English locale:
  const msgEn = {
    id: "m5",
    role: "tool",
    toolName: "Task",
    toolArgs: { agent: "explorer", task: "Search files in project" },
  };
  const titleEn = formatSubagentStatusTitle({ message: msgEn, isZh: false });
  assert.equal(titleEn, "Explore: Search files in project");
});

test("CSS restricts task name to 6 Chinese characters length (6em) with ellipsis", async () => {
  const { readFileSync } = await import("node:fs");
  const chromeCss = readFileSync(
    join(here, "../src/renderer/styles/chrome.css"),
    "utf-8",
  );
  const capsuleContent = readFileSync(
    join(here, "../src/renderer/components/AgentStatusCapsule.vue"),
    "utf-8",
  );

  // Template binds capsule-task-name for the task name
  assert.ok(
    capsuleContent.includes('class="capsule-task-name"'),
    "AgentStatusCapsule must render capsule-task-name for CSS truncation",
  );

  // CSS specifies fixed 6em length (6 Chinese font characters) and ellipsis
  assert.match(
    chromeCss,
    /\.capsule-task-name\s*\{[^}]*max-width:\s*6em/,
    ".capsule-task-name must specify max-width: 6em in chrome.css",
  );
  assert.match(
    chromeCss,
    /\.capsule-task-name\s*\{[^}]*text-overflow:\s*ellipsis/,
    ".capsule-task-name must specify text-overflow: ellipsis in chrome.css",
  );
});

test("completed agent status bar is suppressed when browsing history or when session is not running", async () => {
  const { readFileSync } = await import("node:fs");
  const transcriptContent = readFileSync(
    join(here, "../src/renderer/features/chat/transcript/ChatTranscript.vue"),
    "utf-8",
  );
  const capsuleContent = readFileSync(
    join(here, "../src/renderer/components/AgentStatusCapsule.vue"),
    "utf-8",
  );

  // ChatTranscript passes is-browsing-history tied to showJump or readingWindow
  assert.ok(
    transcriptContent.includes(":is-browsing-history=\"Boolean(showJump || props.readingWindow)\""),
    "ChatTranscript must pass is-browsing-history prop to AgentStatusCapsule",
  );

  // AgentStatusCapsule suppresses isSettled subagents when browsing history or !running
  assert.ok(
    capsuleContent.includes("if (isBrowsingHistoryEffective.value)"),
    "AgentStatusCapsule must check isBrowsingHistoryEffective to suppress completed capsules",
  );
  assert.ok(
    capsuleContent.includes("if (!running)"),
    "AgentStatusCapsule must suppress completed capsules when session is not running",
  );
});

test("extractSubagentTaskName prioritizes description over task and cleans multiline fallbacks", () => {
  // 1. When description is provided alongside full prompt in task, description wins (DCode Task tool convention)
  const msgWithDesc = {
    id: "m_desc",
    role: "tool",
    toolName: "Task",
    toolArgs: {
      agent: "test-runner",
      description: "运行校验链并汇报失败",
      task: "仓库：E:\\Code\\eshop（pnpm + Turbo monorepo，Windows PowerShell 环境）。\n\n任务：运行项目的质量校验链，报告真实结果。",
    },
  };
  assert.equal(extractSubagentTaskName(msgWithDesc), "运行校验链并汇报失败");
  const statusTitle = formatSubagentStatusTitle({ message: msgWithDesc, isZh: true });
  assert.equal(statusTitle, "测试：运行校验链并汇报失败");

  // 2. When description is absent and task has repository context before explicit task, extracts the task line
  const msgMultiline = {
    id: "m_multi",
    role: "tool",
    toolName: "Task",
    toolArgs: {
      agent: "explorer",
      task: "仓库：E:\\Code\\eshop\n\n任务：扫描里程碑与未完成项",
    },
  };
  assert.equal(extractSubagentTaskName(msgMultiline), "扫描里程碑与未完成项");
  const multiTitle = formatSubagentStatusTitle({ message: msgMultiline, isZh: true });
  assert.equal(multiTitle, "探索：扫描里程碑与未完成项");

  // 3. Subagents array structure also prioritizes description
  const msgSubagents = {
    id: "m_subagents",
    role: "tool",
    toolName: "Task",
    toolArgs: {
      Subagents: [
        {
          Role: "测试",
          description: "运行校验链并汇报失败",
          task: "仓库：E:\\Code\\eshop\n\n任务：跑完整测试",
        },
      ],
    },
  };
  assert.equal(extractSubagentTaskName(msgSubagents), "运行校验链并汇报失败");
});

