# Data Model: Guardrails CI (001)

There's no database. These are the records the feature creates or reads, with their fields and rules.

## Guardrails run

One execution of `.forgejo/workflows/guardrails.yml` for one ref.

| Field | Source | Rule |
| --- | --- | --- |
| event | `pull_request`, `push` (to `main` only), `workflow_dispatch` | A push to a branch with an open PR produces only the `pull_request` run. |
| ref / sha | the forge | Concurrency group `guardrails-<ref>`. A newer run cancels an older one still in progress. |
| job status | `job.status` | `success`, `failure` or `cancelled`. It's passed to the digest as `CI_DIGEST_JOB_STATUS`. |
| status context | the forge, `<workflow> / <job> (<event>)` | The exact string is recorded in `docs/runbooks/ci.md` after the first run. `main`'s protection requires it. |

**States:** queued → running → success | failure | cancelled. A cancelled run publishes no digest.

## Failure digest

The per-job summary published when a job fails.

| Field | Rule |
| --- | --- |
| marker | `<!-- ci-digest:job=<job> -->` at the very start of the body. It's keyed by **job**, not run, so a retry updates the same comment. Marker text inside excerpts is defanged. |
| job, failing step | The step comes from the per-step logs (`$HOME/<repo>-ci-step-logs`). |
| excerpt | A tail-biased excerpt of the failing step's log. It's redacted, and dropped entirely if the post-redaction re-scan finds anything. |
| evidence link | A URL of the evidence bundle in the package registry. |
| channel | A PR comment (upsert) on `pull_request`, otherwise a commit status. Without a token, it's printed inline in the job log and marked as the degraded channel. |

**Upsert rule:** find an existing comment whose trimmed body *starts with* this job's marker, and edit it. Otherwise create one. Never create a second comment for the same job.

## Evidence bundle

| Field | Rule |
| --- | --- |
| package | Generic package `<repo>-ci-failures`, where `<repo>` is the lowercased repository name from `GITHUB_REPOSITORY`. For BELAY, that's `belay-ci-failures`. The version is `{runId}--{jobSlug}` and the file is `bundle.json.gz`, which is MCM's layout. The prefix keeps BELAY's bundles out of MCM's owner-level `ci-failures` package and away from its retention policy. |
| host directories | `$HOME/<repo>-ci-step-logs` holds the per-step logs. `$HOME/<repo>-ci-last-failure` holds an optional job-written bundle, accepted only when its owner stamp matches the current run and job. |
| content | Gzipped, redacted step logs and metadata. |

## Digest exemption

| Field | Rule |
| --- | --- |
| marker | `# ci-digest-exempt: <reason>` on the job. |
| reason | Must be non-empty. A blank reason is a coverage failure. |

## Credential (digest)

The digest tries credentials in this order. All are read from the environment only.

1. `CI_DIGEST_TOKEN` (an Actions secret).
2. `GITHUB_TOKEN`, or `ACTIONS_RUNTIME_TOKEN` (the run token).
3. None: the digest is printed inline in the job log.

An empty string counts as absent.

## Secret-scan rule

| Field | Rule |
| --- | --- |
| name | `anthropic-api-key`, `tmdb-v3-api-key` or `tmdb-v4-token`. |
| pattern | A global regex for each rule. The redactor rewrites every occurrence, then re-scans its output with the detection rules. |

## Workspace

| File | Key fields |
| --- | --- |
| `package.json` | `name: @belay/workspace`, `private: true`, `packageManager: pnpm@12.21.0`, `engines.node: >=24`, `preinstall: npx --yes only-allow pnpm`. devDependencies `nx: 24.0.6` (exact, a lockstep group) and `yaml: ^2.9.1`. |
| `pnpm-workspace.yaml` | `packages: [frontend/*, backend/*, packages/*]`. `allowBuilds` is an explicit true or false for every package with an install script, with `nx: true`. |
| `nx.json` | `defaultBase: main`, no plugins. |
| `scripts/project.json` | Nx project `scripts` with targets `lint` and `test` (see [contracts/script-clis.md](contracts/script-clis.md)). |
