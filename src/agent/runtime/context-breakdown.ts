/**
 * Backend context capacity breakdown builder.
 *
 * Measures the exact physical footprint (characters and proportional tokens)
 * of every component sent to the LLM:
 *  - systemPrompt: Base instructions, project instructions, memory, environment
 *  - skills: Plugin skills catalog and active skill instructions
 *  - systemTools: JSON schemas of native/built-in tools (Read, Bash, Edit, etc.)
 *  - mcpTools: JSON schemas of external MCP tools and plugin tools
 *  - messages: Conversational turns (user prompt, assistant answer, tool results)
 *  - reasoning: Model thinking / reasoning tokens
 *
 * Guarantees that token allocations sum exactly to the model's total context occupancy
 * without double-counting cache reads or reasoning tokens.
 */

import type { AgentMessage, AgentTool } from "@earendil-works/pi-agent-core";
import type {
  ContextBreakdownItem,
  ContextBreakdownSource,
  MessageUsage,
} from "@dcode/shared";
import type { PluginSkillDef } from "./plugin-skills.js";

export interface BuildContextBreakdownOptions {
  systemPromptText: string;
  skills?: readonly PluginSkillDef[];
  skillsPromptText?: string;
  activeTools?: readonly AgentTool[];
  messages?: readonly AgentMessage[];
  usage?: MessageUsage;
  nextThinking?: string;
}

export const BUILTIN_TOOL_NAMES = new Set([
  "Read",
  "Write",
  "Edit",
  "Patch",
  "Glob",
  "Grep",
  "Bash",
  "BrowserPreview",
  "FileOutline",
  "Ask",
  "Task",
  "TaskWait",
  "TaskList",
  "TaskStop",
  "EnterPlanMode",
  "EnterGoalMode",
  "SubmitPlan",
  "SubmitGoal",
  "CompactContext",
  "ToolSearch",
  "Skill",
]);

export function isMcpOrPluginTool(toolName: string): boolean {
  if (
    toolName.startsWith("mcp_") ||
    toolName.startsWith("Mcp_") ||
    toolName.startsWith("plugin_") ||
    toolName.startsWith("Plugin_") ||
    toolName.startsWith("ext_") ||
    toolName.startsWith("Ext_")
  ) {
    return true;
  }
  return !BUILTIN_TOOL_NAMES.has(toolName);
}

export function formatBreakdownPercent(percent: number): string {
  if (!Number.isFinite(percent) || percent <= 0) return "0%";
  const rounded = Math.round(percent * 10) / 10;
  return rounded % 1 === 0 ? `${rounded}%` : `${rounded.toFixed(1)}%`;
}

function stringifySafe(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value ?? "");
  }
}

export function measureAgentMessageChars(message: AgentMessage): number {
  let chars = 0;
  const anyMsg = message as any;
  if (typeof anyMsg.content === "string") {
    chars += anyMsg.content.length;
  } else if (Array.isArray(anyMsg.content)) {
    for (const block of anyMsg.content) {
      if (!block) continue;
      if (block.type === "text" && typeof block.text === "string") {
        chars += block.text.length;
      } else if (block.type === "thinking" && typeof block.thinking === "string") {
        chars += block.thinking.length;
      } else if (block.type === "toolCall") {
        chars += (block.name?.length ?? 0) + stringifySafe(block.args).length;
      } else {
        chars += stringifySafe(block).length;
      }
    }
  } else if (typeof anyMsg.command === "string" || typeof anyMsg.output === "string") {
    chars += (anyMsg.command?.length ?? 0) + (anyMsg.output?.length ?? 0);
  }
  return chars;
}

export function measureToolSchemaChars(tool: AgentTool): number {
  return (
    (tool.name?.length ?? 0) +
    (tool.description?.length ?? 0) +
    stringifySafe(tool.parameters).length
  );
}

export function buildContextBreakdownSnapshot(
  options: BuildContextBreakdownOptions,
): ContextBreakdownItem[] {
  const {
    systemPromptText = "",
    skillsPromptText = "",
    activeTools = [],
    messages = [],
    usage,
    nextThinking = "",
  } = options;

  // 1. Measure skills
  let skillsChars = skillsPromptText.length;
  if (skillsChars === 0 && options.skills?.length) {
    skillsChars = options.skills.reduce((sum, s) => {
      return (
        sum +
        (s.id?.length ?? 0) +
        (s.name?.length ?? 0) +
        (s.description?.length ?? 0)
      );
    }, 0);
  }

  // 2. Measure base system prompt (excluding skills prompt if embedded)
  let systemPromptChars = systemPromptText.length;
  if (skillsPromptText && systemPromptText.includes(skillsPromptText)) {
    systemPromptChars = Math.max(0, systemPromptChars - skillsPromptText.length);
  }

  // 3. Measure tools (distinguish system tools vs MCP/plugin tools)
  let systemToolsChars = 0;
  let mcpToolsChars = 0;
  for (const tool of activeTools) {
    const chars = measureToolSchemaChars(tool);
    if (isMcpOrPluginTool(tool.name)) {
      mcpToolsChars += chars;
    } else {
      systemToolsChars += chars;
    }
  }

  // 4. Measure messages in active context
  let messagesInputChars = 0;
  for (const msg of messages) {
    if ((msg as any).role === "system") continue;
    messagesInputChars += measureAgentMessageChars(msg);
  }

  // 5. Token resolution
  const reportedInput =
    typeof usage?.inputTokens === "number" && usage.inputTokens > 0
      ? usage.inputTokens
      : 0;
  const reportedOutput =
    typeof usage?.outputTokens === "number" && usage.outputTokens > 0
      ? usage.outputTokens
      : 0;
  const reportedReasoning =
    typeof usage?.reasoningTokens === "number" && usage.reasoningTokens >= 0
      ? usage.reasoningTokens
      : undefined;

  const totalInputChars =
    systemPromptChars +
    skillsChars +
    systemToolsChars +
    mcpToolsChars +
    messagesInputChars;

  // If input tokens not reported, estimate at 3.5 chars per token
  const effectiveInputTokens =
    reportedInput > 0
      ? reportedInput
      : Math.max(1, Math.ceil(totalInputChars / 3.5));

  // Allocate input tokens proportionally by character counts
  const safeTotalInputChars = Math.max(1, totalInputChars);
  const promptTokens =
    systemPromptChars > 0
      ? Math.max(
          1,
          Math.round((systemPromptChars / safeTotalInputChars) * effectiveInputTokens),
        )
      : 0;
  const skillTokens =
    skillsChars > 0
      ? Math.max(
          1,
          Math.round((skillsChars / safeTotalInputChars) * effectiveInputTokens),
        )
      : 0;
  const systemToolTokens =
    systemToolsChars > 0
      ? Math.max(
          1,
          Math.round((systemToolsChars / safeTotalInputChars) * effectiveInputTokens),
        )
      : 0;
  const mcpTokens =
    mcpToolsChars > 0
      ? Math.max(
          1,
          Math.round((mcpToolsChars / safeTotalInputChars) * effectiveInputTokens),
        )
      : 0;

  // Message input tokens absorbs any rounding slack so input parts sum exactly to effectiveInputTokens
  const messageInputTokens = Math.max(
    0,
    effectiveInputTokens - promptTokens - skillTokens - systemToolTokens - mcpTokens,
  );

  // Reasoning and response text tokens
  const estimatedReasoning =
    nextThinking.trim().length > 0
      ? Math.ceil(nextThinking.trim().length / 3)
      : 0;

  let finalReasoningTokens = 0;
  let assistantResponseTextTokens = 0;
  let effectiveOutputTokens = reportedOutput;

  if (reportedReasoning !== undefined) {
    if (reportedOutput >= reportedReasoning) {
      finalReasoningTokens = reportedReasoning;
      assistantResponseTextTokens = reportedOutput - reportedReasoning;
    } else {
      finalReasoningTokens = reportedReasoning;
      assistantResponseTextTokens = reportedOutput;
      effectiveOutputTokens = reportedOutput + reportedReasoning;
    }
  } else {
    finalReasoningTokens =
      reportedOutput > 0
        ? Math.min(reportedOutput, estimatedReasoning)
        : estimatedReasoning;
    assistantResponseTextTokens = Math.max(0, reportedOutput - finalReasoningTokens);
  }

  // Total message tokens in context (historical message input + assistant text output)
  const totalMessageTokens = messageInputTokens + assistantResponseTextTokens;

  // Total context occupancy: Prompt (input) + Generated Output
  const totalOccupancy = effectiveInputTokens + effectiveOutputTokens;

  const rawItems: Array<{
    key: ContextBreakdownSource;
    labelKey: string;
    colorClass: string;
    tokens: number;
    chars: number;
  }> = [
    {
      key: "messages",
      labelKey: "chat.usageBreakdownMessages",
      colorClass: "dot-messages",
      tokens: totalMessageTokens,
      chars: messagesInputChars,
    },
    {
      key: "reasoning",
      labelKey: "chat.usageBreakdownReasoning",
      colorClass: "dot-reasoning",
      tokens: finalReasoningTokens,
      chars: nextThinking.length,
    },
    {
      key: "systemTools",
      labelKey: "chat.usageBreakdownSystemTools",
      colorClass: "dot-system-tools",
      tokens: systemToolTokens,
      chars: systemToolsChars,
    },
    {
      key: "systemPrompt",
      labelKey: "chat.usageBreakdownSystemPrompt",
      colorClass: "dot-system-prompt",
      tokens: promptTokens,
      chars: systemPromptChars,
    },
    {
      key: "skills",
      labelKey: "chat.usageBreakdownSkills",
      colorClass: "dot-skills",
      tokens: skillTokens,
      chars: skillsChars,
    },
    {
      key: "mcp",
      labelKey: "chat.usageBreakdownMcp",
      colorClass: "dot-mcp",
      tokens: mcpTokens,
      chars: mcpToolsChars,
    },
  ];

  return rawItems.map((item) => {
    const percent =
      totalOccupancy > 0 ? (item.tokens / totalOccupancy) * 100 : 0;
    return {
      ...item,
      percent,
      formattedPercent: formatBreakdownPercent(percent),
    };
  });
}
