#!/usr/bin/env node
/**
 * Release preflight: every version surface and release document must describe
 * the same app version before a stable tag is cut.
 *
 * Usage:
 *   node scripts/check-release-docs.mjs             # check against package.json
 *   node scripts/check-release-docs.mjs <version>   # check against an explicit version
 *
 * Checks (D260, docs/spec/06-delivery/06-release-runbook.md section 4.1):
 *   1. Version surfaces agree: package.json, APP_VERSION in
 *      src/shared/protocol.ts, and — in the sibling `dcore` checkout, which
 *      owns every Rust surface — [workspace.package] in Cargo.toml plus the
 *      host-core Cargo.lock entry. An absent sibling is a failure: packaging
 *      already requires it, so an unverifiable surface must not pass.
 *   2. resources/models.dev/api.json parses as a provider catalog.
 *   3. src/shared/changelog.ts has an entry for the version under
 *      every shipped locale, newest-first, with matching highlight counts.
 *   4. tests/shared/changelog.test.ts pins the version as newest.
 *   5. README.md and README.zh-CN.md declare the current release line
 *      (`<major>.<minor>.x`) in their status section. No README ships in this
 *      checkout, so the check applies when a file is present and is reported
 *      as unverified when it is not.
 * For a prerelease preview, pass the stable version being previewed so the
 * changelog/README checks run against that catalog rather than x.y.z-beta.*.
 */
import {
  existsSync,
  readFileSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (relPath) => readFileSync(path.join(root, relPath), "utf8");
const failures = [];
const fail = (relPath, message) => failures.push(`${relPath}: ${message}`);

const notes = [];

/**
 * Resolve a path inside the sibling `dcore` checkout, which owns every Rust
 * version surface: this checkout has no Cargo workspace of its own, and
 * `package.json`'s `extraResources` already packages
 * `../dcore/target/release`. The candidate order matches
 * `tests/helpers/sibling-repos.mjs`, so a `../dcode-worktrees/<task>` checkout
 * resolves the same sibling. Returns null when the checkout is absent.
 */
function resolveDcore(relPath) {
  for (const candidate of [
    path.join(root, "..", "dcore"),
    path.join(root, "..", "..", "dcore"),
  ]) {
    const file = path.join(candidate, relPath);
    if (existsSync(file)) return file;
  }
  return null;
}

const requested = process.argv[2];
if (requested && !/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(requested)) {
  console.error("Usage: node scripts/check-release-docs.mjs [version]   e.g. 0.11.0");
  process.exit(1);
}

const version = requested ?? JSON.parse(read("package.json")).version;
const releaseLine = `${version.split(".").slice(0, 2).join(".")}.x`;

// 1. Version surfaces.
const packageFiles = ["package.json"];
for (const relPath of packageFiles) {
  const found = JSON.parse(read(relPath)).version;
  if (found !== version) fail(relPath, `version is ${found}, expected ${version}`);
}

for (const [relPath, pattern, label] of [
  ["Cargo.toml", /\[workspace\.package\][\s\S]*?\bversion = "([^"]+)"/, "[workspace.package] version"],
  // `\r?\n`: the sibling checkout keeps Cargo.lock at CRLF, and the
  // workspace version surfaces must be read the same way on any platform.
  ["Cargo.lock", /name = "host-core"\r?\nversion = "([^"]+)"/, "host-core version"],
]) {
  const display = `../dcore/${relPath}`;
  const file = resolveDcore(relPath);
  if (file === null) {
    fail(display, `${label} is unverifiable: no dcore checkout beside dcode`);
    continue;
  }
  const found = readFileSync(file, "utf8").match(pattern)?.[1];
  if (found !== version) fail(display, `${label} is ${found ?? "missing"}, expected ${version}`);
}

const appVersionPath = "src/shared/protocol.ts";
const appVersion = read(appVersionPath).match(/export const APP_VERSION = "([^"]+)"/)?.[1];
if (appVersion !== version) {
  fail(appVersionPath, `APP_VERSION is ${appVersion ?? "missing"}, expected ${version}`);
}

// 2. Bundled models.dev snapshot.
const modelsDevCatalogPath = "resources/models.dev/api.json";
try {
  const catalog = JSON.parse(read(modelsDevCatalogPath));
  if (
    !catalog ||
    Array.isArray(catalog) ||
    typeof catalog !== "object" ||
    !Object.values(catalog).some(
      (provider) => provider && typeof provider === "object" && provider.models,
    )
  ) {
    fail(modelsDevCatalogPath, "contains no provider model records");
  }
} catch (error) {
  fail(modelsDevCatalogPath, `could not parse bundled catalog: ${error.message}`);
}

// 3. Shipped-locale in-app changelog. Compile the source catalog in a temporary
// directory so this preflight does not depend on a prior workspace build or on
// Node's experimental TypeScript module resolution.
async function loadChangelogCatalog() {
  const require = createRequire(path.join(root, "package.json"));
  const typescript = require("typescript");
  const tempDir = mkdtempSync(path.join(root, ".release-changelog-"));
  writeFileSync(path.join(tempDir, "package.json"), '{"type":"module"}\n', "utf8");
  const sources = [
    "src/shared/changelog.ts",
  ];
  try {
    for (const relPath of sources) {
      const output = typescript.transpileModule(read(relPath), {
        compilerOptions: {
          module: typescript.ModuleKind.ESNext,
          target: typescript.ScriptTarget.ES2022,
        },
        fileName: relPath,
      }).outputText;
      writeFileSync(
        path.join(tempDir, path.basename(relPath, ".ts") + ".js"),
        output,
        "utf8",
      );
    }
    return await import(pathToFileURL(path.join(tempDir, "changelog.js")).href);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

let catalogs = null;
try {
  ({ CHANGELOG: catalogs } = await loadChangelogCatalog());
} catch (error) {
  fail("src/shared/changelog.ts", `could not be imported: ${error.message}`);
}

if (catalogs) {
  const enEntries = catalogs.en;
  const expectedVersions = enEntries?.map((entry) => entry.version) ?? [];
  const requiredLocales = ["en", "zh-CN"];
  for (const locale of requiredLocales) {
    if (!catalogs[locale]) {
      fail("src/shared/changelog.ts", `missing shipped locale catalog: ${locale}`);
    }
  }
  for (const [locale, entries] of Object.entries(catalogs)) {
    if (!entries?.length) {
      fail("src/shared/changelog.ts", `the ${locale} catalog is empty`);
      continue;
    }
    if (!entries.some((entry) => entry.version === version)) {
      fail("src/shared/changelog.ts", `${locale} has no entry for ${version}`);
      continue;
    }
    if (entries[0].version !== version) {
      fail(
        "src/shared/changelog.ts",
        `${locale} lists ${entries[0].version} first; ${version} must be newest-first`,
      );
    }
    if (entries.map((entry) => entry.version).join("\u0000") !== expectedVersions.join("\u0000")) {
      fail(
        "src/shared/changelog.ts",
        `${locale} does not match the English release version set`,
      );
    }
    if (enEntries) {
      for (let index = 0; index < enEntries.length; index += 1) {
        if (entries[index]?.highlights.length !== enEntries[index]?.highlights.length) {
          fail(
            "src/shared/changelog.ts",
            `${locale} highlight count differs from English at ${entries[index]?.version ?? "unknown"}`,
          );
          break;
        }
      }
    }
  }
}

// 4. Catalog test pins the newest version.
if (!read("tests/shared/changelog.test.ts").includes(`"${version}"`)) {
  fail("tests/shared/changelog.test.ts", `expected version list does not contain ${version}`);
}

// 5. READMEs declare the current release line. No README ships here, so a
// present file is checked and an absent one is reported as unverified.
for (const relPath of ["README.md", "README.zh-CN.md"]) {
  if (!existsSync(path.join(root, relPath))) {
    notes.push(`${relPath}: not in this checkout; ${releaseLine} release line unverified`);
    continue;
  }
  if (!read(relPath).includes(releaseLine)) {
    fail(relPath, `status section does not mention the ${releaseLine} release line`);
  }
}

for (const note of notes) console.warn(`Note: ${note}`);

if (failures.length > 0) {
  console.error(`Release documentation is not aligned with ${version}:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error("\nSee docs/spec/06-delivery/06-release-runbook.md section 4.1.");
  process.exit(1);
}
console.log(`Release documentation is aligned with ${version} (${releaseLine} line).`);
