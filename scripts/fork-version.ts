// Set the release version for a fork-only release (docs/upstream-sync.md).
//
//   bun run scripts/fork-version.ts            # 6.1.17 -> 6.1.17-fork.1, 6.1.17-fork.1 -> 6.1.17-fork.2
//   bun run scripts/fork-version.ts 6.1.17-fork.3
//
// It rewrites exactly the places scripts/check-version.ts verifies and refuses to change anything
// unless every one of them still names the current version.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const rootFlag = args.indexOf("--root");
const root = rootFlag === -1 ? resolve(import.meta.dir, "..") : resolve(args.splice(rootFlag, 2)[1] ?? "");
const requested = args[0] ?? "next";
if (args.length > 1) throw new Error("Usage: bun run scripts/fork-version.ts [next|X.Y.Z|X.Y.Z-fork.N] [--root DIR]");

const RELEASE = /^(\d+)\.(\d+)\.(\d+)(?:-fork\.([1-9]\d*))?$/;
const current = (JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as { version?: string }).version ?? "";
const currentMatch = RELEASE.exec(current);
if (!currentMatch) throw new Error(`package.json version ${JSON.stringify(current)} is neither X.Y.Z nor X.Y.Z-fork.N`);

let next: string;
if (requested === "next") {
  const [, major, minor, patch, revision] = currentMatch;
  next = `${major}.${minor}.${patch}-fork.${revision ? Number(revision) + 1 : 1}`;
} else {
  if (!RELEASE.test(requested)) throw new Error(`Version ${JSON.stringify(requested)} must be X.Y.Z or X.Y.Z-fork.N with N >= 1`);
  next = requested;
}
if (next === current) throw new Error(`Version is already ${current}`);

const readmeTargets = ["win-x64.exe", "mac-arm64.dmg", "mac-x64.dmg", "linux-x64.AppImage"];
const edits: Array<{ path: string; from: string; to: string; minimum: number }> = [
  { path: "package.json", from: `"version": ${JSON.stringify(current)},`, to: `"version": ${JSON.stringify(next)},`, minimum: 1 },
  { path: "launcher/package.json", from: `"version": ${JSON.stringify(current)},`, to: `"version": ${JSON.stringify(next)},`, minimum: 1 },
  { path: "src/version.ts", from: `export const VERSION = ${JSON.stringify(current)};`, to: `export const VERSION = ${JSON.stringify(next)};`, minimum: 1 },
  {
    path: "scripts/install.sh",
    from: `VERSION="\${CODEX_CHATGPT_WEB_VERSION:-${current}}"`,
    to: `VERSION="\${CODEX_CHATGPT_WEB_VERSION:-${next}}"`,
    minimum: 1,
  },
  ...["README.md", "README.zh-CN.md", "README.ja.md", "README.ko.md"].map(path => ({
    path,
    from: `/releases/download/v${current}/codex-web-gpt-${current}-`,
    to: `/releases/download/v${next}/codex-web-gpt-${next}-`,
    minimum: readmeTargets.length,
  })),
];

// Validate every file before writing any of them.
const updated = edits.map(edit => {
  const text = readFileSync(resolve(root, edit.path), "utf8");
  const count = text.split(edit.from).length - 1;
  if (count < edit.minimum) {
    throw new Error(`${edit.path} has ${count} occurrence(s) of ${JSON.stringify(edit.from)}; expected at least ${edit.minimum}`);
  }
  return { path: edit.path, text: text.split(edit.from).join(edit.to), count };
});
for (const file of updated) writeFileSync(resolve(root, file.path), file.text);

process.stdout.write(`FORK_VERSION_SET ${current} -> ${next}\n`);
for (const file of updated) process.stdout.write(`  ${file.path}: ${file.count} replaced\n`);
process.stdout.write([
  "Next:",
  `  1. Optional: describe the release in docs/releases/v${next}.md (shown above GitHub's notes).`,
  "  2. Commit, open a PR, and merge it once CI passes.",
  "  3. Actions -> Release -> Run workflow on main.",
  "",
].join("\n"));
