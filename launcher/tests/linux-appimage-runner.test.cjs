const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const runner = path.resolve(__dirname, "..", "assets", "linux-appimage-runner.sh");

function executable(file, source) {
  fs.writeFileSync(file, `#!/bin/sh\nset -eu\n${source}\n`, { mode: 0o755 });
}

function procIdentityFixture(fixtures) {
  // Some containers expose /proc from a different PID namespace. Only there,
  // supply start-time reads; cleanup, process liveness and all files stay real.
  let matchingPidNamespace = false;
  try {
    matchingPidNamespace = Number(fs.readFileSync("/proc/self/stat", "utf8").split(" ")[0]) === process.pid;
  } catch {}
  if (!matchingPidNamespace) {
    executable(path.join(fixtures, "sed"), [
      'case "$*" in',
      "  */proc/*/stat*) printf '1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 42\\n' ;;",
      '  *) exec "$REAL_SED" "$@" ;;',
      "esac",
    ].join("\n"));
  }
}

async function waitForFile(file, child) {
  const deadline = Date.now() + 5_000;
  while (!fs.existsSync(file)) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error("First runner exited before the initialization barrier");
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${file}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

test("concurrent Linux AppImage launches preserve an initializing runner", {
  skip: process.platform !== "linux" ? "The fallback runner is Linux-specific" : false,
  timeout: 15_000,
}, async () => {
  // Reverting atomic owner publication makes the second real runner delete the
  // first one's directory, failing its owner.pid write after the barrier opens.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-appimage-concurrent-"));
  const fixtures = path.join(root, "bin");
  const runtime = path.join(root, "runtime");
  const created = path.join(root, "created");
  const release = path.join(root, "release");
  const launched = path.join(root, "launched");
  fs.mkdirSync(fixtures);
  fs.mkdirSync(runtime);
  const realMktemp = spawnSync("sh", ["-c", "command -v mktemp"], { encoding: "utf8" }).stdout.trim();
  const realSed = spawnSync("sh", ["-c", "command -v sed"], { encoding: "utf8" }).stdout.trim();
  assert.ok(path.isAbsolute(realMktemp));
  assert.ok(path.isAbsolute(realSed));
  executable(path.join(fixtures, "mktemp"), [
    'result="$("$REAL_MKTEMP" "$@")"',
    'if [ "${PAUSE_INITIALIZATION:-0}" = 1 ]; then',
    '  printf "%s" "$result" > "$CREATED_FILE"',
    '  while [ ! -f "$RELEASE_FILE" ]; do sleep 0.01; done',
    "fi",
    'printf "%s\\n" "$result"',
  ].join("\n"));
  procIdentityFixture(fixtures);
  const appRun = path.join(root, "AppRun");
  executable(appRun, 'printf "launched\\n" >> "$LAUNCHED_FILE"');
  const image = path.join(root, "fixture.AppImage");
  executable(image, [
    '[ "$1" = --appimage-extract ]',
    "mkdir squashfs-root",
    'cp "$APPRUN_SOURCE" squashfs-root/AppRun',
    "chmod 0755 squashfs-root/AppRun",
  ].join("\n"));
  const env = {
    ...process.env, PATH: `${fixtures}${path.delimiter}${process.env.PATH}`,
    REAL_MKTEMP: realMktemp, REAL_SED: realSed,
    XDG_RUNTIME_DIR: runtime, APPIMAGE_EXTRACT_AND_RUN: "1",
    CREATED_FILE: created, RELEASE_FILE: release, LAUNCHED_FILE: launched, APPRUN_SOURCE: appRun,
  };
  const first = spawn(runner, [image], { env: { ...env, PAUSE_INITIALIZATION: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  first.stderr.on("data", chunk => { stderr += chunk; });
  const completion = new Promise((resolve, reject) => {
    first.once("error", reject);
    first.once("close", status => resolve(status));
  });
  try {
    await waitForFile(created, first);
    const initializing = fs.readFileSync(created, "utf8");
    assert.equal(fs.existsSync(initializing), true);
    const second = spawnSync(runner, [image], { env, encoding: "utf8", timeout: 5_000 });
    assert.equal(second.status, 0, second.stderr);
    assert.equal(fs.existsSync(initializing), true, "a concurrent launch must preserve the initializing directory");
    fs.writeFileSync(release, "");
    assert.equal(await completion, 0, stderr);
    assert.equal(fs.readFileSync(launched, "utf8").trim().split("\n").length, 2);
    const fallback = path.join(runtime, `codex-web-gpt-appimage-${process.getuid()}`);
    assert.deepEqual(fs.readdirSync(fallback), [], "both launches must remove their own directories");
  } finally {
    fs.writeFileSync(release, "");
    if (first.exitCode === null && first.signalCode === null) first.kill("SIGKILL");
    await completion;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("failed AppImage owner publication preserves an existing run directory", {
  skip: process.platform !== "linux" ? "The fallback runner is Linux-specific" : false,
}, () => {
  // A failed rename must never authorize cleanup of another runner's destination.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-appimage-publish-"));
  const fixtures = path.join(root, "bin");
  const runtime = path.join(root, "runtime");
  const conflict = path.join(root, "conflict");
  fs.mkdirSync(fixtures);
  fs.mkdirSync(runtime);
  const realMv = spawnSync("sh", ["-c", "command -v mv"], { encoding: "utf8" }).stdout.trim();
  const realSed = spawnSync("sh", ["-c", "command -v sed"], { encoding: "utf8" }).stdout.trim();
  executable(path.join(fixtures, "mv"), [
    'target="$3"',
    'mkdir "$target"',
    'printf other-owner > "$target/preserve"',
    'printf "%s" "$target" > "$CONFLICT_FILE"',
    'exec "$REAL_MV" "$@"',
  ].join("\n"));
  procIdentityFixture(fixtures);
  const image = path.join(root, "fixture.AppImage");
  executable(image, "exit 99");
  try {
    const result = spawnSync(runner, [image], {
      encoding: "utf8", timeout: 5_000,
      env: {
        ...process.env, PATH: `${fixtures}${path.delimiter}${process.env.PATH}`,
        REAL_MV: realMv, REAL_SED: realSed, CONFLICT_FILE: conflict,
        XDG_RUNTIME_DIR: runtime, APPIMAGE_EXTRACT_AND_RUN: "1",
      },
    });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(result.status, 1, "the actual rename must fail on the nonempty destination");
    const destination = fs.readFileSync(conflict, "utf8");
    assert.equal(fs.existsSync(path.join(destination, "preserve")), true, "failed publication must preserve the other owner");
    assert.equal(fs.readFileSync(path.join(destination, "preserve"), "utf8"), "other-owner");
    assert.deepEqual(fs.readdirSync(path.dirname(destination)), [path.basename(destination)], "failed initialization must clean only its own staging directory");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
