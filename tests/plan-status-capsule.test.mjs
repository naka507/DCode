import assert from "node:assert/strict";
import { register } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));

const { parsePlanStages } = await import("../src/shared/plan-stages.ts");

test("parsePlanStages extracts structured phases and steps", () => {
  const markdown = `
# 三仓收敛: 门禁修复

## Phase 1: 准备工作
- [x] 梳理已知失败与依赖
- [x] 准备本地编译与测试环境

## Phase 2: 核心修复
- [>] 修复 ChrSel.wil 设备端打不开 (LoginScene 缺 resolveRealPath 注册)
- [ ] 实现自动捡物 (默认开，688ms 周期 + 过滤) + 设置窗开关
- [ ] 补全自动挂机: 摇杆取消/死目标清理/卡死保护 + HUD 同步
- [ ] 验证全流程回归测试
`;

  const stages = parsePlanStages(markdown, "running");
  assert.ok(stages);
  assert.equal(stages.totalSteps, 6);
  assert.equal(stages.completedSteps, 2);
  assert.equal(stages.inProgressSteps, 1);
});

test("PlanStatusCapsule template and styles match the reference mockup", async () => {
  const { readFileSync } = await import("node:fs");
  const capsuleContent = readFileSync(
    join(here, "../src/renderer/components/PlanStatusCapsule.vue"),
    "utf-8",
  );
  const chromeCss = readFileSync(
    join(here, "../src/renderer/styles/chrome.css"),
    "utf-8",
  );

  // Status bar capsule binds displayTitle without verbose step details
  assert.ok(
    capsuleContent.includes("displayTitle = computed"),
    "PlanStatusCapsule must compute displayTitle for status bar",
  );
  assert.ok(
    capsuleContent.includes("class=\"capsule-plan-title\" :title=\"displayTitle\""),
    "PlanStatusCapsule must render concise displayTitle",
  );
  assert.ok(
    !capsuleContent.includes("capsule-plan-step"),
    "PlanStatusCapsule must not pollute the status bar with detailed current step text",
  );

  // Popover header matches mockup: 进程 2/9 ... ↗
  assert.ok(
    capsuleContent.includes("plan-popover-badge-label"),
    "Popover header must have badge label for 进程",
  );
  assert.ok(
    capsuleContent.includes("plan-popover-ratio-text"),
    "Popover header must have ratio text for completed/total",
  );
  assert.ok(
    capsuleContent.includes("is-launch"),
    "Popover header must have launch button '↗' to open details in right panel",
  );

  // Popover body matches mockup: collapsed completed, active step with '→', pending with '○'
  assert.ok(
    capsuleContent.includes("plan-collapse-section"),
    "Popover body must have collapsible completed section",
  );
  assert.ok(
    capsuleContent.includes("plan-inprogress-section"),
    "Popover body must have in-progress section",
  );
  assert.ok(
    capsuleContent.includes("IconArrowRight"),
    "In-progress section must render '→' arrow icon",
  );
  assert.ok(
    capsuleContent.includes("plan-circle-icon"),
    "Pending section must render '○' circle icon",
  );
  assert.ok(
    capsuleContent.includes("plan-popover-footer"),
    "Popover must have footer quick link to right panel",
  );

  // CSS definitions exist in chrome.css
  assert.match(
    chromeCss,
    /\.plan-status-popover\s*\{[^}]*width:\s*330px/,
    "chrome.css must specify compact 330px width for plan-status-popover",
  );
  assert.match(
    chromeCss,
    /\.plan-circle-icon\s*\{[^}]*border-radius:\s*50%/,
    "chrome.css must define circular icon for pending steps",
  );
});
