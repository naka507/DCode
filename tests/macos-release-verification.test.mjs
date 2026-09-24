import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { bashPath, bashSkipReason, normalizeShellPath } from "./helpers/posix-shell.mjs";

/**
 * The release scripts are POSIX shell, so this contract needs a `bash`. On
 * Linux and macOS it is always present; on Windows it ships with Git for
 * Windows, which `posix-shell.mjs` locates. A machine with no shell skips
 * rather than failing, because the script's behaviour is then unobservable.
 *
 * Paths are passed in the host's own spelling and the log is compared in the
 * same spelling. Git Bash performs its own POSIX<->Windows argument
 * conversion, so pre-converting the paths here would be converted back and
 * only obscure the comparison; what matters to the assertion is *which*
 * files were signed and stapled, not the dialect they are spelled in.
 */
const skip = bashSkipReason();

const verifyScript = fileURLToPath(
  new URL("../scripts/verify-macos-release.sh", import.meta.url),
);
const stapleScript = fileURLToPath(
  new URL("../scripts/staple-macos-release-dmg.sh", import.meta.url),
);

/** PATH for the shell: the stub directory first, then the inherited entries. */
const shellPath = (bin) => [bin, process.env.PATH].filter(Boolean).join(";");

test("macOS release finalization staples the generated DMG", { skip }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "dcode-macos-staple-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const release = join(root, "release");
  const bin = join(root, "bin");
  const log = join(root, "xcrun.log");
  const dmg = join(release, "dcode-0.14.2-arm64.dmg");
  await mkdir(release, { recursive: true });
  await mkdir(bin, { recursive: true });
  await writeFile(dmg, "fixture");
  await writeFile(
    join(bin, "xcrun"),
    "#!/usr/bin/env bash\nprintf '%s\\n' \"$*\" >> \"$STAPLE_LOG\"\n[[ \"$1 $2\" == 'stapler staple' ]]\n",
  );
  await chmod(join(bin, "xcrun"), 0o755);

  const result = spawnSync(bashPath(), [stapleScript, release], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: shellPath(bin),
      STAPLE_LOG: log,
    },
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(
    normalizeShellPath(await readFile(log, "utf8")),
    normalizeShellPath(`stapler staple ${dmg}\n`),
  );
});

test("macOS release verification requires a notarized Developer ID app and DMG", { skip }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "dcode-macos-release-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const release = join(root, "release");
  const app = join(release, "mac-arm64", "DCode.app");
  const bin = join(root, "bin");
  const staplerLog = join(root, "stapler.log");
  const dmg = join(release, "dcode-0.14.2-arm64.dmg");
  await mkdir(app, { recursive: true });
  await mkdir(bin, { recursive: true });
  await writeFile(dmg, "fixture");
  await writeFile(
    join(bin, "codesign"),
    "#!/usr/bin/env bash\nif [[ \"$*\" == *\"-dv\"* ]]; then echo 'Authority=Developer ID Application: dcode (TEAM123)' >&2; fi\nexit 0\n",
  );
  await writeFile(
    join(bin, "spctl"),
    "#!/usr/bin/env bash\necho 'source=Notarized Developer ID' >&2\n",
  );
  await writeFile(
    join(bin, "xcrun"),
    "#!/usr/bin/env bash\nprintf '%s\\n' \"$*\" >> \"$STAPLER_LOG\"\n[[ \"$1 $2\" == 'stapler validate' ]]\n",
  );
  await Promise.all(
    ["codesign", "spctl", "xcrun"].map((name) => chmod(join(bin, name), 0o755)),
  );

  const result = spawnSync(bashPath(), [verifyScript, release], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: shellPath(bin),
      STAPLER_LOG: staplerLog,
    },
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Notarized Developer ID/);
  assert.equal(
    normalizeShellPath(await readFile(staplerLog, "utf8")),
    normalizeShellPath(`stapler validate ${app}\nstapler validate ${dmg}\n`),
  );
});

test("macOS release verification rejects a Developer ID app without notarization", { skip }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "dcode-macos-unnotarized-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const release = join(root, "release");
  const app = join(release, "mac-arm64", "DCode.app");
  const bin = join(root, "bin");
  await mkdir(app, { recursive: true });
  await mkdir(bin, { recursive: true });
  await writeFile(join(release, "dcode-0.14.2-arm64.dmg"), "fixture");
  await writeFile(
    join(bin, "codesign"),
    "#!/usr/bin/env bash\nif [[ \"$*\" == *\"-dv\"* ]]; then echo 'Authority=Developer ID Application: dcode (TEAM123)' >&2; fi\n",
  );
  await writeFile(
    join(bin, "spctl"),
    "#!/usr/bin/env bash\necho 'source=Developer ID' >&2\n",
  );
  await writeFile(join(bin, "xcrun"), "#!/usr/bin/env bash\nexit 0\n");
  await Promise.all(
    ["codesign", "spctl", "xcrun"].map((name) => chmod(join(bin, name), 0o755)),
  );

  const result = spawnSync(bashPath(), [verifyScript, release], {
    encoding: "utf8",
    env: { ...process.env, PATH: shellPath(bin) },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /did not recognize .* as notarized/);
});
