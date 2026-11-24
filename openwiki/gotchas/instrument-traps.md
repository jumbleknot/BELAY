---
type: Gotcha
title: Instrument traps — a tool's answer is about the tool, not your question
description: Measured cases where a command ignored an argument it did not recognise, acted on one it should not have, or answered a different question — node --test flag order, rg -r, a forge empty list or 404, an empty search, git grep and new files, node's test reporter, spawnSync input encoding, a persistent cd — and the habit of checking the instrument before believing a result in either direction.
tags: [tooling, testing, verification, forge]
timestamp: 2026-11-24
---

# Instrument traps — a tool's answer is about the tool, not your question

**Before believing a result, check the instrument.** An argument a tool does not recognise is often
silently ignored, or acted on. A "no" from a tool is about that tool's invocation, not necessarily
about the question you asked. That applies in both directions: check before claiming something
**verified**, and before claiming it **impossible**.

Most of these were measured in MovieCollectionManager, using the same tools BELAY uses.

## Gotchas

- **`node --test <file> --test-name-pattern x` runs EVERYTHING.** Node's own flags go *before* the
  path: `node --test --test-name-pattern x <file>`. After the path, the flag is passed to the script
  as an argument and ignored, and the "focused" run is the whole file.
- **A skipped test exits 0.** See [testing tiers](../invariants/testing-tiers.md): read the skip
  count, not just the exit code.
- **A mistyped `--dry-run` or a `--help` on a script that does not parse it can run for real.** In
  MovieCollectionManager it once deployed, posted and deleted for real. Before passing a safety flag
  to a script, confirm the script supports it (read its usage text or source). BELAY's
  `taskstoissues.mjs --dry-run` and `backlog.mjs setup-labels --dry-run` are implemented. Check any
  other script before trusting one.
- **A forge empty list or 404 often means the wrong token, scope or id, not "nothing there".** The
  forge answers a request it cannot authorise in ways that look like absence. `backlog.mjs` refuses an
  unknown label locally for this reason, because the API would silently return the unfiltered set.
  Dropping `type=issues` from a Forgejo issue listing turned 1 row into 143 pull requests.
- **The repository API's `permissions` reports what the ACCOUNT may do, not the token.** An
  issue-write-only token on an admin account reports `admin: true` and still cannot push. Prove a
  token's scope by behaviour (see [the backlog runbook](../runbooks/backlog.md)).
- **An exit code that ends a pipe is not the tool's exit code.** `cmd | tee log` reports `tee`'s
  exit code. `scripts/ci-log-step.sh` exists in CI so a step keeps its real exit code while its output
  is mirrored. Locally, use `set -o pipefail` or skip the pipe.
- **`ci-status.mjs` exit 3 means "still waiting", never "failed".** Branch on the code: 0 mergeable,
  1 a required check failed, 2 bad arguments or a missing token scope, 3 pending. A `watch` that
  times out returns 3 against a queued runner, not a broken build.
- **Never `rg -rn` or `rg -ril`.** In ripgrep `-r` is `--replace`, and it silently consumes the
  pattern.
- **An empty search result is not proof of absence.** Confirm with a second method, such as a
  different tool, a broader pattern or `grep -c`, before writing "X is not used". RTK can also hide a
  binary-file notice (see [RTK](../invariants/rtk-token-compression.md)).
- **`git grep` searches only tracked files.** A file you have created but not committed is never searched, so a
  doc-impact sweep run before the first commit misses the feature's own new documents and reads as "no hits".
  Add `--untracked` (ignored files stay excluded), or stage the files first. Measured in feature 013 (PR #71); the
  sweep command in [doc drift](../runbooks/doc-drift.md) carries the flag.
- **`node --test` prints the spec reporter even into a pipe.** On Node 26, the summary lines are `ℹ tests 27`,
  `ℹ pass 26`, not TAP's `# tests 27`. A grep for `^# tests` matches nothing and looks like "no output"; feature
  013's first RED check hit this. Grep for `^ℹ (tests|pass|fail|skipped)`, or pass `--test-reporter=tap` when a
  script needs TAP.
- **`spawnSync`'s `encoding` option also applies to `input`.** With `encoding: 'buffer'`, a string `input` throws
  `Unknown encoding: buffer`. Pass `input` as a `Buffer`. Measured in feature 013.
- **`cd` persists between shell calls in an agent session.** A `cd` into a subdirectory breaks later
  relative paths and makes real files look missing. Prefer absolute paths.
- **Spec Kit hooks act without asking.** `.specify/extensions.yml` sets `auto_execute_hooks: true`,
  so the `git` extension's hooks run around every `/speckit-*` command. `/speckit-specify` creates and
  switches to a feature branch through the mandatory `before_specify` hook. The commit hooks follow
  `.specify/extensions/git/git-config.yml`, which leaves auto-commit off
  (`auto_commit.default: false`), but a commit offered and accepted in passing is still a commit.
  Check `git branch` and `git log` before concluding that a step did nothing.
