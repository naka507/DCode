import test from "node:test";
import assert from "node:assert/strict";
import { parsePlanStages } from "../src/shared/plan-stages.js";

test("parsePlanStages parses markdown phases and checkbox steps", () => {
  const markdown = `
# Implementation Plan

## Phase 1: Exploration
- [x] Read repository structure
- [x] Inspect existing context code

## Phase 2: Core Changes
- [/] Add reasoning tokens breakdown
- [ ] Add segmented progress bar

## Phase 3: Verification
- [ ] Run test suite
- [ ] Check architecture limits
`;

  const summary = parsePlanStages(markdown);
  assert.ok(summary);
  assert.equal(summary.phases.length, 3);
  assert.equal(summary.totalSteps, 6);
  assert.equal(summary.completedSteps, 2);
  assert.equal(summary.inProgressSteps, 1);
  assert.equal(summary.progressPercent, 33);

  assert.equal(summary.phases[0].title, "Phase 1: Exploration");
  assert.equal(summary.phases[0].status, "completed");

  assert.equal(summary.phases[1].title, "Phase 2: Core Changes");
  assert.equal(summary.phases[1].status, "in_progress");

  assert.equal(summary.phases[2].title, "Phase 3: Verification");
  assert.equal(summary.phases[2].status, "pending");
});

test("parsePlanStages harmonizes completed executionState", () => {
  const markdown = `
## 阶段一：调研
- [ ] 阅读文档
## 阶段二：开发
- [ ] 编写代码
`;

  const summary = parsePlanStages(markdown, "completed");
  assert.ok(summary);
  assert.equal(summary.totalSteps, 2);
  assert.equal(summary.completedSteps, 2);
  assert.equal(summary.progressPercent, 100);
  assert.equal(summary.phases[0].status, "completed");
  assert.equal(summary.phases[1].status, "completed");
});

test("parsePlanStages marks first pending step as in_progress when running", () => {
  const markdown = `
## Phase 1
- [ ] Step A
- [ ] Step B
`;

  const summary = parsePlanStages(markdown, "running");
  assert.ok(summary);
  assert.equal(summary.inProgressSteps, 1);
  assert.equal(summary.phases[0].status, "in_progress");
  assert.equal(summary.phases[0].steps[0].status, "in_progress");
  assert.equal(summary.phases[0].steps[1].status, "pending");
});

test("parsePlanStages handles flat list with default phase", () => {
  const markdown = `
- [x] Task 1
- [ ] Task 2
- [ ] Task 3
`;

  const summary = parsePlanStages(markdown);
  assert.ok(summary);
  assert.equal(summary.phases.length, 1);
  assert.equal(summary.totalSteps, 3);
  assert.equal(summary.completedSteps, 1);
  assert.equal(summary.progressPercent, 33);
});

test("parsePlanStages returns null on empty or non-plan markdown", () => {
  assert.equal(parsePlanStages(""), null);
  assert.equal(parsePlanStages(null), null);
  assert.equal(parsePlanStages("Just some conversational text without any steps."), null);
});
