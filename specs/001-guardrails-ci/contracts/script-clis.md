# Contract: script CLIs and Nx targets

**Shared rules:**
- **Exit codes:** 0 means clean or selftest passed. 1 means a finding, or a broken selftest. 2 means bad arguments or unparseable input.
- **Unknown flags:** exit with 2. Arguments go through `scripts/lib/argv-contract.mjs` where MovieCollectionManager (MCM) does so.
- **Tokens:** read from the environment only.

## Nx project `scripts` (`scripts/project.json`)

| Target | Runs (in order, stop on first failure) |
| --- | --- |
| `pnpm nx run scripts:lint` | 1. `node scripts/check-speckit-overrides.mjs --selftest`<br>2. `node scripts/check-speckit-overrides.mjs`<br>3. `node scripts/check-ci-digest-coverage.mjs --selftest`<br>4. `node scripts/check-ci-digest-coverage.mjs`<br>5. `node scripts/secret-scan.mjs --selftest`<br>6. `node scripts/ci-digest-redact.mjs --selftest`<br>7. `node scripts/ci-failure-digest.mjs --selftest` |
| `pnpm nx run scripts:test` | `node --test "scripts/__tests__/*.test.mjs"` (Node expands the quoted glob, so it works on every OS) |

The commands in both targets also work when run directly with `node`. `check-speckit-overrides.mjs` needs no `pnpm install`.

## `scripts/install-pnpm.sh [manifest]`

- **Input:** `manifest` defaults to `package.json`, and its `packageManager` must be `pnpm@<version>`.
- **What it does:** installs that pnpm version globally.
- **Exit codes:**
  - 2: no manifest, or a bad `packageManager`;
  - 1: `pnpm --version`, run from a temp dir, doesn't equal the pin;
  - 0: otherwise.

## `scripts/ci-log-step.sh <log-name> <command> [args…]`

- **What it does:** runs the command, and mirrors its combined output both to the console and to `$HOME/<repo>-ci-step-logs/<log-name>.log`. This is the directory `ci-failure-digest.mjs` collects from.
- **Exit status:** exits with **the command's** exit status (`set -o pipefail`).
- **Bad usage:** exits 2.

## `scripts/secret-scan.mjs`

- **Exports:** `RULES` (`[{name, re}]`, with `anthropic-api-key`, `tmdb-v3-api-key` and `tmdb-v4-token`) and `scanText(text)`. The redactor uses both.
- **`--selftest`:** proves each rule detects its planted sample.
- **As a CLI scan:** ported with the module, but **not wired into CI**. Running it as a CI check is issue #1.

## `scripts/ci-digest-redact.mjs`

- **Exports:** `redactExcerpt` and `redactForPublication`.
  - Every credential-shaped string, and the forge host, is rewritten.
  - The output is re-scanned. Anything surviving drops the excerpt.
- **`--selftest`:** proves the global rewrite and the fail-closed drop.

## `scripts/ci-failure-digest.mjs [--selftest | --help]`

- **Env in:**
  - `CI_DIGEST_TOKEN`, then `GITHUB_TOKEN` / `ACTIONS_RUNTIME_TOKEN`;
  - `CI_DIGEST_JOB_STATUS`;
  - the standard `GITHUB_*` run context (`GITHUB_REPOSITORY`, `GITHUB_SHA`, `GITHUB_EVENT_NAME`, `GITHUB_SERVER_URL`, `GITHUB_RUN_ID`, the event payload).
- **What it publishes:** described in [data-model.md](../data-model.md) under "Failure digest" and "Evidence bundle".
- **Exit status:** **always 0** in digest mode. Errors are logged and swallowed.
- **`--selftest`:** exits 0 or 1.

## `scripts/check-ci-digest-coverage.mjs [--selftest] [--dir <workflows-dir>]`

- **Default `--dir`:** `.forgejo/workflows`.
- **Exit codes:**
  - 1: a job lacks a correctly guarded digest step, or has a blank exemption reason; the message names the file and the job;
  - 2: a workflow it can't parse, or bad arguments.
