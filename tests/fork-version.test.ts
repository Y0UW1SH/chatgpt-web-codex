import { afterAll, expect, test } from "bun:test";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const repository = resolve(import.meta.dir, "..");
const files = [
  "package.json",
  "launcher/package.json",
  "src/version.ts",
  "scripts/install.sh",
  "README.md",
  "README.zh-CN.md",
  "README.ja.md",
  "README.ko.md",
];
const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function copyRepository(): string {
  const root = mkdtempSync(join(tmpdir(), "fork-version-"));
  roots.push(root);
  for (const file of files) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    cpSync(join(repository, file), join(root, file));
  }
  return root;
}

function run(root: string, ...args: string[]) {
  const result = Bun.spawnSync([process.execPath, join(repository, "scripts/fork-version.ts"), ...args, "--root", root]);
  return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

const read = (root: string, file: string) => readFileSync(join(root, file), "utf8");
const versionOf = (root: string) => (JSON.parse(read(root, "package.json")) as { version: string }).version;

// The same release-version locations scripts/check-version.ts verifies.
function expectReleaseVersion(root: string, version: string) {
  expect(versionOf(root)).toBe(version);
  expect((JSON.parse(read(root, "launcher/package.json")) as { version: string }).version).toBe(version);
  expect(read(root, "src/version.ts")).toContain(`export const VERSION = ${JSON.stringify(version)};`);
  expect(read(root, "scripts/install.sh")).toContain(`VERSION="\${CODEX_CHATGPT_WEB_VERSION:-${version}}"`);
  for (const readme of files.filter(file => file.startsWith("README"))) {
    for (const target of ["win-x64.exe", "mac-arm64.dmg", "mac-x64.dmg", "linux-x64.AppImage"]) {
      expect(read(root, readme)).toContain(`/releases/download/v${version}/codex-web-gpt-${version}-${target}`);
    }
  }
}

test("fork-version moves from an upstream release to fork.1, then fork.2, then a chosen release", () => {
  const root = copyRepository();
  // Start from the plain upstream release so the test does not depend on the current revision.
  const base = versionOf(root).replace(/-fork\.\d+$/, "");
  if (versionOf(root) !== base) expect(run(root, base).code).toBe(0);
  expectReleaseVersion(root, base);

  const first = run(root);
  expect(first.code).toBe(0);
  expect(first.stdout).toContain(`${base} -> ${base}-fork.1`);
  expectReleaseVersion(root, `${base}-fork.1`);

  expect(run(root, "next").code).toBe(0);
  expectReleaseVersion(root, `${base}-fork.2`);
  for (const readme of files.filter(file => file.startsWith("README"))) {
    expect(read(root, readme)).not.toContain(`/releases/download/v${base}-fork.1/`);
  }

  expect(run(root, "9.9.9").code).toBe(0);
  expectReleaseVersion(root, "9.9.9");
});

// The launcher updater ignores GitHub prereleases, so a fork release must be published as stable.
test.skipIf(process.platform === "win32")("the release workflow publishes fork revisions as stable releases", () => {
  const workflow = read(repository, ".github/workflows/release.yml");
  const condition = /if \[\[ (.+?) \]\]; then\n\s+release_flags=\(--prerelease --latest=false\)/.exec(workflow)?.[1];
  expect(condition).toBeDefined();
  const classify = (tag: string) => Bun.spawnSync(["bash", "-c",
    `if [[ ${condition} ]]; then echo prerelease; else echo stable; fi`], {
    env: { ...process.env, RELEASE_TAG: tag },
  }).stdout.toString().trim();
  for (const tag of ["v6.1.17", "v6.1.17-fork.1", "v6.1.17-fork.12"]) expect(classify(tag)).toBe("stable");
  for (const tag of ["v6.1.17-beta.1", "v6.1.17-rc.1", "v6.1.17-fork", "v6.1.17-fork.1.2", "v6.1.17-forked.1"]) {
    expect(classify(tag)).toBe("prerelease");
  }
});

test("fork-version rejects other suffixes and leaves every file unchanged when one location is stale", () => {
  const root = copyRepository();
  for (const invalid of ["6.1.17-beta.1", "6.1.17-fork.0", "6.1.17-fork", "v6.1.17", "6.1"]) {
    const result = run(root, invalid);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("must be X.Y.Z or X.Y.Z-fork.N");
  }

  const before = Object.fromEntries(files.map(file => [file, read(root, file)]));
  // Simulate a release bump that missed one README.
  writeFileSync(
    join(root, "README.ko.md"),
    before["README.ko.md"]!.replaceAll(`/releases/download/v${versionOf(root)}/`, "/releases/download/v0.0.0/"),
  );
  const stale = run(root);
  expect(stale.code).not.toBe(0);
  expect(stale.stderr).toContain("README.ko.md has 0 occurrence(s)");
  for (const file of files.filter(file => file !== "README.ko.md")) expect(read(root, file)).toBe(before[file]!);
});
