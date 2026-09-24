/**
 * The `pi-host` bootstrap script: quoting, syntax, install, and output parsing.
 *
 * The sandbox cases were made hermetic and portable:
 *
 * - The shell comes from this tree's `helpers/posix-shell.mjs` instead of being
 *   assumed to be `sh` on `PATH`.
 * - Faking `curl` and `sha256sum` on `PATH` does not work under Git Bash, which
 *   force-prepends `/usr/bin` and `/mingw64/bin`, so the fakes are silently
 *   shadowed by the real tools — the suite then *downloads the published
 *   release asset over the network* and compares it against the local tarball's
 *   digest. The sandbox therefore uses the real `curl`, `sha256sum` and `tar`
 *   against a `file://` URL for the tarball it prepared, which is both hermetic
 *   and a stronger assertion: the script's actual download/verify/unpack path
 *   runs unmodified.
 * - Only `node` is faked (it plays the host's ready/pairing output). The
 *   capability probe verifies the fake actually wins over any real `node`.
 *
 * Where the host cannot supply a POSIX shell, `tar`, `curl`, `sha256sum` and a
 * `file://`-capable `curl`, the assertion is unobservable and the case skips
 * with that reason — the same honest-skip contract the macOS and
 * symlink-privilege contracts use.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { bashPath } from "./helpers/posix-shell.mjs";

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));

const { buildBootstrapScript, parseBootstrapOutput, shellQuote } = await import(
  "../src/main/remote/pi-host-bootstrap-script.ts"
);

const VERSION = "0.15.1-beta.5";
const BUNDLE_DIR = `pi-host-${VERSION}-linux-x64`;
const ARTIFACT_NAME = `${BUNDLE_DIR}.tar.gz`;
const ARTIFACT_URL = `https://github.com/example/dcode/releases/download/v${VERSION}/${ARTIFACT_NAME}`;
const DIGEST = "0123456789abcdef".repeat(4);
/** The sandbox the script's `HOME`/`PATH` point at, outside the real user's. */
const WORK_SUBDIR = ".dcode/pi-host/.bootstrap";
const IS_WINDOWS = process.platform === "win32";

/** The POSIX shell the sandbox runs the generated script with. */
const SHELL = bashPath();
const SHELL_SKIP =
  SHELL === null ? "needs a POSIX shell (bash) to execute the generated bootstrap script" : false;

/**
 * The form a POSIX shell on this host needs for an absolute path. Git Bash
 * resolves `C:\x` too, but only through its MSYS mount table; converting
 * explicitly keeps the sandbox independent of that table and, more
 * importantly, keeps the path free of backslashes — GNU `sha256sum` escapes
 * them and prefixes the digest with `\`, which the script's `cut` keeps.
 */
function shellPath(absolutePath) {
  const slashed = absolutePath.replace(/\\/g, "/");
  return IS_WINDOWS && /^[A-Za-z]:/.test(slashed)
    ? `/${slashed[0].toLowerCase()}${slashed.slice(2)}`
    : slashed;
}

/** A `file://` URL for an absolute local path, in the shape `curl` accepts. */
function fileUrl(absolutePath) {
  const slashed = absolutePath.replace(/\\/g, "/");
  return IS_WINDOWS ? `file:///${slashed}` : `file://${slashed}`;
}

/** The sandbox environment: the fake `node` first on `PATH`, `HOME` in POSIX form. */
function sandboxEnv(bin, home) {
  return {
    ...process.env,
    HOME: shellPath(home),
    PATH: [bin, process.env.PATH ?? ""].filter(Boolean).join(delimiter),
  };
}

/** Inputs every scenario starts from; callers override the digest or version. */
function scriptInput(overrides = {}) {
  return {
    version: VERSION,
    artifactUrl: ARTIFACT_URL,
    artifactName: ARTIFACT_NAME,
    bundleDir: BUNDLE_DIR,
    expectedSha256: DIGEST,
    port: 0,
    pairingLifetimeMs: 600_000,
    readyTimeoutSec: 30,
    ...overrides,
  };
}

async function tempDir(prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/**
 * Whether this host can actually run the generated script: a POSIX shell that
 * executes a `.sh` fixture, the real `curl`/`sha256sum`/`tar` the script needs,
 * a `curl` that accepts a `file://` URL, and a fake `node` that wins on `PATH`.
 *
 * Probed by doing each thing, not by reading `process.platform` — a Windows box
 * with Git for Windows runs these cases fine, and a stripped container without
 * `tar` does not, on any platform.
 */
async function sandboxSkipReason() {
  if (SHELL === null) return SHELL_SKIP;

  const { dir, cleanup } = await tempDir("pi-host-probe-");
  try {
    const bin = join(dir, "bin");
    await mkdir(bin, { recursive: true });
    await writeFile(join(bin, "node"), "#!/bin/sh\nprintf 'sandbox-node\\n'\n", { mode: 0o755 });

    const payload = join(dir, "payload.txt");
    await writeFile(payload, "probe\n");

    const probe = join(dir, "probe.sh");
    await writeFile(
      probe,
      [
        "#!/bin/sh",
        'for tool in curl sha256sum tar; do',
        '  command -v "$tool" >/dev/null 2>&1 || { printf \'missing-%s\\n\' "$tool"; exit 0; }',
        "done",
        '[ "$(node -p x 2>/dev/null)" = "sandbox-node" ] || { printf \'fake-node-shadowed\\n\'; exit 0; }',
        `curl -fsSL --max-time 30 -o "${shellPath(join(dir, "copy.txt"))}" "${fileUrl(payload)}" >/dev/null 2>&1 || { printf 'no-file-url\\n'; exit 0; }`,
        "printf 'ok\\n'",
        "",
      ].join("\n"),
    );

    const stdout = execFileSync(SHELL, [probe], {
      encoding: "utf8",
      env: sandboxEnv(bin, dir),
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();

    return stdout === "ok" ? false : `the bootstrap sandbox cannot run on this host: ${stdout}`;
  } catch (error) {
    return `the bootstrap sandbox cannot run on this host: ${String(error.message).split("\n")[0]}`;
  } finally {
    await cleanup();
  }
}

const SANDBOX_SKIP = await sandboxSkipReason();

/**
 * Everything the generated script touches, with only the host process faked: a
 * real `tar.gz` on disk, served to the script's real `curl` through a `file://`
 * URL, hashed by the real `sha256sum`, unpacked by the real `tar`, and a `node`
 * on `PATH` that plays the host's ready/pairing output.
 *
 * Returns the env for the run, the tarball's real digest (what `expectedSha256`
 * has to be for a run that is meant to succeed), and the URL to hand the script
 * in place of the published release asset.
 */
async function prepareSandbox(root, { readyVersion = VERSION } = {}) {
  const stage = join(root, "stage");
  const bin = join(root, "bin");
  const home = join(root, "home");
  await mkdir(join(stage, BUNDLE_DIR), { recursive: true });
  await mkdir(bin, { recursive: true });
  await mkdir(home, { recursive: true });
  await writeFile(join(stage, BUNDLE_DIR, "install.sh"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });

  // A real archive: the script unpacks and installs it with the host's `tar`.
  const tarball = join(root, ARTIFACT_NAME);
  execFileSync("tar", ["-czf", tarball, "-C", stage, BUNDLE_DIR]);
  const digest = createHash("sha256").update(await readFile(tarball)).digest("hex");

  const readyLine = `PI_HOST_READY ${JSON.stringify({
    hostId: "host_x",
    host: "127.0.0.1",
    port: 41234,
    version: readyVersion,
  })}`;
  const pairingLine = `PI_HOST_PAIRING_TOKEN ${JSON.stringify({
    token: "ppt1.stub",
    expiresAt: 1_893_456_000_000,
  })}`;
  await writeFile(
    join(bin, "node"),
    [
      "#!/bin/sh",
      "# `node -p` is the script's version probe; answer with a modern major.",
      'case " $* " in',
      '  *" -p "*) printf \'99\\n\'; exit 0 ;;',
      "esac",
      `printf '%s\\n' '${readyLine}'`,
      `printf '%s\\n' '${pairingLine}'`,
      "# The script polls `kill -0` on this pid, so the fake host outlives the wait.",
      "sleep 5",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );

  return { digest, home, tarball, url: fileUrl(tarball), env: sandboxEnv(bin, home) };
}

function runScript(scriptPath, env) {
  return execFileSync(SHELL, [scriptPath], {
    encoding: "utf8",
    timeout: 120_000,
    stdio: ["ignore", "pipe", "pipe"],
    env,
  });
}

test("shellQuote produces a single-quoted literal that cannot escape", () => {
  assert.equal(shellQuote("plain"), "'plain'");
  // The one character a single-quoted string cannot contain ends the literal,
  // emits an escaped quote, and reopens it — the POSIX `'\''` dance.
  assert.equal(shellQuote("it's"), "'it'\\''s'");
  // Command substitution and variable expansion are inert inside quotes; a
  // caller-supplied URL must never execute.
  assert.equal(shellQuote("$(touch /tmp/pwned)"), "'$(touch /tmp/pwned)'");
});

test("buildBootstrapScript interpolates every input as a quoted literal", () => {
  const script = buildBootstrapScript(scriptInput());
  assert.ok(script.startsWith("#!/bin/sh\n"), "the script is uploaded and run by `sh`");
  assert.ok(script.includes(`VERSION='${VERSION}'`));
  assert.ok(script.includes(`ARTIFACT_URL='${ARTIFACT_URL}'`));
  assert.ok(script.includes(`ARTIFACT_NAME='${ARTIFACT_NAME}'`));
  assert.ok(script.includes(`BUNDLE_DIR='${BUNDLE_DIR}'`));
  assert.ok(script.includes(`EXPECTED_SHA256='${DIGEST}'`));
  assert.ok(script.includes("PORT='0'"));
  assert.ok(script.includes("PAIRING_LIFETIME_MS='600000'"));
  assert.ok(script.includes("READY_TIMEOUT_SEC='30'"));
  // The Node floor is injected from the module, not left as an empty shell var.
  assert.match(script, /^MIN_NODE_MAJOR='\d+'$/m);
  assert.ok(script.includes("$MIN_NODE_MAJOR"));

  // Every `${…}` that reaches the shell must be deliberate. `${HOME:-}` is a
  // shell expansion; anything else would be a JS placeholder that never
  // interpolated and would run as garbage on the remote machine.
  const interpolations = [...script.matchAll(/\$\{([^}]*)\}/g)].map((match) => match[1]);
  assert.deepEqual(interpolations, ["HOME:-"]);
});

test("the generated script is valid POSIX shell, even with hostile inputs", { skip: SHELL_SKIP }, async () => {
  const { dir, cleanup } = await tempDir("pi-host-script-syntax-");
  try {
    const plain = join(dir, "plain.sh");
    await writeFile(plain, buildBootstrapScript(scriptInput()));
    execFileSync(SHELL, ["-n", plain]);

    // Quoting is the only thing standing between a caller-supplied host or
    // label and the remote shell, so the syntax check runs on those too.
    const hostile = join(dir, "hostile.sh");
    await writeFile(
      hostile,
      buildBootstrapScript(
        scriptInput({
          version: "1.0.0'; touch \"$HOME/pwned\"; echo '",
          artifactUrl: "https://example.invalid/a'b",
          artifactName: "a b'c.tar.gz",
          bundleDir: "d'est",
        }),
      ),
    );
    execFileSync(SHELL, ["-n", hostile]);
  } finally {
    await cleanup();
  }
});

test(
  "a hostile version stays one literal value when the assignments run",
  { skip: SHELL_SKIP },
  async () => {
    const { dir, cleanup } = await tempDir("pi-host-script-quote-");
    try {
      const hostileVersion = "1.0.0'; touch \"$HOME/pwned\"; echo '";
      const script = buildBootstrapScript(scriptInput({ version: hostileVersion }));
      const assignments = script.split("\n").filter((line) => /^[A-Z_]+='/.test(line));
      assert.ok(
        assignments.some((line) => line.startsWith("VERSION=")),
        "the assignment block must be visible to this test",
      );

      const echoed = execFileSync(SHELL, ["-c", `${assignments.join("\n")}\nprintf '%s' "$VERSION"`], {
        encoding: "utf8",
        env: { ...process.env, HOME: shellPath(dir) },
      });
      assert.equal(echoed, hostileVersion);
      assert.equal(existsSync(join(dir, "pwned")), false, "the injected command must not have run");
    } finally {
      await cleanup();
    }
  },
);

test(
  "the generated script installs, starts, and prints the ready/pairing lines",
  { skip: SANDBOX_SKIP },
  async () => {
    const { dir, cleanup } = await tempDir("pi-host-script-run-");
    try {
      const sandbox = await prepareSandbox(dir);
      const scriptPath = join(dir, "bootstrap.sh");
      await writeFile(
        scriptPath,
        buildBootstrapScript(scriptInput({ artifactUrl: sandbox.url, expectedSha256: sandbox.digest })),
      );

      const stdout = runScript(scriptPath, sandbox.env);
      const parsed = parseBootstrapOutput(stdout);
      assert.equal(parsed.failure, null);
      assert.deepEqual(parsed.ready, {
        hostId: "host_x",
        host: "127.0.0.1",
        port: 41234,
        version: VERSION,
      });
      assert.deepEqual(parsed.pairing, { token: "ppt1.stub", expiresAt: 1_893_456_000_000 });
      assert.deepEqual(parsed.steps, ["download", "verify", "install", "start", "await-ready", "ok"]);

      // The host was started under the sandbox HOME and left running there.
      const pid = (await readFile(join(sandbox.home, WORK_SUBDIR, "pi-host.pid"), "utf8")).trim();
      assert.match(pid, /^\d+$/);
    } finally {
      await cleanup();
    }
  },
);

test(
  "a checksum mismatch fails the script before anything is installed",
  { skip: SANDBOX_SKIP },
  async () => {
    const { dir, cleanup } = await tempDir("pi-host-script-digest-");
    try {
      const sandbox = await prepareSandbox(dir);
      const scriptPath = join(dir, "bootstrap.sh");
      // A tampered download is the case the trust anchor exists for: the digest
      // travels over the same SSH channel as the script that checks it.
      await writeFile(
        scriptPath,
        buildBootstrapScript(
          scriptInput({ artifactUrl: sandbox.url, expectedSha256: "0".repeat(64) }),
        ),
      );

      let failure;
      try {
        runScript(scriptPath, sandbox.env);
      } catch (error) {
        failure = error;
      }
      assert.ok(failure, "the script must exit non-zero");
      assert.notEqual(failure.status, 0);
      assert.match(String(failure.stderr), /PI_HOST_BOOTSTRAP_FAILED checksum-mismatch/);
      // The typed line is on stdout too, which is how the desktop reports the step.
      assert.match(String(failure.stdout), /PI_HOST_FAILED \{.*"step":"checksum-mismatch"/);
      assert.ok(!String(failure.stdout).includes("PI_HOST_READY"), "the host must not have been started");
    } finally {
      await cleanup();
    }
  },
);

test("parseBootstrapOutput reads the ready and pairing lines", () => {
  const output = parseBootstrapOutput(
    [
      "PI_HOST_BOOTSTRAP download",
      'PI_HOST_READY {"hostId":"host_x","host":"127.0.0.1","port":41234,"version":"0.15.1-beta.5"}',
      'PI_HOST_PAIRING_TOKEN {"token":"ppt1.abc","expiresAt":123}',
      "PI_HOST_BOOTSTRAP ok",
    ].join("\n"),
  );
  assert.deepEqual(output.ready, {
    hostId: "host_x",
    host: "127.0.0.1",
    port: 41234,
    version: "0.15.1-beta.5",
  });
  assert.deepEqual(output.pairing, { token: "ppt1.abc", expiresAt: 123 });
  assert.deepEqual(output.steps, ["download", "ok"]);
  assert.equal(output.failure, null);
});

test("parseBootstrapOutput collects step lines and ignores interleaved noise", () => {
  const output = parseBootstrapOutput(
    [
      "Warning: Permanently added 'host' (ED25519) to the list of known hosts.",
      "PI_HOST_BOOTSTRAP download",
      "",
      "PI_HOST_BOOTSTRAP   verify  ",
      "some other chatter",
      "PI_HOST_BOOTSTRAP install",
    ].join("\n"),
  );
  assert.deepEqual(output.steps, ["download", "verify", "install"]);
  assert.equal(output.ready, null);
  assert.equal(output.pairing, null);
});

test("parseBootstrapOutput reports the failing step and ignores unrelated failures", () => {
  const timedOut = parseBootstrapOutput(
    ['PI_HOST_BOOTSTRAP await-ready', 'PI_HOST_FAILED {"code":"HOST_BOOTSTRAP_FAILED","step":"ready-timeout"}'].join(
      "\n",
    ),
  );
  assert.equal(timedOut.failure, "ready-timeout");

  // The script also writes its own bare failed-line; the first one wins.
  const mismatch = parseBootstrapOutput(
    ["PI_HOST_BOOTSTRAP_FAILED checksum-mismatch", "PI_HOST_BOOTSTRAP_FAILED download-failed"].join("\n"),
  );
  assert.equal(mismatch.failure, "checksum-mismatch");

  // A failure line for a different code, or malformed JSON, must not be read as
  // a bootstrap failure for this host.
  assert.equal(parseBootstrapOutput('PI_HOST_FAILED {"code":"OTHER","step":"x"}').failure, null);
  assert.equal(parseBootstrapOutput("PI_HOST_FAILED {not json").failure, null);
});

test("parseBootstrapOutput refuses a ready line with an unusable port", () => {
  const ready = (payload) => parseBootstrapOutput(`PI_HOST_READY ${JSON.stringify(payload)}`);
  const valid = { hostId: "host_x", host: "127.0.0.1", port: 41234, version: "0.15.1" };
  assert.equal(ready({ ...valid, port: 0 }).ready, null, "port 0 means the host never bound");
  assert.equal(ready({ ...valid, port: 41234.5 }).ready, null, "a fractional port is not a port");
  assert.equal(ready({ ...valid, port: "41234" }).ready, null, "a string port is not a port");
  assert.equal(ready({ ...valid, hostId: "" }).ready, null);
  assert.equal(parseBootstrapOutput("PI_HOST_READY {not json").ready, null);

  // The pairing line tolerates a missing expiry rather than dropping the token.
  const pairing = parseBootstrapOutput('PI_HOST_PAIRING_TOKEN {"token":"ppt1.abc"}');
  assert.deepEqual(pairing.pairing, { token: "ppt1.abc", expiresAt: 0 });
  assert.equal(parseBootstrapOutput('PI_HOST_PAIRING_TOKEN {"expiresAt":1}').pairing, null);
});
