# Research: PR and CI-Status Tooling (002)

**Source:** MovieCollectionManager (MCM) at `E:\Programming\VSCode\MovieCollectionManager`. The user's direction is to reuse it as much as possible and strip only MCM coupling. Line references below are to MCM's files on 2026-11-22.

| MCM file | Lines | Port to |
| --- | --- | --- |
| `scripts/ci-status.mjs` | 2224 | `scripts/ci-status.mjs` |
| `scripts/forge-pr.mjs` | 309 | `scripts/forge-pr.mjs` |
| `scripts/lib/forge-credential.mjs` | 114 | `scripts/lib/forge-credential.mjs` |
| `scripts/__tests__/ci-status.test.mjs` | 2280 | the same path |
| `scripts/__tests__/forge-pr.test.mjs` | 250 | the same path, including the forge-credential tests at L29–90 |
| `scripts/__tests__/fixtures/ci/*.json` (10), `fixtures/ci-status/*.json` (5) | — | `scripts/__tests__/fixtures/ci/` only. The `ci-status/` fixtures are deploy fixtures and are dropped. |

**R-strip,** as in feature 001, applies to every port:
- remove MCM feature and item numbers, run numbers and incident stories from comments and test titles (`(#1072)` becomes a descriptive prefix);
- remove FR tags from identifiers;
- keep all behaviour.

**Neutral names:** MCM job, workflow and service names in test data become neutral ones, using the same mapping as feature 001's `neutral_names.py` (`app-ci` → `ci`, `app-e2e` → `e2e`, `dast` → `scan`, `mc-service-checks` → `api-checks`, and so on). The mapping is applied to the tests and fixtures together, so assertions still line up.

## R1. Align the digest's package naming with MCM (prerequisite)

- **Finding:** MCM shipped repo-scoped evidence packages as its feature 106 (`04673404`). Its `ci-failure-digest.mjs` exports:
  - `bundlePackageFor(repo)`, giving `<repo>-ci-failures`. It throws when no repository name is given.
  - `bundlePackagesFor(repo)`, giving `[bundlePackageFor(repo), LEGACY_BUNDLE_PACKAGE]`.
  - `isEvidencePackage`.
  - `bundleRefFor`.

  `ci-status.mjs` imports `bundlePackageFor` and `bundlePackagesFor`. BELAY's port from feature 001 exposes `bundlePackage(env)` instead, so `ci-status` would not load.
- **Decision:**
  - Add MCM's `bundlePackageFor(repo)`, `bundleRefFor` and `isEvidencePackage` to BELAY's `scripts/ci-failure-digest.mjs`, with the same bodies as MCM.
  - Define `bundlePackagesFor(repo)` as `[bundlePackageFor(repo)]`, with no legacy entry. BELAY never published to the shared `ci-failures` name, and reading it would pull in MCM's evidence. That's spec FR-004.
  - Keep `bundlePackage(env)` as a thin wrapper, `bundlePackageFor(repoSlug(env))`, so feature 001's call sites and tests keep working.
  - The work is test-first: the new exports get tests in `ci-failure-digest.test.mjs`, ported from MCM's feature 106 cases where they exist.
- **Rationale:** a common API means the two repositories' scripts can be diffed and later shared. `ci-status` reads the repository name from `origin`, not from `GITHUB_REPOSITORY`, so it needs the `repo`-argument form.
- **Alternatives considered:** patch `ci-status` to compute the name inline. Rejected: it would fork the API that MCM and BELAY should share.

## R2. Remove MCM's deploy pipeline from `ci-status`

- **Finding:** the deploy code is additive by design: the verdict and exit codes don't depend on it. It removes cleanly.
- **Decision:** remove all of the following.
  - `DEPLOY_CONTEXT`, `DEPLOY_WORKFLOW`, `DEPLOY_BUNDLE_JOBS`, `DEPLOY_RUN_STATE` and `findDispatchedDeploy` (L293–341).
  - The `deploy` option, `deployCheck` and `withDeploy` in `computeMergeVerdict`. Each `withDeploy(x)` becomes `x`.
  - The `check?.deploy` branch in `annotateCheck`, and the `!c.deploy` filters (L1234, L1334, L1658).
  - `describeDeploy`, `explainDeployFailure`, and the deploy paths in `cmdFailure`.
  - `EXIT.DEPLOY_FAILED` (4). `watchExitCode` is replaced by `exitCodeForVerdict`.
  - The deploy check in `--selftest` (L2116–2127), and the "failed deploy seen" wording.
  - Advisory and trigger-cd wording in USAGE and `describeAdvisoryFailures`.

  **Kept:** the generic advisory machinery (`advisory`, `advisoryWaiting`, `outstandingContexts`, `--required-only`).
- **Exit codes:** 0 mergeable, 1 required check failed, 2 bad arguments or auth, 3 still waiting. This is spec FR-002.

## R3. Required checks

- **Finding:** they're read live from `GET /repos/{owner}/{repo}/branch_protections`. `parseRequiredGlobs` picks the rule for the base branch: the PR's `base.ref`, otherwise `main`. Globs match the context minus its `(event)` suffix. If protection can't be read, there's a hard-coded fallback, `REQUIRED_CONTEXT_GLOBS`, which is all MCM.
- **Decision:**
  - The fallback becomes `REQUIRED_CONTEXT_GLOBS = ['guardrails / guardrails*']`.
  - `NARROW_STATUS_EVENTS` becomes `{}`. Every MCM entry is for MCM-only workflows.
  - The live read is unchanged. It already returns BELAY's `guardrails / guardrails (pull_request)`.
- **Rationale:** branch protection is the authority (spec "Edge cases"). The fallback only matters when the protection API can't be read.

## R4. Credentials and environment

- **ci-status:**
  - Reads `FORGE_TOKEN` instead of `MCM_FORGE_TOKEN` (`requireToken`, L157).
  - Its missing-token message names `FORGE_TOKEN` and points at `docs/runbooks/ci.md`. MCM's `setx` / VS Code advice is dropped.
  - `CI_HTTP_TIMEOUT_MS` and `CI_STATUS_POLL_SECONDS` are kept as they are.
  - `CI_STATUS_CACHE_DIR` defaults to `<tmpdir>/<repo>-ci-status`, not `mcm-ci-status`.
- **forge-pr and forge-credential:**
  - No environment token. Writes use `git credential fill` for origin's scheme and host. The user approved this on 2026-11-22.
  - USAGE and error text name `FORGE_TOKEN` where MCM named `MCM_FORGE_TOKEN`.
  - The `remedy()` text drops the dev-container and VS Code advice and points at `docs/runbooks/ci.md`.
  - `dispatch` examples use `guardrails.yml`, without MCM's `app-ci.yml` / `provider=anthropic`.
- **Scope risk:** `FORGE_TOKEN`'s exact scopes on this forge aren't recorded. `ci-status` needs to read commit statuses, PRs, branch protection, Actions runs and generic packages. The plan treats this as a quickstart check, step 1. If a read gets 403, `ci-status` already names the missing scope, and the user regenerates the token with it.

## R5. Remaining MCM names in code

- **`durations`:** the default `--job` and the `renderCeilingsTable` default become `guardrails`, not `app-e2e`.
- **Selftest contexts:** `app-ci / app-e2e` becomes `guardrails / guardrails`.
- **The DETACHED HEAD warning:** the nx remote-cache remark comes out.
- **`loadNeedsGraph`:** reads `.forgejo/workflows` at runtime, and works unchanged on `guardrails.yml`.

## R6. Tests

- **`ci-status.test.mjs`:**
  - **Removed:** the deploy tests (MCM L1947–2185, plus `(#403e)`), and the `(dep-free)` walk rooted at MCM's `cd-dispatch-gate.mjs`, which is re-rooted at `ci-status.mjs` instead.
  - **Removed:** the import of `../publish-sweep-verdict.mjs` and the tests that use its `CONTEXT`. That module is MCM-only.
  - **Removed:** `(n4)`, which reads MCM workflows for narrow statuses.
  - **Rewritten:** `(#396e)`, which now expects `guardrails`, and the needs-parser test, which now needs at least 1 workflow file, not 5.
  - **Fallback-list assertions:** `(w)`, `(oo)`, `(oo2)`, `(nn)` and `(tt)` are rewritten for the one-glob BELAY fallback.
  - **Token assertions:** `(e)`, `(f)`, `(uu2)` and `runScript` use `FORGE_TOKEN`.
  - **Package tests:** `(106-1..3)` become BELAY's: `belay-ci-failures` only, never the legacy name and never another repository's package.
  - **Everything else** carries over with fixtures copied and names neutralized, including the fetch stubs `stubForge`, `stubPackageForge`, `quiet` and `capture`.
- **`forge-pr.test.mjs`:**
  - Ported, with `jumbleknot/mcm` → `jumbleknot/belay` in the parseOrigin cases, and dispatch examples using `guardrails.yml`.
  - Exit code 4 is removed from the merge loop.
  - The `(#1072)` title prefixes become descriptive.
- **Network:** every test stubs `globalThis.fetch` or injects `fill` / `ciStatus`, so none use the network (spec FR-021).

## R7. Nx targets

- **Decision:** add `node scripts/ci-status.mjs --selftest` to `scripts:lint`. `forge-pr.mjs` and `forge-credential.mjs` have no selftest in MCM, and none is added. The new test files run under `scripts:test` through its glob.

## R8. The "Open the PR" task in the tasks-template override

- **Decision:** rewrite the task body in `.specify/templates/overrides/tasks-template.md`:
  1. Push a real branch: `git push origin HEAD:<branch>`.
  2. Run `node scripts/forge-pr.mjs open --head <branch> --title … --body-file …`.
  3. Run `node scripts/ci-status.mjs watch --pr <n>` until exit 0.
  4. Run `node scripts/forge-pr.mjs merge <n> --expect-head <full sha>`.
  5. Tick the task in the branch's last commit.
  6. Keep CI evidence out of `tasks.md`; it goes in the PR's closing comment.

  The fork-point header is untouched, because the core template didn't change. The sweep and TDD markers stay, and `node scripts/check-speckit-overrides.mjs` must pass. The override is project-owned, so this is a normal edit.
- **Rationale:** spec FR-018 and US6. These are the same commands MCM's override names, adapted to BELAY.

## R9. Runbook

- **Decision:** extend `docs/runbooks/ci.md` with a section on PRs and CI status, rather than adding a new runbook. It documents every command, its exit codes and its credential (spec FR-019).
- **Also:** the digest's footer hint (`node scripts/ci-status.mjs failure --run <id> --full`) becomes true, so the "Reading a failure digest" section gains that command.

## R10. Constitution check notes

- **Nx:** the new tests and selftest run through the existing `scripts` targets, as the constitution's "Monorepo Build Tool" rule requires. `ci-status` and `forge-pr` are operator CLIs run directly with `node`. They aren't test, lint or build operations, so they need no Nx target. MCM's `openwiki/invariants/nx-task-runner.md` makes the same exception for interactive tools.
- **Dependencies:** none are added. Node built-ins only, plus the existing `yaml` dev dependency in tests.
