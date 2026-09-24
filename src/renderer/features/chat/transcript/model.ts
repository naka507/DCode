/**
 * Pure readers over a `Task` delegation, shared by the transcript's tool row
 * and the subagent detail panel.
 *
 * The `model.ts` module. It is
 * framework-free, so only the import specifiers resolve through
 * `../../../lib/*` inside `src/renderer/`.
 */
import type { ThinkingLevel, UiMessage } from "@dcode/shared";
import { THINKING_LEVELS } from "@dcode/shared";
import type { SubagentRun } from "../../../lib/assistant-turns";
import { toolResultPayload } from "../../../lib/tool-presentation";

export function delegateAgentName(
  message: UiMessage,
  delegate?: SubagentRun,
): string {
  if (delegate?.agentName) return delegate.agentName;
  const args = message.toolArgs;
  if (args && typeof args === "object" && !Array.isArray(args)) {
    const requested = (args as { agent?: unknown }).agent;
    if (typeof requested === "string") return requested;
  }
  return "";
}

/**
 * Maps subagent identifier to a localized human-readable name.
 * e.g., "code-reviewer" -> "审查" (zh) / "Review" (en)
 *       "test-runner"   -> "测试" (zh) / "Test" (en)
 *       "explorer"      -> "探索" (zh) / "Explore" (en)
 *       "fixer"         -> "修复" (zh) / "Fix" (en)
 *       "ui-designer"   -> "设计" (zh) / "Design" (en)
 */
export function localizeAgentName(rawName: string, isZh = true): string {
  if (!rawName) return "";
  const trimmed = rawName.trim();
  const lower = trimmed.toLowerCase().replace(/[-_\s]+/g, "");

  if (isZh) {
    if (/[\u4e00-\u9fa5]/.test(trimmed)) {
      return trimmed;
    }
    if (lower === "codereviewer" || lower === "reviewer" || lower === "review") {
      return "审查";
    }
    if (lower === "testrunner" || lower === "tester" || lower === "test") {
      return "测试";
    }
    if (lower === "explorer" || lower === "explore") {
      return "探索";
    }
    if (lower === "fixer" || lower === "fix") {
      return "修复";
    }
    if (lower === "uidesigner" || lower === "designer" || lower === "design") {
      return "设计";
    }
    return trimmed;
  }

  // Non-Chinese (English default)
  if (trimmed === "审查") return "Review";
  if (trimmed === "测试") return "Test";
  if (trimmed === "探索" || trimmed === "探查") return "Explore";
  if (trimmed === "修复") return "Fix";
  if (trimmed === "设计") return "Design";
  if (lower === "codereviewer" || lower === "reviewer" || lower === "review") {
    return "Review";
  }
  if (lower === "testrunner" || lower === "tester" || lower === "test") {
    return "Test";
  }
  if (lower === "explorer" || lower === "explore") {
    return "Explore";
  }
  if (lower === "fixer" || lower === "fix") {
    return "Fix";
  }
  if (lower === "uidesigner" || lower === "designer" || lower === "design") {
    return "Design";
  }
  return trimmed.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Effective model resolved for this delegation, recorded by the Task result. */
export function delegateModelId(message: UiMessage): string {
  const payload = toolResultPayload(message);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return "";
  }
  const modelId = (payload as { modelId?: unknown }).modelId;
  return typeof modelId === "string" ? modelId.trim() : "";
}

/** Effective thinking level resolved for this delegation, from the Task result.
 * `off` and `omit` deliberately have no visible suffix. */
export function delegateThinkingLevel(message: UiMessage): ThinkingLevel | undefined {
  const payload = toolResultPayload(message);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }
  const value = (payload as { thinkingLevel?: unknown }).thinkingLevel;
  if (
    typeof value !== "string" ||
    value === "off" ||
    !THINKING_LEVELS.includes(value as ThinkingLevel)
  ) {
    return undefined;
  }
  return value as ThinkingLevel;
}

/**
 * Copies a run row's command from its head. The expanded body holds only the
 * output, so this is the one place the command can be taken from (D226).
 *
 * The doc comment describes a helper that no longer lives in this module; it
 * was left orphaned here when the component it described moved out. That
 * component is `ToolCommandCopy.vue`.
 */

/**
 * Limits task name to `maxLen` (default 6) characters, appending "..." if exceeded.
 */
export function truncateTaskName(task: string, maxLen = 6): string {
  const trimmed = task.trim();
  const chars = Array.from(trimmed);
  if (chars.length <= maxLen) {
    return chars.join("");
  }
  return `${chars.slice(0, maxLen).join("")}...`;
}

/**
 * Intelligently cleans multi-line task prompts when used as fallback.
 * If the prompt contains explicit "任务：" or "Task:" line, extracts that line.
 * If the first line is repository/context info ("仓库：...", "Repo: ..."), skips it.
 */
export function cleanFallbackTask(raw: string): string {
  if (!raw) return "";
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return "";
  for (const line of lines) {
    const taskMatch = line.match(/^(?:任务|Task|Goal|目标)[：:]\s*(.+)/i);
    if (taskMatch && taskMatch[1]?.trim()) {
      return taskMatch[1].trim();
    }
  }
  if (
    lines.length > 1 &&
    /^(?:仓库|项目|Repo|Repository|Context|目录|路径)[：:]/i.test(lines[0])
  ) {
    return lines[1];
  }
  return lines[0] || raw;
}

/**
 * Extracts raw task name or description from a delegation message's toolArgs.
 * Prioritizes concise `description`, `summary`, and `title` before falling back to full `task`/`prompt`.
 */
export function extractSubagentTaskName(message: UiMessage): string {
  let args = message.toolArgs;
  if (typeof args === "string") {
    const rawString = args;
    try {
      args = JSON.parse(rawString);
    } catch {
      const trimmed = rawString.trim();
      if (trimmed && !trimmed.startsWith("{") && !trimmed.startsWith("[")) {
        return cleanFallbackTask(trimmed);
      }
    }
  }

  if (args && typeof args === "object") {
    const record = args as Record<string, unknown>;

    if (Array.isArray(record.Subagents) && record.Subagents.length > 0) {
      const first = record.Subagents[0];
      if (first && typeof first === "object") {
        const sub = first as Record<string, unknown>;
        const subTask =
          (typeof sub.description === "string" && sub.description.trim()) ||
          (typeof sub.summary === "string" && sub.summary.trim()) ||
          (typeof sub.title === "string" && sub.title.trim()) ||
          (typeof sub.task === "string" && cleanFallbackTask(sub.task.trim())) ||
          (typeof sub.Role === "string" && sub.Role.trim()) ||
          (typeof sub.role === "string" && sub.role.trim()) ||
          (typeof sub.Prompt === "string" && cleanFallbackTask(sub.Prompt.trim())) ||
          (typeof sub.prompt === "string" && cleanFallbackTask(sub.prompt.trim())) ||
          "";
        if (subTask) return subTask;
      }
    }

    const raw =
      (typeof record.description === "string" && record.description.trim()) ||
      (typeof record.summary === "string" && record.summary.trim()) ||
      (typeof record.title === "string" && record.title.trim()) ||
      (typeof record.task === "string" && cleanFallbackTask(record.task.trim())) ||
      (typeof record.name === "string" && record.name.trim()) ||
      (typeof record.prompt === "string" && cleanFallbackTask(record.prompt.trim())) ||
      (typeof record.role === "string" && record.role.trim()) ||
      "";
    if (raw) return raw;
  }

  return "";
}

/**
 * Formats subagent title for the floating status bar.
 * Strips "智能体", displays as "探索：xxx任务名" (with task name truncated to 6 characters, "..." if exceeded).
 */
export function formatSubagentStatusTitle({
  message,
  delegate,
  isZh = true,
}: {
  message: UiMessage;
  delegate?: SubagentRun;
  isZh?: boolean;
}): string {
  const rawName = delegateAgentName(message, delegate);
  const localized = localizeAgentName(rawName, isZh) || (isZh ? "探索" : "Explore");

  const rawTask = extractSubagentTaskName(message);
  let cleanTask = rawTask.replace(/\s+/g, " ").trim();

  // Strip duplicate leading agent name (e.g. "探索：xxx" or "探索 xxx")
  if (cleanTask.startsWith(`${localized}:`) || cleanTask.startsWith(`${localized}：`)) {
    cleanTask = cleanTask.slice(localized.length + 1).trim();
  } else if (cleanTask.startsWith(localized) && cleanTask.length > localized.length) {
    cleanTask = cleanTask.slice(localized.length).trim();
  }

  if (!cleanTask) {
    return localized;
  }

  const colon = isZh ? "：" : ": ";
  return `${localized}${colon}${cleanTask}`;
}
