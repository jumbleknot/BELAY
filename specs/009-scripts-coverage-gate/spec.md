# Feature Specification: Coverage gate for the scripts project

**Feature Branch**: `009-scripts-coverage-gate`

**Created**: 2026-11-24

**Status**: Draft

**Input**: User description: "Feature 009: a coverage gate for the scripts/ project (backlog item 53). The constitution requires a minimum of 70% coverage for new features, but no Nx target or workflow measures coverage. The maintainer decided on 2026-11-24 to gate scripts/ now. Also update the unenforced-rules register: the coverage row will point at this feature, and the item 54 row records 'decided not to build'."

## Context

The constitution requires **a minimum of 70% code coverage for new features**. It says so in three places: the Backend, Frontend and AI Agent Quality Standards. Nothing measures it. No build target, workflow or check reports coverage, so the rule is held only by review. The register of unenforced rules (`openwiki/invariants/unenforced-rules.md`) lists it for that reason.

MovieCollectionManager has the same gap. Its only configured threshold sits on a script that no workflow runs. A threshold that nothing runs is indistinguishable from no threshold.

`scripts/` is the only project in BELAY with tests today: 38 source files and about 1,150 tests. On 2026-11-24 the maintainer decided to gate it now rather than amend the constitution. A baseline measured that day, restricted to the 38 source files, read:
- 91.4% of lines in total;
- 81.1% of branches;
- 91.7% of functions;
- one file below 70% of lines: the SAST orchestrator, at 67.8%.

The same measurement exposed two traps the gate must defend against:
- **A file no test loads is not reported at all.** It is absent from the report, not shown at 0%. A gate that reads only the report would therefore pass a brand-new script with no tests.
- **An unrestricted report also counts the test files themselves and temporary fixture directories.** That inflates the total.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A change that drops coverage below the floor is refused (Priority: P1)

A contributor, human or AI session, changes a script or adds one, and opens a pull request. If any source file in the scripts project now has less than 70% of its lines exercised by the tests, or the project as a whole does, the required check fails. The failure names each file below the floor, its coverage and the floor. The contributor fixes it by adding tests, or by deleting code nobody needs, and the check passes.

**Why this priority**: this is the whole point of the feature. It turns a stated rule into an enforced one, which is the reason the coverage row is in the register.

**Independent Test**: on a branch, add a source file with logic that no test exercises, or delete a test so that an existing file falls below 70%. The required check fails and names that file. Restore the change and the check passes.

**Acceptance Scenarios**:

1. **Given** every source file is at or above the floor, **When** the required check runs, **Then** it passes and reports the total line coverage and the lowest-covered file.
2. **Given** a change leaves one source file below 70% of lines, **When** the required check runs, **Then** it fails and names that file, its measured coverage and the floor.
3. **Given** a new source file that no test loads, **When** the required check runs, **Then** it fails and names the file as having no coverage data. It never passes just because the file is missing from the report.
4. **Given** the total line coverage falls below 70% while every listed file is above it (for example, because files are missing from the report), **When** the check runs, **Then** it fails on the total.

---

### User Story 2 - The same check runs locally and in CI (Priority: P1)

A contributor can run the coverage check on their own machine with the same single command that CI runs, before pushing, and get the same verdict.

**Why this priority**: every gate in this repository is reproducible locally through the task runner. A coverage gate that only CI can run would turn every failure into a push-and-wait loop.

**Independent Test**: run the documented command locally on a tree that passes and on one that fails. Each verdict matches the CI verdict for the same commit.

**Acceptance Scenarios**:

1. **Given** a clean checkout of `main`, **When** the contributor runs the documented coverage command, **Then** it passes with the same totals CI reports for that commit.
2. **Given** the coverage check fails in CI, **When** the contributor reads the failure through the existing CI failure-reading tooling, **Then** the failure output names the files below the floor, with no need to open the raw CI log.

---

### User Story 3 - The gate proves it can still fail (Priority: P2)

Before the real measurement is judged, the gate checks itself. It is fed one coverage result that must pass and others that must fail: a file below the floor, a file missing from the report, and a total below the floor. It fails loudly if it ever accepts one of the failing inputs.

**Why this priority**: every gate in this repository has a self-test that runs before the real check. A gate that has silently stopped detecting anything reads as a pass, which is the exact failure mode this feature exists to remove.

**Independent Test**: break the gate's comparison on purpose, for example so that it never reports a file below the floor. The self-test fails. Revert the break.

**Acceptance Scenarios**:

1. **Given** the gate's logic is intact, **When** its self-test runs, **Then** it passes.
2. **Given** the gate's per-file comparison is broken, **When** its self-test runs, **Then** it fails and names the scenario that was wrongly accepted.

---

### User Story 4 - The documents tell the truth about what is enforced (Priority: P3)

A reader of the register of unenforced rules, the testing-tiers page or the validation checklist sees that coverage of the scripts project is now gated, at what floor and by which check. They also see that it is not yet gated for projects that do not exist yet. The register also records the decision on backlog item 54: a mechanical spec-before-code check was evaluated and deliberately not built.

**Why this priority**: the register is only useful if it is accurate. A gated rule left listed as soft, or a decided item left as "evaluate", misleads in the same way an ungated rule listed as gated would.

**Independent Test**: read the register after the feature merges. The coverage entry is gone, or narrowed to "projects other than scripts". The spec-before-code entry records "decided not to build" with its reason. The testing-tiers page lists the coverage gate.

**Acceptance Scenarios**:

1. **Given** the gate has landed, **When** a reader opens the register, **Then** the coverage entry no longer claims nothing measures coverage. Either it is removed or it covers only projects that have no gate.
2. **Given** the item 54 decision, **When** a reader opens the register, **Then** the spec-before-code entry states the check was evaluated and deliberately not built, with the reason, and names no open backlog item as closing it.

### Edge Cases

- **A source file that no test imports** (for example, a new script, or one exercised only by running it as a separate process): it must count as uncovered and fail, never be silently skipped.
- **Code run only through a separate process** (a test that runs a script as a command rather than importing it): whether that execution counts toward coverage must be stated, and measured consistently locally and in CI. If it does not count, a file whose behaviour is tested only that way may need tests that import it.
- **Test files, test fixtures and temporary directories** must never count as source and never inflate the total.
- **A coverage tool that produces no report** (it crashed, or nothing ran): the gate fails closed and does not pass with "no files below the floor".
- **A skipped test** lowers coverage like any other missing test. The gate does not treat a skip as an exemption.
- **A file the floor cannot reasonably reach** (for example, a thin entry point that only runs real external tools): handled through a recorded, bounded exception with a written reason. Never by lowering the floor for everyone, and never by an unrecorded skip. The baseline file below the floor is brought above it by this feature rather than exempted.
- **Files under `scripts/__tests__/`, and shell or PowerShell scripts**, are not measured. Only the project's JavaScript source modules are.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The scripts project MUST have a coverage check, run through the repository's task runner, that measures line coverage of its source modules while the project's whole test suite runs.
- **FR-002**: The check MUST fail when any single source module has less than **70%** of its lines covered, and MUST name each such module with its measured coverage and the floor.
- **FR-003**: The check MUST fail when the total line coverage across all source modules is below **70%**.
- **FR-004**: The check MUST compare its measurement against the list of source modules in the tree, not only the modules present in the coverage report. A source module with no coverage data MUST fail as uncovered.
- **FR-005**: The measured set MUST be exactly the project's JavaScript source modules. Test files, fixtures and any temporary or out-of-tree paths MUST be excluded from both the per-file and the total figures.
- **FR-006**: The check MUST fail closed: if the coverage report is missing, empty or unreadable, it fails with a message saying so. It never passes because nothing was measured.
- **FR-007**: The check MUST have a self-test that runs before the real measurement. The self-test MUST cover at least: a passing result, a file below the floor, a source file missing from the report, and a total below the floor. It MUST fail if any failing input is accepted.
- **FR-008**: The check and its self-test MUST run inside the existing required CI check, so a pull request cannot merge while coverage is below the floor.
- **FR-009**: The same command MUST reproduce the CI verdict locally.
- **FR-010**: On failure, the output MUST be readable through the repository's existing CI failure digest. The files below the floor appear in the failure summary.
- **FR-011**: On success, the check MUST print the total line coverage and the lowest-covered module, so a reader sees the margin without opening a report. Branch and function coverage MAY be reported but MUST NOT gate.
- **FR-012**: Any per-module exception MUST be recorded in one reviewed place, with:
  - the module;
  - a lower floor, which is never below 50%;
  - a written reason;
  - who added it;
  - an expiry or re-check date.

  An exception MUST stop applying when it expires. This feature MUST land with **no** exceptions: the SAST orchestrator, below the floor at baseline, is brought to at least 70% by new tests.
- **FR-013**: The floor MUST be stated once, in one place that the check reads, and MUST NOT be lowered to make a failing change pass. A change to the floor is a reviewed change to that place.
- **FR-014**: The register of unenforced rules MUST be updated:
  - the coverage entry is removed, or narrowed to projects other than scripts;
  - the spec-before-code entry records that backlog item 54 was evaluated and deliberately not built (maintainer decision, 2026-11-24), with its reason.
- **FR-015**: The testing-tiers page, the validation checklist and the task-runner page MUST describe the coverage check, wherever they list what the required check runs.

### Key Entities

- **Coverage floor**: the minimum share of lines (70%) each source module, and the project in total, must have covered. It is stated in exactly one place.
- **Source module**: a JavaScript module of the scripts project that the gate measures. Test files and fixtures are not source modules.
- **Coverage exception**: a recorded, expiring permission for one named module to sit below the floor, with a reason. This feature lands with none.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A pull request that leaves any scripts source module below 70% line coverage is refused by the required check, every time. This is demonstrated on a branch for each of: a below-floor file, an untested new file, and a below-floor total.
- **SC-002**: When the feature merges, every scripts source module is at or above 70% line coverage, and the exception list is empty.
- **SC-003**: A contributor reproduces the CI coverage verdict locally with one documented command, and the totals agree with CI's to within 0.1 percentage points for the same commit.
- **SC-004**: The required check's run time grows by no more than 50% of the test suite's own run time. Measure it with the existing step-duration tooling, before and after.
- **SC-005**: Breaking the gate's comparison on purpose makes its self-test fail. This is demonstrated once, during implementation, and recorded.
- **SC-006**: After merge, the register of unenforced rules lists no entry that the coverage gate has closed, and records the item 54 decision.

## Assumptions

- **The rule applies to all current source modules, not only the changed ones.** The constitution says "new features". With one file below the floor at baseline, gating the whole project is simpler and stricter than a changed-lines measurement, and costs one file's worth of tests. A per-change (diff) measurement is out of scope.
- **Line coverage is the gated metric**, matching the constitution's single number and MovieCollectionManager's configured threshold. Branch coverage is reported, not gated. Several modules are below 70% of branches at baseline, which would make a branch gate a separate decision.
- **Shell and PowerShell scripts under `scripts/` are out of scope.** The JavaScript test runner cannot measure them.
- **Coverage is measured by the platform's built-in tooling where it suffices.** Adding a coverage dependency with an install script would be a structural decision needing the maintainer's approval and an ADR. Choosing the tool is for the plan.
- **Projects that do not exist yet** (under `backend/`, `frontend/`, `agents/` and the other product folders) are out of scope. Each will gate its own coverage when it arrives, and the register says so.
- **The register update for backlog item 54 rides in this feature's pull request** rather than a separate one. It is a one-line documentation change in a file this feature already edits. Item 54 closes when this feature merges.
- The floor of 70% is the constitution's number and is not re-litigated here.
