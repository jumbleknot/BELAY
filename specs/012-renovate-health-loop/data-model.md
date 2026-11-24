# Data model: the dependency bot's health loop

Nothing is stored except the tracking issue's comments. The entities below are computed per run from the forge, git and
`renovate.json`. The field constraints are what the scripts and their tests hold.

## Window

The most recent routine window that has fully passed.

| Field | Constraint |
| --- | --- |
| `Window.schedule` | `renovate.json` `lockFileMaintenance.schedule`, else `schedule`. Five-field crons, in UTC (rule C2). Required. |
| `Window.start`, `Window.end` | ISO timestamps. The start of the most recent contiguous run of matching minutes that ends at or before *now*, and its last minute + 1. `end ≤ now`. A window in progress is never chosen. |

## Lock-file verdict

| Field | Constraint |
| --- | --- |
| `LockfileVerdict.state` | One of `unaided`, `current`, `forced`, `not-scheduled`, `starved`, `no-window-run`, `unknown`. `unaided` and `current` pass; all others fail (research R3). |
| `LockfileVerdict.windowRun` | The run number and head sha of the `renovate` run started inside the window, or null (then the state is `no-window-run`). |
| `LockfileVerdict.result` | The `lock file: <result>` value parsed from that run's `renovate/verdict` description, or null. |
| `LockfileVerdict.pr` | The lock-file-maintenance PR number, its `created_at`/`updated_at`, and whether either falls inside the window. A PR matches by head `^renovate/lock-file-maintenance` **or** title `/lock file maintenance/i`. |
| `LockfileVerdict.line` | One line for the report, always naming the window. |

## Bot branch

| Field | Constraint |
| --- | --- |
| `BotBranch.name` | Starts with `renovate/`. Required. |
| `BotBranch.sha` | The head sha from the branch listing. |
| `BotBranch.inMain` | `true`, `false` or `null`, from `git merge-base --is-ancestor`: exit 0 or 1, otherwise null. |
| `BotBranch.pr` | The open PR whose head is this branch, or null. |
| `BotBranch.class` | `active` (inMain false), `empty` (inMain true with a PR), `stale` (inMain true without a PR), `unknown` (inMain null). Spec FR-004. |

## Blocked PR

| Field | Constraint |
| --- | --- |
| `BlockedPr.number`, `BlockedPr.title` | An open PR whose head starts with `renovate/`. |
| `BlockedPr.failing` | The required contexts that failed, from `computeMergeVerdict(...).blocking`. Non-empty when listed. |

## Dashboard problem

| Field | Constraint |
| --- | --- |
| `DashboardProblem.text` | A line from the dashboard's "Repository problems" section that contains `WARN` or `ERROR`, with any leading `- ` stripped. |

## Health report

One comment per health run.

| Field | Constraint |
| --- | --- |
| `HealthReport.healthy` | `true` exactly when there are no dashboard problems, every branch is `active`, no PR is blocked, the lock-file verdict passes, and the dashboard was found. |
| `HealthReport.body` | When healthy, **one line**: `✅ <YYYY-MM-DD> healthy: dashboard 0 problems · <N> bot branches active · <M>/<limit> open PRs, none blocked · lock file <state>`. Otherwise a header `⚠️ <YYYY-MM-DD> <K> finding(s)`, then one line per finding. |
| `HealthReport.marker` | The first line carries `<!-- renovate-health -->`, so `--check-freshness` finds the newest report among the issue's comments. A failure comment (FR-005) never carries it. |

## Tracking issue

| Field | Constraint |
| --- | --- |
| `TrackingIssue.title` | `Dependency-bot health reports`. |
| `TrackingIssue.label` | `status/bot-managed`. Required: `backlog.mjs ready` excludes it. |
| `TrackingIssue.freshness` | One of `fresh <N>d`, `stale <N>d`, `no-report-yet` or `missing`. It is the age of the newest comment carrying `HealthReport.marker`. More than **8 days** is `stale`. With no such comment, it is `no-report-yet`, which passes. It is `missing`, which fails, when the issue does not exist but a `renovate-health` run has already succeeded. |

## Reap candidate

| Field | Constraint |
| --- | --- |
| `ReapCandidate.name`, `ReapCandidate.sha` | From `git for-each-ref refs/remotes/origin`, after `fetch --prune`. |
| `ReapCandidate.decision` | `reap` only when all five rules of research R7 hold. Otherwise `keep` with one reason: `protected`, `open-pr`, `not-merged`, `ancestry-unknown`, `unstarted` (the head is on `main`'s first-parent history), `too-new` or `no-date`. |
| `ReapCandidate.age` | Now minus the tip commit's committer date. `reap` needs ≥ 6 hours. |
