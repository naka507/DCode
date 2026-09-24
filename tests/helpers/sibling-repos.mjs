/**
 * Locate the sibling repository that holds the assets `dcode`'s tests
 * cross-check against.
 *
 * Some tests are deliberately cross-language contracts: the host-core Rust
 * sources live in the sibling `dcore` checkout (dcode's own electron-builder
 * config already packages `../dcore/target/release`). Those assertions are
 * about *the ecosystem*, so repointing them at the real sibling is the
 * faithful fix — copying the files into dcode would let the two drift apart,
 * which is exactly what the tests exist to prevent.
 *
 * The resolver returns `null` when the sibling checkout is absent, so the
 * suite stays runnable on a machine that only has dcode. A test that gets
 * `null` should skip rather than fail.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const helpersDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(helpersDir, "..", "..");

/** Candidate roots, nearest first, for each sibling checkout. */
const SIBLINGS = {
  /** host-core: the Rust host the desktop app spawns. */
  dcore: [join(repoRoot, "..", "dcore"), join(repoRoot, "..", "..", "dcore")],
};

function firstExisting(paths) {
  for (const candidate of paths) {
    if (existsSync(candidate)) return resolve(candidate);
  }
  return null;
}

/**
 * Absolute path to `relativePath` inside the dcore checkout, or `null` when the
 * checkout is not present next to dcode.
 */
export function dcorePath(relativePath) {
  const root = firstExisting(SIBLINGS.dcore);
  return root === null ? null : join(root, relativePath);
}

/** Absolute path to `relativePath` inside the dcode repo itself. */
export function repoPath(relativePath) {
  return join(repoRoot, relativePath);
}
