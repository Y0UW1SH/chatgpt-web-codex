# How this fork differs from upstream

`Y0UW1SH/chatgpt-web-codex` is a maintained fork of
[miuuyy/codex-chatgpt-web](https://github.com/miuuyy/codex-chatgpt-web). It includes every
upstream feature, model and setting, currently from upstream **v6.1.17**, and adds the changes
below. Each item names the regression test that protects it, so a later upstream sync cannot drop
it silently. [docs/upstream-sync.md](upstream-sync.md) describes how syncs keep these changes.

## At a glance

| | Upstream v6.1.17 | This fork |
|---|---|---|
| Passing regression tests (core / launcher) | 1113 / 431 | 1172 / 467 (+95) |
| Dependency audit | 2 moderate advisories (vite, minimatch) | Clean |
| Raw exec argument checks | `write_stdin` poll limit can be bypassed with a getter or `toJSON` | One validated snapshot for every guarded tool |
| Desktop updates and installers | Upstream releases | This fork's releases, so fixes survive updates |
| Electron main-process type checking | None | Every `launcher/electron/*.cjs` file, with a no-new-errors ratchet |
| Dependency advisories in CI | Fail every platform job before tests run | Reported by a separate weekly and per-PR audit check |

## Runtime reliability

- **Completed responses stay correct.** An incomplete compaction checkpoint is rejected instead of
  becoming replacement history. JSON and streamed (SSE) responses report the same terminal status
  for incomplete, truncated and content-filtered replies. *Tests:* `tests/responses-terminal.test.ts`.
- **No lost stream errors.** Unary responses keep draining while events are produced, and a
  terminal backlog failure is always delivered. *Tests:* `tests/server-event-backlog.test.ts`.
- **Native passthrough.** Stale `Content-Encoding` headers are removed from responses that were
  already decoded. *Tests:* `tests/native-passthrough.test.ts`.
- **Safe tunnel and service changes.** Active turns drain before a tunnel restart or stop. Launcher
  migration and uninstall stop the old daemon before removing its tunnel.
  *Tests:* `tests/tunnel-drain.test.ts`, `tests/setup-lifecycle.test.ts`, `tests/service-lifecycle.test.ts`.
- **Launcher helper lifecycle.** Closing the helper before it is ready rejects the waiting turn, and
  late writes from a replaced turn cannot complete or release the new one.
  *Tests:* `tests/launcher-helper-lifecycle.test.ts`.
- **Runtime ownership.** The launcher recovers a stale runtime owner as a whole before adopting any
  of its processes, and a refused recovery keeps the original ownership evidence.
  *Tests:* `launcher/tests/runtime-supervisor.test.cjs`.
- **Codex configuration.** Uninstall refuses an integration journal that belongs to a different
  Codex home, leaving both homes unchanged. *Tests:* `tests/codex-integration.test.ts`.

## Model-authored code (raw `exec`)

- Caller JavaScript is compiled as its own strict-mode function body, so it cannot close the
  wrapper and reach the unguarded tool registry, and undeclared globals or registry writes fail.
- `wait_agent` and `write_stdin` arguments are validated and dispatched from one JSON snapshot, so
  getters or `toJSON` cannot pass validation with one value and send another. Upstream's
  `write_stdin` limit (added in v6.1.14) lacks this.
- MCP calls and raw `exec` share a single validator, so their transport rules cannot drift apart.

*Tests:* `tests/raw-exec-transport.test.ts`, `tests/transport-argument-rules.test.ts`. The
[security model](security-model.md) explains why this is a transport guard, not a sandbox.

## Linux installer and AppImage

- The desktop entry launches correctly from install paths containing spaces and special characters.
- The installer identifies a running launcher through its authenticated identity endpoint, so a
  reused PID or an unrelated process on the endpoint is not mistaken for it.
- Concurrent AppImage launches share one extraction, and its ownership is published atomically.

*Tests:* `launcher/tests/linux-installer-paths.test.cjs`, `launcher/tests/linux-appimage-runner.test.cjs`,
`launcher/tests/control-server.test.cjs`.

## Releases and updates

The in-app updater, `install.sh`, `install-launcher.sh`, `install-launcher.ps1`, the README
downloads and the package metadata all use this fork's releases. Upstream binaries do not contain
these changes, so installing one over a fork build would remove them.
*Test:* `launcher/tests/fork-release-source.test.cjs` fails if a sync points any of them back at
upstream. Releases can be started from the Actions tab (**Release → Run workflow** on `main`).

## Dependency security

- vite 6.4.5 clears GHSA-8g5g-mxqh-grgj.
- minimatch 11.0.4 clears GHSA-g3hv-75wg-m249. The override is scoped to electron-builder's
  `app-builder-lib` and `@electron/universal`; the packaged app is file-for-file identical to the
  build with the old version.

## Maintenance safeguards

- **Electron type checking:** existing diagnostics are recorded in
  `launcher/electron-typecheck-baseline.json`, and any new one fails `launcher:typecheck`.
- **UI contract parity:** the launcher's sign-in check must use the same ChatGPT composer selector as
  `src/chatgpt-ui/`. *Test:* `tests/launcher-composer-selector-parity.test.ts`.
- **CI:** dependency audits run separately on every PR, on `main`, and weekly. Superseded runs are
  cancelled, jobs have timeouts, downloads are cached, and every workflow action is pinned to a commit.
  Dependabot keeps those pins current.
- **Developer startup:** `bun run app` starts the production launcher profile.
  *Test:* `tests/start-launcher.test.ts`.
- **Process:** [AGENTS.md](../AGENTS.md) and [docs/upstream-sync.md](upstream-sync.md) define how
  upstream changes are merged without losing these fixes.
  [docs/opencode-and-codex.md](opencode-and-codex.md) covers using this bridge from other agents.

## Unchanged from upstream

Models, routes, efforts, settings, and the ChatGPT browser automation are upstream's. Version
numbers follow upstream releases. Upstream behavior changes, such as Temporary Chat becoming the
default in v6.1.15, apply here too and are called out in this fork's release notes.
