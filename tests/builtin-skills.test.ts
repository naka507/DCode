import { describe, expect, it } from "vitest";
import {
  builtinSkills,
  loadBuiltinSkillBody,
  listAllBuiltinSkills,
  BUILTIN_SKILLS_MANIFEST,
} from "../src/main/builtin-skills.js";

describe("builtinSkills", () => {
  it("manifest includes expected core engineering skills", () => {
    const ids = BUILTIN_SKILLS_MANIFEST.map((s) => s.id);
    expect(ids).toContain("dcode/plugin-development");
    expect(ids).toContain("dcode/react-best-practices");
    expect(ids).toContain("dcode/agent-browser");
    expect(ids).toContain("dcode/dogfood");
    expect(ids).toContain("dcode/electron");
  });

  it("listAllBuiltinSkills returns all shipped skills with body and metadata", () => {
    const all = listAllBuiltinSkills();
    expect(all.length).toBe(5);
    const ids = all.map((s) => s.id);
    expect(ids).toContain("dcode/react-best-practices");
    expect(ids).toContain("dcode/agent-browser");
    expect(ids).toContain("dcode/dogfood");
    expect(ids).toContain("dcode/electron");
    expect(ids).toContain("dcode/plugin-development");
    for (const item of all) {
      expect(item.name).toBeTruthy();
      expect(item.description).toBeTruthy();
      expect(item.body.length).toBeGreaterThan(100);
    }
  });

  it("returns core skills in non-plugin workspaces", () => {
    const skills = builtinSkills({ workspacePath: null });
    const ids = skills.map((s) => s.id);
    expect(ids).toContain("dcode/react-best-practices");
    expect(ids).toContain("dcode/agent-browser");
    expect(ids).toContain("dcode/dogfood");
    expect(ids).toContain("dcode/electron");
    // plugin-development should only be present in plugin workspaces
    expect(ids).not.toContain("dcode/plugin-development");
  });

  it("loads skill body by id and aliases without prefix", () => {
    const reactFull = loadBuiltinSkillBody("dcode/react-best-practices");
    expect(reactFull).not.toBeNull();
    expect(reactFull?.name).toBe("React Best Practices");
    expect(reactFull?.body).toContain("Eliminating Waterfalls");

    const reactShort = loadBuiltinSkillBody("react-best-practices");
    expect(reactShort).not.toBeNull();
    expect(reactShort?.body).toBe(reactFull?.body);

    const browser = loadBuiltinSkillBody("dcode/agent-browser");
    expect(browser).not.toBeNull();
    expect(browser?.body).toContain("agent-browser snapshot -i");

    const dogfood = loadBuiltinSkillBody("dcode/dogfood");
    expect(dogfood).not.toBeNull();
    expect(dogfood?.body).toContain("Exploratory Testing");

    const electron = loadBuiltinSkillBody("dcode/electron");
    expect(electron).not.toBeNull();
    expect(electron?.body).toContain("--remote-debugging-port");
  });

  it("returns null for unknown skill id", () => {
    expect(loadBuiltinSkillBody("unknown-skill")).toBeNull();
  });
});
