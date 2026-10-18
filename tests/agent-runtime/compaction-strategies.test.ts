/**
 * ADR-004 (P1-5): compaction strategies are pluggable via a registry.
 * The built-ins keep their behavior; new strategies register without
 * touching runtime.ts.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import {
  compactionStrategyNames,
  getCompactionStrategy,
  registerCompactionStrategy,
  resolveCompactionStrategyName,
  type CompactionStrategyDef,
} from "../../src/agent/runtime/compaction-strategies.js";

describe("compaction strategy registry", () => {
  it("registers the two built-in strategies", () => {
    expect(compactionStrategyNames().sort()).toEqual([
      "fresh_window",
      "summary",
    ]);
    const summary = getCompactionStrategy("summary");
    const freshWindow = getCompactionStrategy("fresh_window");
    expect(summary?.toolReply).toContain("with a summary");
    expect(freshWindow?.toolReply).toContain("without summarizing");
  });

  it("returns undefined for unknown strategies", () => {
    expect(getCompactionStrategy("nope")).toBeUndefined();
  });

  it("rejects duplicate registration", () => {
    const def: CompactionStrategyDef = {
      name: "summary",
      toolReply: "x",
      build: async () => {
        throw new Error("unreachable");
      },
    };
    expect(() => registerCompactionStrategy(def)).toThrow(
      'compaction strategy "summary" is already registered',
    );
  });

  it("accepts a new strategy without runtime.ts changes", () => {
    const build = vi.fn(async () => ({ ok: false as const, message: "custom" }));
    registerCompactionStrategy({
      name: "test-custom-strategy",
      toolReply: "Custom reply.",
      build: build as never,
    });
    expect(getCompactionStrategy("test-custom-strategy")?.toolReply).toBe(
      "Custom reply.",
    );
    expect(compactionStrategyNames()).toContain("test-custom-strategy");
  });
});

describe("resolveCompactionStrategyName", () => {
  const original = process.env.DCODE_COMPACTION_STRATEGY;
  afterEach(() => {
    if (original === undefined) delete process.env.DCODE_COMPACTION_STRATEGY;
    else process.env.DCODE_COMPACTION_STRATEGY = original;
  });

  it("prefers the explicit option", () => {
    expect(resolveCompactionStrategyName("fresh_window")).toBe("fresh_window");
    process.env.DCODE_COMPACTION_STRATEGY = "summary";
    expect(resolveCompactionStrategyName("fresh_window")).toBe("fresh_window");
  });

  it("falls back to the env var, then summary", () => {
    process.env.DCODE_COMPACTION_STRATEGY = "fresh_window";
    expect(resolveCompactionStrategyName()).toBe("fresh_window");
    delete process.env.DCODE_COMPACTION_STRATEGY;
    expect(resolveCompactionStrategyName()).toBe("summary");
  });

  it("passes unknown names through for loud failure", () => {
    expect(resolveCompactionStrategyName("custom")).toBe("custom");
  });
});
