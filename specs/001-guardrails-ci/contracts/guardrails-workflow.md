# Contract: `.forgejo/workflows/guardrails.yml`

This is what the workflow promises the maintainer, agents, and `main`'s branch protection.

## Triggers

| Event | Scope | Notes |
| --- | --- | --- |
| `pull_request` | any branch | This is the run branch protection requires. |
| `push` | `main` only | Keeps one push to a PR branch from running twice. |
| `workflow_dispatch` | any ref | Manual re-check. |

`concurrency.group` is `guardrails-${{ github.ref }}`, with `cancel-in-progress: true`.

## Job `guardrails`

- `runs-on: belay`, served by BELAY's repository runner `ci-belay` (`docker://node:26-bookworm`). It was `ubuntu-latest` on the shared `ci-homelab` until 2026-11-22.
- `timeout-minutes: 10`.

| # | Step | Must fail the job when |
| --- | --- | --- |
| 1 | `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1` (v7) | it can't check out |
| 2 | `actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1` (v7), `node-version: 26.13.1` | Node can't be provisioned |
| 3 | `bash scripts/ci-log-step.sh guardrails-install-pnpm bash scripts/install-pnpm.sh` | the pnpm on PATH ≠ `packageManager` |
| 4 | `bash scripts/ci-log-step.sh guardrails-install-deps pnpm install --frozen-lockfile` | the lock file is out of date, or an install script hasn't been decided in `allowBuilds` |
| 5 | `bash scripts/ci-log-step.sh guardrails-lint pnpm nx run scripts:lint` | any gate, or any gate's selftest, fails |
| 6 | `bash scripts/ci-log-step.sh guardrails-test pnpm nx run scripts:test` | any script test fails |
| 7 | Publish failure digest: `if: always()`, `continue-on-error: true`, env `CI_DIGEST_TOKEN: ${{ secrets.CI_DIGEST_TOKEN }}`, `GITHUB_TOKEN: ${{ github.token }}`, `CI_DIGEST_JOB_STATUS: ${{ job.status }}`, running `node scripts/ci-failure-digest.mjs` | **never** (FR-009) |

## Invariants (checked by `check-ci-digest-coverage.mjs`)

Every job in every `.forgejo/workflows/*.yml` must meet one of these:
- it has step 7's shape: it runs the digest script, has the always-run guard and the continue-on-error guard, and wires the job status. Also, every other `run:` step goes through `scripts/ci-log-step.sh`, or carries `# ci-log-step-exempt: <reason>`;
- it carries `# ci-digest-exempt: <non-empty reason>`.

## Status context

- **Expected:** `guardrails / guardrails (pull_request)`.
- **Authoritative:** the string the first run shows, recorded in `docs/runbooks/ci.md`.
- **Use:** branch protection on `main` requires it.

## Secrets and variables

| Name | Kind | Scopes | Needed by |
| --- | --- | --- | --- |
| `CI_DIGEST_TOKEN` | repository Actions secret | `write:issue`, `write:package`, `read:repository` | step 7 only |

No repository variables are needed.
