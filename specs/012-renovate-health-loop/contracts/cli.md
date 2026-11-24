# Contract: the scripts

Exit codes follow the repository convention: `0` pass, `1` a failure, and `2` bad arguments. Every script takes
`--selftest`, which uses injected fixtures only (no network, no git), and exports its pure functions. The forge base
comes from `GITHUB_SERVER_URL`, and the repository from `GITHUB_REPOSITORY`. Neither is ever a literal.

## `scripts/lib/forge-list.mjs` (new)

`listAll(path, { fetch, token, base, pageSize = 50, items })` pages through a listing with `limit` and `page` and
returns every row. With `items` (for example `"workflow_runs"`), the page is an object, the rows are that key, and the
total is the body's `total_count`. It throws `ForgeListError` when:
- the status is not 2xx;
- a page is not of the expected shape;
- the total is missing;
- the rows read differ from it.

## `scripts/check-lockfile-refresh.mjs` (new)

| Invocation | Behaviour |
| --- | --- |
| *(no args)* | Derives the window from `renovate.json`. Reads the `renovate` runs, the window run's `renovate/verdict` status and the lock-file PRs, then prints the verdict line. With `--verdict-out <file>` it also writes data-model.md's `LockfileVerdict` as JSON. Exits `0` when the state is `unaided` or `current`, `1` otherwise. |
| `--now <iso>` | Judges as if it were that time (tests and operator replays). |
| `--selftest` | Proves every verdict state on fixtures, including a window in progress being skipped. |

Exports: `deriveWindow(config, now)`, `judgeLockfile({ window, runs, verdictDescription, prs })`.

## `scripts/renovate-health.mjs` (new)

| Invocation | Behaviour |
| --- | --- |
| *(no args)* | Reads the dashboard, branches, open PRs, protections, statuses and `renovate.json`, plus the lock-file verdict file when given with `--lockfile-verdict <file>`. Builds the report, then posts it on the tracking issue, creating the issue if missing. Exits `0` when posted, `1` when any read or the post failed (research R4). |
| `--dry-run` | Does every read and prints the report, posting nothing. |
| `--check-freshness [--out <file>]` | Computes data-model.md `TrackingIssue.freshness` and writes it to `<file>`. Exits `0`, because the verdict step decides; it exits `1` only on bad arguments. A read failure writes `unknown`. |
| `--selftest` | Proves the classification, problem parsing, blocked-PR detection, the one-line healthy rendering and the freshness threshold, all on fixtures. |

Exports: `parseRepositoryProblems(body)`, `classifyBranch({ inMain, pr })`, `buildReport(facts, now)`,
`judgeFreshness(comments, now)`.

Tokens:
- `GITHUB_TOKEN` for reads;
- `CI_DIGEST_TOKEN` for the comment and for creating the issue (research R2).

## `scripts/reap-merged-branches.mjs` (new)

| Invocation | Behaviour |
| --- | --- |
| *(no args)* | A dry run. Prints `keep <branch> (<reason>)` or `would reap <branch>` for every remote branch, then a summary, and deletes nothing. Exits `0`. |
| `--apply` | Deletes each candidate with `git push --force-with-lease=refs/heads/<b>:<sha> origin :refs/heads/<b>`. Exits `1` if any delete fails. |
| `--selftest` | Proves every keep reason and the fail-closed open-PR read, on fixtures. |

Exports: `decideBranch({ name, sha, date, inMain, openPrHeads, protectedGlobs, now })`.

Token: `GITHUB_TOKEN`, read through the checkout's persisted credentials for the push.

## `scripts/check-renovate-config.mjs` (changed, feature 011)

`judgeRun` appends `; lock file: <result>` to its line. With `--health-freshness <file>`, it also appends
`; health report: <state>`, and a `stale`, `missing` or `unknown` state makes the verdict fail. The result is the `result` of the
`renovate/lock-file-maintenance` entry in Renovate's `branches info extended` record; when absent, it appends
`; lock file: absent`.
