import { describe, expect, it } from "vitest";
import {
  CHANGELOG,
  formatChangelogNotes,
  getChangelogEntry,
  normalizeChangelogVersion,
  resolveChangelogLocale,
} from "../../src/shared/changelog.js";

// dcode starts its own history at 1.0.0. The catalog is the app's own release
// record, so the oldest entry and the newest one are the same entry today.
const OLDEST = "1.0.0";

describe("changelog catalog", () => {
  it("keeps shipped locale version sets and highlight counts aligned", () => {
    const en = CHANGELOG.en;
    const zh = CHANGELOG["zh-CN"];
    for (const catalog of [zh]) {
      expect(catalog.map((e) => e.version)).toEqual(en.map((e) => e.version));
      for (let i = 0; i < en.length; i += 1) {
        expect(catalog[i]?.highlights.length).toBe(en[i]?.highlights.length);
        expect(en[i]?.highlights.length).toBeGreaterThan(0);
      }
    }
  });

  it("lists only shipped stable releases, newest-first, without pre-releases", () => {
    const versions = CHANGELOG.en.map((e) => e.version);
    expect(versions[0]).toBe("1.0.2");
    expect(versions.at(-1)).toBe(OLDEST);
    expect(versions).toEqual(["1.0.2", "1.0.1", "1.0.0"]);
    for (const version of versions) {
      expect(version).not.toMatch(/-/);
    }
  });

  it("describes the product without naming an origin", () => {
    // The catalog is user-facing and must read as a standalone product: no
    // "renamed from", no parent project, no migration framing.
    const notes = CHANGELOG.en
      .flatMap((entry) => entry.highlights)
      .join("\n")
      .toLowerCase();
    for (const forbidden of ["rename", "renamed", "upstream", "fork", "migrat"]) {
      expect(notes).not.toContain(forbidden);
    }
    expect(CHANGELOG["zh-CN"].flatMap((entry) => entry.highlights).join("\n"))
      .not.toContain("更名");
  });

  it("normalizes versions and resolves locales", () => {
    expect(normalizeChangelogVersion(" v1.0.0 ")).toBe("1.0.0");
    expect(resolveChangelogLocale("zh-CN")).toBe("zh-CN");
    expect(resolveChangelogLocale("zh-TW")).toBe("zh-CN");
    expect(resolveChangelogLocale("zh-Hant")).toBe("zh-CN");
    expect(resolveChangelogLocale("zh_HK")).toBe("zh-CN");
    expect(resolveChangelogLocale("en-US")).toBe("en");
    expect(resolveChangelogLocale()).toBe("en");
  });

  it("looks up and formats notes with English fallback", () => {
    const entry = getChangelogEntry("v1.0.0", "en");
    expect(entry?.version).toBe("1.0.0");
    const notes = formatChangelogNotes("1.0.0", "en");
    expect(notes).toMatch(/^• /);
    expect(notes?.split("\n").length).toBe(
      getChangelogEntry("1.0.0", "en")?.highlights.length,
    );
    expect(formatChangelogNotes("9.9.9", "en")).toBeUndefined();
    expect(formatChangelogNotes("1.1.0-rc.6", "en")).toBeUndefined();
  });
});
