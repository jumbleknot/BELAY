# Contract: `.forgejo/workflows/renovate.yml` and the guardrails step

## `renovate.yml`

```yaml
on:
  schedule:
    - cron: '17 1,7,13,19 * * *'   # security channel: outside the window (C2), ≤ 24 h worst case (C3)
    - cron: '0 5 * * 3'            # the routine window, Wednesday 05:00 UTC, inside "* 5-6 * * 3"
  workflow_dispatch:
    inputs:
      dryRun: { type: boolean, default: true }   # FR-016
concurrency: { group: renovate, cancel-in-progress: false }
jobs:
  renovate:
    runs-on: belay                 # never kvm: the bot runs no PR code, but holds a write token
    env:
      RENOVATE_DRY_RUN: ${{ (github.event_name == 'workflow_dispatch' && inputs.dryRun) && 'full' || '' }}
```

The steps, in order:
1. `actions/checkout`, pinned by SHA.
2. `actions/setup-node`, 26.13.1. It must come **before** step 3.
3. Install pnpm (`install-pnpm.sh`), through `ci-log-step.sh`.
4. Publish the dispatch mode: a `renovate/mode` commit status. Runs only on dispatch, with `always()` and
   `continue-on-error`.
5. Preflight the credential. It fails by name when `RENOVATE_TOKEN` is empty, or when `GET /api/v1/user` with it is
   not 200. It never prints the token.
6. Validate the config: `renovate-config-validator --strict --no-global renovate.json`, at
   `$(node scripts/check-renovate-config.mjs --print-renovate-version)`, with `npx --before=<now − 3 d>`.
7. Run Renovate with this environment:
   - `RENOVATE_PLATFORM=gitea`
   - `RENOVATE_ENDPOINT=${{ github.server_url }}/api/v1/`
   - `RENOVATE_REPOSITORIES=${{ github.repository }}`
   - `RENOVATE_AUTODISCOVER=false`
   - `RENOVATE_TOKEN`
   - `RENOVATE_GITHUB_COM_TOKEN` (optional)
   - `RENOVATE_DOCKER_MAX_PAGES=10`
   - `RENOVATE_ALLOWED_COMMANDS`, the C8 regex
   - `LOG_FORMAT=json`, `RENOVATE_LOG_FILE`, `RENOVATE_LOG_FILE_LEVEL=debug`
   - `RENOVATE_ONBOARDING=false` and `RENOVATE_REQUIRE_CONFIG=required`: a missing `renovate.json` fails the run, and it
     never opens an onboarding PR
8. The verdict: `check-renovate-config.mjs --run-verdict <log> --publish-verdict`, with `always()`, so a failed run
   still posts `renovate/verdict` (research R11). The step env has `GITHUB_TOKEN: ${{ github.token }}`.
9. Publish the failure digest, last, with `always()`.

No host literal appears: the endpoint comes from `github.server_url`, and the repository from `github.repository`.

## `guardrails.yml`, a new step in the existing `guardrails` job

Placed after the dependency install:
- **Validate renovate.json**: the same validator command as step 6.
- **Verify version-and-checksum pairs**: `node scripts/refresh-pin-checksum.mjs --verify-changed --base
  origin/${{ github.base_ref || 'main' }}`.

Both go through `ci-log-step.sh`. Being in `guardrails`, both are part of the required check. Neither adds a job, so
the retention floor is unaffected by them.

## Guard tests (`scripts/__tests__/renovate-workflow.guard.test.mjs`)

These assert the following against the parsed YAML:
- the triggers: never `pull_request`;
- the crons equal the C2 set;
- `runs-on: belay`;
- setup-node comes before install-pnpm;
- the dispatch default is `true`;
- `RENOVATE_DOCKER_MAX_PAGES` is ≤ 10;
- every `run:` goes through `ci-log-step.sh`, and the failure digest is last;
- no `ANTHROPIC_API_KEY`, and no `*.ts.net` literal;
- the validator and the run use the same version expression;
- the verdict step has `always()` and `--publish-verdict`;
- `RENOVATE_ONBOARDING` is `'false'` and `RENOVATE_REQUIRE_CONFIG` is `required`.
