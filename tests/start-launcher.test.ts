import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const launcher = join(root, "launcher");

async function bootstrap(failHelperBuild = false) {
  const fixture = mkdtempSync(join(tmpdir(), "codex-launcher-start-"));
  const callsPath = join(fixture, "calls.jsonl");
  const preload = join(fixture, "preload.js");
  writeFileSync(callsPath, "");
  writeFileSync(preload, `
    import { appendFileSync } from "node:fs";
    Bun.spawnSync = (args, options) => {
      appendFileSync(process.env.LAUNCHER_START_TEST_CALLS, JSON.stringify({ args: args.slice(1), cwd: options.cwd }) + "\\n");
      return { exitCode: process.env.LAUNCHER_START_TEST_FAIL_HELPER === "1" && args.includes("scripts/build-browser-helper.ts") ? 23 : 0 };
    };
  `);
  try {
    const child = Bun.spawn([process.execPath, "--preload", preload, join(root, "scripts", "start-launcher.ts")], {
      cwd: root,
      env: {
        ...process.env,
        CODEX_CHATGPT_WEB_BUN: process.execPath,
        LAUNCHER_START_TEST_CALLS: callsPath,
        LAUNCHER_START_TEST_FAIL_HELPER: failHelperBuild ? "1" : "0",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    const calls = readFileSync(callsPath, "utf8").trim().split("\n").filter(Boolean)
      .map(line => JSON.parse(line) as { args: string[]; cwd: string });
    return { exitCode, stderr, calls };
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

test("source app startup prepares its helper and renderer before starting the production launcher", async () => {
  const result = await bootstrap();
  expect(result.stderr).toBe("");
  expect(result.exitCode).toBe(0);
  expect(result.calls).toEqual([
    { args: ["install", "--frozen-lockfile"], cwd: root },
    { args: ["install", "--frozen-lockfile"], cwd: launcher },
    { args: ["run", "scripts/build-browser-helper.ts"], cwd: root },
    { args: ["run", "build"], cwd: launcher },
    { args: ["run", "start"], cwd: launcher },
  ]);
});

test("a failed helper build stops source app startup before Electron can launch", async () => {
  const result = await bootstrap(true);
  expect(result.stderr).toBe("");
  expect(result.exitCode).toBe(23);
  expect(result.calls.at(-1)).toEqual({ args: ["run", "scripts/build-browser-helper.ts"], cwd: root });
});
