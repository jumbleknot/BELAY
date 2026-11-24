# Research: the dependency bot's health loop

The sources are:
- MovieCollectionManager's (MCM's) `scripts/renovate-health.mjs`, `scripts/check-lockfile-refresh.mjs` and
  `scripts/reap-merged-branches.mjs`, and their workflows, read through the forge API on 2026-11-24. "Measured" means
  MCM measured it.
- BELAY's feature 011, merged as `08ce00b`.
- The first dry-run log of BELAY's bot (run #83).

## R1 — Three scripts, two workflows

**Decision**:
- `scripts/renovate-health.mjs`: the weekly report (US1).
- `scripts/check-lockfile-refresh.mjs`: the lock-file check (US2).
- `scripts/reap-merged-branches.mjs`: the reaper (US3).
- `scripts/lib/forge-list.mjs`: shared paginated forge reads (FR-013).

Two workflows on the `belay` runner:
- **`renovate-health.yml`** runs **Wednesday 08:30 UTC**, plus dispatch. It has one job:
  1. the lock-file check, which writes its verdict to a file and fails the step on a miss;
  2. then, with `always()`, the health report, which includes the lock-file verdict as one of its lines.

  So a week produces one comment, and a lock-file miss also turns the job red.
- **`branch-reaper.yml`** runs **daily at 03:30 UTC**, plus dispatch. Dispatch defaults to a dry run.

**Rationale**:
- The routine window is Wednesday 05:00–06:59 UTC, and its 07:17 security run takes minutes. So 08:30 reads
  settled state. MCM measured that a check reading state before the run it checks is wrong.
- 03:30 is clear of the 01:17 security run and the Tuesday and Friday 04:00 image sweep.
- One report issue per week keeps "silence is the alarm" readable. MCM split its checks across two issues (#218 and
  #311), so a reader had to check both.

**Alternatives**:
- Three workflows, MCM's shape. That adds one more job to the retention floor and one more silent thing.
- Running the reaper on every push to `main` (MCM's shape). The 6-hour grace period makes a push-time run reap
  nothing that the next daily run wouldn't, so it only adds runner load.

## R2 — Tokens: the run token reads and deletes, `CI_DIGEST_TOKEN` writes the report

**Decision**:
- **Reads** (branches, PRs, statuses, Actions runs) use `GITHUB_TOKEN`, the run's own token. **Branch protections are
  the exception.** The run token is refused on `/branch_protections` (HTTP 403, measured 2026-11-24 on the first
  post-merge runs, #94 and #95), so that one read uses `CI_DIGEST_TOKEN` (the owner's `read:repository`). Planning had
  assumed the run token could read it, and only the live run showed otherwise.
- **Branch deletion** uses `git push --force-with-lease=refs/heads/<b>:<sha> origin :refs/heads/<b>`, with the
  checkout's persisted run token. This is MCM's measured mechanism. The lease ties the delete to the sha that was
  classified, which the forge's DELETE endpoint cannot do.
- **The report comment, and creating the tracking issue,** use `CI_DIGEST_TOKEN` (`write:issue`). That widens the
  secret's documented use from "the failure-digest step only" to "the failure digest and the health report", which the
  secrets page and the CI runbook record.

**Rationale**:
- No new secret is needed.
- The run token cannot push to protected `main`. MCM chose it deliberately for that reason, so a reaper bug cannot
  touch `main` even in theory.
- `CI_DIGEST_TOKEN` already holds `write:issue` for the same reason: CI posting a readable record.

**Alternatives**:
- The bot's `RENOVATE_TOKEN`. That widens the bot's credential to jobs that are not the bot, so rejected.
- A new token, as one more secret to rotate. Rejected.

## R3 — The lock-file check: did the window run, and what happened to lock-file maintenance

**Decision**: the check uses two sources of evidence, both tied to the **most recent fully passed window**. It derives
the window from `renovate.json` (`lockFileMaintenance.schedule`, else `schedule`, always in UTC; rule C2 enforces UTC)
with `cronMinutes` from `check-renovate-config.mjs`. The window's copy never lives anywhere else.

1. **The window run.** It finds the `renovate` workflow runs that started inside the window: the Actions tasks
   listing, filtered client-side by `name === "renovate"` and **`run_started_at`**. `created_at` is the queue time.
   Both were measured on 2026-11-24. That endpoint returns `{ workflow_runs, total_count }` with **no `x-total-count`
   header**, so `listAll` reads it with `items: "workflow_runs"` (R8). With none, it **fails**: "the window run never happened". That catches
   the window-never-meets-cron failure, MCM's worst, directly.
2. **The lock-file result.** Feature 011's verdict step now appends the lock-file-maintenance branch's result, taken
   from Renovate's own `branches info extended` record, to the `renovate/verdict` description. For example:
   `✅ renovate run: done, 3 PR(s) created; lock file: pr-created`. The check reads that status on the window run's
   commit.

| Lock-file result in the window run | A lock-file PR created or updated in the window | Verdict |
| --- | --- | --- |
| `pr-created`, `pr-updated`, `already-existed`, `done` | yes | **pass**, unaided |
| `no-work` (nothing to refresh) | (none expected) | **pass**: the lock file was already current |
| `not-scheduled` | no | **fail**: the window run did not consider itself in the window |
| `pr-limit-reached`, `branch-limit-reached` | no | **fail**: the budget starved it (MCM measured this) |
| anything else, or no `lock file:` part | no | **fail**, naming what was seen |
| (no window run) | (any) | **fail**: the window run never happened |
| (any) | only one created *outside* the window | **fail**, reported as forced |

**The result decides, and a PR is needed only for the results that produce one.** Every combination the table does
 not list is `unknown`, which fails, naming both values:
- `pr-created` or `pr-updated` with no lock-file PR found inside the window;
- `no-work` combined with a PR created outside the window. The window is what is judged, so this is `current` and
  passes, and the report also names the forced PR.

**Rationale**:
- MCM's check judged only PR creation times. It reported "STILL_STARVED" as a comment and never failed, and it could
  not tell an already-current lock file from a dead channel. BELAY's spec requires the job to fail (FR-007), and
  failing on a weekly no-op would be noise.
- The bot's own result settles it. Renovate decides the result, and the verdict step already reads that log.
- The status lives on the window run's commit, so the check needs no log download (the forge API has no artifact
  endpoint).

**Alternatives**:
- Downloading the run's log artifact. Not readable through this forge's API (measured 2026-11-24).
- PR timestamps alone, MCM's way. Ambiguous on a no-op week, as above.

**Measured, from MCM**:
- A merged lock-file PR's head becomes `refs/pull/N/head`, so a PR is matched by its title
  (`/lock file maintenance/i`) as well as its head ref.
- `?trigger_event=` is silently ignored, so filtering is client-side.
- A scheduled run reports `event="push"`; the trigger is in `trigger_event`.

## R4 — The health report: what it reads, how it classifies

**Decision**:
- **Dashboard**: the open issue labelled `status/bot-managed` whose title is `Dependency Dashboard`. It is found by
  label, never by a hard-coded number: MCM hard-coded #29. Its "Repository problems" section is parsed with MCM's rule:
  - the heading regex `^##\s+Repository problems\s*$`, case-insensitive, up to the next `## `;
  - keep the lines containing `WARN` or `ERROR`;
  - no dashboard found is a **finding**, never "healthy".
- **Branches**: every `renovate/*` branch, from the paginated branch listing. It is classified with
  `git merge-base --is-ancestor origin/<b> origin/main` on a full-history checkout (`fetch-depth: 0`), using MCM's
  measured rules from spec FR-004:
  - active: not an ancestor;
  - empty: an ancestor, with an open PR;
  - stale: an ancestor, with no PR;
  - unknown: the exit code is not 0 or 1.
- **Blocked PRs** (FR-004a): for each open bot PR, the head commit's statuses are judged with `ci-status.mjs`'s
  `computeMergeVerdict`, against `parseRequiredGlobs` of the `main` protection. Failing required contexts are listed.
  If protection cannot be read, that is a finding (MCM measured this). This exists because MCM's report said "Healthy"
  while two bot PRs were red (MCM item #485).
- **Budget**: open bot PRs against `renovate.json`'s `prConcurrentLimit`, as an information line.
- **The lock-file verdict** from R3, as one line.

The report is:
- **healthy** (FR-002, one line): `✅ <date> healthy: dashboard 0 problems · N bot branches active · M/6 open PRs, none blocked · lock file <verdict>`;
- **otherwise**: a header line plus one line per finding.

**Exit codes**:
- `0` when it posted, whatever the findings: findings are reported, not failures;
- `1` when any read failed, or the post was refused (FR-005). It never posts "healthy" from partial data. When a read
  fails, it posts a failure comment, `❌ <date> could not read <what>`, **without** the report marker, so the
  tracking issue records the failure and the watchdog still counts only real reports.

**Rationale**: MCM's version always exits 0, even on errors, so a broken report job was silent. That is exactly the
thing this feature exists to end.

## R5 — The tracking issue

**Decision**:
- The issue is titled `Dependency-bot health reports` and labelled `status/bot-managed`, so `backlog.mjs ready` skips
  it.
- It is found by label and title. If missing, it is created; its description says that a week without a comment
  means the job died, and points to the runbook.
- A **closed** tracking issue still gets the comment, and the report says it was closed. MCM treated a closed issue as
  a kill switch, which made silence a legitimate state.

## R6 — Noticing the silence: a watchdog in the bot's own run (SC-001)

**Decision**: feature 011's `renovate.yml` gains one step after the verdict,
`renovate-health.mjs --check-freshness`. It reads the tracking issue's newest comment and fails the bot's run when
that comment is **older than 8 days**. The step reports this through the failure digest; it does not hide it under
`continue-on-error`.

Before the first report exists (no tracking issue, or no comments yet), it passes, saying "no report yet". **Except**:
when the tracking issue is missing but a `renovate-health` run has already succeeded (the Actions tasks listing), the
issue was deleted after reports existed. That is a failure, not a bootstrap.

**Placement (one record tells the truth)**: the watchdog runs **before** the verdict step. It writes its state to a
file, which `--run-verdict --health-freshness <file>` reads. The verdict line gains `; health report: <state>`, and a
`stale` or `unknown` state fails the verdict. So `renovate/verdict` and the job always agree.

**Rationale**: "silence is the alarm" needs a listener. Nothing else in BELAY reads the tracking issue on a schedule.
The bot runs four times a day on an independent schedule, so the two loops watch each other:
- the health job checks the bot's lock-file channel;
- the bot checks that the health job still reports.

It costs one API call.

**Alternatives**:
- Relying on a human or an agent reading the issue: the measured way these failures lasted weeks.
- A third workflow just for freshness: one more silent thing.

## R7 — The reaper's rules

**Decision**: MCM's measured rules, plus branch protection. A branch is deleted only when **all** of these hold:
1. It is not `main`, and it matches no branch-protection rule (`rule_name` globs, read from `/branch_protections`). An
   unreadable protection listing means nothing is deleted.
2. It is not the head of any open PR. The open-PR listing is read to its end, and a short or malformed read deletes
   nothing (FR-013).
3. `git merge-base --is-ancestor` says its head is in `origin/main`. An unanswerable ancestry means keep.
4. Its head is **not on `main`'s first-parent history**: `git rev-list --first-parent origin/main` does not contain
   it. A branch created from `main` with no commits of its own points at a first-parent commit, so it is
   `unstarted` and kept. A branch merged through a merge commit has its tip as a second parent, so it is not on the
   first-parent history and can be reaped. MCM's rules miss this: a branch created today from a `main` commit that is
   days old passes their age check at once.
5. Its tip commit is at least **6 hours** old (MCM's `GRACE_MS`), as a second guard.

**Known limitation**: a branch merged by fast-forward or squash is never reaped. Its tip is on the first-parent
history, or not in `main` at all. That is the safe direction: BELAY merges with merge commits, and the merge tool
deletes the head branch anyway.

- The default is a dry run. `--apply` deletes, and the scheduled workflow passes it.
- Every keep and every reap is printed with its reason.
- A failed delete exits 1, so the job goes red.

**Rationale**: every rule maps to an incident or an edge case in the spec. Protection rules are an addition to MCM:
BELAY's protection set may grow, and the reaper should honour it without an edit. There is no special exemption for
`renovate/lock-file-maintenance`: a merged one is exactly the branch that reopened as an empty PR in MCM (#874–#877).

## R8 — The shared list reader (FR-013)

**Decision**: `scripts/lib/forge-list.mjs` exports
`listAll(path, { fetch, token, base, pageSize = 50, items })`. With `items` (for example `"workflow_runs"`) the page
is an object, the rows are that key, and the total is the body's `total_count`. Without it, the page is an array and
the total is `x-total-count`. It:
- pages with `limit` and `page`, since `?limit=` alone is ignored on this forge (measured by MCM);
- reads `x-total-count`;
- **throws** when the rows read differ from the total, or a page is not an array.

All three scripts use it.

**Rationale**: `backlog.mjs` and `ci-status.mjs` each have their own client, and making either one shared would touch
two working tools. A small library with one job is easier to prove.

## R9 — CI rules and the retention floor

**Decision**:
- Both workflows follow the repository's CI rules: `belay` runner, setup-node 26.13.1, `install-pnpm.sh` and
  `pnpm install --frozen-lockfile` (the scripts import `yaml` and `ci-status.mjs`). Every `run:` goes through
  `ci-log-step.sh`, and the failure digest runs last.
- Each script's `--selftest` runs as a workflow step before the real check (backlog item #48's acceptance criterion),
  and also in `scripts:lint`.
- Two new bundle-publishing jobs raise the evidence floor from 25 × 6 = 150 to 25 × 8 = **200**.
- The workflow guards assert the triggers (never `pull_request`), the runner, `fetch-depth: 0` where ancestry is read,
  and the step order.
