---
type: Runbook
title: CI guardrails, the failure digest, and the PR loop
description: The single guardrails Forgejo Actions workflow required on main — what it runs and how to reproduce it locally, how a failure is read back from the redacted digest and its package bundle with ci-status.mjs, the dedicated repository runner and the one exception to it (the dev-container image job, which never runs pull-request code), branch protection, the terminal PR loop through forge-pr.mjs, and the rule every new job must follow.
tags: [ci, forgejo, pull-requests, runbook]
resource: docs/runbooks/ci.md
timestamp: 2026-11-22
---

# CI guardrails, the failure digest, and the PR loop

BELAY's required CI is one workflow, `.forgejo/workflows/guardrails.yml` (a second,
`devcontainer-image.yml`, publishes the dev-container image and is not a merge check). Guardrails runs on every pull request,
every push to `main` and manual dispatch, and branch protection on `main` requires its
`guardrails / guardrails (pull_request)` context. Its one job installs Node and the pinned pnpm, then
runs `pnpm nx run scripts:lint` and `pnpm nx run scripts:test`. So **those two commands, run locally,
reproduce the required check**. A failure-digest step always runs last and never changes the result.
Full detail is in [docs/runbooks/ci.md](../../docs/runbooks/ci.md).

The whole PR loop runs from a terminal:

```bash
git push origin HEAD:<branch>
node scripts/forge-pr.mjs open --head <branch> --title "<title>" --body-file <file>
node scripts/ci-status.mjs watch --pr <n> --timeout 900
node scripts/forge-pr.mjs merge <n> --expect-head "$(git rev-parse HEAD)"
```

## Gotchas

- **A PR's head MUST be a real branch, never an AGit push.** Push with
  `git push origin HEAD:<branch>`. A `refs/for/main` (AGit) head runs with **no** Actions secrets,
  and `forge-pr.mjs open` refuses one. Never hand-type a `git credential fill` recipe. `forge-pr.mjs`
  asks the credential helper itself and never prints the answer.
- **`merge --expect-head` merges only what was checked.** It refuses unless the PR's head is that
  exact sha, `ci-status` says mergeable, and the forge agrees. It then deletes the branch.
- **Branch on `ci-status` exit codes, never on its prose.** 0 is mergeable, 1 means a required check
  failed, 2 is bad arguments or a token missing a scope (the message names it), and **3 is still
  waiting, never a failure**. A `watch` that hits `--timeout` against a queued runner returns 3.
- **Read a failure from the digest, not the runner.** On a PR it is one comment per job, edited in
  place on a later failure. On `main` it is a commit status. Fuller evidence is a bundle in the
  `belay-ci-failures` generic package, read with
  `node scripts/ci-status.mjs failure --run <id> [--full]`. "Excerpt withheld" means the redactor
  found something credential-shaped. A "degraded channel" note means `CI_DIGEST_TOKEN` was not
  available to that run.
- **A dispatched run posts no commit status.** Follow a `forge-pr.mjs dispatch` run in the Actions
  tab, because `ci-status` cannot see it.
- **The runner is BELAY's own, with one exception.** Jobs use `runs-on: belay`, served by a
  repository runner that maps it to a Node 26 container with no host Docker access. The global
  runner is shared with MovieCollectionManager and runs one job at a time, and BELAY's first run
  waited about 36 minutes behind it. A run stuck on "Waiting for a runner with the following label:
  belay" means that runner is offline. The label is pinned by `guardrails-workflow.test.mjs`, so
  change both together.
  - **The exception is `devcontainer-image`**, which builds the dev-container toolchain image and so
    needs a Docker daemon. It runs on the shared host runner (`runs-on: kvm`), which has the host's
    Docker, so it **must never run pull-request code**. Its triggers are push to `main`, dispatch and
    the weekly schedule, and a guard test fails on any `pull_request` trigger.
  - **Its result is not readable from the run.** The forge cannot read back the step summary, so the
    published digest is resolved from the registry (see the [dev container](./devcontainer.md)).
- **Every job ends with the failure-digest step, and every other `run:` step goes through
  `scripts/ci-log-step.sh`.** `check-ci-digest-coverage.mjs` fails `scripts:lint` otherwise. An
  opt-out needs a marker with a written reason. A blank reason is rejected.
- **When the whole board goes red at once, suspect the INSTALL before the code.** A frozen install
  can fail on a just-published transitive under pnpm's release-age policy (see
  [package-manager enforcement](../invariants/package-manager-enforcement.md)). Read one digest, not
  all of them.
