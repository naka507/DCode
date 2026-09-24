/**
 * `scripts/check-release-docs.mjs` reads the Rust version surfaces from the
 * sibling `dcore` checkout: there is no Cargo workspace in this tree, so
 * `Cargo.toml` and `Cargo.lock` only exist one directory up. It also has to
 * read them the
 * way the sibling stores them — `dcore` keeps `Cargo.lock` at CRLF, so a `\n`
 * pattern silently finds nothing and the gate reports "missing" for a version
 * that is right there.
 *
 * Both failures are invisible against the real sibling when the versions
 * happen to agree, so the fixture builds a miniature pair of checkouts instead.
 * It lives under `node_modules/.cache` so the `typescript` the gate requires
 * resolves from the repository root, and so nothing it writes can reach the
 * architecture gate or `git status`.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const scriptRelativePath = join("scripts", "check-release-docs.mjs");

const APP_VERSION = "1.0.0";

/**
 * A miniature `dcode` + `dcore` pair. `dcore` files are written with the line
 * endings the real sibling uses: CRLF for `Cargo.lock`, LF for `Cargo.toml`.
 */
function writeFixture({ hostCoreVersion = APP_VERSION, withDcore = true } = {}) {
  const cacheRoot = join(repoRoot, "node_modules", ".cache");
  mkdirSync(cacheRoot, { recursive: true });
  const base = mkdtempSync(join(cacheRoot, "release-docs-fixture-"));
  const dcode = join(base, "dcode");

  mkdirSync(join(dcode, "scripts"), { recursive: true });
  mkdirSync(join(dcode, "src", "shared"), { recursive: true });
  mkdirSync(join(dcode, "resources", "models.dev"), { recursive: true });
  mkdirSync(join(dcode, "tests", "shared"), { recursive: true });

  // The script under test, not a copy of its logic.
  copyFileSync(join(repoRoot, scriptRelativePath), join(dcode, scriptRelativePath));

  writeFileSync(
    join(dcode, "package.json"),
    `${JSON.stringify({ name: "dcode", version: APP_VERSION }, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(
    join(dcode, "src", "shared", "protocol.ts"),
    `export const APP_NAME = "DCode";\nexport const APP_VERSION = "${APP_VERSION}";\n`,
    "utf8",
  );
  writeFileSync(
    join(dcode, "src", "shared", "changelog.ts"),
    [
      "export const CHANGELOG = {",
      `  en: [{ version: "${APP_VERSION}", highlights: ["one"] }],`,
      `  "zh-CN": [{ version: "${APP_VERSION}", highlights: ["one"] }],`,
      "};",
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    join(dcode, "tests", "shared", "changelog.test.ts"),
    `expect(versions[0]).toBe("${APP_VERSION}");\n`,
    "utf8",
  );
  writeFileSync(
    join(dcode, "resources", "models.dev", "api.json"),
    `${JSON.stringify({ anthropic: { models: { "claude-3": {} } } })}\n`,
    "utf8",
  );

  if (withDcore) {
    const dcore = join(base, "dcore");
    mkdirSync(dcore, { recursive: true });
    writeFileSync(
      join(dcore, "Cargo.toml"),
      [
        "[workspace]",
        "members = []",
        "",
        "[workspace.package]",
        'edition = "2021"',
        `version = "${APP_VERSION}"`,
        "",
      ].join("\n"),
      "utf8",
    );
    // CRLF, as the real sibling checkout stores it.
    writeFileSync(
      join(dcore, "Cargo.lock"),
      [
        'version = 4',
        "",
        "[[package]]",
        'name = "host-core"',
        `version = "${hostCoreVersion}"`,
        "dependencies = []",
        "",
      ].join("\r\n"),
      "utf8",
    );
  }

  return { base, dcode };
}

function runGate(dcode, args = [APP_VERSION]) {
  // spawnSync, not execFileSync: the gate reports an unverified README on
  // stderr while still exiting 0, so the success path has to capture stderr too.
  const result = spawnSync(process.execPath, [scriptRelativePath, ...args], {
    cwd: dcode,
    encoding: "utf8",
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function withFixture(options, run) {
  const fixture = writeFixture(options);
  try {
    return run(fixture);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
}

test("a CRLF Cargo.lock in the sibling checkout resolves to its real version", () => {
  withFixture({}, ({ dcode }) => {
    const result = runGate(dcode);
    assert.equal(result.status, 0, `expected the gate to pass; stderr:\n${result.stderr}`);
    assert.match(result.stdout, /aligned with 1\.0\.0 \(1\.0\.x line\)/);
  });
});

test("a sibling Cargo.lock version mismatch fails and names the sibling file", () => {
  withFixture({ hostCoreVersion: "0.9.9" }, ({ dcode }) => {
    const result = runGate(dcode);
    assert.equal(result.status, 1, "a mismatched host-core version must fail the gate");
    assert.match(result.stderr, /\.\.\/dcore\/Cargo\.lock: host-core version is 0\.9\.9/);
  });
});

test("an absent sibling checkout is a failure, not a silent pass", () => {
  withFixture({ withDcore: false }, ({ dcode }) => {
    const result = runGate(dcode);
    assert.equal(result.status, 1, "an unverifiable Rust version surface must fail");
    assert.match(result.stderr, /\.\.\/dcore\/Cargo\.toml: .* is unverifiable/);
  });
});

test("a README that is absent is reported, while one that disagrees fails", () => {
  withFixture({}, ({ dcode }) => {
    const absent = runGate(dcode);
    assert.equal(absent.status, 0);
    assert.match(absent.stderr, /README\.md: not in this checkout/);

    writeFileSync(join(dcode, "README.md"), "Status: the current 0.9.x line.\n", "utf8");
    const disagreeing = runGate(dcode);
    assert.equal(disagreeing.status, 1);
    assert.match(disagreeing.stderr, /README\.md: status section does not mention the 1\.0\.x/);
  });
});
