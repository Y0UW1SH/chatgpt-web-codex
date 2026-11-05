// Type-check the Electron main-process sources (CommonJS JavaScript) with a ratchet.
//
// The existing diagnostics are recorded in electron-typecheck-baseline.json instead of being fixed
// in place, so this fork does not have to rewrite upstream-owned files. Any diagnostic that is not
// in the baseline fails the check. Run with --update after deliberately accepting or fixing one.
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const configPath = path.join(root, "tsconfig.electron.json");
const baselinePath = path.join(root, "electron-typecheck-baseline.json");
const update = process.argv.includes("--update");

function diagnosticsByKey() {
  const config = ts.getParsedCommandLineOfConfigFile(configPath, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic(diagnostic) {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
    },
  });
  if (config.errors.length) {
    throw new Error(config.errors.map(error => ts.flattenDiagnosticMessageText(error.messageText, "\n")).join("\n"));
  }
  const program = ts.createProgram({ rootNames: config.fileNames, options: config.options });
  const found = new Map();
  for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
    const file = diagnostic.file ? path.relative(root, diagnostic.file.fileName).split(path.sep).join("/") : "<global>";
    // Line numbers are omitted from the key so that unrelated edits do not churn the baseline.
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ").replace(/\s+/g, " ");
    const key = `${file}: TS${diagnostic.code}: ${message}`;
    const line = diagnostic.file && diagnostic.start !== undefined
      ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1
      : 0;
    const entry = found.get(key) ?? { count: 0, lines: [] };
    entry.count += 1;
    entry.lines.push(line);
    found.set(key, entry);
  }
  return found;
}

const found = diagnosticsByKey();
if (update) {
  const baseline = Object.fromEntries([...found.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, entry.count]));
  fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
  process.stdout.write(`ELECTRON_TYPECHECK_BASELINE_UPDATED ${found.size} diagnostic kinds\n`);
  process.exit(0);
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
const added = [];
for (const [key, entry] of found) {
  const allowed = baseline[key] ?? 0;
  if (entry.count > allowed) added.push(`${key} (lines ${entry.lines.join(", ")}; ${entry.count} found, ${allowed} accepted)`);
}
const resolved = Object.keys(baseline).filter(key => (found.get(key)?.count ?? 0) < baseline[key]);
if (resolved.length) {
  process.stdout.write(`Electron type diagnostics resolved; run with --update to tighten the baseline:\n  ${resolved.join("\n  ")}\n`);
}
if (added.length) {
  process.stderr.write(`New Electron type diagnostics:\n  ${added.join("\n  ")}\n`
    + "Fix them, or run `node scripts/typecheck-electron.cjs --update` to accept them deliberately.\n");
  process.exit(1);
}
process.stdout.write(`ELECTRON_TYPECHECK_OK ${[...found.values()].reduce((sum, entry) => sum + entry.count, 0)} baselined diagnostics\n`);
