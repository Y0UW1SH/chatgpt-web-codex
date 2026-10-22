const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { createServer } = require("node:http");
const { BrowserControlServer } = require("../electron/control-server.cjs");

const installer = path.resolve(__dirname, "../../scripts/install-launcher.sh");

// ctypes uses the system GLib library directly; python-gi and a display server
// are not needed to parse and launch a desktop entry.
const launchDesktop = String.raw`
import ctypes, json, pathlib, sys, time

gio = ctypes.CDLL("libgio-2.0.so.0")
gio.g_desktop_app_info_new_from_filename.argtypes = [ctypes.c_char_p]
gio.g_desktop_app_info_new_from_filename.restype = ctypes.c_void_p
gio.g_app_info_launch.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p)]
gio.g_app_info_launch.restype = ctypes.c_int

class Error(ctypes.Structure):
    _fields_ = [("domain", ctypes.c_uint), ("code", ctypes.c_int), ("message", ctypes.c_char_p)]

app = gio.g_desktop_app_info_new_from_filename(sys.argv[1].encode())
error = ctypes.c_void_p()
launched = bool(app and gio.g_app_info_launch(app, None, None, ctypes.byref(error)))
marker = pathlib.Path(sys.argv[2])
if launched:
    for _ in range(200):
        if marker.exists():
            break
        time.sleep(0.01)
print(json.dumps({
    "launched": launched,
    "marker": marker.exists(),
    "error": ctypes.cast(error, ctypes.POINTER(Error)).contents.message.decode() if error.value else None,
}))
`;

function installerFixture(directory = "normal") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-linux-installer-path-"));
  const bin = path.join(root, "tools");
  fs.mkdirSync(bin);
  const script = (name, body) => fs.writeFileSync(path.join(bin, name), `#!/bin/sh\nset -eu\n${body}\n`, { mode: 0o755 });
  script("uname", 'case "$1" in -s) echo Linux ;; -m) echo x86_64 ;; esac');
  script("pgrep", "exit 1");
  // Only a later desktop-entry launch may run the installed wrapper.
  script("nohup", "exit 0");
  script("update-desktop-database", "exit 0");
  script("curl", `
case "$*" in
  *http://127.0.0.1:*)
    printf '%s\\n' "$@" > "$TEST_ROOT/probe-args"
    exec "$REAL_CURL" "$@"
    ;;
esac
while [ "$#" -gt 0 ]; do
  case "$1" in https:*) url="$1" ;; -o) shift; output="$1" ;; esac
  shift
done
case "$url" in
  */checksums.txt) cp "$TEST_ROOT/checksums.txt" "$output" ;;
  *) cp "$TEST_ROOT/fixture.AppImage" "$output" ;;
esac`);
  const appImage = Buffer.from(`#!/bin/sh
set -eu
test "$1" = --appimage-extract
mkdir -p squashfs-root/icons/512x512/apps squashfs-root/resources/app.asar.unpacked/assets
printf icon > squashfs-root/icons/512x512/apps/icon.png
cp "$TEST_ROOT/runner" squashfs-root/resources/app.asar.unpacked/assets/linux-appimage-runner.sh
`);
  fs.writeFileSync(path.join(root, "fixture.AppImage"), appImage);
  fs.writeFileSync(path.join(root, "checksums.txt"), `${createHash("sha256").update(appImage).digest("hex")}  codex-web-gpt-1.2.3-linux-x64.AppImage\n`);
  fs.writeFileSync(path.join(root, "runner"), `#!/bin/sh
set -eu
printf '%s\\n' "$CODEX_WEB_GPT_LAUNCHER_EXECUTABLE" "$CODEX_WEB_GPT_APPIMAGE" "$1" > "$TEST_ROOT/launched.next"
mv "$TEST_ROOT/launched.next" "$TEST_ROOT/launched"
`);
  const installRoot = path.join(root, directory);
  const binDir = path.join(installRoot, "bin");
  const libDir = path.join(installRoot, "lib");
  const dataDir = path.join(root, "data");
  const marker = path.join(root, "launched");
  const core = path.join(root, "core");
  const realCurl = spawnSync("/bin/sh", ["-c", "command -v curl"], { encoding: "utf8" });
  assert.equal(realCurl.status, 0, realCurl.stderr);
  const env = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    REAL_CURL: realCurl.stdout.trim(),
    TEST_ROOT: root,
    CODEX_WEB_GPT_VERSION: "1.2.3",
    CODEX_WEB_GPT_REPOSITORY: "test/repo",
    CODEX_WEB_GPT_BIN_DIR: binDir,
    CODEX_WEB_GPT_LIB_DIR: libDir,
    CODEX_CHATGPT_WEB_HOME: core,
    XDG_DATA_HOME: dataDir,
  };
  return {
    root, binDir, libDir, dataDir, marker, env,
    descriptor(value) {
      fs.mkdirSync(path.join(core, "runtime"), { recursive: true });
      fs.writeFileSync(path.join(core, "runtime", "launcher-browser.json"), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    },
    cleanup() { fs.rmSync(root, { recursive: true, force: true }); },
  };
}

function runInstaller(env) {
  return new Promise((resolve, reject) => {
    const child = spawn("/bin/sh", [installer], { env, timeout: 10_000 });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", data => { stdout += data; });
    child.stderr.setEncoding("utf8").on("data", data => { stderr += data; });
    child.on("error", reject);
    child.on("close", status => resolve({ status, stdout, stderr }));
  });
}

async function httpFixture(handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return {
    endpoint: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

function descriptor(control, pid = process.pid) {
  return { version: 3, kind: "codex-web-gpt-launcher", pid, control, createdAt: "2026-01-01T00:00:00Z" };
}

for (const [label, directory] of [
  ["normal", "normal"],
  ["spaces", "space dir"],
  ["a dollar sign", "dollar$dir"],
  ["a double quote", 'quote"dir'],
  ["a single quote", "single'quote"],
  ["a backtick", "tick`dir"],
  ["a literal backslash", "back\\slash"],
  ["a percent sign", "percent%dir"],
  ["combined special characters", "space $\"'`\\% dir"],
]) {
  test(`Linux installer desktop entry launches from a path containing ${label}`, {
    skip: process.platform !== "linux" ? "Linux desktop entries" : false,
  }, () => {
    if (process.platform !== "linux") return;
    const fixture = installerFixture(directory);
    const { root, binDir, libDir, dataDir, marker, env } = fixture;
    try {
      const installed = spawnSync("/bin/sh", [installer], { env, encoding: "utf8", timeout: 10_000 });
      assert.equal(installed.status, 0, installed.stderr || installed.error?.message);
      assert.equal(fs.existsSync(marker), false, "installer auto-launch must be isolated from the desktop entry check");
      const desktopFile = path.join(dataDir, "applications", "codex-web-gpt.desktop");
      const result = spawnSync("python3", ["-c", launchDesktop, desktopFile, marker], { env, encoding: "utf8", timeout: 5_000 });
      assert.equal(result.status, 0, result.stderr || result.error?.message);
      const launched = JSON.parse(result.stdout);
      assert.equal(launched.launched, true, launched.error || "GLib did not launch the desktop entry");
      assert.equal(launched.marker, true, "the desktop entry did not run the installed wrapper");
      const target = path.join(libDir, "1.2.3", "Codex Web GPT.AppImage");
      assert.equal(fs.readFileSync(marker, "utf8"), `${path.join(binDir, "codex-web-gpt")}\n${target}\n${target}\n`);
    } finally {
      fixture.cleanup();
    }
  });
}

test("Linux installer permits a stale authenticated descriptor whose PID belongs to an unrelated process", {
  skip: process.platform !== "linux" ? "Linux installer" : false,
}, async () => {
  if (process.platform !== "linux") return;
  const fixture = installerFixture();
  const closed = await httpFixture((_request, response) => response.end());
  await closed.close();
  fixture.descriptor(descriptor({ endpoint: closed.endpoint, token: "a".repeat(43), identityPath: "/v1/identity" }));
  try {
    const result = await runInstaller(fixture.env);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(fs.existsSync(path.join(fixture.libDir, "1.2.3", "Codex Web GPT.AppImage")));
  } finally { fixture.cleanup(); }
});

test("Linux installer verifies an active authenticated launcher without inspecting its browser", {
  skip: process.platform !== "linux" ? "Linux installer" : false,
}, async () => {
  if (process.platform !== "linux") return;
  const fixture = installerFixture();
  const server = await new BrowserControlServer({
    logger: { info() {}, warn() {}, error() {} },
    getBrowserHost: () => { throw new Error("installer must not inspect a browser"); },
    getPreferences: () => { throw new Error("installer must work in manual mode"); },
  }).start();
  let probes = 0;
  server.server.on("request", request => { if (request.url === "/v1/identity") probes++; });
  fixture.descriptor(descriptor({ ...server.descriptor(), identityPath: "/v1/identity" }));
  Object.assign(fixture.env, {
    http_proxy: "http://127.0.0.1:1", HTTP_PROXY: "http://127.0.0.1:1",
    ALL_PROXY: "http://127.0.0.1:1", NO_PROXY: "", no_proxy: "",
  });
  try {
    const result = await runInstaller(fixture.env);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Quit Codex Web GPT/);
    assert.equal(probes, 1);
    assert.equal(fs.existsSync(fixture.libDir), false);
    assert.equal(fs.readFileSync(path.join(fixture.root, "probe-args"), "utf8").includes(server.token), false, "bearer tokens must not appear in process arguments");
  } finally { await server.close(); fixture.cleanup(); }
});

for (const [label, status, body] of [
  ["an authentication rejection", 401, { error: "unauthorized" }],
  ["a different service", 200, { kind: "unrelated-service", pid: process.pid }],
  ["a different PID", 200, { kind: "codex-web-gpt-launcher", pid: process.pid + 1 }],
  ["a malformed identity", 200, "not JSON"],
  ["an HTTP redirect", 302, {}],
]) {
  test(`Linux installer refuses an ambiguous reachable identity endpoint returning ${label}`, {
    skip: process.platform !== "linux" ? "Linux installer" : false,
  }, async () => {
    if (process.platform !== "linux") return;
    const fixture = installerFixture();
    const requests = [];
    const server = await httpFixture((request, response) => {
      requests.push(request.url);
      response.writeHead(status, { location: "/must-not-follow" });
      response.end(JSON.stringify(body));
    });
    fixture.descriptor(descriptor({ endpoint: server.endpoint, token: "a".repeat(43), identityPath: "/v1/identity" }));
    try {
      const result = await runInstaller(fixture.env);
      assert.notEqual(result.status, 0);
      assert.equal(fs.existsSync(fixture.libDir), false);
      assert.deepEqual(requests, ["/v1/identity"]);
    } finally { await server.close(); fixture.cleanup(); }
  });
}

test("Linux installer refuses a reachable identity endpoint that stops responding", {
  skip: process.platform !== "linux" ? "Linux installer" : false,
}, async () => {
  if (process.platform !== "linux") return;
  const fixture = installerFixture();
  let probes = 0;
  const server = await httpFixture((_request, response) => {
    probes++;
    response.writeHead(200, { "content-type": "application/json" });
    response.flushHeaders();
  });
  fixture.descriptor(descriptor({ endpoint: server.endpoint, token: "a".repeat(43), identityPath: "/v1/identity" }));
  try {
    const result = await runInstaller(fixture.env);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Cannot verify launcher identity/);
    assert.equal(probes, 1);
    assert.equal(fs.existsSync(fixture.libDir), false);
  } finally { await server.close(); fixture.cleanup(); }
});

for (const endpoint of [
  "http://localhost:1234", "https://127.0.0.1:1234", "http://127.0.0.1:1234/extra",
  "http://127.0.0.1:1234?query", "http://127.0.0.1:1234@other.example", "http://127.0.0.1:65536",
]) {
  test(`Linux installer refuses an unsafe identity endpoint ${endpoint}`, {
    skip: process.platform !== "linux" ? "Linux installer" : false,
  }, async () => {
    if (process.platform !== "linux") return;
    const fixture = installerFixture();
    fixture.descriptor(descriptor({ endpoint, token: "a".repeat(43), identityPath: "/v1/identity" }));
    try {
      const result = await runInstaller(fixture.env);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Cannot verify launcher identity/);
      assert.equal(fs.existsSync(path.join(fixture.root, "probe-args")), false);
      assert.equal(fs.existsSync(fixture.libDir), false);
    } finally { fixture.cleanup(); }
  });
}

test("Linux installer permits a dead PID in an identity-capable descriptor without probing it", {
  skip: process.platform !== "linux" ? "Linux installer" : false,
}, async () => {
  if (process.platform !== "linux") return;
  const fixture = installerFixture();
  fixture.descriptor(descriptor({ endpoint: "http://127.0.0.1:1", token: "a".repeat(43), identityPath: "/v1/identity" }, 2147483647));
  try {
    const result = await runInstaller(fixture.env);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(path.join(fixture.root, "probe-args")), false);
    assert.ok(fs.existsSync(path.join(fixture.libDir, "1.2.3", "Codex Web GPT.AppImage")));
  } finally { fixture.cleanup(); }
});

for (const [label, pid, allowed] of [["a live", process.pid, false], ["a dead", 2147483647, true]]) {
  test(`Linux installer preserves legacy descriptor compatibility for ${label} PID`, {
    skip: process.platform !== "linux" ? "Linux installer" : false,
  }, async () => {
    if (process.platform !== "linux") return;
    const fixture = installerFixture();
    fixture.descriptor(descriptor({ endpoint: "http://127.0.0.1:1", token: "a".repeat(43) }, pid));
    try {
      const result = await runInstaller(fixture.env);
      assert.equal(result.status === 0, allowed, result.stderr);
      assert.equal(fs.existsSync(path.join(fixture.root, "probe-args")), false);
    } finally { fixture.cleanup(); }
  });
}
