---
type: Runbook
title: CI guardrails, the failure digest, and the PR loop
description: The single guardrails Forgejo Actions workflow required on main — what it runs and how to reproduce it locally, how a failure is read back from the redacted digest and its package bundle with ci-status.mjs, the dedicated repository runner and the one exception to it (the dev-container image job, which never runs pull-request code), the sast job beside guardrails, the report-only registry-retention job, branch protection, the terminal PR loop through forge-pr.mjs, and the rule every new job must follow.
tags: [ci, forgejo, pull-requests, runbook]
resource: docs/runbooks/ci.md
resource-sha256: 4f387e3400cf07888b3b7d62b7d49f496f509396a4c8bf1400a3356ac2617764
timestamp: 2026-11-27T01:29:53.048Z
---

# CI guardrails, the failure digest, and the PR loop

BELAY's required CI is one workflow, `.forgejo/workflows/guardrails.yml`. Three others are not merge
checks: `devcontainer-image.yml` publishes the dev-container image after scanning it,
`registry-retention.yml` reports which old package versions would be deleted, and `image-scan.yml`
sweeps third-party images for CVEs ([image scanning](image-scanning.md)). Guardrails runs on every pull request,
every push to `main` and manual dispatch, and branch protection on `main` requires its
`guardrails / guardrails (pull_request)` and `guardrails / sast (pull_request)` contexts. Its `guardrails` job installs Node and the pinned pnpm, then
runs `pnpm nx run scripts:lint` (every gate: Spec Kit overrides, digest coverage, egress allowlist,
secret scan, topology scrub, toolchain consistency, inline and argv secrets, override floors,
resource naming, OpenWiki OKF and governance, each after its selftest) and `pnpm nx run scripts:test` (the unit
tests under coverage, then the 70% line-coverage gate, whose verdict is the step's last line), then the `pdlc`
server's three targets: `pdlc:lint`, `pdlc:test` (unit and contract tests, its own 70% gate) and
`pdlc:integration` (real git). So **those five commands, run locally, reproduce the required check**. The
server's live-forge tier, `pdlc:integration-forge`, is operator-run and never in CI. A failure-digest step always
runs last and never changes the result.
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
- **Step timings come from every run, green ones included.** A passing job publishes its
  `step-durations.tsv` alone into the same package, so `node scripts/ci-status.mjs durations --job
  <name>` has a sample even for a job that has never failed.
- **A dispatched run posts no commit status.** Follow a `forge-pr.mjs dispatch` run in the Actions
  tab, because `ci-status` cannot see it.
- **Never dispatch over a queued run (item #81).** A run waiting for its runner is in
  `/actions/runs` but not in `/actions/tasks`, which lists only picked-up jobs. A dispatch on the same
  branch cancels it through the workflow's `cancel-in-progress`. On 2026-11-25 that cancelled the
  queued image push run that a session wrongly thought was never created. `forge-pr.mjs dispatch` now
  refuses while a run of the same workflow and branch is waiting, running or blocked, and fails closed
  when it cannot list runs; `--supersede` replaces the run on purpose.
- **BELAY has two runners of its own, each under its own Unix user with its own Docker daemon**
  (item #92). `ci-belay` (`belay-ci`) serves `runs-on: belay`, a fresh Node 26 container per job with
  no host Docker access. `ci-belay-host` (`belay-host-ci`) serves `runs-on: belay-host`, directly on
  the host. Both run one job at a time. A run stuck on "Waiting for a runner with the following label"
  means that runner is offline. The `belay` label is pinned by `guardrails-workflow.test.mjs`, so
  change both together.
  - **The exception is `devcontainer-image`**, which builds the dev-container toolchain image and so
    needs a Docker daemon. It runs on `belay-host`, on the host, so it **must never run pull-request
    code**. Its triggers are push to `main`, dispatch and the weekly schedule, and a guard test fails
    on any `pull_request` trigger. Its `DOCKER_HOST` is derived from `id -u`, never a literal uid.
  - **`kvm` is retired.** It was the instance-wide runner shared with MovieCollectionManager, now
    scoped to that repository. A job left on it waits for ever, so a guard fails any workflow naming it.
  - **A PR can still target `belay-host`**, and its workflow runs before any guard can fail it. The
    separate Unix user is what keeps such a job away from the container jobs' daemon and `ci-belay`'s
    token; one user for both was rejected for that reason.
  - **A host job never leaves state behind on the host, and never runs a tool from there.** Before
    item #92 the host runner shared its home folder, tool cache and Docker daemon with
    MovieCollectionManager's runner. On 2026-11-25:
    - a global pnpm install broke MovieCollectionManager's pnpm check (item #79);
    - the shared `~/.local/bin/trivy`, `~/.cache/trivy` and a registry login in `~/.docker/config.json`
      turned out to be shared too (item #84).

    The runner user's home still outlives every job, so pnpm, Trivy and its cache, and `DOCKER_CONFIG`
    all live under `runner.temp`, and one `if: always()` step removes them.
    `scripts/lib/host-runner-rules.mjs` fails a `belay-host` job that installs globally, adds to PATH
    from outside `runner.temp`, runs Trivy without a private cache, logs in to Docker without a private
    config, uses `pnpm/action-setup` or setup-node's `cache:`, names a home-folder path in a command,
    or leaves a private path unremoved.
  - **Its build cache is its own**, so the first build after the move, or after a daemon reset, is cold.
  - **Its result is not readable from the run.** The forge cannot read back the step summary, so the
    published digest is resolved from the registry (see the [dev container](./devcontainer.md)). It scans the
    built image **before** `Push`, and a fixable Critical publishes nothing ([image scanning](image-scanning.md)).
- **Registry retention deletes only with two keys.** The weekly run only reports. `--apply` reaches
  the script only on a dispatch with `apply: true`, and the script refuses it unless the committed
  config says `mode: apply`; it ships in `mode: report`. A package the config does not list (another
  repository's, under the same owner) is never deleted. Its token is `REGISTRY_CLEANUP_TOKEN`; without
  it the job fails loudly rather than reporting an empty registry.
- **Every job ends with the failure-digest step, and every other `run:` step goes through
  `scripts/ci-log-step.sh`.** `check-ci-digest-coverage.mjs` fails `scripts:lint` otherwise. An
  opt-out needs a marker with a written reason. A blank reason is rejected.
- **When the whole board goes red at once, suspect the INSTALL before the code.** A frozen install
  can fail on a just-published transitive under pnpm's release-age policy (see
  [package-manager enforcement](../invariants/package-manager-enforcement.md)). Read one digest, not
  all of them.
- **The `sast` job also runs the dependency bot's two PR checks**: `renovate.json` against Renovate's
  strict validator at the pinned version, and a version-and-checksum pair that moved must agree with
  its release. The bot's own `renovate` workflow is not a merge check; its record is the
  `renovate/verdict` status ([dependency bot](renovate.md)).
- **The evidence floor is 200 versions**: 25 durations runs × 8 bundle-publishing jobs. A new job that
  publishes a bundle fails the retention config until the number is raised.
- **The bot's health loop is two more scheduled workflows**: `renovate-health.yml` (Wednesday 08:30 UTC, one
  report comment) and `branch-reaper.yml` (daily 03:30 UTC; a dispatch is a dry run). Neither is a merge check
  ([dependency bot](renovate.md)).
