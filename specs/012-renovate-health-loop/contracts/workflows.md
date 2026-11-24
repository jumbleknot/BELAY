# Contract: the workflows

## `.forgejo/workflows/renovate-health.yml` (new)

```yaml
on:
  schedule:
    - cron: '30 8 * * 3'   # Wednesday 08:30 UTC: after the 05:00–06:59 window and its 07:17 security run
  workflow_dispatch:
concurrency: { group: renovate-health, cancel-in-progress: false }
jobs:
  renovate-health:
    runs-on: belay
```

The steps, in order:
1. Checkout, `fetch-depth: 0`. Ancestry checks are wrong on a shallow clone.
2. setup-node 26.13.1, then `install-pnpm.sh`, then `pnpm install --frozen-lockfile`.
3. Self-tests: `check-lockfile-refresh.mjs --selftest` and `renovate-health.mjs --selftest`.
4. The lock-file check, `check-lockfile-refresh.mjs --verdict-out lockfile-verdict.json`, with `GITHUB_TOKEN`.
5. The health report, `renovate-health.mjs --lockfile-verdict lockfile-verdict.json`, with `if: always()`,
   `GITHUB_TOKEN` and `CI_DIGEST_TOKEN`.
6. The failure digest, last.

## `.forgejo/workflows/branch-reaper.yml` (new)

```yaml
on:
  schedule:
    - cron: '30 3 * * *'   # daily 03:30 UTC: clear of the 01:17 security run and the 04:00 image sweep
  workflow_dispatch:
    inputs:
      apply: { type: boolean, default: false }   # a dispatch is a dry run unless asked (FR-009)
concurrency: { group: branch-reaper, cancel-in-progress: false }
jobs:
  branch-reaper:
    runs-on: belay
```

The steps, in order:
1. Checkout, `fetch-depth: 0`, with persisted credentials (the default), because the delete is a `git push`.
2. setup-node 26.13.1, then `install-pnpm.sh`, then `pnpm install --frozen-lockfile`.
3. Self-test: `reap-merged-branches.mjs --selftest`.
4. The reaper, with `GITHUB_TOKEN`. It passes `--apply` on a schedule, or on a dispatch with `apply: true`. The value
   goes through `env:`, never `${{ }}` inside `run:` (Semgrep `run-shell-injection`).
5. The failure digest, last.

## `.forgejo/workflows/renovate.yml` (changed, feature 011)

After the verdict step, a step runs `renovate-health.mjs --check-freshness` with `GITHUB_TOKEN` (research R6). It is
blocking, has no `continue-on-error`, and runs on every bot run.

## Guards (`scripts/__tests__/renovate-health-workflows.guard.test.mjs`)

These assert:
- the triggers: never `pull_request`;
- the crons above;
- `runs-on: belay`;
- `fetch-depth: 0`;
- every self-test step comes before its real step;
- the reaper's apply flag goes through `env`, with dispatch defaulting to false;
- every `run:` goes through `ci-log-step.sh`, and the digest is last;
- no `${{ }}` inside `run:`;
- the freshness step in `renovate.yml`.

The existing `workflow-deps-installed` guard covers the dependency installs. The retention guard requires
`keepNewest` ≥ 200.
