import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { register } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * The release origin derived from `package.json`.
 *
 * dcode ships no hardcoded cloud endpoint: the update checker and the SSH
 * remote-host artifact download both need a release origin, and it comes from
 * whatever the build configured. These cases pin the two halves of that
 * contract — which `repository` spellings are understood, and what every
 * consumer must do when there is no configured origin at all (`null`, never a
 * guessed vendor URL).
 */

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));

const {
  parseReleaseOrigin,
  releaseAssetBase,
  releasesPageUrl,
  repositoryUrlFromPackage,
  resolveReleaseOriginFrom,
} = await import("../src/main/repository-url.ts");

test("repositoryUrlFromPackage accepts the string and object forms npm allows", () => {
  assert.equal(
    repositoryUrlFromPackage({ repository: "https://gitee.com/naka507/dcode.git" }),
    "https://gitee.com/naka507/dcode.git",
  );
  assert.equal(
    repositoryUrlFromPackage({
      repository: { type: "git", url: "https://github.com/owner/repo.git" },
    }),
    "https://github.com/owner/repo.git",
  );
  // `directory` is deliberately ignored: release artifacts belong to the
  // repository, not to one workspace folder inside it.
  assert.equal(
    repositoryUrlFromPackage({
      repository: { type: "git", url: "https://github.com/o/r.git", directory: "packages/app" },
    }),
    "https://github.com/o/r.git",
  );
});

test("repositoryUrlFromPackage reports no URL rather than a guess", () => {
  assert.equal(repositoryUrlFromPackage({}), null);
  assert.equal(repositoryUrlFromPackage({ repository: "" }), null);
  assert.equal(repositoryUrlFromPackage({ repository: "   " }), null);
  assert.equal(repositoryUrlFromPackage({ repository: { type: "git" } }), null);
  assert.equal(repositoryUrlFromPackage({ repository: { url: 7 } }), null);
  assert.equal(repositoryUrlFromPackage({ repository: null }), null);
  assert.equal(repositoryUrlFromPackage(null), null);
  assert.equal(repositoryUrlFromPackage("https://github.com/o/r"), null);
});

test("parseReleaseOrigin normalizes every spelling a repository field holds", () => {
  const expected = {
    host: "github.com",
    path: "owner/repo",
    htmlUrl: "https://github.com/owner/repo",
  };
  assert.deepEqual(parseReleaseOrigin("https://github.com/owner/repo.git"), expected);
  assert.deepEqual(parseReleaseOrigin("git+https://github.com/owner/repo.git"), expected);
  // scp-like, the form `git remote` prints for an SSH checkout.
  assert.deepEqual(parseReleaseOrigin("git@github.com:owner/repo.git"), expected);
  // A trailing slash and a missing `.git` are both noise — and they combine:
  // `repo.git/` must lose the slash *before* the `.git` strip, or the suffix
  // survives into every derived release URL.
  assert.deepEqual(parseReleaseOrigin("https://github.com/owner/repo/"), expected);
  assert.deepEqual(parseReleaseOrigin("https://github.com/owner/repo.git/"), expected);
  assert.deepEqual(parseReleaseOrigin("git@github.com:owner/repo.git/"), expected);
  // The host is case-insensitive.
  assert.equal(parseReleaseOrigin("https://GitHub.com/owner/repo")?.host, "github.com");
});

test("parseReleaseOrigin refuses anything a release URL cannot be built from", () => {
  assert.equal(parseReleaseOrigin(null), null);
  assert.equal(parseReleaseOrigin(undefined), null);
  assert.equal(parseReleaseOrigin(""), null);
  assert.equal(parseReleaseOrigin("   "), null);
  // A bare `owner/repo` has no host to point at.
  assert.equal(parseReleaseOrigin("owner/repo"), null);
  // A single path segment is not a repository.
  assert.equal(parseReleaseOrigin("https://github.com/owner"), null);
  // A bare host is not a repository either.
  assert.equal(parseReleaseOrigin("https://github.com"), null);
  // Non-web transports cannot serve release downloads.
  assert.equal(parseReleaseOrigin("file:///tmp/checkout"), null);
  assert.equal(parseReleaseOrigin("ssh://git@github.com/owner/repo.git"), null);
});

test("releasesPageUrl picks the page the forge actually serves", () => {
  const at = (host) => ({ host, path: "owner/repo", htmlUrl: `https://${host}/owner/repo` });
  assert.equal(releasesPageUrl(at("github.com")), "https://github.com/owner/repo/releases/latest");
  assert.equal(releasesPageUrl(at("gitee.com")), "https://gitee.com/owner/repo/releases/latest");
  // GitLab and Codeberg have no `/releases/latest` route.
  assert.equal(releasesPageUrl(at("gitlab.com")), "https://gitlab.com/owner/repo/releases");
  assert.equal(releasesPageUrl(at("codeberg.org")), "https://codeberg.org/owner/repo/releases");
  assert.equal(releasesPageUrl(null), null);
});

test("releaseAssetBase builds the tag layout GitHub, Gitee and Gitea share", () => {
  const origin = { host: "gitee.com", path: "naka507/dcode", htmlUrl: "https://gitee.com/naka507/dcode" };
  assert.equal(
    releaseAssetBase(origin, "1.0.0"),
    "https://gitee.com/naka507/dcode/releases/download/v1.0.0",
  );
  // A caller that already carries the tag prefix must not double it.
  assert.equal(
    releaseAssetBase(origin, "v1.0.0"),
    "https://gitee.com/naka507/dcode/releases/download/v1.0.0",
  );
  assert.equal(releaseAssetBase(origin, "  "), null);
  assert.equal(releaseAssetBase(null, "1.0.0"), null);
});

test("resolveReleaseOriginFrom reads the root package.json and degrades to null", (t) => {
  const root = mkdtempSync(join(tmpdir(), "dcode-release-origin-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "dcode", version: "1.0.0", repository: { type: "git", url: "git+https://gitee.com/naka507/dcode.git" } }),
  );
  assert.deepEqual(resolveReleaseOriginFrom(root), {
    host: "gitee.com",
    path: "naka507/dcode",
    htmlUrl: "https://gitee.com/naka507/dcode",
  });

  // No `repository` field: the update checker and the SSH artifact path must
  // both report "not configured" rather than fall back to a vendor.
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "dcode", version: "1.0.0" }));
  assert.equal(resolveReleaseOriginFrom(root), null);

  // A malformed or absent manifest is the same answer, not a crash.
  writeFileSync(join(root, "package.json"), "{ not json");
  assert.equal(resolveReleaseOriginFrom(root), null);
  assert.equal(resolveReleaseOriginFrom(join(root, "does-not-exist")), null);
});

test("parseReleaseOrigin refuses a path that could escape the repository", () => {
  // The scp branch never passes through `new URL`, so it gets no path
  // normalization: without an explicit guard `git@github.com:../evil` would
  // build `https://github.com/../evil`, which a browser resolves to a
  // different repository on the same host.
  assert.equal(parseReleaseOrigin("git@github.com:../evil"), null);
  assert.equal(parseReleaseOrigin("git@github.com:owner/../evil"), null);
  assert.equal(parseReleaseOrigin("https://github.com/owner/../../evil"), null);
});

test("parseReleaseOrigin refuses spellings it cannot build a release URL from", () => {
  // A dotless scp-shaped prefix is a scheme, not a host: `myhost:owner/repo`
  // reaches the URL branch and is rejected on protocol.
  assert.equal(parseReleaseOrigin("myhost:owner/repo"), null);
  // `git+ssh://` is a legitimate npm `repository` spelling but cannot serve
  // release downloads over https, so it is refused rather than guessed at.
  assert.equal(parseReleaseOrigin("git+ssh://git@github.com/owner/repo.git"), null);
  assert.deepEqual(parseReleaseOrigin("git@github.com:owner/repo"), {
    host: "github.com",
    path: "owner/repo",
    htmlUrl: "https://github.com/owner/repo",
  });
  // A nested forge path (GitLab subgroup) is more than the two segments every
  // derived release URL is built from, so it is not a usable origin.
  assert.equal(parseReleaseOrigin("https://gitlab.com/group/sub/repo"), null);
});

test("releasesPageUrl matches the listing hosts on a label boundary", () => {
  const at = (host) => ({ host, path: "owner/repo", htmlUrl: `https://${host}/owner/repo` });
  // A host that merely *ends with* the label is a different host.
  assert.equal(releasesPageUrl(at("notgitlab.com")), "https://notgitlab.com/owner/repo/releases/latest");
  assert.equal(
    releasesPageUrl(at("gitlab.com.evil.com")),
    "https://gitlab.com.evil.com/owner/repo/releases/latest",
  );
  // A genuine subdomain of the listing host still gets the listing page.
  assert.equal(releasesPageUrl(at("sub.gitlab.com")), "https://sub.gitlab.com/owner/repo/releases");
  assert.equal(releasesPageUrl(at("sub.codeberg.org")), "https://sub.codeberg.org/owner/repo/releases");
});

test("releaseAssetBase refuses a version that is only the tag prefix", () => {
  const origin = { host: "gitee.com", path: "naka507/dcode", htmlUrl: "https://gitee.com/naka507/dcode" };
  // `"v"` strips to the empty tag; the guard has to run after the strip or the
  // base ends at `/releases/download/v`.
  assert.equal(releaseAssetBase(origin, "v"), null);
  assert.equal(releaseAssetBase(origin, "  v  "), null);
});

test("repositoryUrlFromPackage rejects a whitespace-only object url", () => {
  // The string form is covered above; the object form has to trim too.
  assert.equal(repositoryUrlFromPackage({ repository: { url: "   " } }), null);
  assert.equal(repositoryUrlFromPackage({ repository: { url: "  https://github.com/o/r.git  " } }), "https://github.com/o/r.git");
});
