/**
 * ADR-005: assertion evaluators are pure outcome checks.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateAssertion } from "../../src/eval/assertions.js";
import type { EvalTrajectory } from "../../src/eval/types.js";

const trajectory: EvalTrajectory = {
  turns: 3,
  toolCalls: [
    { toolName: "Read", args: {}, ok: true },
    { toolName: "Read", args: {}, ok: true },
    { toolName: "Edit", args: {}, ok: true },
  ],
};

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "eval-assert-"));
  await writeFile(join(dir, "a.txt"), "hello world\n");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("evaluateAssertion", () => {
  it("fileExists", async () => {
    expect(
      (await evaluateAssertion({ type: "fileExists", path: "a.txt" }, dir, trajectory)).passed,
    ).toBe(true);
    expect(
      (await evaluateAssertion({ type: "fileExists", path: "nope.txt" }, dir, trajectory)).passed,
    ).toBe(false);
  });

  it("fileContains / fileNotContains", async () => {
    expect(
      (await evaluateAssertion({ type: "fileContains", path: "a.txt", contains: "hello" }, dir, trajectory)).passed,
    ).toBe(true);
    expect(
      (await evaluateAssertion({ type: "fileContains", path: "a.txt", contains: "goodbye" }, dir, trajectory)).passed,
    ).toBe(false);
    expect(
      (await evaluateAssertion({ type: "fileNotContains", path: "a.txt", contains: "goodbye" }, dir, trajectory)).passed,
    ).toBe(true);
    expect(
      (await evaluateAssertion({ type: "fileNotContains", path: "a.txt", contains: "hello" }, dir, trajectory)).passed,
    ).toBe(false);
  });

  it("commandSucceeds", async () => {
    expect(
      (await evaluateAssertion({ type: "commandSucceeds", command: "true" }, dir, trajectory)).passed,
    ).toBe(true);
    expect(
      (await evaluateAssertion({ type: "commandSucceeds", command: "false" }, dir, trajectory)).passed,
    ).toBe(false);
    expect(
      (await evaluateAssertion({ type: "commandSucceeds", command: "grep -q hello a.txt" }, dir, trajectory)).passed,
    ).toBe(true);
  });

  it("maxTurns / maxToolCalls", async () => {
    expect(
      (await evaluateAssertion({ type: "maxTurns", max: 3 }, dir, trajectory)).passed,
    ).toBe(true);
    expect(
      (await evaluateAssertion({ type: "maxTurns", max: 2 }, dir, trajectory)).passed,
    ).toBe(false);
    expect(
      (await evaluateAssertion({ type: "maxToolCalls", max: 3 }, dir, trajectory)).passed,
    ).toBe(true);
    expect(
      (await evaluateAssertion({ type: "maxToolCalls", max: 2 }, dir, trajectory)).passed,
    ).toBe(false);
    expect(
      (await evaluateAssertion({ type: "maxToolCalls", max: 2, tool: "Read" }, dir, trajectory)).passed,
    ).toBe(true);
    expect(
      (await evaluateAssertion({ type: "maxToolCalls", max: 1, tool: "Read" }, dir, trajectory)).passed,
    ).toBe(false);
  });
});
