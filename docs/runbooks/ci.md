# CI runbook: guardrails

BELAY's CI is one Forgejo Actions workflow, [`.forgejo/workflows/guardrails.yml`](../../.forgejo/workflows/guardrails.yml). Branch protection on `main` requires it to pass. This runbook covers:
- what the workflow runs;
- how to run the same checks locally;
- how to read a failure;
- the runner and secret it needs;
- how `main` is protected.

## What guardrails runs

**Triggers:**
- every pull request;
- every push to `main`;
- manual dispatch ("Run workflow" in the Actions tab).

A push to a branch with an open PR runs once, through the `pull_request` event. A newer run for the same ref cancels an older one.

**Steps.** One job, `guardrails`, runs:

1. Checkout.
2. Node 26.13.1, through `actions/setup-node`.
3. pnpm at exactly `package.json` `packageManager`, through `scripts/install-pnpm.sh`.
4. `pnpm install --frozen-lockfile`.
5. `pnpm nx run scripts:lint`:
   - the Spec Kit override gate, with its selftest;
   - the digest-coverage gate, with its selftest;
   - the secret-scan, redactor and digest selftests.
6. `pnpm nx run scripts:test`, which runs every `scripts/__tests__/*.test.mjs`.
7. The failure digest. It always runs and never changes the job's result.

Steps 3 to 6 run through `scripts/ci-log-step.sh`. That script keeps each step's exit code and mirrors its output to the per-step log the digest reads.

## Running it locally

```bash
pnpm install --frozen-lockfile     # once, and after any lockfile change
pnpm nx run scripts:lint           # gates and selftests
pnpm nx run scripts:test           # script unit tests
node scripts/check-speckit-overrides.mjs   # the Spec Kit gate alone; needs no install
```

Use pnpm only. `npm install` and `yarn` are refused by the `preinstall` hook.

## Reading a failure digest

When a guardrails job fails, the digest publishes:
- **On a pull request:** one comment per job that starts `<!-- ci-digest:job=guardrails -->`. It names the failing step and shows a redacted tail of that step's output. A later failure of the same job **edits** this comment rather than adding another.
- **On a push to `main`:** a commit status carrying the same summary.
- **Fuller evidence:** a bundle in the generic package `belay-ci-failures`, at version `<runId>--<job>`. The digest links to it.

To fetch a bundle by hand:

```bash
curl -fsS -H "Authorization: token $FORGE_TOKEN" \
  "http://<tailnet-host>:3000/api/packages/jumbleknot/generic/belay-ci-failures/<runId>--guardrails/bundle.json.gz" \
  | gunzip | less
```

Everything published goes through the fail-closed redactor first (`scripts/ci-digest-redact.mjs`). It rewrites credentials and the forge host, and withholds an excerpt entirely if anything credential-shaped survives. A digest that says **"Excerpt withheld"** means exactly that. Read the job log on the runner instead.

If the digest notes the **degraded channel**, `CI_DIGEST_TOKEN` was unavailable to that run. This happens, for example, on a ref that gets no secrets. The digest then used the run's own token, or printed itself inline in the job log.

## Runner

- **Runner:** `ci-belay`, a **repository** runner registered for BELAY only, under **Settings → Actions → Runners**. It runs on the homelab host as the `ci` user's systemd-user service `forgejo-runner-belay`, from `~/runner-belay`.
- **Label:** jobs use `runs-on: belay`. The runner maps it to `docker://node:26-bookworm`, so a job starts in a Node 26 container. `setup-node` still pins the exact 26.13.1 in the workflow.
- **Why its own runner:** the global `ci-homelab` runner (labels `ubuntu-latest`, `kvm`) is shared with MovieCollectionManager and runs one job at a time. BELAY's first run waited about 36 minutes behind it. The unique `belay` label keeps the two repositories from queuing behind each other.
- **A run stays "Waiting for a runner with the following label: belay":** `ci-belay` is offline. On the host, run `systemctl --user status forgejo-runner-belay` and `journalctl --user -u forgejo-runner-belay -f`. `scripts/__tests__/guardrails-workflow.test.mjs` pins the label, so change it in the same commit as `runs-on`.

To recreate the runner:
1. Go to **Settings → Actions → Runners → Create new runner**, named `ci-belay`, and note the `--uuid` and the secret.
2. On the host, as `ci`, save the secret to `~/runner-belay/runner-token` with mode 600.
3. Run `forgejo-runner daemon --url <forge url> --uuid <uuid> --token-url file:///home/ci/runner-belay/runner-token --label belay:docker://node:26-bookworm` from a systemd-user unit, set up like the global runner in MovieCollectionManager's server-setup runbook.

## Secrets

| Name | Where | Scopes | Used by |
| --- | --- | --- | --- |
| `CI_DIGEST_TOKEN` | Repository **Settings → Actions → Secrets** | `write:issue`, `write:package`, `read:repository` | The failure-digest step only |

No repository variables are needed. If `CI_DIGEST_TOKEN` is missing or empty, the digest falls back to the run token, then to the job log. CI never fails because of it.

On your machine, the PR and backlog scripts (features 002 and 003) read `FORGE_TOKEN` (read-only) and `FORGE_ISSUE_TOKEN` (`write:issue`) from the environment. CI doesn't need them.

## Branch protection for `main`

Do this once, after the first green guardrails run on a pull request. The status check only appears in the list once it has reported.

1. In BELAY, go to **Settings → Branches**, then **Add new rule**. Use rule name or pattern `main`.
2. **Push:** choose **Disable push**, so nobody pushes directly to `main`. Changes go through PRs.
3. **Status checks:** enable **Enable status check**, then add the guardrails context exactly as it appears on the PR's checks: `guardrails / guardrails (pull_request)`. This was recorded from the first green run, on PR #3, on 2026-11-22.
4. Optional: enable **Block merge on outdated branch**, so a PR must include the latest `main` before it merges.
5. **Save rule**.

**Check it worked:**
- `git push origin HEAD:main` from any local commit is refused;
- a PR whose guardrails run failed shows merge blocked.

## Adding a job

Every job in every workflow under `.forgejo/workflows/` must end with the failure-digest step. That step needs `if: always()`, `continue-on-error: true`, and `CI_DIGEST_JOB_STATUS: ${{ job.status }}` in its env, as in `guardrails.yml`. `scripts/check-ci-digest-coverage.mjs` fails `scripts:lint` for any job without it.

Every other `run:` step must go through `scripts/ci-log-step.sh <step-name> <command>`, so a failure reaches the digest with its output.

A job that genuinely can't publish a digest may opt out with a marker line under the job header, above `steps:`, carrying a written reason. A single step that can't be wrapped uses `# ci-log-step-exempt: <reason>` on the line above it.

```yaml
  some-job:
    # ci-digest-exempt: <why this job cannot publish a digest>
    runs-on: ubuntu-latest
```

A blank reason is rejected.
