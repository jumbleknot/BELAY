---

description: "Task list for feature 002: PR and CI-status tooling"
---

# Tasks: PR and CI-Status Tooling

**Input**: Design documents from `specs/002-pr-ci-tooling/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: REQUIRED in this repository (project override; constitution "Test-Driven Development", NON-NEGOTIABLE). Test and implementation tasks use the TDD checkpoint format in `docs/templates/feature-test-tasks-template.md`. Documentation, config and live-verification tasks use its "Done when" form.

**Source to port**: `E:\Programming\VSCode\MovieCollectionManager` (MCM). "Port" means: copy the MCM file, apply **R-strip**, apply **neutral names**, then make only the changes [research.md](research.md) lists for that file.
- **R-strip:** remove MCM item, feature and run numbers and incident stories from comments; turn `(#NNNN)` test-title prefixes into descriptive ones; keep all behaviour.
- **Neutral names:** apply feature 001's mapping consistently to code, tests and fixtures. For example, `app-ci` → `ci`, `app-e2e` → `e2e`, `dast` → `scan`, and `jumbleknot/mcm` → `jumbleknot/belay`.

**Test-file note:** MCM keeps all of `ci-status`'s tests in one file, covering status/watch (US1), failure (US4) and durations (US5). That file is ported once, in US1. The US4 and US5 phases then verify those commands live.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependencies)
- **[Story]**: the user story this task belongs to (US1–US6)

---

## Phase 1: Setup (Shared Infrastructure)

- [ ] T001 **Doc-impact sweep** (REQUIRED in every tasks.md; constitution "Documentation").
  - **Command:** for each term, `git grep -n -F "<term>" -- '*.md' ':!specs/' ':!docs/proposals/' ':!docs/decisions/' ':!docs/superpowers/'`.
  - **Terms:** `ci-status`, `forge-pr`, `feature 002`, `features 002`, `Open the PR`, `PR and backlog`, `bundlePackage`, `FORGE_TOKEN`, `git push origin HEAD`.
  - **Results** (searched 2026-11-22, while generating this file):
    - [x] `docs/runbooks/ci.md:93`: "the PR and backlog scripts (features 002 and 003) read `FORGE_TOKEN` … `FORGE_ISSUE_TOKEN`". → T013
    - [x] `docs/runbooks/ci.md:55`: a hand-written `curl` to fetch a bundle. → T013 (add the `ci-status failure` equivalent)
    - [x] `.specify/templates/overrides/tasks-template.md:193`: the "Open the PR" task, with `git push` only. → T012
    - [x] `docs/runbooks/spec-kit.md:61`: row 1 describes the "Open the PR" task. → T014
    - [x] `docs/runbooks/spec-kit.md:159`: no change. The upgrade procedure only says to keep the task.
    - [x] `docs/runbooks/ci.md:106`: no change. It's the branch-protection check.
    - [x] `ci-status`, `forge-pr`, `bundlePackage`: no hits outside `specs/`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: give BELAY's digest module MCM's repo-scoped package API, which `ci-status` imports (research R1).

**⚠️ CRITICAL**: `ci-status.mjs` can't load until this phase is complete.

- [ ] T002 Add package-API tests to `scripts/__tests__/ci-failure-digest.test.mjs`, following MCM's feature 106 cases, with BELAY's values. Contract: [contracts/cli.md](contracts/cli.md) → `ci-failure-digest.mjs` added exports. Data: [data-model.md](data-model.md) → Evidence bundle.package.
  - **Cases:**
    - `bundlePackageFor('BELAY') === 'belay-ci-failures'`;
    - `bundlePackageFor('')` throws;
    - `bundlePackagesFor('BELAY')` deep-equals `['belay-ci-failures']`, with no legacy `ci-failures`;
    - `isEvidencePackage('belay-ci-failures')` is true, and `isEvidencePackage('ci-failures-x')` is false;
    - `bundleRefFor('p', 'v') === 'p:v'`;
    - `bundlePackage({GITHUB_REPOSITORY:'jumbleknot/BELAY'}) === 'belay-ci-failures'`, unchanged.
  - **Scenarios covered:** US4-AC3 (only BELAY's evidence is ever read).
  - **Verify RED:** `node --test --test-name-pattern="package-api" scripts/__tests__/ci-failure-digest.test.mjs` → expected: failing with `does not provide an export named 'bundlePackageFor'`.
- [ ] T003 Implement `bundlePackageFor`, `bundlePackagesFor`, `isEvidencePackage` and `bundleRefFor` in `scripts/ci-failure-digest.mjs`, with MCM's bodies, except `bundlePackagesFor`, which returns `[bundlePackageFor(repo)]`. Re-express `bundlePackage(env)` as `bundlePackageFor(repoSlug(env))`, and use `bundleRefFor` where the digest builds `bundleRef`. Prerequisite: T002 verified RED.
  - **Verify GREEN:** the T002 command → expected: 0 failures; then `pnpm nx run scripts:test` passes, so feature 001's digest tests are unchanged.

**Checkpoint**: the digest module exports what `ci-status` imports.

---

## Phase 3: User Story 1 - Know whether a change can merge (Priority: P1) 🎯 MVP

**Goal**: `ci-status status` / `watch` give a scriptable merge verdict, with exits 0, 1, 2 and 3.

**Independent Test**: quickstart §1, against `origin/main`.

### Tests for User Story 1 (REQUIRED, TDD checkpoint format) ⚠️

- [ ] T004 [P] [US1] Port `scripts/__tests__/fixtures/ci/*.json` (10 files) from MCM, with neutral names. Don't port `fixtures/ci-status/*.json`; those are deploy fixtures (research table).
  - **Done when:** the 10 files exist, and `git grep -niE 'mcm|movie|mc-service|app-ci|app-e2e|dast' scripts/__tests__/fixtures` finds nothing.
- [ ] T005 [US1] Port `scripts/__tests__/ci-status.test.mjs` from MCM (research R6).
  - **Removed:** the deploy tests (MCM L1947–2185 and `(#403e)`), the `publish-sweep-verdict` import and the tests that use it, and `(n4)`.
  - **Rewritten:** `(#396e)` (`guardrails`), the needs-parser test (at least 1 workflow), the `(dep-free)` walk (re-rooted at `ci-status.mjs`), the fallback-list tests `(w)`, `(oo)`, `(oo2)`, `(nn)` and `(tt)` (one glob, `guardrails / guardrails*`), the token tests `(e)`, `(f)` and `(uu2)` plus `runScript` (`FORGE_TOKEN`), and `(106-1..3)` (`belay-ci-failures` only, never the legacy name, never another repository's).
  - **Added:** `(no-leak)`. With `FORGE_TOKEN` set to a planted value and the forge stubbed to return 401, 403 and success, the output of `status`, `watch` and `failure` never contains the planted value (SC-004).
  - **Scenarios covered:** US1-AC1 to AC6, US4-AC1 to AC3, US5-AC1, SC-002 and SC-004. See [data-model.md](data-model.md) → Verdict, Required check.source and Required check.fallback, Target.
  - **Verify RED:** `node --test scripts/__tests__/ci-status.test.mjs` → expected: failing with `ERR_MODULE_NOT_FOUND` for `ci-status.mjs`.

### Implementation for User Story 1

- [ ] T006 [US1] Port `scripts/ci-status.mjs` from MCM.
  - **Deploy pipeline removed** (research R2): the exports, branches and filters listed there. `watchExitCode` becomes `exitCodeForVerdict`, and the deploy selftest check and exit code 4 go.
  - **Fallback:** `REQUIRED_CONTEXT_GLOBS = ['guardrails / guardrails*']`, and `NARROW_STATUS_EVENTS = {}` (R3).
  - **Credentials and cache:** `FORGE_TOKEN` and its message; `CI_STATUS_CACHE_DIR` defaults to `<tmpdir>/<repo>-ci-status` (R4).
  - **Defaults:** `guardrails` for `durations` and the ceilings table, the selftest contexts, and no nx remote-cache remark (R5).
  - **Imports:** `bundlePackageFor` and `bundlePackagesFor` from T003.
  - **Lint:** add `node scripts/ci-status.mjs --selftest` to `scripts:lint` in `scripts/project.json` (R7).
  - Prerequisite: T005 verified RED.
  - **Verify GREEN:** `node --test scripts/__tests__/ci-status.test.mjs` → expected: 0 failures; then `pnpm nx run scripts:lint` and `pnpm nx run scripts:test` pass.
- [ ] T007 [US1] Live check: quickstart §1. Run `node scripts/ci-status.mjs status --sha "$(git rev-parse origin/main)"`.
  - **Done when:**
    - it exits 0 and lists `guardrails / guardrails (push)` as successful;
    - `--pr 3` reports the merged PR's head as mergeable;
    - an unset `FORGE_TOKEN` exits 2 and names the variable.

    If it exits 2 with a missing scope, record the scope and ask the user to regenerate `FORGE_TOKEN` (research R4).

**Checkpoint**: the merge verdict works against the real forge.

---

## Phase 4: User Story 2 - Open a pull request without the web UI (Priority: P1)

**Goal**: `forge-pr open` creates a PR from a pushed branch, using the git credential.

**Independent Test**: quickstart §5 (open) and §6 (the AGit refusal).

### Tests for User Story 2 (REQUIRED, TDD checkpoint format) ⚠️

- [ ] T008 [P] [US2] Port `scripts/__tests__/forge-pr.test.mjs` from MCM, including its `forge-credential` cases (MCM L29–90), with `jumbleknot/mcm` → `jumbleknot/belay`, `guardrails.yml` in the dispatch examples, and no exit code 4 in the merge loop (research R6).
  - **Added:** `(no-leak)`. A planted git credential, injected through `fill`, never appears in the output or errors of `open`, `merge` or `dispatch` when the forge returns 401, 403, 409 or success (SC-004).
  - **Scenarios covered:**
    - US2-AC1 to AC4;
    - US3-AC1 to AC5 (head mismatch, CI not green, not mergeable, success, short sha);
    - US5-AC2 (dispatch);
    - the edge cases for a non-HTTP(S) origin and an empty password.

    See [data-model.md](data-model.md) → Merge preconditions, Write credential.source, Write credential.empty password, Pull request.head, Pull request.body.
  - **Verify RED:** `node --test scripts/__tests__/forge-pr.test.mjs` → expected: failing with `ERR_MODULE_NOT_FOUND` for `forge-pr.mjs` / `lib/forge-credential.mjs`.

### Implementation for User Story 2

- [ ] T009 [US2] Port `scripts/lib/forge-credential.mjs` and `scripts/forge-pr.mjs` from MCM (research R4). Prerequisite: T008 verified RED.
  - **USAGE and errors:** name `FORGE_TOKEN`.
  - **`remedy()`:** points at `docs/runbooks/ci.md`, without the dev-container or VS Code advice.
  - **Dispatch examples:** use `guardrails.yml`.
  - **Verify GREEN:** `node --test scripts/__tests__/forge-pr.test.mjs` → expected: 0 failures; then `pnpm nx run scripts:test` passes.

**Checkpoint**: open, merge and dispatch are proven by tests. Their live use is T019.

---

## Phase 5: User Story 3 - Merge only what was checked (Priority: P1)

**Goal**: `forge-pr merge` refuses anything not verified.

**Independent Test**: quickstart §6.

- [ ] T010 [US3] Confirm the merge preconditions are covered and ordered as [data-model.md](data-model.md) → Merge preconditions states: the head is checked first, then CI, then the forge, and nothing is called after a refusal.
  - **Done when:** T008's tests include a case where every one of the three refusals makes no merge call (the stubbed forge records zero `POST …/merge`), and one where success sends `head_commit_id` equal to the expected sha. Add any missing case test-first, watched RED, then GREEN.

---

## Phase 6: User Story 4 - Read why CI failed (Priority: P2)

**Goal**: `ci-status failure` reads BELAY's evidence bundles.

**Independent Test**: quickstart §2.

- [ ] T011 [US4] Live check: quickstart §2. Run `node scripts/ci-status.mjs failure --run 8169` and `--full`.
  - **Done when:**
    - both exit 0;
    - the output names `guardrails-test` and shows `deliberate failure #2`, read from `belay-ci-failures`;
    - each finishes in under 10 s (SC-005);
    - `failure --run 8171`, a green run, says there is no failure evidence and doesn't exit 0 as if evidence were found.

---

## Phase 7: User Story 6 - The workflow points at the tools (Priority: P2)

**Goal**: the "Open the PR" task and the runbooks name the new commands.

**Independent Test**: quickstart §7.

- [ ] T012 [P] [US6] Update the "Open the PR" task in `.specify/templates/overrides/tasks-template.md` (sweep hit `:193`) to [contracts/cli.md](contracts/cli.md) → the "Open the PR" task.
  - **Commands named:** the push, `forge-pr open`, `ci-status watch --pr <n>` until it exits 0, and `forge-pr merge <n> --expect-head <full sha>`.
  - **Kept:** the tick-in-last-commit rule and the rule that CI evidence goes in the PR's closing comment.
  - **Unchanged:** line 1 (the fork point), the sweep task and the TDD sample.
  - **Done when:**
    - `node scripts/check-speckit-overrides.mjs` passes;
    - the resolver output (`.specify/scripts/powershell/resolve-template.ps1 tasks-template -Json`) contains `forge-pr.mjs open`;
    - `git diff` shows line 1 untouched.
- [ ] T013 [P] [US6] Add a "Pull requests and CI status" section to `docs/runbooks/ci.md` (sweep hits `:55` and `:93`, FR-019).
  - **Section content:** every `ci-status` and `forge-pr` command, its exit codes and its credential, and the open → watch → merge sequence.
  - **Line 93:** reads now say `FORGE_TOKEN`, used by `ci-status`; writes use the git credential through `forge-pr`; and `FORGE_ISSUE_TOKEN` is used by feature 003's backlog.
  - **Line 55:** "Reading a failure digest" gains `node scripts/ci-status.mjs failure --run <id> [--full]` above the `curl` fallback.
  - **Done when:** every command in [contracts/cli.md](contracts/cli.md) appears in the runbook with its exit codes.
- [ ] T014 [P] [US6] Update row 1 of `docs/runbooks/spec-kit.md` (sweep hit `:61`): the "Open the PR" task now runs through `forge-pr` / `ci-status`.
  - **Done when:** the row names the tools, and `node scripts/check-speckit-overrides.mjs` passes, which keeps the inventory check green.

---

## Phase 8: User Story 5 - Step timings and manual runs (Priority: P3)

- [ ] T015 [US5] Live check: run `node scripts/ci-status.mjs durations --runs 5`, then `node scripts/forge-pr.mjs dispatch guardrails.yml --ref 002-pr-ci-tooling` once the branch is pushed.
  - **Done when:**
    - durations lists per-step timings for `guardrails`;
    - dispatch exits 0 and prints its note that dispatched runs post no commit status;
    - the dispatched run appears in BELAY's Actions list, and it passes.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [ ] T016 [P] Update `AGENTS.md`: the `scripts/` layout row names `ci-status.mjs`, `forge-pr.mjs` and `lib/forge-credential.mjs`.
  - **Done when:** the row lists them.
- [ ] T017 No-MCM check (spec FR-020). Run `git grep -niE 'mcm|movie|mc-service|app-ci|app-e2e|cd-deploy|trigger-cd|MCM_FORGE' -- scripts docs/runbooks/ci.md .specify/templates/overrides`.
  - **Done when:** only the deliberate `themoviedb` vendor regex in `secret-scan.mjs` matches.
- [ ] T018 **Close-out re-search**: re-run T001's searches.
  - **Done when:** every remaining hit in a doc that states current procedure has been fixed, or is justified here.
- [ ] T019 **Open the PR** with this feature's own tools (quickstart §5 and §6; SC-001, SC-003):
  1. `git push origin HEAD:002-pr-ci-tooling`.
  2. `node scripts/forge-pr.mjs open --head 002-pr-ci-tooling --title "Feature 002: PR and CI-status tooling" --body-file <file>`.
  3. Run the §6 refusals: a wrong `--expect-head` exits 1 with nothing merged; `--expect-head abc123` exits 2; `open --head refs/for/main` exits 1 with nothing created.
  4. `node scripts/ci-status.mjs watch --pr <n> --timeout 900` until it exits 0.
  5. `node scripts/forge-pr.mjs merge <n> --expect-head "$(git rev-parse HEAD)"`.

  Tick this task in the branch's LAST commit, quoting the branch and the PR number.

  **CI evidence is never recorded here.** A file can't hold the CI result of the commit that contains it, and a commit added to record it is a new head that reruns every required CI job. The run ids, the CI verdict and the merge sha go in the PR's closing comment.
- [ ] T020 Run [quickstart.md](quickstart.md) §1 to §7.
  - **Done when:** every "Expected" holds. §5's merge is the last step of T019.

---

## Dependencies & Execution Order

- **T001** comes first, then **Foundational (T002–T003)**. Everything that loads `ci-status` needs T003.
- **US1 (T004–T007)** needs T003.
- **US2 (T008–T009)** can start after T003, in parallel with US1. Its merge path calls `ci-status`, which only the live merge needs; the tests inject `ciStatus`.
- **US3 (T010)** needs T008 and T009.
- **US4 (T011)** and **US5 (T015)** need T006. T015's dispatch also needs the branch pushed.
- **US6 (T012–T014)** can run any time after T001.
- **Polish:**
  - T016–T018 after the stories;
  - T019 after everything is committed;
  - T020 alongside T019.

### Parallel Opportunities

- T004 and T008 can run together; so can T012, T013 and T014.

## Implementation Strategy

1. **MVP:** T001–T007. The digest API plus `ci-status`, verified against the real forge.
2. **Next:** forge-pr and forge-credential (T008–T010), then the live failure and durations checks (T011, T015).
3. **Then:** the workflow docs (T012–T014, T016), the checks (T017–T018), and finally this feature's PR, opened and merged with its own tools (T019–T020).
