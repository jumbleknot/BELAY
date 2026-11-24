<!-- forked-from: .specify/templates/tasks-template.md sha256=fc29a233f6f5a27ca31f1aa46b596af6500c627441c6e62b2bc4a1d721525842 spec-kit=1.4.2 -->
---

description: "Task list for feature 013: the learnings ledger and its scripted measurement log"
---

# Tasks: The learnings ledger and its scripted measurement log

**Input**: Design documents from `specs/013-learnings-ledger/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R7), data-model.md, contracts/cli.md, quickstart.md

**Tests**: REQUIRED (constitution "Test-Driven Development"). Test tasks carry **Verify RED**, and their paired
implementation tasks carry **Verify GREEN**, per `docs/templates/feature-test-tasks-template.md`. Documentation
tasks use the "Done when" form.

**Test command convention**: node's flags go **before** the path, or the pattern is ignored and every test runs
(see [instrument traps](../../openwiki/gotchas/instrument-traps.md)):
`node --test --test-name-pattern "<pattern>" scripts/__tests__/count-repo-metrics.test.mjs`

**Working copy**: worktree `/home/coder/worktrees/013-learnings-ledger`, branch `013-learnings-ledger`. Never commit
from `/workspaces/belay`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependencies)
- **[Story]**: the user story this task belongs to (US1, US2, US3)

---

## Phase 1: Setup

**Purpose**: the module boundary exists, so every RED fails on an assertion, not on a missing import.

- [x] T001 Create `scripts/count-repo-metrics.mjs` as a **stub**:
  - the header comment (why it exists: MCM's 4.5% hand-count gap, research R5's transcription gap), usage and exit
    codes from contracts/cli.md;
  - exports `classifyPath`, `countNonBlankLines`, `countTestDeclarations`, `countGateScripts`,
    `measureCommit`, `formatText` and `mergeLogColumn`, each throwing `new Error('not implemented')`;
  - the `isMain` entry point.
  - **Done when**: `node -e "import('./scripts/count-repo-metrics.mjs').then(m => console.log(Object.keys(m).length))"` prints `7`
- [x] T002 **Doc-impact sweep** (constitution "Documentation"). This feature renames and removes nothing. It adds
  `scripts/count-repo-metrics.mjs`, `docs/BELAY-Learnings.md` and a new step in the quarterly drift audit. The
  searches are for the new names (to catch a collision) and for the documents that describe the audit.
  - **Command**: `git grep -n -F "<term>" -- '*.md' ':!specs/' ':!docs/proposals/' ':!docs/decisions/'`
  - **Terms**: `count-repo-metrics`, `BELAY-Learnings`, `Learnings`, `learnings`, `measurement log`, `drift audit`,
    `Audit log`, `doc-drift.md`
  - **Result** (run 2026-11-24 on `cf9b694`):
    - `count-repo-metrics`, `BELAY-Learnings`, `Learnings`, `measurement log`: no hits. The names are free.
    - `learnings` → `openwiki/INSTRUCTIONS.md:194` (why learnings are not written into the instruction file).
      The ledger is a new place a reader may think a learning *goes*, so **→ T024**: say that the ledger indexes
      lessons and is never their home.
    - `drift audit` → `docs/runbooks/doc-drift.md:48` → **T016** (the new step; traced as T020). `openwiki/runbooks/doc-drift.md:28`
      → **T022** (V17 refresh). `docs/repo-foundation-setup.md:411` → **T025** (the playbook's one-line description
      of the audit gains the ledger refresh). `openwiki/invariants/unenforced-rules.md:48`: no change, because it
      states a step the audit still has.
    - `Audit log` → `docs/runbooks/doc-drift.md:85`: no change. This is the audit's drift-rate log, a different
      table from the learnings log. T020 keeps the two apart by name.
    - `doc-drift.md` → `AGENTS.md:73`, `openwiki/quickstart.md:60`, `openwiki/process/constitution.md:50`,
      `openwiki/invariants/feature-validation-checklist.md:19`, `openwiki/runbooks/index.md:6`: no change. They
      link to the page, whose title and subject do not change. `docs/repo-foundation-setup.md:410,814`:
      line 410 → T025; line 814 is dated history.

---

## Phase 2: Foundational

**Purpose**: a fixture-repository helper that every US1 test shares.

- [x] T003 Write the fixture builder at the top of `scripts/__tests__/count-repo-metrics.test.mjs`: `makeRepo(files, { commits })`.
  - It creates a temporary directory, runs `git init -q -b main` with a local `user.name` and `user.email`, writes
    `files` (a path → content map), and commits each listed batch.
  - It returns `{ dir, shas }`, and cleans up in `after()`.
  - The test file imports only the stub's exports.
  - **Done when**: `node --test scripts/__tests__/count-repo-metrics.test.mjs` runs and reports 0 tests or only
    the helper's own smoke test, passing.

**Checkpoint**: the stub and the fixture helper exist, and the user stories can start.

---

## Phase 3: User Story 1 - Counting the repository at any commit (Priority: P1) 🎯 MVP

**Goal**: one command prints every metric for the committed tree of one commit (FR-001 to FR-008).

**Independent Test**: quickstart §1–§3: identical output with a dirty working copy, and refusals with the
documented exit codes.

### Tests for User Story 1 (REQUIRED — TDD checkpoint format) ⚠️

- [x] T004 [P] [US1] Table-driven test of `classifyPath` in `scripts/__tests__/count-repo-metrics.test.mjs`, with
  one row per rule in research R2:
  - excluded: `.specify/x.md`, `.claude/skills/speckit-plan/SKILL.md`, `scripts/__tests__/fixtures/a.md`,
    `security/sast/rules/r.py`, `security/sast/reports/f.json`, `pnpm-lock.yaml`;
  - test: `scripts/__tests__/a.test.mjs`, `scripts/__tests__/jsonc.mjs`;
  - docs: `docs/x.md`, `specs/001-a/spec.md`;
  - code: `scripts/a.mjs`, `scripts/a.sh`, `scripts/a.ps1`, `.devcontainer/Dockerfile`,
    `.devcontainer/toolchain.Dockerfile`, `.forgejo/workflows/g.yml`;
  - not counted: `renovate.json`, `security/sast/allowlist.yaml`, `LICENSE`, `.gitkeep`.
  - **Scenarios covered**: FR-005; spec edge cases "A file that could fall in two categories", "Vendored files"
  - **Verify RED**: `node --test --test-name-pattern "classifyPath" scripts/__tests__/count-repo-metrics.test.mjs` → expected: failing — `not implemented`
- [x] T005 [P] [US1] Unit tests of `countNonBlankLines` (blank and whitespace-only lines skipped, no trailing newline,
  CRLF; a buffer with a NUL byte → 0), `countTestDeclarations` (`test(`, `test.skip(`, `it(`, `t.test(` counted;
  `// test(` in a comment, `retest(` and `describe(` not), and `countGateScripts` (a `commands` list naming one
  script twice, `--selftest` and a real run, counts 1; a single `command` string; no lint target → 0; not JSON →
  throws). All in the same test file.
  - **Scenarios covered**: FR-002 (test declarations, gate scripts), research R3, spec edge case "A binary file"
  - **Verify RED**: `node --test --test-name-pattern "countNonBlankLines|countTestDeclarations|countGateScripts" scripts/__tests__/count-repo-metrics.test.mjs` → expected: failing — `not implemented`
- [x] T006 [US1] Fixture-repository tests of `measureCommit({ cwd, rev })` in the same file. The fixture's tree has
  hand-counted contents covering every metric in data-model.md `MetricSnapshot.metrics.*`:
  - 2 features, one with a `Verify RED` tasks.md and one with a tasks.md without it, and a third `specs/` directory
    lacking spec.md;
  - a guard test;
  - a `scripts/project.json` with a lint target;
  - two `security/*/allowlist.yaml` files, one a 2-entry list and one comments-only;
  - a fixture `.md`, a `.specify/` file and a binary.
  The tests assert:
  - every metric exactly, plus `rev` (40 hex), `commitDate` and `allowlists` per file;
  - after an uncommitted edit and an untracked file, the snapshot is deep-equal (SC-001);
  - `--rev` at the first of two commits gives the first commit's counts, and `commits` = 1;
  - a rev with no `security/` gives `allowlistEntries` 0, and no `scripts/project.json` gives `gateScripts` 0;
  - an unknown rev throws, naming it;
  - a non-repository directory throws;
  - a malformed allowlist (a mapping at the top level) throws, naming the file;
  - a shallow clone (`git clone --depth 1 file://…`) gives `commits: null` (research R4);
  - `scriptCommit` is read from the script's own repository, never the counted one, and is a short sha (optionally
    `+dirty`) or `untracked` (data-model.md `MetricSnapshot.scriptCommit`).
  - **Scenarios covered**: US1-AC1, US1-AC2, US1-AC3, US1-AC4, US1-AC5; FR-001, FR-002, FR-003, FR-006, FR-007; SC-001, SC-002
  - **Verify RED**: `node --test --test-name-pattern "measureCommit" scripts/__tests__/count-repo-metrics.test.mjs` → expected: failing — `not implemented`
- [x] T007 [US1] CLI tests in the same file. They spawn `node scripts/count-repo-metrics.mjs` with `cwd` set to a fixture
  repository, and assert:
  - `--json` parses to the snapshot;
  - the text form has the header line and the 11 labels from contracts/cli.md;
  - `--help` exits 0 and prints the R2 rules, naming every category (`code`, `test`, `docs`, not counted) and the
    `speckit-taskstoissues` caveat;
  - `--revv`, `--rev` without a value, a positional argument, and `--json --append-log f` each exit 2 with empty
    stdout;
  - `--rev nope` exits 1 with empty stdout and stderr naming `nope`.
  - **Scenarios covered**: US1-AC4, US1-AC6; FR-004; contracts/cli.md exit codes
  - **Verify RED**: `node --test --test-name-pattern "CLI" scripts/__tests__/count-repo-metrics.test.mjs` → expected: failing — non-zero exit / `not implemented`

### Implementation for User Story 1

- [x] T008 [US1] Implement `classifyPath`, `countNonBlankLines`, `countTestDeclarations` and `countGateScripts` in
  `scripts/count-repo-metrics.mjs` (research R2, R3) (prerequisite: T004 and T005 verified RED)
  - **Test approval checkpoint** (constitution TDD: tests written → user approval → tests fail): the US1 test list
    (T004–T007) is approved by the maintainer before any implementation. Approval given 2026-11-24 with the
    instruction "apply all fixes, then implement, work CI to green, then merge"; the PR description lists the tests
    for review.
  - **Verify GREEN**: `node --test --test-name-pattern "classifyPath|countNonBlankLines|countTestDeclarations|countGateScripts" scripts/__tests__/count-repo-metrics.test.mjs` → expected: 0 failures
- [x] T009 [US1] Implement `measureCommit` in `scripts/count-repo-metrics.mjs`, filling data-model.md
  `MetricSnapshot.rev`, `.commitDate`, `.scriptCommit`, `.metrics.*` and `.allowlists` (prerequisite: T006 verified
  RED):
  - `rev-parse --verify <rev>^{commit}`, then `ls-tree -r -z --full-tree`, skipping modes `120000` and `160000`;
  - one `cat-file --batch` over all blob ids, with the output parsed by declared size (research R1);
  - `rev-list --count`, unless `rev-parse --is-shallow-repository` is `true` (R4);
  - `yaml` for the allowlists.
  - **Verify GREEN**: `node --test --test-name-pattern "measureCommit" scripts/__tests__/count-repo-metrics.test.mjs` → expected: 0 failures
- [x] T010 [US1] Implement `formatText` and the CLI in `scripts/count-repo-metrics.mjs` (contracts/cli.md): parse with
  `partitionArgsWithValues` and `wantsHelp` from `lib/argv-contract.mjs`, print nothing to stdout on exit 1 or 2,
  and include the R2 and R3 rules in `--help` (prerequisite: T007 verified RED)
  - **Verify GREEN**: `node --test scripts/__tests__/count-repo-metrics.test.mjs` → expected: 0 failures; then
    `node scripts/count-repo-metrics.mjs` in the worktree prints all 11 metrics in under 5 s

**Checkpoint**: US1 works alone. quickstart §1–§3 pass, except the `--append-log` line.

---

## Phase 4: User Story 2 - A learnings document a newcomer can read (Priority: P1)

**Goal**: `docs/BELAY-Learnings.md` with Parts 1–3 and "How to update", and a log written only by the script (FR-009
to FR-012).

**Independent Test**: quickstart §4 and §5.

### Tests for User Story 2 (REQUIRED — TDD checkpoint format) ⚠️

- [x] T011 [P] [US2] Unit tests of `mergeLogColumn(markdown, snapshot)` in `scripts/__tests__/count-repo-metrics.test.mjs`
  (data-model.md "Log table"). They cover:
  - a document with empty markers gets the header, the `Script commit` row and the 11 metric rows;
  - a second, later snapshot appends a column to the right;
  - an earlier snapshot (a back-fill) is inserted to the left in `commitDate` order;
  - the same rev again throws `already logged`;
  - a snapshot with `commits: null` throws `shallow`;
  - a row present in the table but not in the snapshot gets `—`, and a metric new to the table gets `—` in older
    columns;
  - a missing start or end marker throws `markers`;
  - every byte outside the markers is unchanged.
  - **Scenarios covered**: US2-AC5, US3-AC3; FR-012; SC-003; data-model.md log-table invariants
  - **Verify RED**: `node --test --test-name-pattern "mergeLogColumn" scripts/__tests__/count-repo-metrics.test.mjs` → expected: failing — `not implemented`
- [x] T012 [US2] CLI test of `--append-log` in the same file, on a fixture repository and a temporary markdown file:
  - the file gains the column and the command exits 0;
  - a second run exits 1 and leaves the file byte-identical;
  - a file without markers exits 1, unchanged.
  - **Scenarios covered**: US2-AC5; contracts/cli.md exit code 1 cases
  - **Verify RED**: `node --test --test-name-pattern "append-log" scripts/__tests__/count-repo-metrics.test.mjs` → expected: failing

### Implementation for User Story 2

- [x] T013 [US2] Implement `mergeLogColumn` and the `--append-log` path in `scripts/count-repo-metrics.mjs` (research
  R5): read the file, merge, and write only on success. The script commit comes from
  `git log -1 --format=%h HEAD -- scripts/count-repo-metrics.mjs` run in the **script's own repository**, plus
  `+dirty` when `git status --porcelain -- <that file>` is non-empty, or `untracked` when the log is empty (data-model.md `MetricSnapshot.scriptCommit`) (prerequisite:
  T011 and T012 verified RED; the same approval checkpoint as T008 covers T011, T012 and T014's link test)
  - **Verify GREEN**: `node --test scripts/__tests__/count-repo-metrics.test.mjs` → expected: 0 failures
- [x] T014 [US2] Write `docs/BELAY-Learnings.md`. The opening says it is a narrative, not a source of truth: where it
  conflicts with a linked page, the page wins. Then:
  - **Part 1 — The story so far**: features 001–012 in a few paragraphs, rewritten in place at each refresh.
  - **Part 2 — The ledger**: append-only; seed it with the lessons in research R6, each in the data-model.md
    `Lesson` shape, with its evidence and home links.
  - **Part 3 — The measurement log**: empty markers, filled by T015.
  - **How to update**: what is rewritten (Part 1), appended (Parts 2 and 3) and never edited (lessons and earlier
    columns); a lesson's status transitions; the exact `--append-log` command.
  - **Test first** (SC-004): add a test `learnings document links resolve` to
    `scripts/__tests__/count-repo-metrics.test.mjs` that reads `docs/BELAY-Learnings.md`, extracts body links with
    `bodyLinks` from `scripts/openwiki-links.mjs`, and asserts every relative link's target exists (anchors
    stripped). **Verify RED**: `node --test --test-name-pattern "links resolve" scripts/__tests__/count-repo-metrics.test.mjs` → expected: failing — `ENOENT` on the missing document.
  - **Done when**: every rule mention has a link, the link test passes (**Verify GREEN**: same command → 0 failures),
    and each lesson has all six fields.
- [x] T015 [US2] Fill Part 3 with the script, never by hand (research R7):
  `node scripts/count-repo-metrics.mjs --rev cf9b694 --append-log docs/BELAY-Learnings.md`, then
  `node scripts/count-repo-metrics.mjs --rev c74bc25 --append-log docs/BELAY-Learnings.md`. Commit the script
  (T013) **before** this, so the `Script commit` cell is a real commit and not `+dirty`.
  - **Done when**: the table has 2 columns, `c74bc25` left of `cf9b694`, and re-running either command exits 1
    (`already logged`).

**Checkpoint**: US1 and US2 deliver the backlog item's first three acceptance criteria.

---

## Phase 5: User Story 3 - Keeping the ledger and the log current (Priority: P2)

**Goal**: the quarterly drift audit refreshes the document (FR-013).

**Independent Test**: read the audit procedure. It names the command and the append-only rule.

- [x] T016 [US3] Add the step to the quarterly drift audit procedure in `docs/runbooks/doc-drift.md`, after step 10
  (before "File the next audit", so only that step is renumbered). In the same edit, correct the layer table's
  "triggered by check 4 of the audit" to name the actual layer-2 step (step 9). The step:
  - refresh Part 1 of `docs/BELAY-Learnings.md`;
  - append new lessons to Part 2, with status changes for any reversed;
  - run `node scripts/count-repo-metrics.mjs --rev <the commit you read against> --append-log docs/BELAY-Learnings.md`
    from a full clone.
  Say that this log is distinct from the audit's own drift-rate "Audit log" table.
  - **Done when**: the step names the command, the full-clone requirement and the never-edit rule, and links to
    the document's "How to update"; and the runbook's layer-3 description (lines 1–20) mentions the ledger
    refresh (absorbs T021).

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T017 [P] Add the wiki concept `openwiki/projects/learnings-ledger.md`: `resource: docs/BELAY-Learnings.md`, a
  summary of what the document is and isn't, and gotchas (a narrative, not a source; never hand-type a log number;
  shallow clones). List it in `openwiki/projects/index.md`. Record its fingerprint with
  `node scripts/wiki-refresh.mjs --record openwiki/projects/learnings-ledger.md`.
  - **Done when**: `node scripts/check-openwiki-okf.mjs` and `node scripts/check-openwiki-governance.mjs` pass.
- [x] T018 [P] Add one line to AGENTS.md's Knowledge index under **Projects**, linking the new concept page (FR-014,
  SC-005).
  - **Done when**: the line exists, and the OKF gate passes.
- [x] T019 Write the counting rules into the help text and the document consistently. The categories in `--help`
  (T010) and those named in Part 3's preamble (T014) say the same thing; the document links to `--help` rather
  than restating the table.
  - **Done when**: `docs/BELAY-Learnings.md` contains no copy of the R2 rule list.
- [x] T020 *(merged into T016 by the analysis, R1)*: the sweep's hit on `docs/runbooks/doc-drift.md:48` is done by
  T016. Tick with T016.
- [x] T021 *(merged into T016 by the analysis, R2)*: the layer-3 description check is T016's "Done when". Tick with
  T016.
- [x] T022 Refresh `openwiki/runbooks/doc-drift.md` for the changed resource (V17): `node scripts/wiki-refresh.mjs --stale`,
  then `--diff` and an edit to the summary (its step list gains the ledger refresh), then `--record`.
  - **Done when**: `node scripts/wiki-refresh.mjs --stale` lists nothing.
- [x] T023 Note under the coverage gate: no change to `scripts/coverage-policy.yaml`. The module matches `scripts/*.mjs`.
  - **Done when**: `pnpm nx run scripts:test` lists `count-repo-metrics.mjs` at ≥ 70% lines.
- [x] T024 [P] Doc task from the sweep: `openwiki/INSTRUCTIONS.md` near line 194 ("Where a new learning goes"). Add one
  sentence: the learnings ledger (`docs/BELAY-Learnings.md`) indexes lessons and links to their homes; a new
  learning still goes to its home, and the ledger gains the entry at the next quarterly refresh.
  - **Done when**: the sentence is there, and the OKF gate passes.
- [x] T025 [P] Doc task from the sweep: `docs/repo-foundation-setup.md:410–411`. The description of
  `docs/runbooks/doc-drift.md` gains "and the refresh of a learnings ledger whose measurement log is written by a
  counting script". If any `openwiki/` page cites this playbook as its `resource`, refresh it (V17).
  - **Done when**: the clause is there, and `node scripts/wiki-refresh.mjs --stale` lists nothing.
- [x] T026 **Close-out re-search**: re-run T002's searches. This feature renames nothing, so the check is that every
  new hit for `count-repo-metrics` and `BELAY-Learnings` is intended: the runbook, the playbook, the wiki concept,
  INSTRUCTIONS.md and AGENTS.md. Record the hit list here.
  - **Result** (2026-11-24, after `git add`; `git grep` searches only tracked files, so the new files are invisible
    until staged, an instrument trap worth naming): `count-repo-metrics` → `AGENTS.md`, `docs/BELAY-Learnings.md`,
    `docs/repo-foundation-setup.md`, `docs/runbooks/doc-drift.md`, `openwiki/projects/index.md`,
    `openwiki/projects/learnings-ledger.md`, `openwiki/runbooks/doc-drift.md`. `BELAY-Learnings` →
    `docs/repo-foundation-setup.md`, `docs/runbooks/doc-drift.md`, `openwiki/INSTRUCTIONS.md`,
    `openwiki/projects/index.md`, `openwiki/projects/learnings-ledger.md`. Every hit is intended; no old identifier
    exists to re-search.
- [x] T027 Run the CI targets, plus the checks this diff touches, in the worktree. That needs a real install, not the
  symlink: `rm node_modules && CI=true pnpm install --frozen-lockfile`. Then run:
  `pnpm nx run scripts:lint`, `pnpm nx run scripts:test`, `node scripts/check-openwiki-okf.mjs` and
  `node scripts/check-topology-scrub.mjs`.
  - **Done when**: all exit 0, and the test summary shows **0 skipped**: watch the skip count.
  - **Result** (2026-11-24): `scripts:lint` exit 0; `scripts:test` exit 0. Run directly with
    `node scripts/check-coverage.mjs --run`: 1494 tests, 1494 pass, 0 fail, **0 skipped**;
    `count-repo-metrics.mjs` 98.78% lines; total 92.74%. OKF, governance and topology-scrub gates pass;
    `wiki-refresh.mjs --stale` lists nothing.
- [x] T028 Run quickstart.md §1–§5 and tick its §5 boxes.
- [x] T029 **Open the PR** (branch `013-learnings-ledger`, PR #71) from a real branch, with the repository's PR tools (`docs/runbooks/ci.md`):
  1. `git push origin HEAD:013-learnings-ledger`
  2. `node scripts/forge-pr.mjs open --head 013-learnings-ledger --title "Feature 013: the learnings ledger and its scripted measurement log (item #51)" --body-file <file>`
  3. `node scripts/ci-status.mjs watch --pr <n>`, until it exits 0 (exit 3 means still waiting)
  4. `node scripts/forge-pr.mjs merge <n> --expect-head <full sha>`

  Tick this task in the branch's LAST commit and quote the branch and the PR number. **CI evidence is never
  recorded here.** The run ids, the CI verdict and the merge sha go in the PR's closing comment, and in item #51's
  closing comment, which verifies its four acceptance criteria before closing it.

---

## Dependencies & Execution Order

- **Setup (T001, T002)** → **Foundational (T003)** → **US1 (T004–T010)** → **US2 (T011–T015)** → **US3 (T016)** → **Polish (T017–T029)**.
- US2 depends on US1: `--append-log` writes a `measureCommit` snapshot. US3 depends on US2 only for the document it
  names; its runbook text can be written in parallel with T014.
- Within US1: T004 and T005 are RED, then T008 is GREEN. T006 is RED, then T009. T007 is RED, then T010.
- T015 needs T013 **committed** (see T015).
- T022 follows T016, and T017 follows T014. T027 follows every file change, and T029 is last.

### Parallel Opportunities

- T004 and T005 are independent test groups, but in one file: write them in one sitting, not concurrently.
- T017, T018, T024 and T025 touch different files and can run in parallel after T014.
- T014 (prose) can be drafted while US1 is implemented. T015 waits for T013.

## Implementation Strategy

### MVP First (User Story 1)

T001–T010 give a working, tested `count-repo-metrics.mjs`. That is the backlog item's first acceptance criterion,
and is useful alone (`--json` for any commit).

### Incremental Delivery

1. US1: the script.
2. US2: the document, its log written by the script.
3. US3: the audit step.
4. Polish: the wiki, the index and the gates.

One PR carries all of it, because the pieces share one review story ([PR batching](../../openwiki/process/pull-request-batching.md)).
A failure would not be ambiguous: the script's tests and the document's gates fail separately.

## Notes

- Every RED must fail on an assertion or on `not implemented`, never on a missing module (T001 exists for this).
- Commit after each green group. Never commit from `/workspaces/belay`.
