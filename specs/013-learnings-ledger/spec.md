# Feature Specification: The learnings ledger and its scripted measurement log

**Feature Branch**: `013-learnings-ledger`

**Created**: 2026-11-24

**Status**: Draft

**Input**: User description: "Backlog item #51: BELAY learnings ledger and scripted measurement log (count-repo-metrics.mjs)."

## Context

BELAY has no single place that tells a newcomer, in story form, what this repository has learned about itself: what
was tried, what was measured, and what turned out wrong. The lessons exist, but they are scattered across feature
specs, runbook gotchas and pull-request descriptions, and a reversed lesson usually disappears with the edit that
reversed it.

MovieCollectionManager (MCM) keeps such a document in three parts: a narrative of the current state, rewritten in
place; an **append-only ledger** of lessons, where a lesson's status may change but the lesson is never deleted,
because a reversed lesson's reversal is the useful half; and a **measurement log** of the repository's size and
shape over time. MCM measured that hand-made counts in its log differed from a script's by about a month's growth
(4.5% of its production code). So the numbers in the log must come from a script, and that script must be able to
count an earlier commit too, so a missing column can be back-filled honestly.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Counting the repository at any commit (Priority: P1)

A maintainer runs one command and gets the repository's measurements at a chosen commit (the current one by
default): how many features, how many commits, how many lines of code, tests and documentation, how many test
declarations, gate scripts, guard tests, task lists that carry the RED/GREEN test format, and allowlist entries. The
numbers come only from what is committed at that commit, so uncommitted edits, ignored files and another session's
work in progress never change them, and the same commit always gives the same numbers.

**Why this priority**: the log is only worth keeping if its numbers are trustworthy. Without the script, Part 3 is
hand counts, which MCM measured as wrong by a month's growth.

**Independent Test**: run the command twice on the same commit, once with an uncommitted file added to the working
copy. Both runs print identical numbers, and each number matches a hand-checked count on a small fixture repository.

**Acceptance Scenarios**:

1. **Given** a clean checkout of `main`, **When** the maintainer runs the command with no arguments, **Then** it
   prints every metric for `HEAD`, together with the commit's full identifier and commit date.
2. **Given** an earlier commit identifier, **When** the maintainer passes it, **Then** the metrics describe that
   commit's tree, not the working copy.
3. **Given** an uncommitted or ignored file in the working copy, **When** the command runs, **Then** that file
   changes no metric.
4. **Given** a commit identifier that does not exist, **When** the command runs, **Then** it fails with a message
   naming the identifier and prints no metrics.
5. **Given** a commit from before a measured thing existed (for example, before any allowlist file was added),
   **When** the command runs, **Then** that metric is reported as zero, not as an error.
6. **Given** a request for machine-readable output, **When** the command runs, **Then** it prints the same metrics
   in a structured form that another tool can read.

---

### User Story 2 - A learnings document a newcomer can read (Priority: P1)

A newcomer, human or agent, opens one document and learns the repository's story so far, the lessons it has paid
for, and how its size and shape have changed. The document says plainly that it is a narrative and not a source of
truth: every rule it mentions links to the page that owns that rule, so a reader who wants to act follows the link
instead of trusting the summary.

**Why this priority**: the document is the reason the script exists. Both are P1 because neither is useful alone.

**Independent Test**: open the document. It has the three parts and the update instructions; every rule it states
carries a link to its canonical home, and every link resolves.

**Acceptance Scenarios**:

1. **Given** the document, **When** a reader opens it, **Then** it has Part 1 (the story, rewritten in place),
   Part 2 (the ledger, append-only), Part 3 (the measurement log) and a "how to update" section.
2. **Given** the document's opening, **When** a reader reads it, **Then** it states that the document is a narrative,
   not a source of truth, and that a conflict between it and a linked page is resolved in the linked page's favour.
3. **Given** any rule or procedure the document mentions, **When** a reader looks for its home, **Then** a link to
   the canonical page is next to it.
4. **Given** Part 2, **When** a reader reads a lesson, **Then** the lesson has a stable identifier, the date it was
   learned, a status (for example current, superseded or reversed), the evidence behind it and a link to where the
   rule now lives.
5. **Given** Part 3, **When** a reader reads it, **Then** its first column is the script's output on `main` at a
   named commit, with no hand-typed number in it.

---

### User Story 3 - Keeping the ledger and the log current (Priority: P2)

The ledger and the log stay current without anyone remembering to update them. The quarterly drift audit, which
already files its own successor, gains a step: refresh Part 1, append any new lessons to Part 2, and add a new
script column to Part 3. The "how to update" section says what may be edited in place and what may only be
appended.

**Why this priority**: without a trigger the document decays, but the first version is useful before the trigger
fires.

**Independent Test**: read the audit procedure. It contains the refresh step, naming the command that produces the
new column and the rule that earlier columns and lessons are never edited.

**Acceptance Scenarios**:

1. **Given** the quarterly drift audit procedure, **When** the auditor reaches the new step, **Then** it tells them
   to run the counting command on the commit they read against and append its output as a new log column.
2. **Given** a lesson that turned out wrong, **When** someone updates the ledger, **Then** the "how to update" section
   tells them to change its status and add the reversal, and not to delete or rewrite the original lesson.
3. **Given** an older log column, **When** someone refreshes the log, **Then** the instructions forbid changing it,
   except to back-fill a column for an earlier commit using the same script.

### Edge Cases

- **A shallow clone** (as CI uses) has an incomplete history, so a commit count from it would be wrong. The command
  detects a shallow history and refuses to report the commit count rather than reporting a short one.
- **A metric's definition changes later** (for example, a new file type counts as code): older columns were produced
  under the old definition. The log records, per column, the commit of the script that produced it, so a reader can
  tell which definition applies, and back-filling re-runs the current script.
- **A binary or generated file**: it counts toward no line metric.
- **A file that could fall in two categories** (for example, a markdown file inside a test fixture folder): each
  file is counted in exactly one category, by rules the script states in its help.
- **Vendored files** (third-party tool scaffolding committed to the repository) would inflate "our code". They are
  excluded from the line metrics, and the exclusion is stated in the help.
- **The command is run outside a git repository**: it fails with a clear message.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The counting command MUST read only the committed tree of one commit, given by the operator and
  defaulting to `HEAD`. Nothing in the working copy or the ignored files may change its output.
- **FR-002**: It MUST report: features; commits; non-blank lines of code, of tests and of documentation; test
  declarations; gate scripts; guard tests; task lists that carry the RED/GREEN test format; and allowlist entries.
- **FR-003**: It MUST print the commit's full identifier and commit date with the metrics, so a log column names
  exactly what it measured.
- **FR-004**: It MUST offer a human-readable form and a machine-readable form of the same metrics.
- **FR-005**: It MUST place each counted file in exactly one line category (code, test, documentation, or not
  counted), and its help MUST state the rules, including what is excluded as vendored or generated.
- **FR-006**: It MUST fail, without printing metrics, on an unknown commit or outside a git repository. A metric
  whose source does not exist at that commit MUST be zero.
- **FR-007**: It MUST refuse to report a commit count from a shallow history rather than report a wrong one.
- **FR-008**: It MUST have automated tests, run by the repository's standard test target, that check every metric
  against a small fixture repository with known counts.
- **FR-009**: The learnings document MUST exist with Part 1 (story), Part 2 (ledger), Part 3 (log) and a "how to
  update" section, and MUST state that it is a narrative, not a source of truth.
- **FR-010**: Every rule or procedure the document mentions MUST link to its canonical home.
- **FR-011**: Each ledger entry MUST carry a stable identifier, the date learned, a status, its evidence and a link to
  the rule's current home. Entries MUST never be deleted. A reversal changes the status and adds the reversal.
- **FR-012**: The log's first column MUST be the command's output on `main`, naming the commit counted and the
  commit of the script that counted it. A back-filled column for the first merged feature is optional.
- **FR-013**: The quarterly drift audit procedure MUST gain a step that refreshes Part 1, appends new lessons and
  appends a new log column produced by the command.
- **FR-014**: Wiki pages that summarise any changed source document MUST be refreshed in the same change, and the
  new document MUST be findable from the knowledge index.

### Key Entities

- **Metric snapshot**: the set of measurements for one commit. It has the commit identifier, the commit date, the
  identifier of the script commit that produced it, and one value per metric.
- **Lesson**: one entry in the ledger. It has an identifier, the date learned, a status, a statement, the evidence
  and a link to the rule's current home. An optional "reversed by" points to the lesson that replaced it.
- **Log column**: one metric snapshot, written into the document's measurement table. Columns are only appended or
  back-filled, never edited.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Running the command twice on the same commit, with different working-copy states, gives identical
  output in 100% of runs.
- **SC-002**: On the fixture repository, every metric equals its hand-checked expected value.
- **SC-003**: Every number in Part 3 can be reproduced exactly by re-running the command on the commit its column
  names.
- **SC-004**: 100% of the rules the document mentions link to a canonical home, and every link resolves.
- **SC-005**: A newcomer can find the document from the knowledge index in one step.
- **SC-006**: The next quarterly drift audit can append a log column by following its written procedure, with no
  step needing knowledge outside the document and the runbook.

## Assumptions

- **Features** are the numbered feature folders under `specs/` that contain a spec.
- **Commits** are all commits reachable from the counted commit, merges included.
- **Lines** are non-blank lines. **Test** lines are files in test folders or named as tests. **Documentation** is
  markdown. **Code** is the repository's own script and workflow source outside the test folders. Test fixtures,
  lock files, Spec Kit's vendored scaffolding, binary files and generated files are not counted. The exact rules
  are a planning decision, stated in the command's help.
- **Test declarations** are the individual test cases declared in the test files.
- **Gate scripts** are the checks the repository's CI lint target runs, as recorded at the counted commit.
- **Guard tests** are the test files the repository names as guards.
- **Task lists with Verify RED** are feature task lists that contain at least one Verify RED step.
- **Allowlist entries** are the entries in the security finding allowlists (code scanning and image scanning). The
  dev container's network egress list is a different concept and is not counted.
- The document lives at `docs/BELAY-Learnings.md`. Part 2 is seeded with lessons already recorded elsewhere in the
  repository (gotchas, feature specs, runbooks); no lesson is invented for the occasion.
- The command is an operator tool, run by hand or by the auditor. It is not a merge gate.
