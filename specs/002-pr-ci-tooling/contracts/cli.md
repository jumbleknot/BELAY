# Contract: PR and CI-status CLIs

Shared rules for all three entry points:
- Arguments go through `scripts/lib/argv-contract.mjs`: an unknown flag exits 2, and `--help` or a bare call prints usage and does nothing.
- Every forge request has a time limit, `CI_HTTP_TIMEOUT_MS`, defaulting to 30 s.
- Credential values never appear in output.

## `node scripts/ci-status.mjs`

```text
status    [--sha <full-sha> | --pr <n> | --branch <name> | --run <id>] [--event push|pull_request]
watch     [--sha … | --pr … | --branch … | --run <id>] [--timeout <seconds>] [--required-only]
failure   [--sha … | --pr … | --branch … | --run <id>] [--job <name>] [--full]
durations [--job <name>] [--runs <n>] [--propose]
--selftest
```

| Exit | Meaning |
| --- | --- |
| 0 | mergeable (`status` / `watch`), or the evidence was printed (`failure` / `durations`) |
| 1 | a required check failed (`status` / `watch`) |
| 2 | bad arguments, or the read credential is missing or lacks scope |
| 3 | still waiting. Never a failure. `watch` returns 3 at `--timeout`. |

- **Credential:** `FORGE_TOKEN`, read-only, from the environment.
- **`--event`** narrows what is displayed only; the verdict always covers every event.
- **`failure`** reads only the `belay-ci-failures` package, through `bundlePackagesFor`.
- **`durations`** defaults to `--job guardrails`.

## `node scripts/forge-pr.mjs`

```text
open      --head <branch> --title <title> --body-file <path> [--base main]
merge     <pr-number> --expect-head <full-40-hex-sha>
dispatch  <workflow.yml> --ref <branch> [--input <key>=<value>]
```

| Exit | Meaning |
| --- | --- |
| 0 | done. `open` prints the number and URL; `merge` prints the merge commit. |
| 1 | refused (an AGit head, head mismatch, CI not green, or not mergeable) or the forge failed |
| 2 | bad arguments: a missing body file, a short sha, or an unknown flag |

- **Credential:** the git credential for `origin`, through `lib/forge-credential.mjs`.
- **`merge`** runs `node scripts/ci-status.mjs status --sha <expect-head>`, which needs `FORGE_TOKEN`.
- **`dispatch`** starts a `workflow_dispatch` run, which posts no commit status. Read the run from the Actions API, not with `ci-status`.

## `scripts/lib/forge-credential.mjs` (module)

| Export | Contract |
| --- | --- |
| `parseOrigin(origin)` | Takes an `http(s)://host[:port]/owner/repo(.git)` URL and returns the scheme, host, owner, repo and API base. Anything else, including scp-style SSH, throws `ForgeCredentialError`. |
| `credentialQuery({ scheme, host })` | Builds the `git credential fill` input from origin's own scheme and host. They are never typed by hand. |
| `readOrigin()` | `git remote get-url origin`. |
| `forgeWriteToken({ origin, fill })` | Runs `git credential fill` with `GIT_TERMINAL_PROMPT=0` and returns the password. An empty password throws `ForgeCredentialError`, naming the scheme and host. `fill` can be injected for tests. |
| `ForgeCredentialError` | The error class for all of the above. |

## `scripts/ci-failure-digest.mjs`: added exports (R1)

| Export | Contract |
| --- | --- |
| `bundlePackageFor(repo)` | `<repo, trimmed and lowercased>-ci-failures`. An empty or missing repo throws. |
| `bundlePackagesFor(repo)` | `[bundlePackageFor(repo)]`. No legacy shared name. |
| `isEvidencePackage(name)` | True for any `*-ci-failures` package. |
| `bundleRefFor(pkg, version)` | `` `${pkg}:${version}` `` |
| `bundlePackage(env)` | Unchanged behaviour: `bundlePackageFor(repoSlug(env))`. |

## Tasks-template override: the "Open the PR" task

The task body names, in this order:
1. `git push origin HEAD:<branch>`
2. `node scripts/forge-pr.mjs open --head <branch> --title "…" --body-file <file>`
3. `node scripts/ci-status.mjs watch --pr <n>`, until it exits 0
4. `node scripts/forge-pr.mjs merge <n> --expect-head <full sha>`

Then: tick the task in the branch's last commit, and put CI evidence in the PR's closing comment only.
