# Safely update this fork

Use this guide whenever bringing changes from `miuuyy/codex-chatgpt-web` into
`Y0UW1SH/chatgpt-web-codex`. Keep the fork's custom behavior while adopting upstream
improvements. A clean Git merge does not prove that the combined application works.

## The short request to use next time

```text
Sync this fork using AGENTS.md and docs/upstream-sync.md. Open a sync PR and report the results before merging.
```

The complete reusable prompt:

```text
Sync upstream into a new PR based on my fork's main. Preserve my custom fixes and behavior. Never reset, force-push, or discard my commits. Check overlapping changes, run regression tests and builds, compare failures with unchanged upstream, and report any remaining risk before merging.
```

## Sync procedure

1. **Inspect the current state.** Read `AGENTS.md` and `CONTRIBUTING.md`. Verify the
   repository and remote identities, preserve any uncommitted work, fetch both
   remotes, and record the exact fork and upstream SHAs. Do not use a stale local
   `main` as the starting point.
2. **Keep a recovery point.** Record the original fork head in the sync PR. Create
   a uniquely named backup branch or tag at that commit before changing `main`;
   never move an existing backup. A backup is a recovery aid, not branch protection.
3. **Work on a separate branch.** Create `sync/upstream-<date>-<unique-suffix>` from
   the fork's current `main`. Merge the pinned upstream commit into it. Do not
   replace the fork with upstream, rebase away its history, force-push, or use
   GitHub's **Discard commits** action.
4. **Review both sides.** Identify the fork-specific changes and the new upstream
   changes from their common ancestor. Inspect overlapping files and interactions
   across files. Resolve conflicts deliberately. Retain regression coverage and
   explain any custom fix replaced by equivalent upstream behavior. Preserve this
   guide and `AGENTS.md` if upstream later adds its own instructions.
5. **Validate the combined code.** Install the versions pinned by the current
   manifests and lockfiles. Run the fork's affected regression tests and the
   repository verification described below. Test the affected live behavior when
   applicable, following `CONTRIBUTING.md` and `docs/release-validation.md`.
6. **Compare failures fairly.** Run the same failing checks on an untouched checkout
   of the exact upstream SHA, on the same host, with its own frozen dependencies.
   Compare failing test names and causes, not just totals. Investigate new failures
   and preserve failing evidence. Baseline failures, dependency advisories, skipped
   tests, and environment limits remain unresolved results, not passing checks.
7. **Open a sync PR.** Include the report below. Leave it open for review unless
   merging has been explicitly authorized. Do not merge with unresolved new
   regressions. If either branch moves, refresh the comparison and validate the
   final proposed merge tree before merging. Use a merge commit to retain history.
8. **Verify after merging.** Confirm `main` contains both the previous fork head and
   the reviewed upstream commit, and that its code matches the tested merge tree.
   Keep the recovery point. Build any fork release from this reviewed code.

## Verification commands

These commands match the repository scripts when this guide was added. Read the
current scripts and contributor instructions each time; do not silently omit newly
required checks.

```bash
bun install --frozen-lockfile
(cd launcher && bun install --frozen-lockfile)
bun run verify
```

`verify` currently covers version consistency, dependency audits, root and launcher
typechecks and tests, launcher and runtime builds, generated notices, and the
relocated-runtime smoke test. It stops at the first failure. If that happens, record
the failure and run the remaining applicable checks individually so later results
are not mistaken for passes. Packaging and live integration checks are additional;
use the matching operating systems and the release-validation guide.

## What the sync PR must report

- Original fork SHA, upstream SHA, proposed merge SHA, and recovery branch or tag.
- Upstream features adopted and custom fixes preserved or replaced with evidence.
- Conflict resolutions and any behavior, configuration, or dependency changes.
- Test/build commands and results, including the untouched-upstream comparison.
- Remaining advisories, failures, skipped/live tests, platform gaps, and risks.

## Source sync versus the desktop Update button

Merging source changes does not change the installed application. At the time this
guide was added, the desktop updater in `launcher/electron/update.cjs` targets
`miuuyy/codex-chatgpt-web` releases. Those binaries do not include fork-only changes.
Check this setting again before updating. Use a build containing the reviewed fork
changes; do not install an upstream binary over a fork build expecting those changes
to survive. Supporting fork releases in the updater requires a separate change.

## Enforcement is separate

`AGENTS.md` and this guide are saved instructions. GitHub's Sync fork button and
tools that do not read them will not follow this procedure automatically. For
enforcement, configure `main` to require PRs and appropriate CI checks and to block
force pushes and deletion. Verify that Actions is enabled and required checks
actually run. This documentation does not configure those controls or schedule
automatic syncing.
