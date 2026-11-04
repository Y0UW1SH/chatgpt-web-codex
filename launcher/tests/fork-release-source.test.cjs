// Fork-owned guard: an upstream sync must not silently move installs and updates back to
// upstream releases, whose binaries do not contain this fork's fixes (docs/upstream-sync.md).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { validateReleaseAssetUrl } = require("../electron/update.cjs");

const FORK = "Y0UW1SH/chatgpt-web-codex";
const UPSTREAM = "miuuyy/codex-chatgpt-web";
const repositoryRoot = path.resolve(__dirname, "..", "..");
const read = relative => fs.readFileSync(path.join(repositoryRoot, relative), "utf8");

test("the launcher updater accepts only this fork's release assets", () => {
  const asset = "codex-web-gpt-9.9.9-linux-x64.AppImage";
  const fork = `https://github.com/${FORK}/releases/download/v9.9.9/${asset}`;
  assert.equal(validateReleaseAssetUrl(fork, "9.9.9", asset), fork);
  assert.throws(
    () => validateReleaseAssetUrl(`https://github.com/${UPSTREAM}/releases/download/v9.9.9/${asset}`, "9.9.9", asset),
    /unexpected release asset URL/,
  );
});

test("the update check, About link and package metadata name this fork", () => {
  assert.match(read("launcher/electron/update.cjs"), new RegExp(`^const REPOSITORY = "${FORK}";$`, "m"));
  assert.match(read("launcher/electron/main.cjs"), new RegExp(`^const GITHUB_URL = "https://github.com/${FORK}";$`, "m"));
  const manifest = JSON.parse(read("package.json"));
  assert.equal(manifest.repository.url, `git+https://github.com/${FORK}.git`);
  assert.equal(manifest.homepage, `https://github.com/${FORK}#readme`);
  assert.equal(manifest.bugs.url, `https://github.com/${FORK}/issues`);
});

test("installers default to this fork's releases", () => {
  assert.match(read("scripts/install.sh"), new RegExp(`^REPOSITORY="\\$\\{CODEX_CHATGPT_WEB_REPOSITORY:-${FORK}\\}"$`, "m"));
  assert.match(read("scripts/install-launcher.sh"), new RegExp(`^REPOSITORY="\\$\\{CODEX_WEB_GPT_REPOSITORY:-${FORK}\\}"$`, "m"));
  assert.ok(read("scripts/install-launcher.ps1").includes(`else { "${FORK}" }`));
  for (const script of ["scripts/install.sh", "scripts/install-launcher.sh", "scripts/install-launcher.ps1"]) {
    assert.ok(!read(script).includes(UPSTREAM), `${script} still references ${UPSTREAM}`);
  }
});

test("every README downloads, installs and clones from this fork", () => {
  for (const readme of ["README.md", "README.zh-CN.md", "README.ja.md", "README.ko.md"]) {
    const text = read(readme);
    assert.ok(!text.includes(`github.com/${UPSTREAM}/releases`), `${readme} links an upstream release`);
    assert.ok(!text.includes(`git clone https://github.com/${UPSTREAM}`), `${readme} clones upstream`);
    assert.ok(text.includes(`https://github.com/${FORK}/releases/latest/download/install-launcher.sh`), `${readme} lacks the fork installer`);
    assert.ok(text.includes(`https://github.com/${FORK}/releases/latest/download/install-launcher.ps1`), `${readme} lacks the fork Windows installer`);
    assert.ok(text.includes(`git clone https://github.com/${FORK}.git && \\\ncd chatgpt-web-codex && \\`), `${readme} lacks the fork clone`);
  }
});
