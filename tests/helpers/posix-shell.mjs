/**
 * Locate a POSIX shell for the tests that drive real `.sh` release scripts.
 *
 * A handful of contracts execute the repository's shell scripts directly
 * (`scripts/staple-macos-release-dmg.sh`, `scripts/verify-macos-release.sh`,
 * and the `bash -c` write step in the agent-runtime bundle script). Those
 * scripts are POSIX, so the contract can only be exercised where a `bash`
 * exists — on Linux and macOS it always does, and on Windows it ships with
 * Git for Windows rather than being on `PATH` by default.
 *
 * `bashPath()` returns the first usable shell, or `null` when the machine has
 * none, so a test can skip instead of failing on a platform that cannot run
 * the script at all. Skipping is the honest outcome: the assertion is about
 * the script's behaviour, which an absent interpreter makes unobservable.
 */
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

/** Well-known install locations, checked when `bash` is not on `PATH`. */
const FALLBACKS = [
  "C:\\Program Files\\Git\\bin\\bash.exe",
  "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
  "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
  "/bin/bash",
  "/usr/bin/bash",
  "/usr/local/bin/bash",
  "/opt/homebrew/bin/bash",
];

let cached;

/** Absolute path to a usable `bash`, or `null` when this machine has none. */
export function bashPath() {
  if (cached !== undefined) return cached;

  const pathEntries = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const names = process.platform === "win32" ? ["bash.exe", "bash"] : ["bash"];

  for (const entry of pathEntries) {
    for (const name of names) {
      const candidate = join(entry, name);
      if (existsSync(candidate)) return (cached = candidate);
    }
  }
  for (const candidate of FALLBACKS) {
    if (existsSync(candidate)) return (cached = candidate);
  }
  return (cached = null);
}

/** `{ skip }` reason for `node:test` when no POSIX shell is available. */
export function bashSkipReason() {
  return bashPath() === null
    ? "needs a POSIX shell (bash); the release scripts under test are shell scripts"
    : false;
}

/**
 * Compare shell-emitted paths without asserting the host's separator dialect.
 *
 * Git Bash rewrites the arguments it receives, so a fixture that passes
 * `C:\tmp\x` sees the script echo back `C:\tmp\x/file`. The separators are a
 * property of the host, not of the behaviour under test, so the comparison
 * normalises them and keeps every other character exact. On Linux and macOS
 * this is a no-op, so the original strictness is fully preserved there.
 */
export function normalizeShellPath(value) {
  return value.replace(/\\/g, "/");
}
