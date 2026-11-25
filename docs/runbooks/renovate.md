# The dependency bot (Renovate)

BELAY runs a self-hosted Renovate as `.forgejo/workflows/renovate.yml`, against this repository only, as the
dedicated `belay-renovate` account ([ADR-0004](../decisions/ADR-0004-renovate-dependency-bot.md), feature 011). It
**proposes** updates as pull requests. It never merges: `automerge` is off everywhere, CI judges each bot PR like any
other, and a human merges. Because BELAY is a dependency of other repositories, a merge here is a release to its
consumers.

The design and its measured reasons are in `specs/011-renovate-dependency-bot/research.md` (R1–R13). Most of them
were measured in MovieCollectionManager, which runs the same bot.

## What it does, and when

| When (UTC) | Run | What it may open |
| --- | --- | --- |
| 01:17, 07:17, 13:17, 19:17 every day | the **security channel** | PRs for a dependency with a published advisory and a fixed version (OSV). Labelled `security`. Routine updates defer: these times are outside the window. |
| Wednesday 05:00 | the **routine window** (`* 5-6 * * 3`) | at most **4** new PRs (`prHourlyLimit`), lock files first, then base images, then digest pins, then the rest. At most 6 open at once (`prConcurrentLimit`). |

- **Everything is in UTC**, including `renovate.json`'s `timezone`, so daylight saving cannot move the window off its
  cron. MCM lost four weekly windows that way.
- **Cooling-off**: a release is proposed once it is **3 days** old, or **12 hours** old for a security fix. The worst
  case for a security fix is about 18 hours.
- **Every major** waits for approval on the dashboard. Spec Kit waits for approval on every update.
- **Lockstep groups** move as one PR each: `node toolchain`, `nx`, `rust toolchain`, `uv` and `spec kit`.
  `check-toolchain-consistency.mjs` runs on every bot PR.
- **Lock-file maintenance** refreshes `pnpm-lock.yaml` in the window, so a transitive fix that a range already allows
  actually arrives.

`node scripts/check-renovate-config.mjs` holds all of this to rules C1–C11, in `scripts:test` and `scripts:lint`. An
edit that breaks the window, the limits, a group or a hold fails CI before it merges.

## Reading the dashboard

The bot keeps one issue, **Dependency Dashboard**, labelled `status/bot-managed`. `node scripts/backlog.mjs ready`
never lists it as work.
- **Pending Approval**: majors and Spec Kit updates waiting for a tick.
- **Rate-Limited / Awaiting Schedule**: routine updates waiting for the next window or a free slot.
- **Pending Status Checks**: releases still inside their cooling-off.
- **Repository Problems**: a warning here is a real problem. The expected missing-timestamp message is remapped to
  info, so it does not appear.
- **Detected Dependencies**: what each manager sees. Check here first when a pin seems ignored.

**Ticking a checkbox is the only allowed interaction.** Never edit the issue's text, retitle it, relabel it or close
it: the bot owns it.

## Approving a held major

Tick its box under "Pending Approval". The next run opens the PR. That is the next security cron, within about six
hours, or a dispatch. One tick covers every member of its group. Review the major's breaking changes before merging.

For a **Spec Kit** PR, also run `specify integration upgrade` on the PR's branch before it merges
([spec-kit.md](spec-kit.md)). The raw version bump alone leaves the checked-in scripts behind the CLI.

## Bot pull requests: what not to do

- **Never close a bot PR by hand.** The bot reads a closed PR as "rejected" and never proposes that version again. The
  exception is lock-file maintenance, which is recreated. To stop an update, add a hold (below).
- **Never push to a bot branch.** Tick "rebase" on the dashboard or in the PR instead.
- **Merge with branch deletion.** `forge-pr.mjs merge` deletes the head branch, and the repository deletes merged
  branches by default. A surviving bot branch is reused verbatim and opens an empty PR.
- Bot PRs need the same required checks as any PR, `guardrails` and `sast`, and a human merge.

## Adding a pin

Every pinned version or digest in the tree must be **managed** or **excluded**. Rule C6 fails on anything else, naming
the file and line. The detectors are deliberately broad. They cover:
- action SHAs and `node-version:`;
- `FROM …@sha256:`;
- `package.json`;
- `*_PIN`, `*_VERSION`, `*_TOOLCHAIN` and `*_SHA256` constants in scripts;
- Dockerfile `ARG *_VERSION=`;
- versioned installer URLs;
- `--default-toolchain`;
- `speckit_version`.

- A built-in manager covers workflow actions, `node-version`, Dockerfile `FROM` lines and `package.json` with nothing
  to add.
- **For a constant in a script**, add a `customManagers` entry to `renovate.json`:
  - `customType: regex`;
  - `managerFilePatterns` in the `/regex/` form (never `fileMatch`, which renovate@41+ silently ignores);
  - a `matchStrings` entry with a `currentValue` group;
  - `depNameTemplate` and `datasourceTemplate`.

  C6 checks offline that the manager really captures the pin. A manager that captures nothing also fails.
- **For a pin the bot must not manage**, add an entry to `security/dependencies/unmanaged-pins.yaml`, with `file`,
  `match`, a `reason` of at least 20 characters, and `addedBy`. An entry that matches nothing fails as stale.
- **For a version with a sha256** (a downloaded binary), add a row to `CHECKSUM_PAIRS` in
  `scripts/refresh-pin-checksum.mjs`, a `postUpgradeTasks` rule, and the pin to `RENOVATE_ALLOWED_COMMANDS` in the
  workflow. Rule C8 checks all three.

## Version-and-checksum pairs

Trivy, rustup-init and cargo-audit are pinned by version **and** by the sha256 of their bytes. The bot moves the
version. Its post-upgrade task, `node scripts/refresh-pin-checksum.mjs <pin>`, then:
1. downloads that release;
2. hashes it;
3. writes the hash only if the publisher's own checksum agrees: Trivy's `checksums.txt`, rustup's `.sha256` file, or
   GitHub's release-API digest for cargo-audit.

The `sast` job then runs `refresh-pin-checksum.mjs --verify-changed` on every PR. A pair that disagrees cannot merge.

**The limitation** (research R7): when the post-upgrade task fails, Renovate still opens the PR, carrying an artifact
error. The PR cannot merge, because the required check fails. Do not close it by hand: the next run retries.

**What the agreement proves**: the publisher's checksum and the bytes come from the same origin. That catches a
corrupted or half-served download, not a compromised release. Review the sha256 change in the PR like any other line.

A manual bump is still allowed. Change the version, then run `node scripts/refresh-pin-checksum.mjs <pin>`.

## A base-image re-pin that discharges an allowlist entry

A bot PR that re-pins `node:26-bookworm` changes the digest that the image-scan allowlist entry is keyed to. The entry
then goes `UNMATCHED`, which is the signal ([image-scanning.md](image-scanning.md)). **Before merging that PR**, add to
it:
- the deletion of the matching entry in `security/images/allowlist.yaml`;
- the deletion of the `linux-libc-dev` upgrade layer in `.devcontainer/toolchain.Dockerfile`, if the new base carries
  the fix.

Push those to the bot branch through a normal commit: it is the one edit a bot PR legitimately needs. Then tick
"rebase" if the bot reports a conflict.

## Holds

A hold is a `packageRules` entry that sets `enabled: false`, `allowedVersions` or `ignoreDeps`. Its `description`
must carry `Why:`, a backlog reference (`item #N`) and `Re-check:`. Rule C7 fails a hold that lacks any of the three.
Today's holds:
- **`actions/upload-artifact` below v4**: Forgejo rejects v4 with `GHESNotSupportedError`. Tracked as item #62.
- **`engines.node`**: the toolchain floor, raised by hand. Decided in item #47.
- **`belay-devcontainer`**: the image BELAY builds itself. Decided in item #47.

## Running it by hand

```bash
node scripts/forge-pr.mjs dispatch renovate.yml --ref main            # a DRY RUN: creates nothing
```

- A dispatch **defaults to a dry run**. To dispatch a live run, set `dryRun` to false in the Actions UI, and only with
  the maintainer's go-ahead.
- The forge API shows neither a step's resolved expression nor its log. So the run posts two commit statuses on the
  commit it ran on, readable with `node scripts/ci-status.mjs status --sha <sha>`:
  - **`renovate/mode`**, on a dispatch: `DRY RUN (creates nothing)` or `LIVE`;
  - **`renovate/verdict`**, on every run: `✅ renovate run: done, N PR(s) created; lock file: <result>; health report:
    <state>`, or `❌` and the reason. The lock-file result is Renovate's own, for the lock-file-maintenance branch;
    the weekly health check reads it. The health-report state is the watchdog (see [The health loop](#the-health-loop)),
    and a stale report fails the verdict.
- The log is uploaded as the `renovate-log` artifact for 7 days.

**The verdict is the run's authority, not Renovate's exit code.** The run fails, through the failure digest, when any
of these is true:
- the preflight finds `RENOVATE_TOKEN` empty, or `GET /api/v1/user` refuses it;
- the strict validator rejects `renovate.json`;
- the log has an ERROR;
- a WARN reports a refused lookup or credential (`Failed to look up`, 401/403);
- the repository never finished `done`, `no-work` or `not-scheduled`;
- there is no log at all.

**Validating locally**: `npx --package renovate@<version> -- renovate-config-validator --strict --no-global renovate.json`
installs Renovate's full dependency tree. In an 8 GB dev container that was killed with exit 137 (2026-11-24). The
`sast` job runs it on the runner on every PR, so let CI validate.

## The health loop

The bot is not done until its health loop is (ADR-0004). A bot that silently stops is worse than no bot, because you
believe you are covered. Feature 012 adds three checks, and they and the bot watch each other.

| What | When (UTC) | Proves |
| --- | --- | --- |
| `renovate-health.yml`, step 1: `check-lockfile-refresh.mjs` | Wednesday 08:30 | that a bot run started inside the routine window, and what Renovate said happened to lock-file maintenance in it. It reads **that run's own** `renovate/verdict`, chosen by the status's run link: a later run on an unchanged `main` posts to the same commit, and the newest verdict there is not the window's |
| `renovate-health.yml`, step 2: `renovate-health.mjs` | Wednesday 08:30 | dashboard problems, bot-branch state, blocked bot PRs and the lock-file verdict, posted as **one comment** on the tracking issue |
| the watchdog step in `renovate.yml` (`--check-freshness`) | every bot run | that the newest weekly report is at most 8 days old |
| `branch-reaper.yml` (`reap-merged-branches.mjs`) | daily 03:30 | that no merged, unused branch is left for the bot to reuse |

**The tracking issue** is titled `Dependency-bot health reports` and labelled `status/bot-managed`, so `backlog.mjs
ready` hides it. The job creates it if it is missing, with this description (kept equal to `TRACKING_BODY` in
`scripts/renovate-health.mjs`):

> The dependency bot's weekly health report (feature 012). `.forgejo/workflows/renovate-health.yml` posts one comment
> here every Wednesday after the routine window: one line when healthy, one line per finding otherwise.
>
> **A week with no comment means the health job itself stopped.** The bot's own run checks this, and fails its
> `renovate/verdict` when the newest report is more than 8 days old. See docs/runbooks/renovate.md, "The health loop".
>
> Never close or relabel this issue: it is bot-managed, and `backlog.mjs ready` deliberately hides it.

**Reading a report.** A healthy week is one line:
`✅ <date> healthy: dashboard 0 problems · N bot branches active · M/6 open PRs, none blocked · lock file <state>`.
Otherwise there is a header and one line per finding:

| Finding | What it means | What to do |
| --- | --- | --- |
| `dashboard problem: WARN…/ERROR…` | the bot logged a repository problem, such as a refused lookup or a manager that died | read the dashboard's "Repository problems", and fix the cause (a missing toolchain, a token scope, a registry) |
| `empty: renovate/x (PR #n adds nothing to main)` | a merged bot branch was reused, and the PR is empty | merge-close it the normal way, and check the head branch is deleted (the reaper does this daily) |
| `stale: renovate/x` | a merged bot branch with no PR survives, and the bot will reuse it | let the reaper delete it, or dispatch the reaper with `apply` |
| `unknown ancestry: renovate/x` | git could not say whether it is in `main` | check the job checked out full history |
| `blocked: PR #n … · failing: <checks>` | a bot PR's required checks are red | read its failure digest (`ci-status.mjs failure --pr <n>`), and fix the update or hold it |
| `lock file <state>: …` | the lock-file channel did not deliver in the last window | `no-window-run`: the window cron never ran. `not-scheduled`: the window and the schedule disagree. `starved`: the PR budget ran out first. `forced`: only a dashboard tick produced it. `unknown`: read the line |
| `dashboard not found` | no open `Dependency Dashboard` labelled `status/bot-managed` | check the bot's last run, and never close the dashboard |
| `branch protection unreadable` | blocked PRs could not be judged | check the run token's access to `/branch_protections` |
| `tracking issue was closed` | someone closed the report issue | reopen it: reports still post there |

A **failure comment** (`❌ <date> could not read …`) means the job could not read its inputs. The job is red, and the
comment carries no report marker, so the watchdog does not count it as a report.

**A missing week.** If no report is newer than 8 days, the next bot run's `renovate/verdict` fails with `health report:
stale <N>d`. A tracking issue deleted after reports existed reads `missing`, which fails too. Look at the
`renovate-health` workflow's runs: a schedule that stopped, a failed run, or a missing secret.

**The reaper** deletes a remote branch only when all of these hold:
- it is not `main`, and matches no branch-protection rule;
- it is not the head of an open PR;
- it is merged into `main`;
- it is **not** on `main`'s first-parent history, because a branch just created from `main` would be;
- its tip is at least 6 hours old.

A short or unreadable listing deletes nothing. A scheduled run deletes; a dispatch is a dry run unless `apply` is
ticked.

**Tokens.** The run's own token does every read and the delete, which is a leased `git push`. The one exception is
`/branch_protections`: the run token gets HTTP 403 there (measured 2026-11-24), so both the reaper and the health
report read it with `CI_DIGEST_TOKEN`. Without that secret, the reaper deletes nothing and fails, and the report shows
`branch protection unreadable`.

```bash
node scripts/forge-pr.mjs dispatch branch-reaper.yml --ref main                     # dry run: lists keep / would reap
node scripts/forge-pr.mjs dispatch branch-reaper.yml --ref main --input apply=true  # deletes
node scripts/reap-merged-branches.mjs                                                # the same dry run locally
```

A fast-forward or squash merge is never reaped. That is the safe direction, and BELAY merges with merge commits.

## The bot's version

`RENOVATE_VERSION` in `scripts/check-renovate-config.mjs` is the exact version both workflows run, installed with
`npx --before` three days ago. A custom manager manages it, so the bot proposes its own upgrade. That PR's `sast`
validator step runs the **new** version against `renovate.json` before anything uses it. Also check the new
release's `engines.node` against the workflow's `node-version`. MCM measured a minor release raising it.

## The token

`belay-renovate` is a **restricted** Forgejo user with **Write** access to this repository only. Its token is the
repository Actions secret `RENOVATE_TOKEN`, and it is never in the dev container. Its scopes are `read:user`,
`read:organization`, `write:repository` and `write:issue`. MCM measured that each is needed: a missing one shows as a
403 on that one call, which the verdict reports.

The optional `RENOVATE_GITHUB_COM_TOKEN` is a github.com fine-grained token with public-repository read and no
permissions. It lifts the anonymous 60-requests-an-hour limit on release lookups, which is shared with MCM's bot on
the same runner.

**To rotate the token:**
1. Sign in as `belay-renovate` and go to Settings → Applications.
2. Generate a new token with the same scopes.
3. Replace the `RENOVATE_TOKEN` secret (Settings → Actions → Secrets).
4. Delete the old token.
5. Dispatch a dry run: its preflight proves the new token.

The full first-time setup is in `specs/011-renovate-dependency-bot/quickstart.md` §2.
