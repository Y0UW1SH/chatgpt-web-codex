# Fork maintenance instructions

This repository is the maintained fork `Y0UW1SH/chatgpt-web-codex`. Its upstream is
`miuuyy/codex-chatgpt-web`. The fork's `main` contains custom fixes; it is not an
upstream mirror. Follow [CONTRIBUTING.md](CONTRIBUTING.md) for general contributions.

## Updating or syncing upstream

Read [docs/upstream-sync.md](docs/upstream-sync.md) before any upstream sync.

- Fetch and record the current fork and upstream commit SHAs. Start a new sync
  branch from the fork's current `main`, then merge upstream into that branch.
- Preserve custom fixes, behavior, regression tests, and these maintenance
  instructions. Do not reset the fork to upstream, force-push, discard fork
  commits, or resolve conflicts by blindly choosing either side.
- Inspect overlapping changes and interactions even when Git reports no
  conflicts. Remove a custom fix only when an upstream replacement is verified
  by regression coverage to preserve its behavior; explain that decision.
- Run regression tests and builds. Compare failures against an untouched
  checkout of the same upstream commit on the same host. Investigate new
  failures; do not weaken tests or label a failure pre-existing without evidence.
- Open a sync PR and report preserved changes, conflict decisions, validation,
  and remaining risks before merging. Do not automatically merge sync PRs unless
  the user explicitly authorizes merging. Stop for unresolved regressions.
- Treat source syncing and desktop binary updates separately. Check the release
  source before recommending an installed-app update; an upstream binary does
  not automatically include this fork's changes.

These instructions guide agents that read this file. They do not configure
GitHub branch protection, CI enforcement, or the desktop updater.
