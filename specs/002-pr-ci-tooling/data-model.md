# Data Model: PR and CI-Status Tooling (002)

There's no database. These are the records the CLIs read and act on.

## Target

What a question is about. Exactly one of these is given per call.

| Field | Rule |
| --- | --- |
| `sha` | A full 40-hex commit id. A short id exits 2. |
| `pr` | A PR number. It resolves to the PR's head commit, and its `base.ref` sets the protection rule. |
| `branch` | A branch name. It resolves to the branch tip. |
| `run` | A CI run id. It resolves to the commit that run was for. |

With no selector, `status` and `watch` exit 2 and print usage.

## Required check

| Field | Rule |
| --- | --- |
| source | `status_check_contexts` of the branch-protection rule matching the base branch (`GET /repos/{owner}/{repo}/branch_protections`). |
| fallback | `REQUIRED_CONTEXT_GLOBS = ['guardrails / guardrails*']`, used only when protection can't be read. |
| matching | A glob is matched against the context without its `(event)` suffix. |

## Verdict

| Value | Exit | Meaning |
| --- | --- | --- |
| mergeable | 0 | Every required check's latest status is success. |
| failed | 1 | Some required check's latest status is failure or error. Those checks are named. |
| waiting | 3 | No required check has failed, but some haven't reported. Never reported as a failure. |
| (bad input or auth) | 2 | Arguments couldn't be parsed, or the read credential is missing or lacks scope. The message names the scope. |

**Precedence:** a failure anywhere wins over waiting. Cancelled runs are "superseded", not failures. Skipped checks are "skipped".

## Merge preconditions

`forge-pr merge <n> --expect-head <sha>` merges only when all three hold, checked in this order:

1. **Head:** the PR's head sha equals `<sha>`, a full 40-hex id. Otherwise it refuses, naming both commits.
2. **CI:** `ci-status status --sha <sha>` exits 0. Otherwise it refuses with the verdict.
3. **Forge:** the forge reports the PR mergeable. Otherwise it refuses with the forge's reason, such as an outdated branch or a conflict.

It then merges with `head_commit_id = <sha>`, deletes the branch and prints the merge commit. Exits: 0 merged, 1 refused or failed, 2 bad arguments.

## Evidence bundle

Feature 001's digest evidence, read by `failure` and `durations`.

| Field | Rule |
| --- | --- |
| package | `bundlePackageFor(repo)`, which is `belay-ci-failures`. `bundlePackagesFor(repo)` is exactly `[belay-ci-failures]`. There's no legacy shared name. |
| version | `bundleVersion(runId, job)`, which is `{runId}--{jobSlug}`. |
| files | `bundle.json.gz` (summary or full) and `step-durations.tsv` (`DURATIONS_FILE`). |
| listing | `GET {base}/packages/{owner}?type=generic&q={package}`, paged. Results are filtered on the **exact** package name, because `q` is a substring search. |

## Write credential

| Field | Rule |
| --- | --- |
| source | `git credential fill` with `protocol` and `host` taken as written from `git remote get-url origin`. Only `http://` and `https://` origins are accepted. |
| use | An Authorization header for open, merge and dispatch only. It never goes into argv, stdout, logs or files. |
| empty password | Fails immediately, naming the protocol and host that were asked for. |

## Pull request (open)

| Field | Rule |
| --- | --- |
| head | A real branch name. A `refs/…` (AGit) head is refused. |
| base | Defaults to `main`. |
| title | Required. |
| body | Read from `--body-file`. A missing file exits 2 before any request. |
| output | The PR number and URL. |
