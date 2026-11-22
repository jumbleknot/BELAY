# Research: Guardrails CI (001)

The source for everything here is MovieCollectionManager (MCM) at `E:\Programming\VSCode\MovieCollectionManager`. The user's direction is to reuse MCM's implementation as much as possible and strip only MCM coupling. Each decision below says what is reused verbatim, what changes, and why.

## R1. Workspace toolchain: pnpm + Nx

- **Decision:** add a root `package.json`, `pnpm-workspace.yaml`, `nx.json` and `pnpm-lock.yaml`, modelled on MCM's.

  `package.json`:
  - `"name": "@belay/workspace"` and `"private": true`.
  - `"packageManager": "pnpm@12.21.0"`, MCM's pin.
  - `"engines": { "node": ">=24" }`.
  - `"preinstall": "npx --yes only-allow pnpm"`, kept from MCM.
  - devDependencies: `nx` `24.0.6`, exact, because it is a lockstep group (MCM's version); and `yaml` `^2.9.1`, a range, at the version MCM's lock resolves.

  `nx.json`:
  - `$schema` and `defaultBase: "main"`.
  - `namedInputs.default`, plus a `targetDefaults.test.cache: true` entry.
  - No plugins.

  `pnpm-workspace.yaml`:
  - `packages`: `frontend/*`, `backend/*` and `packages/*`.
  - An `allowBuilds` map with `nx: true`. Every other package that wants an install script is decided explicitly after the first `pnpm install`; pnpm 12 fails the install on an undecided one.
  - MCM's supply-chain notes, cut down to what applies: why `allowBuilds` exists, why overrides live here and not in `package.json`, and why there's no `minimumReleaseAge`.
  - No `overrides` or `minimumReleaseAgeExclude` entries, until a finding needs one.
- **Rationale:**
  - The user decided on 2026-11-22 that BELAY uses pnpm and Nx like MCM.
  - The constitution already requires both ("Package Manager", "Monorepo Build Tool").
  - The constitution's "Dependency Security" principle (v1.0.1, amended 2026-11-22 to MCM's enforced policy) applies:
    - the lock file pins every install;
    - lockstep groups (`nx`, `@nx/*`, `@playwright/test`) are exact;
    - other dependencies may use `^`, so a lock file refresh can pick up an in-range security fix.

    An earlier draft pinned `yaml` exactly. That would have recreated the in-range CVE fix MCM was blocked from for ten days.
  - `engines` is `>=24`, not MCM's `>=22.13`, because the Spec Kit gate's tests rely on Node 24 behaviour and the maintainer's machine runs v24.14.1. CI runs the constitution's Node 26 (R3).
  - `frontend/*` and `backend/*` are listed because the constitution requires the workspace file to cover every frontend and backend package directory. Empty globs are harmless.
- **Alternatives considered:**
  - Copy MCM's Nx plugins (Rust, Expo, Playwright). Rejected: those plugins serve apps BELAY doesn't have, and add install weight and supply-chain surface.
  - Use the Nx `installation` block, MCM's `nx`/`nx.bat` wrapper. Rejected: BELAY has a `package.json`, so `pnpm nx` is enough.
  - Copy `.npmrc`. Rejected: MCM's holds only historical comments about Android builds and no settings.

## R2. Running tests and gates through Nx

- **Decision:** add one Nx project, `scripts` (`scripts/project.json`, using `nx:run-commands`, with the repository root as `cwd`). It has two targets:
  - **`lint`:** runs, in order:
    - `node scripts/check-speckit-overrides.mjs --selftest`
    - `node scripts/check-speckit-overrides.mjs`
    - `node scripts/check-ci-digest-coverage.mjs --selftest`
    - `node scripts/check-ci-digest-coverage.mjs`
    - `node scripts/secret-scan.mjs --selftest`
    - `node scripts/ci-digest-redact.mjs --selftest`
    - `node scripts/ci-failure-digest.mjs --selftest`

    Every ported module MCM ships with a selftest proves its detection on each run.
  - **`test`:** runs `node --test "scripts/__tests__/*.test.mjs"`. The glob is quoted so Node expands it, which works on Windows too.

  CI calls `pnpm nx run scripts:lint` and `pnpm nx run scripts:test`.
- **Rationale:** the constitution's "Monorepo Build Tool" rule says all test and lint operations run through Nx targets. MCM runs `node --test …` directly in CI; BELAY follows the constitution here and keeps MCM's commands as the target bodies.
  - The gate scripts can still be run directly with `node`, and the Spec Kit gate needs no install. AGENTS.md says so.
- **Alternatives considered:**
  - Run `node` directly in CI, as MCM does. Rejected: it breaks the constitution, and the user didn't ask to deviate from it.
  - One Nx project per script. Rejected: too fine-grained for repository scripts that share one test folder.
  - This also corrects the spec's assumption "no Nx projects are created". Repository scripts need one project for the constitution's rule. No product projects are created.

## R3. Workflow shape and runner

- **Decision:** `.forgejo/workflows/guardrails.yml`, copied from MCM's `guardrails.yml`:
  - **Triggers and concurrency:** `workflow_dispatch: {}`, `push: branches: [main]`, an unscoped `pull_request:`, and `concurrency: guardrails-${{ github.ref }}` with `cancel-in-progress: true`.
  - **Triggers comment:** MCM's explanation of why `push` is limited to `main`, minus its run and item numbers.
  - **Job:** one job, `guardrails`, with `runs-on: ubuntu-latest` and `timeout-minutes: 10`.
  - **Steps, in order:**
    1. `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7`, MCM's pinned SHA.
    2. `actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7` with `node-version: 26.13.1`, MCM's pinned SHA and the constitution's Node version.
    3. `bash scripts/install-pnpm.sh`.
    4. `pnpm install --frozen-lockfile`.
    5. `bash scripts/ci-log-step.sh guardrails-lint pnpm nx run scripts:lint`.
    6. `bash scripts/ci-log-step.sh guardrails-test pnpm nx run scripts:test`.
    7. MCM's "Publish failure digest" step, verbatim: `if: always()`, `continue-on-error: true`, env `CI_DIGEST_TOKEN`, `GITHUB_TOKEN: ${{ github.token }}` and `CI_DIGEST_JOB_STATUS: ${{ job.status }}`, running `node scripts/ci-failure-digest.mjs`.
  - **Action-light header comment:** MCM's, saying that `uses:` is limited to actions mirrored on the instance's action registry.
- **Rationale:**
  - **`ubuntu-latest`:** this is the label MCM's guardrails use on the same homelab instance, and `ci-homelab` is BELAY's registered runner. The first run confirms it (spec assumption). If the run stays queued, change the label to whatever `ci-homelab` advertises.
  - **setup-node:** MCM's image ships Node 22. BELAY needs 24 or later (spec FR-005), and the constitution pins 26.13.1. MCM already uses this pinned setup-node through the mirrored registry, in its renovate job.
  - **One job:** the checks are fast and share setup. MCM's other jobs belong to issue #1.
- **Status context to require:** Forgejo names commit statuses `<workflow name> / <job name> (<event>)`, so this one should be `guardrails / guardrails (pull_request)`. The CI runbook records the exact string after the first run shows it.
- **Alternatives considered:**
  - The image's Node 22 with no setup-node, which is MCM's guardrails shape. Rejected: it doesn't meet FR-005.
  - Several jobs. Rejected: not needed yet.

## R4. pnpm installer: `scripts/install-pnpm.sh`

- **Decision:** port it verbatim. It reads `packageManager` from `package.json`, runs `npm install --global "$spec"`, then probes `pnpm --version` from a temp dir and fails on a mismatch. Only MCM item-number comments are removed.
- **Rationale:** Node 26 ships without corepack, so MCM bootstraps pnpm this way.
- **Constitution note:** the constitution prohibits npm "for JavaScript/TypeScript projects". This one-off global install of pnpm itself manages no project dependencies, and MCM uses it for the same reason. It's recorded under Complexity Tracking.

## R5. Per-step log capture: `scripts/ci-log-step.sh` (+ test)

- **Decision:** port it verbatim. It keeps `set -o pipefail`, which stops a failing step reporting success through `tee`, and the per-step log directory the digest collects from. Changes:
  - **Log directory:** the MCM-named directory (`$HOME/mcm-ci-step-logs`) becomes `$HOME/<repo>-ci-step-logs` (see R8). The digest reads the same constant.
  - **Comments:** MCM incident stories (TMDB, `mc-service`, `movie-assistant`) come out of the comments.
- **Tests:** port `scripts/__tests__/ci-log-step.test.mjs` (658 lines), changing only the names.

## R6. Secret-scan rules: `scripts/secret-scan.mjs`

- **Decision:** port the module and its `--selftest`. The redactor imports `RULES` and `scanText` from it.
  - **Rules kept:** `anthropic-api-key`, `tmdb-v3-api-key` and `tmdb-v4-token`. These are real vendor credential shapes that could appear in any repo's logs.
  - **Rule removed:** `mcm-dev-credential`, which matches only MCM's generated dev passwords (`Mcm-dev-…`, `McmToken`). Its selftest fixtures are removed with it.
  - **Run as a CI check:** no. That's still issue #1.
- **Rationale:** the user asked to grab MCM's existing rules and reuse them. A rule for MCM's own credential format can't match in BELAY, so it's MCM coupling, not reuse. The spec's FR-021 says so.
- **Alternatives considered:**
  - Keep `mcm-dev-credential`. Rejected: dead and MCM-named.
  - Generalise it into a "dev credential prefix" rule. Rejected: BELAY has no generated dev credentials yet. Add a BELAY rule when it does.

## R7. Redactor: `scripts/ci-digest-redact.mjs` (+ test)

- **Decision:** port it verbatim:
  - global patterns;
  - a fail-closed re-scan of its output, which drops the excerpt if anything survives;
  - forge-host redaction.

  The only change is removing the MCM-specific credential shapes (`mcm_`, `Mcm-dev-`) that pair with the removed rule.
- **Tests:** port `scripts/__tests__/ci-digest-redact.test.mjs` (248 lines), dropping the MCM-credential cases with the rule.

## R8. Failure-digest writer: `scripts/ci-failure-digest.mjs` (+ test)

- **Decision:** port it verbatim. That covers:
  - the publish channels: an upserted PR comment keyed by a start-of-body `<!-- ci-digest:job=… -->` marker, a commit status otherwise, and an evidence bundle in the generic package registry;
  - suppression for cancelled runs;
  - the credential order: `CI_DIGEST_TOKEN`, then the run token (`GITHUB_TOKEN`/`ACTIONS_RUNTIME_TOKEN`), then inline in the job log, marked as the degraded channel;
  - FR-009's swallow-everything behaviour;
  - defanging of forged markers.

  Changes:
  - **Registry package:** MCM publishes evidence bundles to **one generic package, `ci-failures`**, at `/api/packages/{owner}/generic/ci-failures/{runId}--{jobSlug}/bundle.json.gz`. The path is owner-level, with no repo segment. BELAY shares the `jumbleknot` owner, so BELAY's bundles would land in MCM's package. MCM's retention policy and `ci-status` lists would then prune and mix them. BELAY derives the package name instead: `<repo>-ci-failures`, where `<repo>` is the lowercased repository name from `GITHUB_REPOSITORY`, giving `belay-ci-failures`.
  - **Host directories:** `mcm-ci-last-failure` and `mcm-ci-step-logs` are **not** registry packages. They're `$HOME` directories on the runner: the per-step logs (R5), and a last-failure bundle a job may write with an owner stamp. These get the same `<repo>-` derived prefix, so jobs from different repositories on a shared host `$HOME` can't read each other's evidence.
  - **Container-log collection:** in MCM, this is app-ci's failure step on `kvm` host jobs (`docker logs`, health, compose logs), not something the digest does. It's left out because BELAY has no services. The digest's generic step of reading a last-failure bundle is kept, so a future BELAY job can write one.
  - **Comments:** MCM feature and item numbers come out of the comments.
- **Tests:** port `scripts/__tests__/ci-failure-digest.test.mjs` (1,853 lines), changing names and removing the cases for the removed collectors.

## R9. Digest-coverage gate: `scripts/check-ci-digest-coverage.mjs` (+ test)

- **Decision:** port it verbatim, including `import { parse } from 'yaml'`. Its rules:
  - every job in `.forgejo/workflows/*.yml` has a step running `scripts/ci-failure-digest.mjs`;
  - that step has `if: always()` and `continue-on-error: true`;
  - it wires `CI_DIGEST_JOB_STATUS: ${{ job.status }}`;
  - opting out takes `# ci-digest-exempt: <reason>`, and a blank reason is rejected.

  Flags: `--selftest` and `--dir`. Exit codes: 0, 1 and 2. The only changes are removing MCM job names from comments and test fixtures.
- **Tests:** port `scripts/__tests__/check-ci-digest-coverage.test.mjs` (619 lines).

## R10. What stays dependency-free

- **Decision:** `scripts/check-speckit-overrides.mjs` and `scripts/lib/extensions-yml.mjs` stay on Node built-ins.
- **Rationale:** the Spec Kit gate must run before any install, both locally and as the first CI check after an upgrade. The `yaml` dependency is for the digest-coverage gate only.

## R11. Status-context name and branch protection

- **Decision:** the CI runbook gives the steps for Forgejo's repository Settings → Branches → protection rule for `main`:
  - enable it;
  - disable direct push, or restrict it to no one;
  - enable status checks, requiring the guardrails context as the first run actually shows it;
  - require the PR's branch to be up to date if desired.

  This feature also checks once that a direct push is refused.
- **Rationale:** the spec's FR-017 and US4. Protection is switched on by hand, so no admin token is needed.
