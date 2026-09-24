import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Release coordinates derived from `package.json`'s `repository` field.
 *
 * dcode ships no hardcoded cloud endpoint: update checks and remote-host
 * artifact downloads both need a release origin, and that origin is whatever
 * the build configured. A checkout with no `repository` field has no origin,
 * and every consumer must degrade explicitly instead of guessing a vendor.
 *
 * The URL rules are pure values, so they stay testable without a network or an
 * Electron app; only `resolveReleaseOriginFrom` touches the filesystem, and it
 * takes the root as a parameter.
 */

export type ReleaseOrigin = {
  /** Repository host, e.g. `gitee.com`. */
  host: string;
  /** `owner/name` path, without a leading slash or a trailing `.git`. */
  path: string;
  /** `https://<host>/<path>` — the browsable repository root. */
  htmlUrl: string;
};

/**
 * Read the repository URL out of a parsed `package.json`.
 *
 * `repository` is either a string or npm's `{ type, url }` object; both forms
 * appear in the wild and both are accepted. `directory` is ignored on purpose:
 * release artifacts belong to the repository, not to a workspace folder.
 */
export function repositoryUrlFromPackage(
  packageJson: unknown,
): string | null {
  if (!packageJson || typeof packageJson !== "object") return null;
  const value = (packageJson as { repository?: unknown }).repository;
  if (typeof value === "string") return value.trim() || null;
  if (value && typeof value === "object") {
    const url = (value as { url?: unknown }).url;
    if (typeof url === "string") return url.trim() || null;
  }
  return null;
}

/**
 * Normalize a repository URL into a host plus `owner/name`.
 *
 * Accepts the three forms a `repository` field realistically holds:
 *   - `https://gitee.com/naka507/dcode.git`
 *   - `git+https://github.com/owner/repo.git`
 *   - `git@github.com:owner/repo.git`
 *
 * Returns `null` for anything else (a bare `owner/repo`, a `file:` path, a
 * local directory) so callers can disable the dependent surface instead of
 * building a URL that cannot resolve.
 */
export function parseReleaseOrigin(url: string | null | undefined): ReleaseOrigin | null {
  const raw = url?.trim();
  if (!raw) return null;

  let host: string;
  let path: string;
  // `git@host:owner/repo.git` — scp-like, no scheme. A one-slash URL scheme
  // (`file:/tmp/x`, `javascript:/a/b`) has the same shape and must not be read
  // as a host literally named `file`. A scheme never contains a dot, while an
  // scp host normally does, so the prefix before the first `:` decides: a
  // dotless scheme-shaped prefix is a scheme, and falls through to the URL
  // branch below, which rejects it on protocol.
  const scp = /^(?:[^@/]+@)?([^/:]+):(.+)$/.exec(raw);
  const prefix = raw.slice(0, raw.indexOf(":") === -1 ? 0 : raw.indexOf(":"));
  const schemeLike = /^[a-z][a-z0-9+.-]*$/i.test(prefix) && !prefix.includes(".");
  if (!raw.includes("://") && scp && !schemeLike) {
    host = scp[1] ?? "";
    path = scp[2] ?? "";
  } else {
    let parsed: URL;
    try {
      parsed = new URL(raw.startsWith("git+") ? raw.slice("git+".length) : raw);
    } catch {
      return null;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    host = parsed.host;
    path = parsed.pathname;
  }

  const normalizedHost = host.trim().toLowerCase();
  // Order matters: a trailing slash must go before the `.git` strip, or
  // `owner/repo.git/` keeps the suffix and every derived release URL 404s.
  const normalizedPath = path
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "");
  // `owner/name` is the minimum a release URL can be built from; anything
  // shorter (a bare host, a single segment) is not a repository.
  if (!normalizedHost || !normalizedPath.includes("/")) return null;
  if (!/^[\w.-]+\/[\w.-]+$/.test(normalizedPath)) return null;
  // The URL branch is protected by `new URL` normalization, but the scp branch
  // is not: `git@github.com:../evil` would otherwise build
  // `https://github.com/../evil`, which normalizes to a *different*
  // repository on the same host. The input is build-controlled, but the
  // derived URL is opened in a browser, so refuse it outright.
  if (normalizedPath.split("/").includes("..")) return null;

  return {
    host: normalizedHost,
    path: normalizedPath,
    htmlUrl: `https://${normalizedHost}/${normalizedPath}`,
  };
}

/**
 * Human-facing "latest release" page for the configured repository.
 *
 * Gitee and GitHub both serve `/releases/latest`; the other common forges
 * (GitLab, Codeberg) use `/releases` only, so they get the listing page.
 * `null` means "no configured origin" — the caller must hide the link rather
 * than point it somewhere arbitrary.
 */
export function releasesPageUrl(origin: ReleaseOrigin | null): string | null {
  if (!origin) return null;
  const suffix = isReleaseListingHost(origin.host) ? "releases" : "releases/latest";
  return `${origin.htmlUrl}/${suffix}`;
}

/**
 * True for the forges that serve a listing page but no `/releases/latest`.
 *
 * Matched on a label boundary (`gitlab.com` or `*.gitlab.com`), not a bare
 * `endsWith`, so `notgitlab.com` is not mistaken for GitLab. A self-hosted
 * instance on some other domain still gets `/releases/latest`; that is a
 * 404-to-listing fallback at worst, and guessing at every self-hosted host
 * would be worse than the listing page it already has.
 */
function isReleaseListingHost(host: string): boolean {
  return (
    host === "gitlab.com" ||
    host.endsWith(".gitlab.com") ||
    host === "codeberg.org" ||
    host.endsWith(".codeberg.org")
  );
}

/**
 * Release-asset base for a tag, e.g.
 * `https://gitee.com/naka507/dcode/releases/download/v1.0.0`.
 *
 * This is the layout GitHub, Gitee, and Gitea all serve, and it is the reason
 * the remote-host bootstrap can derive an artifact URL without an API call.
 */
export function releaseAssetBase(
  origin: ReleaseOrigin | null,
  version: string,
): string | null {
  if (!origin) return null;
  // Strip a leading `v` before the empty check: a version of exactly `"v"`
  // would otherwise survive as the malformed tag `/releases/download/v`.
  const tag = version.trim().replace(/^v/, "");
  if (!tag) return null;
  return `${origin.htmlUrl}/releases/download/v${tag}`;
}

/**
 * Read the configured release origin from a checkout/asar root's
 * `package.json`.
 *
 * Takes the root as a parameter rather than reaching for Electron, so the
 * update checker, the remote-host bootstrap, and tests all resolve the same
 * value through one pure function. `null` means "no repository configured" and
 * every caller must disable its surface instead of guessing a vendor.
 */
export function resolveReleaseOriginFrom(appPath: string): ReleaseOrigin | null {
  try {
    const pkg = JSON.parse(readFileSync(join(appPath, "package.json"), "utf8"));
    return parseReleaseOrigin(repositoryUrlFromPackage(pkg));
  } catch {
    return null;
  }
}
