import type { PlanExecutionState } from "./types/plans.js";

export type PlanStageStepStatus = "pending" | "in_progress" | "completed";

export type PlanStageStep = {
  id: string;
  title: string;
  status: PlanStageStepStatus;
};

export type PlanStagePhase = {
  id: string;
  title: string;
  status: PlanStageStepStatus;
  steps: PlanStageStep[];
};

export type PlanStageSummary = {
  phases: PlanStagePhase[];
  totalSteps: number;
  completedSteps: number;
  inProgressSteps: number;
  currentPhaseIndex: number;
  progressPercent: number;
};

const CHECKBOX_PATTERN = /^\s*[-*+]\s+\[([ xX/=>\-])\]\s*(.+)$/;
const NUMBERED_STEP_PATTERN = /^\s*\d+[.)]\s+(.+)$/;
const HEADING_PATTERN = /^(?:#{1,4}\s+|(?:\*\*(?:Phase|Stage|阶段|步骤)\s*\d*[:：\s]*))([^\n*#]+)/i;

function cleanTitle(raw: string): string {
  return raw.replace(/[*_`]/g, "").trim();
}

function parseCheckboxStatus(mark: string): PlanStageStepStatus {
  const m = mark.trim();
  if (m === "x" || m === "X") return "completed";
  if (m === "/" || m === "=" || m === ">") return "in_progress";
  return "pending";
}

/**
 * Extract structured stages, phases, and steps from a Plan or Goal Markdown snapshot.
 * Supports task lists (- [x] / - [ ]), numbered items (1. Step), and section headings (## Phase 1).
 */
export function parsePlanStages(
  markdown: string | undefined | null,
  executionState?: PlanExecutionState,
): PlanStageSummary | null {
  if (!markdown || typeof markdown !== "string") return null;

  const lines = markdown.split(/\r?\n/);
  const phases: PlanStagePhase[] = [];

  let currentPhase: PlanStagePhase | null = null;
  let stepIndex = 0;
  let phaseIndex = 0;

  const ensurePhase = (title: string): PlanStagePhase => {
    phaseIndex += 1;
    const phase: PlanStagePhase = {
      id: `phase-${phaseIndex}`,
      title: cleanTitle(title),
      status: "pending",
      steps: [],
    };
    phases.push(phase);
    return phase;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const headingMatch = trimmed.match(HEADING_PATTERN);
    if (headingMatch && (trimmed.startsWith("#") || trimmed.startsWith("**"))) {
      const title = headingMatch[1]?.trim();
      if (title && title.length > 0 && !title.toLowerCase().startsWith("http")) {
        currentPhase = ensurePhase(title);
        continue;
      }
    }

    const checkboxMatch = line.match(CHECKBOX_PATTERN);
    if (checkboxMatch) {
      if (!currentPhase) {
        currentPhase = ensurePhase("Plan Overview");
      }
      stepIndex += 1;
      const status = parseCheckboxStatus(checkboxMatch[1]);
      const title = cleanTitle(checkboxMatch[2]);
      currentPhase.steps.push({
        id: `step-${stepIndex}`,
        title,
        status,
      });
      continue;
    }

    const numberedMatch = line.match(NUMBERED_STEP_PATTERN);
    if (numberedMatch && currentPhase) {
      stepIndex += 1;
      const title = cleanTitle(numberedMatch[1]);
      currentPhase.steps.push({
        id: `step-${stepIndex}`,
        title,
        status: "pending",
      });
    }
  }

  // Filter out phases that ended up with 0 steps, unless there are no other phases with steps
  const validPhases = phases.filter((p) => p.steps.length > 0);
  const activePhases = validPhases.length > 0 ? validPhases : phases;

  if (activePhases.length === 0) return null;

  // Harmonize status with executionState
  let totalSteps = 0;
  let completedSteps = 0;
  let inProgressSteps = 0;

  for (const phase of activePhases) {
    for (const step of phase.steps) {
      totalSteps += 1;
      if (executionState === "completed") {
        step.status = "completed";
      }
      if (step.status === "completed") {
        completedSteps += 1;
      } else if (step.status === "in_progress") {
        inProgressSteps += 1;
      }
    }
  }

  // If executing and no step is explicitly marked in_progress, mark the first pending step as in_progress
  if (executionState === "running" && inProgressSteps === 0 && completedSteps < totalSteps) {
    for (const phase of activePhases) {
      const firstPending = phase.steps.find((s) => s.status === "pending");
      if (firstPending) {
        firstPending.status = "in_progress";
        inProgressSteps += 1;
        break;
      }
    }
  }

  // Determine overall phase status
  for (const phase of activePhases) {
    if (executionState === "completed") {
      phase.status = "completed";
      continue;
    }
    if (phase.steps.length === 0) {
      phase.status = "pending";
      continue;
    }
    const allDone = phase.steps.every((s) => s.status === "completed");
    const anyRunning = phase.steps.some((s) => s.status === "in_progress");
    const anyDone = phase.steps.some((s) => s.status === "completed");

    if (allDone) {
      phase.status = "completed";
    } else if (anyRunning || anyDone) {
      phase.status = "in_progress";
    } else {
      phase.status = "pending";
    }
  }

  const currentPhaseIndex = Math.max(
    0,
    activePhases.findIndex((p) => p.status === "in_progress" || p.status === "pending"),
  );

  const progressPercent =
    totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

  return {
    phases: activePhases,
    totalSteps,
    completedSteps,
    inProgressSteps,
    currentPhaseIndex,
    progressPercent,
  };
}
