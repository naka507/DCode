/**
 * Tests for `subagent-presets`. The presets drive the Subagent editor's
 * "start from template" affordances (issue #60) and must stay in lockstep with
 * `BUILTIN_SUBAGENT_DOCUMENTS` in `agent-runtime/src/subagent-definitions.ts`
 * so the editor pre-fills the same prompt the runtime will execute.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_SUBAGENT_TOOLS } from "../../src/shared/subagent-definition.js";
import {
  SUBAGENT_PRESETS,
  defaultSubagentPresetTools,
  fallbackBuiltinDefinitions,
  findSubagentPreset,
} from "../../src/shared/subagent-presets.js";

describe("SUBAGENT_PRESETS", () => {
  it("ships the five builtin roles", () => {
    const ids = SUBAGENT_PRESETS.map((preset) => preset.id);
    expect(ids).toEqual([
      "researcher",
      "reviewer",
      "tester",
      "coder",
      "designer",
    ]);
  });

  it("never duplicates a name", () => {
    const names = SUBAGENT_PRESETS.map((preset) => preset.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("declares at least one tool per preset", () => {
    for (const preset of SUBAGENT_PRESETS) {
      expect(preset.tools.length).toBeGreaterThan(0);
    }
  });

  it("writes non-empty body copy", () => {
    for (const preset of SUBAGENT_PRESETS) {
      expect(preset.body.trim().length).toBeGreaterThan(0);
    }
  });

  it("exposes no turn cap on any preset", () => {
    // ADR 0253 removed the delegate turn limit, so no preset may carry one.
    for (const preset of SUBAGENT_PRESETS) {
      expect("maxTurns" in preset).toBe(false);
    }
  });

  it("grants Edit/Write only to roles that need them", () => {
    const coder = findSubagentPreset("coder");
    const researcher = findSubagentPreset("researcher");
    const reviewer = findSubagentPreset("reviewer");
    const runner = findSubagentPreset("tester");
    const designer = findSubagentPreset("designer");
    expect(coder?.tools).toContain("Edit");
    expect(coder?.tools).toContain("Write");
    expect(designer?.tools).toContain("Edit");
    expect(designer?.tools).toContain("Write");
    expect(designer?.tools).toContain("BrowserPreview");
    expect(researcher?.tools ?? []).not.toContain("Edit");
    expect(reviewer?.tools ?? []).not.toContain("Edit");
    expect(runner?.tools ?? []).not.toContain("Edit");
  });
});

describe("findSubagentPreset", () => {
  it("returns the matching preset", () => {
    expect(findSubagentPreset("researcher")?.id).toBe("researcher");
    expect(findSubagentPreset("coder")?.id).toBe("coder");
    expect(findSubagentPreset("designer")?.id).toBe("designer");
  });

  it("resolves legacy and alias names to canonical presets", () => {
    expect(findSubagentPreset("explorer")?.id).toBe("researcher");
    expect(findSubagentPreset("fixer")?.id).toBe("coder");
    expect(findSubagentPreset("code-reviewer")?.id).toBe("reviewer");
    expect(findSubagentPreset("test-runner")?.id).toBe("tester");
    expect(findSubagentPreset("ui-designer")?.id).toBe("designer");
    expect(findSubagentPreset("代码开发")?.id).toBe("coder");
  });

  it("returns undefined for unknown ids", () => {
    expect(findSubagentPreset("nope")).toBeUndefined();
    expect(findSubagentPreset("")).toBeUndefined();
  });
});

describe("defaultSubagentPresetTools", () => {
  it("matches the shared default tool list", () => {
    expect(defaultSubagentPresetTools()).toEqual(DEFAULT_SUBAGENT_TOOLS);
  });
});

describe("fallbackBuiltinDefinitions", () => {
  it("emits one catalog entry per preset, keyed by Task handle", () => {
    const definitions = fallbackBuiltinDefinitions();
    expect(definitions.map((item) => item.name)).toEqual(SUBAGENT_PRESETS.map((preset) => preset.id));
    for (const definition of definitions) {
      expect(definition.source).toBe("builtin");
      expect(definition.prompt.trim().length).toBeGreaterThan(0);
      expect(definition.tools.length).toBeGreaterThan(0);
      // A preset never exposes a turn cap (ADR 0253).
      expect("maxTurns" in definition).toBe(false);
    }
  });
});