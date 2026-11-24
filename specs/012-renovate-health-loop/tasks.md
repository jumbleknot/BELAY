---

description: "Task list for feature 012: the dependency bot's health loop"
---

# Tasks: The dependency bot's health loop

**Input**: Design documents from `specs/012-renovate-health-loop/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md),
[contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: REQUIRED (constitution "Test-Driven Development"). Every test task carries **Verify RED**, and its paired
implementation task carries **Verify GREEN**, in the format of `docs/templates/feature-test-tasks-template.md`.
Stubs come first, so every RED fails on an assertion, never on an import. Config and doc tasks use "Done when".

**Instrument notes**:
- `node --test` takes its flags **before** the path.
- A RED with 0 failures is a broken test.
- Watch the skip count.

Shorthand used below:
- `FL` = `scripts/__tests__/forge-list.test.mjs`
- `LR` = `scripts/__tests__/check-lockfile-refresh.test.mjs`
- `RH` = `scripts/__tests__/renovate-health.test.mjs`
- `RM` = `scripts/__tests__/reap-merged-branches.test.mjs`
- `WG` = `scripts/__tests__/renovate-health-workflows.guard.test.mjs`
- `RC` = `scripts/__tests__/check-renovate-config.test.mjs`

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [X] T001 **Doc-impact sweep**. Identifiers this feature adds or changes the meaning of:
  - `keepNewest` / `150` (the floor becomes 200) and `6 bundle-publishing` (becomes 8);
  - `CI_DIGEST_TOKEN`'s "failure-digest step only" (it now also posts the health report);
  - the `renovate/verdict` description (it gains `; lock file: <result>`);
  - "health loop", "item 48", "reaper".

  Command, run per term: `git grep -n -F "<term>" -- '*.md' ':!specs/' ':!docs/proposals/' ':!docs/decisions/'`.
  Results:
  - [x] `docs/runbooks/ci.md:149-150` (150 versions, 6 jobs) → T038
  - [x] `openwiki/runbooks/ci.md:86` (150, 6 jobs) → T042 (wiki refresh)
  - [x] `docs/runbooks/ci.md:169` and `openwiki/invariants/secrets-management.md:23` ("the failure-digest step only") → T038, T039
  - [x] `docs/runbooks/renovate.md:142` (the `renovate/verdict` example) → T037
  - [x] `openwiki/decisions/adr-0004-*.md:4,24`, `openwiki/decisions/index.md:6` ("health loop", item 48): no change (they derive from the unchanged ADR-0004 and stay true)
  - [x] `docs/runbooks/devcontainer.md:66` (150GB), `docs/templates/feature-test-tasks-template.md:203` (15000): no change (unrelated numbers)

  New identifiers needing entries:
  - `renovate-health.yml` and `branch-reaper.yml` in ci.md's workflow list → T038;
  - "The health loop" section in the bot runbook → T037;
  - the tracking issue → T037.

- [ ] T002 [P] Create the stub modules, each exporting its contract's functions ([contracts/cli.md](contracts/cli.md)),
  throwing `not implemented`, and guarded by `isMain`:
  - `scripts/lib/forge-list.mjs`: `listAll`, `ForgeListError`;
  - `scripts/check-lockfile-refresh.mjs`: `deriveWindow`, `judgeLockfile`, `main`;
  - `scripts/renovate-health.mjs`: `parseRepositoryProblems`, `classifyBranch`, `buildReport`, `judgeFreshness`, `main`;
  - `scripts/reap-merged-branches.mjs`: `decideBranch`, `main`.
  - **Done when**: each module imports cleanly (`node -e "import('./scripts/<m>')"`).

---

## Phase 2: Foundational

- [ ] T003 [P] Tests in `FL` for `listAll`:
  - pages with `limit` and `page` until the total is read;
  - throws `ForgeListError` on a non-2xx status;
  - throws on a page that is not an array;
  - throws on a missing `x-total-count`;
  - throws when the rows read differ from the total (FR-013);
  - an empty listing (total 0) returns `[]`.
  - **Scenarios covered**: FR-013, spec edge case "the forge paginates"
  - **Verify RED**: `node --test scripts/__tests__/forge-list.test.mjs` → expected: ≥6 failing — `not implemented`
- [ ] T004 Implement `listAll` in `scripts/lib/forge-list.mjs` (research R8).
  - **Verify GREEN**: T003's command → expected: 0 failures, 0 skipped
- [ ] T005 [P] Tests in `RC` for the `judgeRun` lock-file suffix (research R3, contracts/cli.md):
  - a `branches info extended` record whose `renovate/lock-file-maintenance` entry has `result: "no-work"` gives a line
    ending `; lock file: no-work`;
  - no record, or no entry, gives `; lock file: absent`.
  - **Scenarios covered**: US2-AC1, US2-AC2 (the evidence the check reads)
  - **Verify RED**: `node --test --test-name-pattern "lock file suffix" scripts/__tests__/check-renovate-config.test.mjs` → expected: ≥2 failing — the suffix is missing
- [ ] T006 Extend `judgeRun` in `scripts/check-renovate-config.mjs` with the lock-file suffix. Update the existing
  `judgeRun` tests' expected lines at their cause, and the selftest.
  - **Verify GREEN**: `node --test scripts/__tests__/check-renovate-config.test.mjs` → expected: 0 failures, 0 skipped

**Checkpoint**: paginated reads and the lock-file evidence exist.

---

## Phase 3: User Story 1 — a weekly report whose silence is the alarm (P1) 🎯 MVP

**Goal**: one comment a week on the tracking issue, one line when healthy, and a watchdog when it stops.

**Independent Test**: `renovate-health.mjs --dry-run` prints a report built from the live forge. On fixtures, every
finding class renders.

### Tests for User Story 1 ⚠️

- [ ] T007 [P] [US1] Tests in `RH` for `parseRepositoryProblems`:
  - the "Repository problems" section is cut from the heading to the next `## `;
  - lines containing `WARN` or `ERROR` are kept, with any leading `- ` stripped (data-model.md
    `DashboardProblem.text`);
  - no section gives `[]`.
  - **Scenarios covered**: US1-AC2
  - **Verify RED**: `node --test --test-name-pattern "parseRepositoryProblems" scripts/__tests__/renovate-health.test.mjs` → expected: ≥3 failing — `not implemented`
- [ ] T008 [P] [US1] Tests in `RH` for `classifyBranch`, all four classes of data-model.md `BotBranch.class`:
  - inMain false gives active;
  - true with a PR gives empty;
  - true without one gives stale;
  - null gives unknown.
  - **Scenarios covered**: US1-AC3, US1-AC4, FR-004
  - **Verify RED**: `node --test --test-name-pattern "classifyBranch" scripts/__tests__/renovate-health.test.mjs` → expected: 4 failing — `not implemented`
- [ ] T009 [P] [US1] Tests in `RH` for `buildReport(facts, now)`:
  - all clear gives exactly one line, matching data-model.md `HealthReport.body`'s healthy form, with the marker;
  - each finding gives a header plus one line, for each of: a dashboard problem, an empty branch, a stale branch, an
    unknown branch, a blocked PR (naming its failing contexts, per data-model.md `BlockedPr.failing`), a failing
    lock-file verdict, and a missing dashboard;
  - an unreadable protection is a finding;
  - `HealthReport.healthy` is false whenever any of these is present.
  - **Scenarios covered**: US1-AC1 to US1-AC5, FR-002, FR-004a
  - **Verify RED**: `node --test --test-name-pattern "buildReport" scripts/__tests__/renovate-health.test.mjs` → expected: ≥9 failing — `not implemented`
- [ ] T010 [P] [US1] Tests in `RH` for `judgeFreshness(comments, now)` against data-model.md
  `TrackingIssue.freshness`:
  - a marked comment 8 days old passes, and 8 days + 1 minute fails;
  - no marked comment passes as "no report yet";
  - unmarked comments are ignored.
  - **Scenarios covered**: SC-001 (research R6)
  - **Verify RED**: `node --test --test-name-pattern "judgeFreshness" scripts/__tests__/renovate-health.test.mjs` → expected: ≥4 failing — `not implemented`
- [ ] T011 [P] [US1] Tests in `RH` for `main` with an injected `fetch` and `git`:
  - it finds the dashboard by label and title (never a number);
  - it creates the tracking issue, labelled `status/bot-managed`, when it is missing (data-model.md
    `TrackingIssue.title` and `TrackingIssue.label`);
  - it comments on a closed tracking issue and says so;
  - a failed read exits 1 and posts nothing, never "healthy" (FR-005);
  - `--dry-run` posts nothing;
  - `--check-freshness` exits 1 at 8 days + 1 minute.
  - **Scenarios covered**: US1-AC5, US1-AC6, FR-005, FR-006
  - **Verify RED**: `node --test --test-name-pattern "health main" scripts/__tests__/renovate-health.test.mjs` → expected: ≥6 failing — `not implemented`

### Implementation for User Story 1

- [ ] T012 [US1] Implement `parseRepositoryProblems` and `classifyBranch` in `scripts/renovate-health.mjs`
  (data-model.md `DashboardProblem.text`, `BotBranch.name`, `BotBranch.inMain`, `BotBranch.pr` and `BotBranch.class`).
  - **Verify GREEN**: T007's and T008's commands → expected: 0 failures
- [ ] T013 [US1] Implement `buildReport` in `scripts/renovate-health.mjs` (data-model.md `HealthReport.healthy`,
  `HealthReport.body` and `HealthReport.marker`; `BlockedPr.number`, `BlockedPr.title` and `BlockedPr.failing`). Use
  `computeMergeVerdict` and `parseRequiredGlobs` from `scripts/ci-status.mjs`.
  - **Verify GREEN**: T009's command → expected: 0 failures
- [ ] T014 [US1] Implement `judgeFreshness` and the CLI (`--dry-run`, `--check-freshness`, `--lockfile-verdict`, the
  default post) in `scripts/renovate-health.mjs`. It covers data-model.md `TrackingIssue.title`,
  `TrackingIssue.label` and `TrackingIssue.freshness`, with `listAll` for every listing, `git merge-base
  --is-ancestor` for ancestry, `GITHUB_TOKEN` for reads and `CI_DIGEST_TOKEN` for writes (research R2).
  - **Verify GREEN**: T010's and T011's commands → expected: 0 failures; then `node --test scripts/__tests__/renovate-health.test.mjs` passes with 0 skipped
- [ ] T015 [US1] Tests in `WG`, then the workflow `.forgejo/workflows/renovate-health.yml` per
  [contracts/workflows.md](contracts/workflows.md): the health half (the self-test step, the report step with
  `always()`, the digest last).
  - **Verify RED**: `node --test scripts/__tests__/renovate-health-workflows.guard.test.mjs` → expected: failing — `ENOENT … renovate-health.yml`
  - **Verify GREEN**: the same command → expected: 0 failures for the health assertions; then `node scripts/check-ci-digest-coverage.mjs` and `node --test scripts/__tests__/workflow-deps-installed.guard.test.mjs` pass
- [ ] T016 [US1] Add the freshness watchdog step to `.forgejo/workflows/renovate.yml` (research R6). Extend
  `scripts/__tests__/renovate-workflow.guard.test.mjs` first to assert it: after the verdict step, blocking, with
  `GITHUB_TOKEN`.
  - **Verify RED**: `node --test --test-name-pattern "freshness" scripts/__tests__/renovate-workflow.guard.test.mjs` → expected: 1 failing — step not found
  - **Verify GREEN**: the same command → expected: 0 failures
- [ ] T017 [US1] Live dry run, read-only: `node scripts/renovate-health.mjs --dry-run`, with `GITHUB_TOKEN=$FORGE_TOKEN`
  and the forge env set.
  - **Done when**: it prints a report naming dashboard #64 and today's bot branches, and posts nothing.

**Checkpoint**: the report can run. Merging US1 alone gives the weekly signal and its watchdog.

---

## Phase 4: User Story 2 — a lock-file refresh that did not happen is noticed (P1)

**Goal**: after each window, a check that the window ran and what lock-file maintenance did in it.

**Independent Test**: on fixtures, every row of research R3's table gives its verdict. `--now` replays a real window.

### Tests for User Story 2 ⚠️

- [ ] T018 [P] [US2] Tests in `LR` for `deriveWindow(config, now)` (data-model.md `Window.schedule`, `Window.start`
  and `Window.end`):
  - `* 5-6 * * 3` at Wednesday 08:30 UTC gives that day's 05:00–07:00;
  - at Wednesday 06:00, a window in progress, it gives the **previous** week's window;
  - `lockFileMaintenance.schedule` is preferred over `schedule`;
  - a non-UTC timezone throws.
  - **Scenarios covered**: US2-AC4, spec edge case "a run between two windows"
  - **Verify RED**: `node --test --test-name-pattern "deriveWindow" scripts/__tests__/check-lockfile-refresh.test.mjs` → expected: ≥4 failing — `not implemented`
- [ ] T019 [P] [US2] Tests in `LR` for `judgeLockfile`: one case per row of research R3's table, producing data-model.md
  `LockfileVerdict.state`. A PR is matched by head **or** title, per `LockfileVerdict.pr`, using MCM's
  `refs/pull/N/head` case. Every verdict line names the window.
  - **Scenarios covered**: US2-AC1 to US2-AC3, FR-007
  - **Verify RED**: `node --test --test-name-pattern "judgeLockfile" scripts/__tests__/check-lockfile-refresh.test.mjs` → expected: ≥8 failing — `not implemented`
- [ ] T020 [P] [US2] Tests in `LR` for `main`, with an injected `fetch`:
  - it finds the window run among the Actions tasks, filtering client-side by name and start time;
  - it reads `renovate/verdict` on that run's sha;
  - `--verdict-out` writes the JSON;
  - the exit code is 0 for `unaided` and `current`, 1 otherwise;
  - a failed read exits 1.
  - **Scenarios covered**: SC-003
  - **Verify RED**: `node --test --test-name-pattern "lockfile main" scripts/__tests__/check-lockfile-refresh.test.mjs` → expected: ≥4 failing — `not implemented`

### Implementation for User Story 2

- [ ] T021 [US2] Implement `deriveWindow` in `scripts/check-lockfile-refresh.mjs`, with `cronMinutes` from
  `scripts/check-renovate-config.mjs` (data-model.md `Window.schedule`, `Window.start` and `Window.end`).
  - **Verify GREEN**: T018's command → expected: 0 failures
- [ ] T022 [US2] Implement `judgeLockfile` in `scripts/check-lockfile-refresh.mjs` (data-model.md
  `LockfileVerdict.state`, `LockfileVerdict.windowRun`, `LockfileVerdict.result`, `LockfileVerdict.pr` and
  `LockfileVerdict.line`).
  - **Verify GREEN**: T019's command → expected: 0 failures
- [ ] T023 [US2] Implement the CLI (`--now`, `--verdict-out`, `--selftest`) in `scripts/check-lockfile-refresh.mjs`.
  - **Verify GREEN**: T020's command → expected: 0 failures; then `node --test scripts/__tests__/check-lockfile-refresh.test.mjs` passes with 0 skipped
- [ ] T024 [US2] Add the lock-file half to `.forgejo/workflows/renovate-health.yml`: the self-test step, then the check
  writing `lockfile-verdict.json`, before the report. The report reads the file through `--lockfile-verdict`. Extend
  `WG` first.
  - **Verify RED**: `node --test --test-name-pattern "lock-file" scripts/__tests__/renovate-health-workflows.guard.test.mjs` → expected: failing — step not found
  - **Verify GREEN**: the same command → expected: 0 failures
- [ ] T025 [US2] Live replay, read-only: `node scripts/check-lockfile-refresh.mjs --now <now>`.
  - **Done when**: it names the window it derived. Before Wednesday's first window it reports `no-window-run`, which
    is correct then and expected.

**Checkpoint**: a dead lock-file channel fails within a day of the window.

---

## Phase 5: User Story 3 — merged branches do not linger (P2)

**Goal**: a daily reaper, a dry run by default, that never deletes a branch in use.

**Independent Test**: a dry run against the real remote prints a reason for every branch and deletes nothing.

### Tests for User Story 3 ⚠️

- [ ] T026 [P] [US3] Tests in `RM` for `decideBranch`, one case per data-model.md `ReapCandidate.decision` reason:
  - `protected` (`main`, and a `rule_name` glob);
  - `open-pr`;
  - `not-merged`;
  - `ancestry-unknown`;
  - `too-new` (5h 59m against `ReapCandidate.age`);
  - `no-date`;
  - `reap`, at exactly 6 hours.
  - **Scenarios covered**: US3-AC1 to US3-AC4, FR-008, FR-010, SC-004
  - **Verify RED**: `node --test --test-name-pattern "decideBranch" scripts/__tests__/reap-merged-branches.test.mjs` → expected: ≥7 failing — `not implemented`
- [ ] T027 [P] [US3] Tests in `RM` for `main`, with an injected `git` and `fetch`:
  - the default is a dry run, which deletes nothing;
  - `--apply` deletes with `--force-with-lease` to the classified sha (data-model.md `ReapCandidate.sha`);
  - a short or malformed open-PR listing deletes nothing and exits 1;
  - an unreadable protection listing deletes nothing;
  - a failed delete exits 1.
  - **Scenarios covered**: US3-AC5, FR-009, FR-013
  - **Verify RED**: `node --test --test-name-pattern "reaper main" scripts/__tests__/reap-merged-branches.test.mjs` → expected: ≥5 failing — `not implemented`

### Implementation for User Story 3

- [ ] T028 [US3] Implement `decideBranch` in `scripts/reap-merged-branches.mjs` (data-model.md `ReapCandidate.name`,
  `ReapCandidate.decision` and `ReapCandidate.age`).
  - **Verify GREEN**: T026's command → expected: 0 failures
- [ ] T029 [US3] Implement the CLI (`--apply`, `--selftest`, the dry-run default) in `scripts/reap-merged-branches.mjs`.
  It runs `git fetch --prune`, then `for-each-ref`, then `merge-base`, and deletes with `push --force-with-lease`
  (research R7).
  - **Verify GREEN**: T027's command → expected: 0 failures; then `node --test scripts/__tests__/reap-merged-branches.test.mjs` passes with 0 skipped
- [ ] T030 [US3] Add `.forgejo/workflows/branch-reaper.yml` per contracts/workflows.md. Extend `WG` first: the cron,
  dispatch `apply` defaulting to false, the apply flag through `env`, `fetch-depth: 0`, the self-test before the
  reaper, and the digest last.
  - **Verify RED**: `node --test --test-name-pattern "reaper" scripts/__tests__/renovate-health-workflows.guard.test.mjs` → expected: failing — `ENOENT … branch-reaper.yml`
  - **Verify GREEN**: the same command → expected: 0 failures; then `node scripts/check-ci-digest-coverage.mjs` passes
- [ ] T031 [US3] Raise `belay-ci-failures` `keepNewest` from 150 to 200 in
  `infrastructure-as-code/forgejo/registry-retention.yaml`, and update its comment (8 jobs). This is a mutation RED:
  with T015 and T030 in place, the retention guard fails, naming 200.
  - **Verify RED**: `node --test scripts/__tests__/registry-retention.test.mjs` → expected: failing — `keepNewest 150 is below 200`
  - **Verify GREEN**: the same command → expected: 0 failures
- [ ] T032 [US3] Live dry run: `node scripts/reap-merged-branches.mjs` in this worktree (full history).
  - **Done when**: every remote branch gets a `keep` or `would reap` line with its reason, and nothing is deleted.

**Checkpoint**: all three stories work offline and as dry runs.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T033 Wire every new `--selftest` into `scripts:lint` in `scripts/project.json`, with a test that each exits 0.
  - **Done when**: `pnpm nx run scripts:lint` runs and passes them.
- [ ] T034 Coverage: `pnpm nx run scripts:test`.
  - **Done when**: each new module is at ≥ 70% of lines, with 0 skipped tests.
- [ ] T035 [P] Correct feature 011's research R8 in `specs/011-renovate-dependency-bot/research.md`. `setup-node`'s
  `node-version` is extracted through `github-releases` (`actions/node-versions`), as run #83 measured, not the
  `node-version` datasource. Nothing changes in behaviour.
  - **Done when**: R8 states the measured datasource and cites run #83.
- [ ] T036 [P] Add the tracking issue's description text, from research R5, to the runbook section (T037), so creating
  the issue and the runbook say the same thing.
  - **Done when**: `renovate-health.mjs`'s issue-body constant and the runbook quote match.
- [ ] T037 [P] Add "The health loop" to `docs/runbooks/renovate.md`:
  - what each check proves;
  - the schedules;
  - reading the weekly report, and each finding with its remedy;
  - what a missing week means and the watchdog;
  - the reaper's rules and how to dispatch it with `apply`.

  Also update `:142`: the verdict line now ends `; lock file: <result>`.
  - **Done when**: every FR-014 item has a paragraph.
- [ ] T038 [P] Update `docs/runbooks/ci.md`:
  - the two workflows in the workflow list;
  - the floor `:149-150` to 200 and 8 jobs;
  - `CI_DIGEST_TOKEN`'s "Used by" `:169`, adding the health report.
  - **Done when**: `git grep -n "6 bundle-publishing" docs/` is empty.
- [ ] T039 [P] Update `openwiki/invariants/secrets-management.md:23` (canonical): `CI_DIGEST_TOKEN` is also used by the
  health report.
  - **Done when**: the row names both uses.
- [ ] T040 [P] Update the bot runbook's concept page `openwiki/runbooks/renovate.md` with a health-loop bullet.
- [ ] T041 Add a row to `openwiki/invariants/unenforced-rules.md` if anything remains soft. Candidate: the watchdog
  exists only while the bot itself runs. If the bot's workflow is disabled, neither loop reports, and only a human
  notices.
  - **Done when**: the row exists, or a line here explains why none is needed.
- [ ] T042 Refresh every openwiki page whose `resource` changed: `node scripts/wiki-refresh.mjs --stale`, then
  `--record <page>`.
  - **Done when**: `--stale` reports nothing.
- [ ] T043 **Close-out re-search**: re-run T001's searches for `6 bundle-publishing`, `150 versions`, `failure-digest
  step only` and the old verdict example. Fix each remaining hit, or justify it here.
- [ ] T044 Run quickstart §1, the full `pnpm nx run scripts:lint` and `scripts:test` (0 skipped),
  `node scripts/check-speckit-overrides.mjs`, and `node scripts/check-topology-scrub.mjs`. Quickstart §2–§4 run after
  the merge, and are recorded on item #48 (SC-006).
  - **Done when**: the offline commands pass, and the PR body lists the post-merge steps.
- [ ] T045 **Open the PR** from a real branch, with the repository's PR tools (`docs/runbooks/ci.md`):
  1. `git push origin HEAD:012-renovate-health-loop`
  2. `node scripts/forge-pr.mjs open --head 012-renovate-health-loop --title "Feature 012: the dependency bot's health loop (item #48)" --body-file <file>`
  3. `node scripts/ci-status.mjs watch --pr <n>`, until it exits 0
  4. `node scripts/forge-pr.mjs merge <n> --expect-head <full sha>`

  Tick this task in the branch's LAST commit and quote the branch and the PR number. CI evidence goes in the PR's
  closing comment and item #48's, never here.

---

## Dependencies & Execution Order

- **Setup (T001–T002)**, then **Foundational (T003–T006)**: `listAll` and the lock-file suffix are used by US1 and US2.
- **US1 (T007–T017)** and **US2 (T018–T025)** are independent until their workflow halves meet in
  `renovate-health.yml`:
  - T015 creates the file;
  - T024 adds the lock-file steps before the report;
  - the report's `--lockfile-verdict` input is optional, so US1 works without US2.
- **US3 (T026–T032)** is independent of both. T031 needs T015 and T030, because the floor counts their jobs.
- **Polish** comes after all three stories. T045 is last.

## Parallel Examples

```bash
# Foundational: two files
Task: "T003 forge-list tests"    Task: "T005 judgeRun lock-file suffix tests"
# US1 tests, all one file but independent describes; US3's whole phase can run beside US1/US2:
Task: "T026 decideBranch tests in reap-merged-branches.test.mjs"
# Polish docs:
Task: "T037 renovate.md"  "T038 ci.md"  "T039 secrets-management.md"  "T035 011 research R8"
```

## Implementation Strategy

- **MVP = Setup + Foundational + US1**: the weekly report and its watchdog. That is "silence is the alarm".
- **Then US2**: the lock-file channel, the one MCM measured dying repeatedly.
- **Then US3**: the reaper, the safety net behind the merge tool.
- **One PR** for all three (`openwiki/process/pull-request-batching.md`): they share a workflow file and the retention
  floor, so splitting them would not make a failure less ambiguous.
