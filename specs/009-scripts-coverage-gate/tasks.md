<!-- forked-from: .specify/templates/tasks-template.md sha256=fc29a233f6f5a27ca31f1aa46b596af6500c627441c6e62b2bc4a1d721525842 spec-kit=1.4.2 -->
---

description: "Task list for feature 009: coverage gate for the scripts project"
---

# Tasks: Coverage gate for the scripts project

**Input**: Design documents from `specs/009-scripts-coverage-gate/`: [plan.md](plan.md), [spec.md](spec.md),
[research.md](research.md), [data-model.md](data-model.md), [contracts/check-coverage-cli.md](contracts/check-coverage-cli.md),
[quickstart.md](quickstart.md)

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: REQUIRED in this repository (project override; constitution "Test-Driven Development", NON-NEGOTIABLE).
Every test task and its paired implementation task use the TDD checkpoint format in
`docs/templates/feature-test-tasks-template.md`. Documentation and config tasks use that template's
"Done when" form instead.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US4, from spec.md)
- Paths are repository-relative. Work happens in the worktree `/home/coder/worktrees/009-coverage`

---

## Phase 1: Setup

- [x] T001 Confirm the worktree `/home/coder/worktrees/009-coverage` on `009-scripts-coverage-gate`, with a real
  frozen install (not a symlinked `node_modules`), is green before any change
  - **Done when**: `pnpm nx run scripts:lint --skip-nx-cache` and `pnpm nx run scripts:test --skip-nx-cache` both exit 0,
    and the test summary reads `fail 0`, `skipped 0`
- [x] T002 **Doc-impact sweep** (REQUIRED; constitution "Documentation"). This feature changes the meaning of the
  `scripts:test` target and of its command text, and adds no rename or removal. The searches were run while
  generating this file. Command, per term:
  `git grep -n -i -F "<term>" -- '*.md' '*.yaml' '*.yml' '*.json' ':!specs/' ':!docs/proposals/' ':!docs/decisions/' ':!docs/superpowers/'`.
  Terms: `scripts:test`, `__tests__/*.test.mjs`, `node --test`; plus, narrowed with `-E` to the sense this feature
  changes, `code coverage|line coverage|coverage (minimum|gate|threshold|floor)|70% for new|coverage tools|measures coverage`.
  Hits:
  - `docs/runbooks/ci.md:46` ("`scripts:test`, which runs every `scripts/__tests__/*.test.mjs`") and `:56` → T024
  - `docs/repo-foundation-setup.md:218` (the `test` target's command, quoted) → T025
  - `README.md:31` (`scripts:test  # script unit tests`) → T025
  - `openwiki/invariants/nx-task-runner.md:21` (the target's command) → T022
  - `openwiki/invariants/testing-tiers.md:22` (the Unit row) → T021
  - `openwiki/invariants/feature-validation-checklist.md:21` → T023
  - `openwiki/invariants/unenforced-rules.md:25` (the coverage row) → T020
  - `scripts/project.json:72` (the command itself) → T013
  - `AGENTS.md:17,49`, `docs/runbooks/backlog.md:31`, `docs/runbooks/devcontainer.md:161,297`, `docs/runbooks/spec-kit.md:21,23`,
    `docs/repo-foundation-setup.md:166,227,231,256,454,566`, `openwiki/process/pull-request-batching.md:29`,
    `openwiki/runbooks/ci.md:20`, `openwiki/decisions/adr-0001-pnpm-and-nx-only.md:16`, `docs/decisions/ADR-0001-*.md:24`,
    `.forgejo/workflows/guardrails.yml:59-60` → no change: each says to *run* `scripts:test`, which stays true, and the
    target now also gates
  - `openwiki/gotchas/instrument-traps.md:20-21`, `AGENTS.md:16`, `openwiki/invariants/testing-tiers.md:41`,
    `docs/runbooks/devcontainer.md:274` → no change: these are facts about `node --test` itself
  - `.specify/memory/constitution.md:264,379,487` → no change: the source of the rule, not made untrue
  - `docs/templates/feature-test-tasks-template.md:129` (`pnpm nx test [project]` … ≥70% line coverage) → no change:
    a per-project template line, still the rule
  - Code comments in `scripts/ci-status.mjs:23`, `scripts/ci-failure-digest.mjs:26` and three test headers name an older
    `guardrails/naming` step → no change: code comments are outside the sweep's scope, and they predate this feature
  - `scripts/__tests__/allowlist-expiry-wiring.guard.test.mjs:39` reads `targets.lint.options.commands`, not `test`
    → no change: adding a lint command keeps it true (checked by T017's GREEN)

---

## Phase 2: Foundational (blocks every story)

- [x] T003 Measure research **R10** before building on it. In a scratch directory (outside the repository), run
  `node --test --experimental-test-coverage` on a tiny fixture *from inside* a test that is itself running under
  `--experimental-test-coverage`. Record in research.md R10 two things: whether the inner lcov holds only the fixture's
  modules, and whether the outer report gains fixture paths. Then record the decision: clear `NODE_V8_COVERAGE` in the
  child's environment, or not needed
  - **Done when**: research.md R10 states the measured result, the decision and the command used
- [ ] T004 Create `scripts/coverage-policy.yaml` per `data-model.md` → `Coverage policy.version`, `Coverage policy.floor`
  (70), `Coverage policy.include` (`scripts/*.mjs`, `scripts/lib/*.mjs`) and `Coverage policy.exceptions` (`[]`), with a
  header comment saying it is the one place the floor is stated (FR-013), why it lives under `scripts/` (research R6:
  the Nx cache input), and that lowering the floor to pass a change is refused by review
  - **Done when**: the file parses with `yaml` and carries exactly those four keys
- [ ] T005 Create `scripts/check-coverage.mjs` as a **stub**. It exports `parseLcov`, `validatePolicy`, `listSourceModules`,
  `judgeCoverage`, `formatVerdict` and `coverageSelftest`, each throwing `not implemented`, and its CLI prints `not implemented`
  and exits 1. This exists so the RED in T006, T011 and T015 is a real failure, never an import error (a compile or import
  error does not count as RED)
  - **Done when**: `node -e "import('./scripts/check-coverage.mjs')"` exits 0

**Checkpoint**: R10 is decided, the policy exists, and the module shape is fixed.

---

## Phase 3: User Story 1 - A change that drops coverage below the floor is refused (Priority: P1) 🎯 MVP

**Goal**: given a report, a policy and the source list, the gate passes or fails exactly as spec FR-002 to FR-006 and
FR-012 require, and the SAST orchestrator is raised above the floor (FR-012, SC-002).

**Independent Test**: unit tests on the pure functions with in-memory lcov text. The orchestrator's lcov figure is ≥ 70%.

### Tests for User Story 1 (REQUIRED, TDD checkpoint format) ⚠️

> Write these first and see them fail for the right reason. A RED with 0 failures means the test is wrong.

- [x] T006 [US1] Write `scripts/__tests__/check-coverage.test.mjs`, the verdict rules, all with in-memory inputs and an explicit
  `today`:
  - `parseLcov` reads `SF`/`LF`/`LH`/`BRF`/`BRH` per record and ignores records outside `include`;
  - every source module at or above 70% passes;
  - one module at 69.9% fails, naming it with its percent and the floor;
  - a source module absent from the report fails as `no-coverage-data`, never as passing;
  - every module meets its *applied* floor, one of them only through an active exception at 55%, and the total is
    below 70%, so the verdict fails on the total. This is the only reachable shape of a total failure (spec US1-AC4);
  - an empty report, or one with no record for any source module, fails closed;
  - a malformed record (`LF`/`LH` before any `SF`, or a non-numeric `LH`) fails closed with a message naming it,
    never read as zero or as passing (spec FR-006, "unreadable");
  - a module with `LF:0` counts as 100%;
  - an active exception applies its floor, an `expiring` one warns, and an `expired` one is judged at the policy floor;
  - `validatePolicy` refuses (as a usage error, exit 2): a floor outside 50–100, an empty `include`, an `include` pattern
    matching `scripts/__tests__/`, an exception floor below 50 or not below the policy floor, a blank reason or `addedBy`,
    a missing expiry, and an exception for a module that does not exist;
  - `formatVerdict` puts the summary line **last**, and orders failing modules worst first.

  Cite: `data-model.md` → `Module result.status`, `Module result.appliedFloor`, `Exception.floor`, `Exception.expiry`,
  `Coverage policy.include`, and `Verdict`.
  - **Scenarios covered**: US1-AC1, US1-AC2, US1-AC3, US1-AC4; spec Edge Cases (untested file, empty report, test files excluded)
  - **Verify RED**: `node --test scripts/__tests__/check-coverage.test.mjs` → expected: every test failing — `not implemented`
- [x] T007 [P] [US1] Export `toSarif`, `normalizeCargoAudit` and `emitProposedAllowlist` from `scripts/sast-scan.mjs`, with no
  change to their bodies (research R7). This is a prerequisite for T008, and is not itself a behaviour change
  - **Done when**: `node scripts/sast-scan.mjs --selftest` exits 0, and `git diff` shows only the three `export` keywords
- [x] T008 [US1] Write `scripts/__tests__/sast-scan-transforms.test.mjs`, asserting **observable output**:
  - `toSarif` turns two findings into a SARIF 2.1.0 log with one result each, the right rule id, level and location;
  - `normalizeCargoAudit` turns a cargo-audit JSON fixture into findings with the CVSS-banded severity, runtime/dev scope
    from the runtime set, and an `informational` warning as Low;
  - `emitProposedAllowlist` writes one entry per distinct finding to a temp file, with `TODO` justification lines and
    escaped location patterns, and returns the count.

  The behaviour already exists, so this is a **mutation RED**: apply each named edit, observe the failure, revert.
  - **Scenarios covered**: SC-002 (the orchestrator above the floor, with no exception)
  - **Verify RED (mutation)**:
    1. Make `toSarif` return `runs: []`. Then `node --test scripts/__tests__/sast-scan-transforms.test.mjs` → ≥1 failing on the
       SARIF result count.
    2. Make `normalizeCargoAudit` map every severity to `Low` → ≥1 failing on the severity band.
    3. Revert both, and confirm with `git diff scripts/sast-scan.mjs`.

### Implementation for User Story 1

- [x] T009 [US1] Implement `parseLcov`, `validatePolicy`, `listSourceModules` (from the **file system**, per research R5; not
  `git ls-files`), `judgeCoverage` and `formatVerdict` in `scripts/check-coverage.mjs` (prerequisite: T006 verified RED). Field
  citations, all in `data-model.md`:
  - `validatePolicy` enforces `Coverage policy.floor`, `Coverage policy.include`, `Exception.module`, `Exception.floor`,
    `Exception.reason`, `Exception.addedBy` and `Exception.expiry`. Expiry goes through `classifyExpiry` and
    `WARNING_WINDOW_DAYS` from `scripts/allowlist-expiry.mjs`, never re-derived;
  - `judgeCoverage` computes `Module result.percent`, `Module result.appliedFloor` and `Module result.status`, and then the
    `Verdict`;
  - `formatVerdict` prints the output lines in `contracts/check-coverage-cli.md`.
  - **Verify GREEN**: `node --test scripts/__tests__/check-coverage.test.mjs` → expected: 0 failures, 0 skipped. Then
    `pnpm nx run scripts:test` still passes
- [x] T010 [US1] Confirm the orchestrator is above the floor (prerequisite: T008)
  - **Verify GREEN**: `node --test scripts/__tests__/sast-scan-transforms.test.mjs` → 0 failures. In a coverage run
    (`node --test --experimental-test-coverage --test-coverage-include="scripts/*.mjs" --test-coverage-include="scripts/lib/**" "scripts/__tests__/*.test.mjs"`),
    `sast-scan.mjs` reads ≥ 70% of lines; record the figure here
  - **Recorded 2026-11-24**: measured with the policy's exact patterns (`scripts/*.mjs`, `scripts/lib/*.mjs`), and judged by
    the gate's own functions: `scripts/sast-scan.mjs` 75.00% (912/1216), up from 67.76%; `scripts/check-coverage.mjs` 97.74%.
    Verdict: `✅ 39 modules ≥ 70% lines; total 92.02% lines (81.03% branches, not gated)`

**Checkpoint**: the verdict logic is complete and proven, and no module is below the floor.

---

## Phase 4: User Story 2 - The same check runs locally and in CI (Priority: P1)

**Goal**: one command, `pnpm nx run scripts:test`, runs the tests with coverage and gates them, locally and in CI, with the
verdict at the end of the output for the digest (FR-001, FR-006, FR-008 to FR-011).

**Independent Test**: the `--run` end-to-end test against a fixture project, plus a real `scripts:test` run.

### Tests for User Story 2 (REQUIRED, TDD checkpoint format) ⚠️

- [x] T011 [US2] Create the fixture project `scripts/__tests__/fixtures/coverage-run/` with:
  - a policy;
  - two source modules: one fully tested, one with an untested branch below the floor;
  - one test file.

  Then add `--run` tests to `scripts/__tests__/check-coverage.test.mjs`. Each one starts the CLI as a real child process
  with the fixture as its root, applying the R10 decision from T003, and asserts:
  - a stale `coverage/*.lcov` placed beforehand is deleted, and the verdict is judged on the fresh report;
  - the below-floor fixture exits 1, with `✗` naming that module and the `❌` summary as the **last** line;
  - the passing variant exits 0, with `✅` last;
  - a failing fixture test makes `--run` exit with the test runner's non-zero code, and still print the verdict;
  - with no report written (a policy whose include matches nothing the tests load), the run fails closed;
  - a variant whose only test of the below-floor module is `test.skip` makes `--run` fail on that module. A skip is not an
    exemption (spec Edge Cases);
  - `--report <missing file>` exits 1, and an unknown flag exits 2.

  Cite: `contracts/check-coverage-cli.md` (`--run`, exit codes).
  - **Deviation (recorded)**: each case builds its project in a temp dir from inline strings, rather than a committed
    `fixtures/coverage-run/`. Committed `.mjs` fixtures would be scanned by Semgrep and the other tree gates, and every
    variant would need its own copy. Eight cases, including an invalid policy exiting 2 before anything runs
  - **Scenarios covered**: US2-AC1, US2-AC2; spec Edge Cases (no report, a skipped test lowers coverage)
  - **Verify RED**: `node --test --test-name-pattern="--run" scripts/__tests__/check-coverage.test.mjs` → expected: every
    `--run` test failing, with the stub's `not implemented` / exit 1. Node's flags go **before** the path (instrument trap)

### Implementation for User Story 2

- [x] T012 [US2] Implement the CLI in `scripts/check-coverage.mjs`: `--run`, the default gate with `--report <lcov>`, and `--help`.
  `--run` builds one `--test-coverage-include` per `Coverage policy.include` pattern (`data-model.md`), so the measured set
  and the judged set cannot drift (research R5). It deletes the previous report first, inherits stdio, and gates after the
  runner exits (prerequisite: T011 verified RED)
  - **Verify GREEN**: `node --test --test-name-pattern="--run" scripts/__tests__/check-coverage.test.mjs` → 0 failures; then the
    whole file → 0 failures, 0 skipped
- [x] T013 [US2] Point `scripts/project.json`'s `test` target at `node scripts/check-coverage.mjs --run` (replacing
  `node --test "scripts/__tests__/*.test.mjs"`)
  - **Verify GREEN**: `pnpm nx run scripts:test --skip-nx-cache --output-style=static` → every test passes with `skipped 0`,
    and the **last** output line is `[coverage] ✅ … modules ≥ 70% lines; total …%`. Record the total and the lowest module here
  - **Recorded 2026-11-24**: 1185 tests, 1185 passed, 0 failed, 0 skipped; last line
    `[coverage] ✅ 39 modules ≥ 70% lines; total 92.09% lines (81.15% branches, not gated); lowest: scripts/sast-scan.mjs 75.00%`
- [x] T014 [US2] Prove the verdict reaches the CI digest's tail (research R8). Make the tree fail on purpose by moving
  `scripts/__tests__/sast-scan-transforms.test.mjs` aside (the orchestrator then drops below the floor). Then run
  `export CI_STEP_LOG_ROOT=$(mktemp -d)`, then
  `bash scripts/ci-log-step.sh guardrails-test pnpm nx run scripts:test --skip-nx-cache`,
  and read the tail of `$CI_STEP_LOG_ROOT/local/local/guardrails-test.log`, which is the file the digest reads in CI
  - **Done when**: the tail holds the `✗ scripts/sast-scan.mjs` line and the `❌` summary, and the test file is moved back
    (`git status --porcelain` is clean). The live CI confirmation is the PR's own run (T031)
  - **Recorded 2026-11-24**: step exit 1. The log ends with `✗ scripts/sast-scan.mjs — 68.01% lines, floor 70%` and the `❌`
    summary, followed only by Nx's ~12-line trailer. The digest keeps the last 200 lines (`DEFAULT_CAPS` in
    `ci-failure-digest.mjs`), so the verdict is inside it. The test file was moved back. Also proven by mutation: with
    `NODE_TEST_CONTEXT` no longer stripped, 5 of the 6 `--run` tests fail (R10)

**Checkpoint**: `scripts:test` is the coverage gate, locally and in CI.

---

## Phase 5: User Story 3 - The gate proves it can still fail (Priority: P2)

**Goal**: `--selftest` judges the contract's synthetic scenarios before any real measurement, and fails if one is judged
wrongly (FR-007, SC-005).

**Independent Test**: break the per-module comparison on purpose, and the self-test exits 1.

### Tests for User Story 3 (REQUIRED, TDD checkpoint format) ⚠️

- [ ] T015 [US3] Add self-test tests to `scripts/__tests__/check-coverage.test.mjs`:
  - `node scripts/check-coverage.mjs --selftest` exits 0 with `✓ check-coverage --selftest passed`;
  - `coverageSelftest({ judgeCoverage: <a judge that never reports below-floor> })` returns failures naming the below-floor
    scenario;
  - a judge that ignores missing modules → failures naming `no coverage data`;
  - a judge that ignores the total → failures naming the total scenario;
  - a judge that passes an empty report → failures naming fail-closed.
  - **Scenarios covered**: US3-AC1, US3-AC2
  - **Verify RED**: `node --test --test-name-pattern="selftest" scripts/__tests__/check-coverage.test.mjs` → expected: every
    selftest test failing — `not implemented`

### Implementation for User Story 3

- [ ] T016 [US3] Implement `coverageSelftest(deps)` and `--selftest` in `scripts/check-coverage.mjs`, with every scenario listed
  in `contracts/check-coverage-cli.md` → `--selftest`. `deps` exists so tests can inject a broken stage, as in
  `sast-scan.mjs`'s selftest (prerequisite: T015 verified RED)
  - **Verify GREEN**: the T015 command → 0 failures. Then `node scripts/check-coverage.mjs --selftest` exits 0
- [ ] T017 [US3] Add `node scripts/check-coverage.mjs --selftest` to `scripts/project.json`'s `lint` commands, after
  `check-sast-findings.mjs --selftest`
  - **Verify GREEN**: `pnpm nx run scripts:lint --skip-nx-cache --output-style=static` exits 0, and its output shows the
    `✓ check-coverage --selftest passed` line. `node --test scripts/__tests__/allowlist-expiry-wiring.guard.test.mjs` →
    0 failures
- [ ] T018 [US3] **SC-005 mutation**. In the source, make the per-module comparison always pass (for example, `percent >= 0`),
  then run `node scripts/check-coverage.mjs --selftest`. Revert
  - **Done when**: it exited 1 naming the below-floor scenario, and that output is recorded here. `git diff` shows the revert

**Checkpoint**: the gate cannot pass vacuously.

---

## Phase 6: User Story 4 - The documents tell the truth about what is enforced (Priority: P3)

**Goal**: FR-014 and FR-015. **Independent Test**: quickstart §6.

- [x] T019 [US4] (done in the spec commit `2e2dbc2`) The register's spec-before-code row records the item 54 decision
  - **Done when**: `openwiki/invariants/unenforced-rules.md` says "decided not to build" with the reason, and names no open item
- [ ] T020 [US4] `openwiki/invariants/unenforced-rules.md`: **remove** the coverage row, because `scripts/` is now gated and no other
  project exists yet. Add under Gotchas that a new project with tests adds its own coverage gate, or a row here, in the PR
  that adds it. Update the page's `description` and the matching line in `openwiki/invariants/index.md`
  - **Done when**: no row claims nothing measures coverage, and the OKF gate passes
- [ ] T021 [P] [US4] `openwiki/invariants/testing-tiers.md`: add a **Coverage** row to "What exists today" (70% of lines per
  module and in total, a missing module fails, run by `scripts:test`, gates a merge) and adjust the Unit row's command
  - **Done when**: the row exists, and the page states the floor's one home (`scripts/coverage-policy.yaml`)
- [ ] T022 [P] [US4] `openwiki/invariants/nx-task-runner.md:21`: the `scripts:test` row reads
  `node scripts/check-coverage.mjs --run`: the tests under coverage, then the gate. Add `check-coverage` to the `scripts:lint` row
  - **Done when**: both rows match `scripts/project.json`
- [ ] T023 [P] [US4] `openwiki/invariants/feature-validation-checklist.md:21`: the `scripts:test` item also requires the
  `[coverage] ✅` line, saying what to do on `✗`: add tests or delete dead code, never lower the floor
  - **Done when**: the item names the coverage verdict

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T024 [P] `docs/runbooks/ci.md:46,56`: `scripts:test` runs every test under coverage, then the 70% line gate
  (`check-coverage.mjs`), with its verdict last. Then refresh `openwiki/runbooks/ci.md` with `node scripts/wiki-refresh.mjs --diff`
  / `--record` (V17)
  - **Done when**: both lines are true, and `wiki-refresh.mjs --stale` is empty
- [ ] T025 [P] `docs/repo-foundation-setup.md:218` (the `test` target's command) and `README.md:31` (`# script unit tests and the
  coverage gate`)
  - **Done when**: both name the gate
- [ ] T026 **Close-out re-search**: re-run T002's searches. Every hit that states current procedure and is now untrue is fixed,
  or justified here
  - **Done when**: the result is recorded here
- [ ] T027 Run [quickstart.md](quickstart.md) §1, §2, §4 and §6 locally. Revert every deliberate break. §3 (local against CI,
  SC-003) and §5 (durations, SC-004) need the PR's CI run, so they are recorded with T029
  - **Done when**: each scenario's observed result is recorded here, including SC-001's three failure shapes and SC-005 (T018)
- [ ] T028 Final validation, per `openwiki/invariants/feature-validation-checklist.md`:
  - `pnpm nx run scripts:lint --skip-nx-cache`;
  - `pnpm nx run scripts:test --skip-nx-cache`, with `skipped 0` and `[coverage] ✅`;
  - `node scripts/wiki-refresh.mjs --stale`, which must be empty;
  - `node scripts/sast-scan.mjs --scope full` followed by `node scripts/check-sast-findings.mjs`, with 0 blocking.
  - **Done when**: all exit 0, recorded with their summary lines
- [ ] T029 After the PR's first green run, record quickstart §3 and §5:
  - SC-003: the CI `[coverage]` summary line against the local one from T013, within 0.1 points;
  - SC-004: `node scripts/ci-status.mjs durations --job guardrails`, the `guardrails-test` step against the last runs on `main`.
  - **Done when**: the before and after figures are in the PR comment (not in this file; see T031)
- [ ] T030 Backlog, after merge only. Close item 53 with a verification comment (the PR, the merge sha, the total, and the
  lowest module), and close item 54 (its register row landed with the spec commit, on `main` once merged)
  - **Done when**: both are closed, each with a comment
- [ ] T031 **Open the PR** from a real branch, with the repository's PR tools (`docs/runbooks/ci.md`):
  1. `git push origin HEAD:009-scripts-coverage-gate`
  2. `node scripts/forge-pr.mjs open --head 009-scripts-coverage-gate --title "…" --body-file <file>`
  3. `node scripts/ci-status.mjs watch --pr <n>`, until it exits 0
  4. `node scripts/forge-pr.mjs merge <n> --expect-head <full sha>`

  Tick this task in the branch's LAST commit and quote the branch and the PR number. **CI evidence is never recorded here**:
  a file cannot hold the CI result of the commit that contains it, and a commit added to record it is a new head that reruns
  every required CI job. The run ids, the CI verdict and the merge sha go in the PR's closing comment, and in the closing
  comment of each issue the PR resolves

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none. T002 is already done
- **Foundational (Phase 2)**: T003 → T011 (the R10 decision shapes the `--run` test). T004 and T005 block every story
- **US1 (Phase 3)**: after Phase 2. T006 → T009. T007 → T008 → T010
- **US2 (Phase 4)**: after T009 (the CLI uses the judge). T011 → T012 → T013 → T014
- **US3 (Phase 5)**: after T009. T015 → T016 → T017 → T018. It can run alongside US2 (only the CLI's `--selftest`
  branch overlaps; sequence the two edits to `check-coverage.mjs`)
- **US4 (Phase 6)**: T020–T023 after T013, because the documents describe the wired target
- **Polish (Phase 7)**: after all stories. T031 last

### Within Each User Story

- Tests are written and verified RED before implementation, and the paired implementation task is verified GREEN
- The stub (T005) exists before any RED, so no RED is an import error

### Parallel Opportunities

- T007 runs alongside T006 (different files)
- T021, T022 and T023 run alongside each other (different pages)
- T024 and T025 run alongside each other

---

## Parallel Example: User Story 1

```bash
# Different files, no shared state:
Task: "T006 verdict-rule tests in scripts/__tests__/check-coverage.test.mjs"
Task: "T007 export three transforms from scripts/sast-scan.mjs"
```

---

## Implementation Strategy

### MVP First (User Story 1, then User Story 2's wiring)

1. Phase 1, then Phase 2 (R10 measured, policy, stub).
2. US1: the verdict logic, and the orchestrator above the floor. **Stop and validate**: T006/T008 green, `sast-scan.mjs` ≥ 70%.
3. US2: wire `scripts:test`. This is the point at which the rule is enforced, so it is the real MVP line.
4. US3: the self-test, and its place in `scripts:lint`.
5. US4 and Polish: documents, quickstart, PR.

### Notes

- [P] tasks touch different files, with no dependencies between them
- Verify RED before implementing, and GREEN after; a RED with 0 failures means the test is wrong
- Commit after each phase, in a `feat(009): …` / `docs(009): …` trail
- Never lower `Coverage policy.floor` (`data-model.md`) to get a change through
