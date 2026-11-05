// Fork-owned guard: X.Y.Z-fork.N is a stable fork release of upstream X.Y.Z plus fork-only fixes.
// It must update installs of X.Y.Z and earlier fork revisions, and yield to upstream X.Y.(Z+1).
const test = require("node:test");
const assert = require("node:assert/strict");
const { compareVersions, createUpdateController, releaseAssetName } = require("../electron/update.cjs");

test("fork revisions follow their upstream release and precede the next one", () => {
  const ascending = [
    "6.1.16",
    "6.1.17-beta.1",
    "6.1.17-rc.2",
    "6.1.17",
    "6.1.17-fork.1",
    "6.1.17-fork.2",
    "6.1.17-fork.10",
    "6.1.18-beta.1",
    "6.1.18",
    "6.1.18-fork.1",
    "6.2.0",
  ];
  for (let left = 0; left < ascending.length; left += 1) {
    for (let right = 0; right < ascending.length; right += 1) {
      assert.equal(
        compareVersions(ascending[left], ascending[right]),
        Math.sign(left - right),
        `${ascending[left]} vs ${ascending[right]}`,
      );
    }
  }
});

test("only an exact fork.N suffix is a fork revision; other suffixes stay SemVer prereleases", () => {
  for (const prerelease of ["6.1.17-fork", "6.1.17-forked.1", "6.1.17-fork.1.2", "6.1.17-fork.x", "6.1.17-fork-1"]) {
    assert.equal(compareVersions(prerelease, "6.1.17"), -1, prerelease);
  }
});

test("the updater offers fork revisions and later upstream syncs, never a downgrade", async () => {
  const check = async (currentVersion, tag) => {
    const controller = createUpdateController({
      currentVersion,
      platform: "linux",
      arch: "x64",
      packaged: true,
      executablePath: "/app",
      runtimeExecutable: "/runtime",
      logsDirectory: "/logs",
      retryDelaysMs: [],
      dependencies: {
        fetchRelease: async () => {
          const version = tag.slice(1);
          const assets = [releaseAssetName(version, "linux", "x64"), "checksums.txt"].map(name => ({
            name,
            browser_download_url: `https://github.com/Y0UW1SH/chatgpt-web-codex/releases/download/${tag}/${name}`,
          }));
          return { tag_name: tag, draft: false, prerelease: false, assets };
        },
      },
    });
    return (await controller.checkOnce()).status;
  };
  assert.equal(await check("6.1.17", "v6.1.17-fork.1"), "available");
  assert.equal(await check("6.1.17-fork.1", "v6.1.17-fork.2"), "available");
  assert.equal(await check("6.1.17-fork.2", "v6.1.18"), "available");
  assert.equal(await check("6.1.17-fork.2", "v6.1.17-fork.2"), "up-to-date");
  assert.equal(await check("6.1.17-fork.2", "v6.1.17"), "up-to-date");
  assert.equal(await check("6.1.18", "v6.1.17-fork.9"), "up-to-date");
});
