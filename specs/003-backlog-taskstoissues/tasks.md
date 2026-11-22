---

description: "Task list for feature 003: backlog tooling and tasks-to-issues"
---

# Tasks: Backlog Tooling and Tasks-to-Issues

**Input**: Design documents from `specs/003-backlog-taskstoissues/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: REQUIRED in this repository (project override; constitution "Test-Driven Development", NON-NEGOTIABLE). Test and implementation tasks use the TDD checkpoint format in `docs/templates/feature-test-tasks-template.md`. Docs, skills, the form and live-verification tasks use "Done when".

**Source to port**: `E:\Programming\VSCode\MovieCollectionManager` (MCM). "Port" means copy, then apply **R-strip** and **neutral names** (as in features 001 and 002), then make only the changes [research.md](research.md) lists for that file.

**Test-file note**: MCM keeps every `backlog.mjs` test in one file, covering reads (US1), writes (US2), labels and milestones (US4) and dependencies (US5). That file is ported once, in US1. Later phases verify those commands live.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependencies)
- **[Story]**: the user story this task belongs to (US1–US6)

---

## Phase 1: Setup (Shared Infrastructure)

- [ ] T001 **Doc-impact sweep** (REQUIRED in every tasks.md; constitution "Documentation").
  - **Command:** for each term, `git grep -n -F "<term>" -- '*.md' ':!specs/' ':!docs/proposals/' ':!docs/decisions/' ':!docs/superpowers/'`.
  - **Terms:** `backlog`, `FORGE_ISSUE_TOKEN`, `taskstoissues`, `PROJECT_OWNED`, `issue_template`, `bot-managed`, `feature 003`.
  - **Results** (searched 2026-11-22, while generating this file):
    - [x] `docs/runbooks/ci.md:103`: "The backlog script (feature 003) will write issues with `FORGE_ISSUE_TOKEN`". → T017
    - [x] `docs/runbooks/spec-kit.md:75-76`: "`PROJECT_OWNED` holds … today, the agent-context config". → T017 (it gains the taskstoissues skill)
    - [x] `docs/runbooks/spec-kit.md:74,87,104,139,180-182`: no change. These are the generic `PROJECT_OWNED` rules and failure codes.
    - [x] `.specify/extensions/git/README.md:37,46`: no change. It's a Spec Kit vendor file, and the hook keys are already used.
    - [x] `issue_template`, `bot-managed`: no hits outside `specs/`.

---

## Phase 2: Foundational (Blocking Prerequisites)

None. `backlog.mjs`'s dependencies (`forgeEndpoint`, `stripControlChars`, `redactForPublication`, `argv-contract`) already exist from features 001 and 002 (research R2).

---

## Phase 3: User Story 1 - See what's in the backlog and what's ready (Priority: P1) 🎯 MVP

**Goal**: `backlog.mjs list` / `ready` / `show` / `validate-form` against BELAY's tracker.

**Independent Test**: quickstart §2.

### Tests for User Story 1 (REQUIRED, TDD checkpoint format) ⚠️

- [X] T002 [P] [US1] Port `scripts/__tests__/fixtures/backlog/blocked-close-412.json` from MCM, dropping its `specs/049…` note.
  - **Done when:** the file parses as JSON, and `git grep -niE 'mcm|movie|specs/049' scripts/__tests__/fixtures/backlog` finds nothing.
- [X] T003 [US1] Port `scripts/__tests__/backlog.test.mjs` from MCM (research R6).
  - **Removed:** `ready work excludes bot-managed items`.
  - **Changed:**
    - the taxonomy assertion: exactly the nine labels in [data-model.md](data-model.md) → Label set, with no `status/bot-managed`;
    - the token tests: `FORGE_ISSUE_TOKEN` / `FORGE_TOKEN`;
    - the `setx` assertion: the message names `docs/runbooks/backlog.md`.
  - **Added:** `(no-leak)`. A planted `FORGE_ISSUE_TOKEN` never appears in the output or errors of `list`, `create`, `update` and `dep` against 401, 403 and 200 (SC-004). A `TypeError` from a command that never ran fails the test, as in feature 002.
  - **Scenarios covered:** US1-AC1 to AC5, US2-AC1 to AC6, US4-AC1 to AC3, US5-AC1 to AC3, and the edge cases (transport → 5, missing → 3, rejected → 4, exact-title duplicates, body from stdin). See [data-model.md](data-model.md) → Backlog item.title, Backlog item.labels, Backlog item.milestone, Backlog item.kind, Ready item, Dependency.cycle, Credential.
  - **Verify RED:** `node --test scripts/__tests__/backlog.test.mjs` → expected: failing with `ERR_MODULE_NOT_FOUND` for `backlog.mjs`.

### Implementation for User Story 1

- [X] T004 [US1] Port `scripts/backlog.mjs` from MCM.
  - **Credentials:** `FORGE_ISSUE_TOKEN`, then `FORGE_TOKEN`; messages point at `docs/runbooks/backlog.md`, without the dev-container, `${localEnv}` or `setx` advice (R1).
  - **Unchanged:** the origin and write-path guards, and `renderLine` (R2).
  - **Labels:** `TAXONOMY` without `status/bot-managed`, and no bot-managed filters, Renovate note or firewall text (R3).
  - **Entry point:** MCM's direct-invocation check is kept (R7).
  - Prerequisite: T003 verified RED.
  - **Verify GREEN:** `node --test scripts/__tests__/backlog.test.mjs` → expected: 0 failures; then `pnpm nx run scripts:test` passes.
- [X] T005 [US1] Mutation check for `(no-leak)`. Temporarily make an error path include the token, as in feature 002. Restore with a copied backup, never with a PowerShell text round-trip.
  - **Done when:** the test fails under the mutation and passes on the restored code.
- [X] T006 [US1] Live reads (quickstart §2): `list --state all`, `show 1` and `validate-form`.
  - **Done when:** issue #1 is listed with a total, `show 1` prints it, and `validate-form` exits 0.

  - **Done 2026-11-22:**
    - 74 of 74 backlog tests pass. `(no-leak)` went RED under a mutation that appended the token to the 401/403 message, then GREEN.
    - Live: `list --state all` shows #1 and #2 (2 items); `show 1` prints the item; `validate-form` reports no form in effect (the form isn't on `main` yet) and exits 0.
    - **Finding fixed:** on Windows, `show` and `validate-form` printed the right output and then aborted with `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`, exit 127. MCM's entry point calls `process.exit()` while fetch sockets are still closing. `ci-status.mjs` already avoids this (`exitWith`). `backlog.mjs` now sets `process.exitCode`, with an unref'd fallback timer. The live failure exiting 127 was the RED; exit 0 on three runs was the GREEN. No unit test can reproduce it offline, because it needs an open fetch socket at exit.

**Checkpoint**: the backlog is readable from a terminal.

---

## Phase 4: User Story 2 - File and maintain backlog items safely (Priority: P1)

**Goal**: writes refuse duplicates, unknown names, mismatched repositories and blocked closes.

**Independent Test**: quickstart §4.

- [X] T007 [US2] Live refusals (quickstart §4), after T008 has created the labels:
  - `create … --label type/nope` exits 2;
  - `update 1 --milestone 999-nope` exits 2;
  - `comment` without `FORGE_ISSUE_TOKEN` exits 3.
  - **Done when:** all three exit codes match, and `show 1` is unchanged afterwards (SC-003).
  - **Done 2026-11-22:** unknown label → exit 2; unknown milestone → exit 2; no token → exit 3, naming `FORGE_ISSUE_TOKEN`. Afterwards issue #1 was unchanged, and `list --q "refusal probe"` found 0 items.

---

## Phase 5: User Story 4 - Consistent labels and milestones (Priority: P2)

**Goal**: BELAY's label set exists, and issue #1 is labelled.

**Independent Test**: quickstart §3.

- [X] T008 [US4] Live label setup:
  1. `setup-labels --dry-run`, which lists nine labels and creates none;
  2. `setup-labels`, which creates them;
  3. `setup-labels` again, which creates nothing.
  - **Done when:** the forge's label list for BELAY is exactly the nine in [data-model.md](data-model.md) → Label set.
  - **Done 2026-11-22:** the dry run listed 9 labels and created none; the real run created 9; a second run reported "all taxonomy labels already present".
- [X] T009 [US4] Label issue #1: `node scripts/backlog.mjs update 1 --add-label type/tech-debt --add-label priority/p2`.
  - **Done when:** `show 1` lists both labels, and `ready` includes #1 (SC-005).
  - **Done 2026-11-22:** `show 1` lists `priority/p2 type/tech-debt`, and `ready` lists #1 first. Issue #2, the topology-scrub port, has no labels; it was left for the maintainer.

---

## Phase 6: User Story 5 - Ordering with dependencies (Priority: P2)

- [X] T010 [US5] Confirm `backlog.test.mjs` (T003) covers:
  - a `dep` that adds a link and removes it;
  - a cycle refused with **zero** write requests sent;
  - a blocked close refused, using the `blocked-close-412.json` fixture;
  - `ready` excluding an item with an open blocker.
  - **Done when:** each case is present. Add any missing case test-first, watched RED, then GREEN.
  - **Done 2026-11-22:**
    - Cycles (`wouldCreateCycle`), the 412 blocked close (fixture), and `ready` with open blockers were already covered at unit level.
    - **Missing, so added:** `(dep-cmd)` tests that run the `dep` command through an exported `main` against a stubbed forge, counting writes. A cycle exits 2 with zero writes; add is one POST; remove is one DELETE.
    - The test went RED on the missing `main` export, then GREEN. A mutation that disabled the cycle check made it fail, and it passed on the restored code.

---

## Phase 7: User Story 3 - Turn a feature's tasks into tracked issues (Priority: P1)

**Goal**: a project-owned `/speckit-taskstoissues`, guarded by the Spec Kit gate.

**Independent Test**: quickstart §5.

### Tests for User Story 3 (REQUIRED, TDD checkpoint format) ⚠️

- [X] T011 [US3] Register the skill in `scripts/check-speckit-overrides.mjs` `PROJECT_OWNED`, with the entry in [contracts/taskstoissues.md](contracts/taskstoissues.md) → Gate registration.
  - **Scenarios covered:** US3-AC5.
  - **Verify RED:** `node scripts/check-speckit-overrides.mjs` → expected: exit 1, with `project-file-lost` for `.claude/skills/speckit-taskstoissues/SKILL.md` and `inventory-stale` naming it. The skill and its inventory row don't exist yet.

### Implementation for User Story 3

- [X] T012 [US3] Port `.claude/skills/speckit-taskstoissues/SKILL.md` from MCM (research R4).
  - **Frontmatter:** `source` records "forked from spec-kit 0.16.5 via MovieCollectionManager; project-owned".
  - **Scratch file:** the body file goes to a `mktemp` path, not `/tmp/t012.md`.
  - **Wording:** no MCM item numbers or MCM-flavoured text.
  - **Runbook:** add its row to the customisation table in `docs/runbooks/spec-kit.md`.
  - Prerequisite: T011 verified RED.
  - **Verify GREEN:** `node scripts/check-speckit-overrides.mjs` → expected: exit 0, with "2 project-owned file(s)"; then `node scripts/check-speckit-overrides.mjs --selftest` passes.
- [X] T013 [US3] Live run (quickstart §5, SC-001). Run `/speckit-taskstoissues` on this `tasks.md` after T008, so the labels exist, and after this file is committed.
  - **Done when:**
    - milestone `003-backlog-taskstoissues` exists, with one issue per task, titled `T0NN: …`, carrying `type/chore` and `priority/p2`;
    - the ordering dependencies are set, so `ready` shows the lowest open task first;
    - a second run reports 0 created, and the milestone's issue count is unchanged.

  - **Done 2026-11-22.** Run through the skill's flow, driving `scripts/backlog.mjs` for every step.
    - **First run:** created milestone `003-backlog-taskstoissues` and 21 issues (#5–#25), each `type/chore` and `priority/p2`, plus 20 `dep` links chaining each task to the one before.
    - **Second run:** `created=0 already-filed=21`; the milestone lists 21 items.
    - `ready` lists #5 (T001) as the only ready task in the chain. It warns that the blocked items have no `status/blocked` label, which is MCM's tool saying the graph is authoritative.
    - **Ruling:** tasks already ticked in `tasks.md` were mirrored as **open** issues, with "Status in tasks.md when filed: done" in the body. Closing them would be a bulk operation, which the `forgejo-issues` rules leave to the maintainer.

**Checkpoint**: the task list and the tracker agree.

---

## Phase 8: User Story 6 - The rules for using the backlog (Priority: P3)

- [ ] T014 [P] [US6] Port `.claude/skills/forgejo-issues/SKILL.md` from MCM (research R8).
  - **BELAY's version:** the BELAY backlog, `FORGE_ISSUE_TOKEN`, no dev-container requirement, no bot-managed or Renovate passages, generic item examples, and the forge measurement kept as a forge property.
  - **Done when:** the filing, closing, labelling, lifecycle and no-bulk rules are present with BELAY's nine labels, and `git grep -niE 'mcm|movie|bot-managed|renovate|dev container' .claude/skills/forgejo-issues` finds nothing.
- [ ] T015 [P] [US6] Port `docs/runbooks/backlog.md` from MCM (research R8).
  - **Dropped:** the backup section, the dev-container and `setx` advice, and the bot-managed and Renovate rows.
  - **Changed:** the Nx paragraph now points at `pnpm nx run scripts:test`.
  - **Done when:** every command in [contracts/backlog-cli.md](contracts/backlog-cli.md) appears with its exit codes and credential, and the same MCM-term grep is clean.
- [ ] T016 [P] [US6] Port `.forgejo/issue_template/backlog-item.yaml` from MCM, with BELAY placeholders (research R5).
  - **Done when:**
    - it parses as YAML (`node -e "require('yaml').parse(...)"`);
    - it has no MCM terms;
    - `node scripts/check-ci-digest-coverage.mjs` still passes, because it ignores `issue_template/`.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [ ] T017 [P] Doc updates from the sweep (T001):
  - `docs/runbooks/ci.md:103`: the backlog script writes issues with `FORGE_ISSUE_TOKEN` (see `docs/runbooks/backlog.md`);
  - `docs/runbooks/spec-kit.md:75-76`: `PROJECT_OWNED` today holds the agent-context config and `/speckit-taskstoissues`;
  - `AGENTS.md`: the `scripts/` row names `backlog.mjs`, with links to `docs/runbooks/backlog.md` and the `forgejo-issues` skill.
  - **Done when:** each is updated, and `node scripts/check-speckit-overrides.mjs` passes.
- [ ] T018 No-MCM check.
  - **Command:** `git grep -niE 'mcm|movie|mc-service|bot-managed|renovate|MCM_FORGE|dev container' -- scripts .claude/skills/speckit-taskstoissues .claude/skills/forgejo-issues docs/runbooks/backlog.md .forgejo/issue_template`.
  - **Done when:** only deliberate provenance notes and the `themoviedb` vendor regex remain, each justified here.
- [ ] T019 **Close-out re-search**: re-run T001's searches.
  - **Done when:** every remaining hit in a doc that states current procedure has been fixed, or is justified here.
- [ ] T020 **Open the PR** with the repository's PR tools (`docs/runbooks/ci.md`):
  1. `git push origin HEAD:003-backlog-taskstoissues`
  2. `node scripts/forge-pr.mjs open --head 003-backlog-taskstoissues --title "Feature 003: backlog tooling and tasks-to-issues" --body-file <file>`
  3. `node scripts/ci-status.mjs watch --pr <n>`, until it exits 0
  4. `node scripts/forge-pr.mjs merge <n> --expect-head <full sha>`

  Tick this task in the branch's LAST commit, quoting the branch and the PR number. **CI evidence is never recorded here.** The run ids, the CI verdict and the merge sha go in the PR's closing comment.
- [ ] T021 Run [quickstart.md](quickstart.md) §1 to §6.
  - **Done when:** every "Expected" holds. §6 is T020.

---

## Dependencies & Execution Order

- **T001** comes first.
- **US1:** T002 and T003 can run together; then T004, T005, T006.
- **US4:** T008 and T009 need T004, and run against the live forge.
- **US2:** T007 needs T008, because labels must exist first.
- **US5:** T010 needs T003.
- **US3:** T011 then T012. T013 needs T008 (labels), T012, and this `tasks.md` committed.
- **US6:** T014, T015 and T016 can run in parallel at any time.
- **Polish:** T017–T019 after the stories; T020 last; T021 alongside T020.

**Why US4 comes before US3 in execution even though its priority is lower:** tasks-to-issues labels every issue it creates, and an unknown label is refused locally.

## Implementation Strategy

1. **MVP:** T001–T006. The backlog is readable and writable from a terminal, proven by the ported tests.
2. **Then:** the live label setup and refusals (T007–T009), the dependency coverage (T010), the gate-registered tasks-to-issues command and its live double run (T011–T013), the rules skill, runbook and form (T014–T016), and finally the docs, checks and this PR through the tools (T017–T021).
