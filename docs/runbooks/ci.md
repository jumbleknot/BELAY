# CI runbook: guardrails

BELAY's required CI is one Forgejo Actions workflow, [`.forgejo/workflows/guardrails.yml`](../../.forgejo/workflows/guardrails.yml). Branch protection on `main` requires it to pass. A second workflow, [`devcontainer-image.yml`](../../.forgejo/workflows/devcontainer-image.yml), publishes the dev-container toolchain image; it is not a merge check (see [below](#the-devcontainer-image-workflow)). This runbook covers:
- what the workflows run;
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
   - the secret-scan, redactor, digest and `ci-status` selftests;
   - the egress allowlist check (`node scripts/gen-egress-policy.mjs --check`), which validates `.devcontainer/egress-allowlist.json`.
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

To read it, use `ci-status` (see "Pull requests and CI status" below):

```bash
node scripts/ci-status.mjs failure --run <runId>          # the digest from the bundle
node scripts/ci-status.mjs failure --run <runId> --full   # every file in the bundle
```

Or fetch it by hand:

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
- **The one exception:** the `devcontainer-image` job runs on the shared host runner (`runs-on: kvm`), because building an image needs a Docker daemon and `ci-belay` deliberately has no host Docker access. That runner has the host's Docker, so **the job must never run pull-request code**: its triggers are push to `main`, manual dispatch and the weekly schedule only. `scripts/__tests__/devcontainer-image-workflow.guard.test.mjs` fails if a `pull_request` or `pull_request_target` trigger is added. It also means an image build can queue behind MovieCollectionManager's jobs on that runner.
- **Why its own runner:** the global `ci-homelab` runner (labels `ubuntu-latest`, `kvm`) is shared with MovieCollectionManager and runs one job at a time. BELAY's first run waited about 36 minutes behind it. The unique `belay` label keeps the two repositories from queuing behind each other.
- **A run stays "Waiting for a runner with the following label: belay":** `ci-belay` is offline. On the host, run `systemctl --user status forgejo-runner-belay` and `journalctl --user -u forgejo-runner-belay -f`. `scripts/__tests__/guardrails-workflow.test.mjs` pins the label, so change it in the same commit as `runs-on`.

To recreate the runner:
1. Go to **Settings → Actions → Runners → Create new runner**, named `ci-belay`, and note the `--uuid` and the secret.
2. On the host, as `ci`, save the secret to `~/runner-belay/runner-token` with mode 600.
3. Run `forgejo-runner daemon --url <forge url> --uuid <uuid> --token-url file:///home/ci/runner-belay/runner-token --label belay:docker://node:26-bookworm` from a systemd-user unit, set up like the global runner in MovieCollectionManager's server-setup runbook.

**Runner security.** Pull-request code runs on this self-hosted runner. The runner registers only a `docker://` label, so every job runs in a fresh container that is removed when the job ends; nothing runs on the host.

The one way out of that container is host Docker access. Pin it off explicitly rather than relying on the default:
- run `./forgejo-runner generate-config > config.yaml`;
- set `container.docker_host: "-"`;
- add `--config /home/ci/runner-belay/config.yaml` to the unit's `ExecStart`.

The repository is private, and Forgejo gives no secrets (`CI_DIGEST_TOKEN`) to fork PRs. If collaborators or fork PRs are ever allowed, require approval before a fork's workflows run.

## The devcontainer-image workflow

[`.forgejo/workflows/devcontainer-image.yml`](../../.forgejo/workflows/devcontainer-image.yml) builds `.devcontainer/toolchain.Dockerfile` and pushes it to the forge's container registry as `belay-devcontainer:<commit sha>`. The dev container then uses it by digest (see [devcontainer.md](devcontainer.md)).

- **Triggers:** a push to `main` (only `main`: `branches: [main]`) that touches an image input (`.devcontainer/toolchain.Dockerfile`, `.devcontainer/Dockerfile`, the workflow itself, `scripts/install-pnpm.sh`, `scripts/devcontainer-image-gate.mjs`) or `package.json`; manual dispatch; and Fridays at 06:00 UTC. Never pull requests (see [Runner](#runner)).
- **The gate:** `scripts/devcontainer-image-gate.mjs` decides `build=true|false`. A `package.json` change builds only when its `packageManager` value moved, because the image installs pnpm at that pin. Anything it cannot establish (no `before` sha, an unreadable diff) builds. Dispatch and the schedule always build.
- **Configuration:** the repository variables `REGISTRY` (the registry host and port), `NS` (the owner) and `REGISTRY_USER`, and the secret `REGISTRY_TOKEN` (`write:package`). A missing one fails the build step with a message naming it.
- **Dispatch on a branch:** `node scripts/forge-pr.mjs dispatch devcontainer-image.yml --ref <branch>`. A dispatched run posts no commit status, so follow it in the Actions tab.
- **The result:** the job writes the digest-pinned reference to the step summary, which this forge cannot read back. Resolve the digest from the registry instead (the recipe is in [devcontainer.md](devcontainer.md)).
- **Failure digest:** the job ends with the standard failure-digest step, like every job here.

## Secrets

| Name | Where | Scopes | Used by |
| --- | --- | --- | --- |
| `CI_DIGEST_TOKEN` | Repository **Settings → Actions → Secrets** | `write:issue`, `write:package`, `read:repository` | The failure-digest step only |
| `REGISTRY_TOKEN` | Repository **Settings → Actions → Secrets** | `write:package` | The `devcontainer-image` push step only |

Guardrails needs no repository variables. If `CI_DIGEST_TOKEN` is missing or empty, the digest falls back to the run token, then to the job log. CI never fails because of it.

The `devcontainer-image` workflow also needs the repository **variables** `REGISTRY`, `NS` and `REGISTRY_USER` (see [above](#the-devcontainer-image-workflow)). They are topology, not secrets, so they live in variables rather than in git.

On your machine, CI doesn't need any of these:
- `scripts/ci-status.mjs` reads with `FORGE_TOKEN`, a read-only token with `read:repository`, `read:issue` and `read:package`.
- `scripts/forge-pr.mjs` writes (open, merge, dispatch) with the git credential stored for `origin`, through `git credential fill`.
- `scripts/backlog.mjs` writes issues with `FORGE_ISSUE_TOKEN` (`write:issue`), and reads with it or falls back to `FORGE_TOKEN` (see [backlog.md](backlog.md)).

None of these ever appear in command output.

## Pull requests and CI status

The whole loop runs from a terminal. Every feature's **Open the PR** task follows it:

```bash
git push origin HEAD:<branch>
node scripts/forge-pr.mjs open --head <branch> --title "<title>" --body-file <file>   # prints the PR number and URL
node scripts/ci-status.mjs watch --pr <n> --timeout 900                              # waits for the verdict
node scripts/forge-pr.mjs merge <n> --expect-head "$(git rev-parse HEAD)"            # merges only what was checked
```

### `ci-status.mjs` (reads, `FORGE_TOKEN`)

| Command | What it does |
| --- | --- |
| `status --sha <sha> \| --pr <n> \| --branch <name> \| --run <id>` | Gives the merge verdict for that commit, against the checks branch protection on `main` requires. `--event push\|pull_request` narrows only what is displayed. |
| `watch <target> [--timeout <s>] [--required-only]` | Polls until the verdict is known. By default it also waits for non-required checks. |
| `failure <target> [--job <name>] [--full]` | Prints the failure digest from `belay-ci-failures`. `--full` prints every file in the bundle. |
| `durations [--job guardrails] [--runs <n>] [--propose]` | Lists per-step timings from recent bundles. |

| Exit | `status` / `watch` | `failure` |
| --- | --- | --- |
| 0 | mergeable | nothing failed |
| 1 | a required check failed | a failure was found and its evidence printed |
| 2 | bad arguments, or `FORGE_TOKEN` missing or lacking a scope (the message names the scope) | same |
| 3 | still waiting (never a failure); `watch` returns it at `--timeout` | — |

### `forge-pr.mjs` (writes, the git credential)

| Command | What it does |
| --- | --- |
| `open --head <branch> --title <t> --body-file <f> [--base main]` | Opens a PR from a pushed branch. A `refs/…` (AGit) head is refused, because its runs get no secrets. |
| `merge <n> --expect-head <full sha>` | Merges only when all three hold: the PR's head is that sha, `ci-status status` says mergeable, and the forge says mergeable. It then deletes the branch and prints the merge sha. |
| `dispatch <workflow.yml> --ref <branch> [--input k=v]` | Starts a `workflow_dispatch` run. That run posts **no** commit status, so follow it in the Actions tab. |

Exit codes: 0 done · 1 refused or failed · 2 bad arguments.

`forge-pr` reads the forge, owner and repository from `git remote get-url origin`, and asks `git credential fill` for that exact scheme and host. If the helper returns no password, it fails at once and names what it asked for.

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
