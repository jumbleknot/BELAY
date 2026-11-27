---
description: "Task list for feature 016: PDLC spec intake"
---

# Tasks: PDLC spec intake (write, clarify and approve a spec from Claude Desktop)

**Input**: Design documents from `specs/016-pdlc-spec-intake/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md),
[contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: REQUIRED in this repository (project override; constitution "Test-Driven Development", NON-NEGOTIABLE).
Every test task and its paired implementation task use the TDD checkpoint format in
`docs/templates/feature-test-tasks-template.md`. Documentation and config tasks use "Done when".

**Organization**: tasks are grouped by user story (spec.md), in priority order:
- P1: US1, US2, US3, US8;
- P2: US4, US5, US7, US9;
- P3: US6.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: the user story the task belongs to (US1 to US9)

## Path Conventions

- Server: `mcp-servers/pdlc/` (`src/`, `tests/unit/`, `tests/integration/`, `tests/integration-forge/`, `ui/`,
  `contract/`, `skill/`)
- Repository tooling: `scripts/`, with tests in `scripts/__tests__/`; `.specify/`; `.claude/skills/`;
  `.forgejo/workflows/`
- Single-test commands use `node --test <file>`, with node's flags before the path (AGENTS.md instrument trap)

---

## Phase 1: Setup (decisions, measurements, sweep)

**Purpose**: settle the maintainer decisions and measure every **unverified** item in research.md before code depends
on it. A measurement records what was observed, in research.md, under the R it belongs to.

- [X] T001 Write `docs/decisions/ADR-0006-pdlc-spec-intake.md`. It records:
  - the four amendments to 014's decisions (spec Context table);
  - M5 to M7, and M9 once answered;
  - running the target repository's Spec Kit scripts (plan Complexity Tracking);
  - that it supersedes the matching parts of ADR-0005.

  Add `openwiki/decisions/adr-0006-pdlc-spec-intake.md`, the `AGENTS.md` Decisions index line, and ADR-0005's
  "superseded in part by" note.
  - **Done when**: the maintainer has approved the ADR (M8, FR-034), quoted in the ADR's status line, and
    `node scripts/check-openwiki-okf.mjs` passes. No server code is merged before this task.
- [X] T002 **Doc-impact sweep** (REQUIRED; constitution "Documentation"). Run while generating this file, 2026-11-27.

  Command, per term:
  `git grep --untracked -n -F "<term>" -- '*.md' ':!specs/' ':!docs/proposals/' ':!docs/decisions/'`

  Terms:
  - `close-proposal`
  - `close-on-spec`
  - `closes once its spec`
  - `closed once its spec`
  - `read:repository`
  - `read-only local cop`
  - `never commits`
  - `Superseded by spec`
  - `after_specify`

  Hits and dispositions:
  - [x] `.claude/skills/forgejo-issues/SKILL.md:20,93-95` (close-proposal, close-on-spec, Superseded by spec) → T071
  - [x] `.claude/skills/speckit-belay-close-proposal/SKILL.md` (whole file) → T040 (replaced by `speckit-belay-spec-stage`)
  - [x] `docs/runbooks/backlog.md:23,114-117` (close-proposal verb and comment text) → T072
  - [x] `docs/runbooks/backlog.md:41` (`FORGE_ISSUE_TOKEN` scope) → no change: that token keeps its scope; only the `pdlc` token widens
  - [x] `docs/runbooks/pdlc.md:12,15-18,28,39,170-171,193,204` (read-only copy, never commits, token scope, close-on-spec, hand-off) → T073
  - [x] `docs/runbooks/spec-kit.md:68,71,79,158-160` (hook rows 5a and 7, reinstall steps) → T074
  - [x] `mcp-servers/pdlc/README.md:6,17` (read-only copies, close-proposal) → T075
  - [x] `mcp-servers/pdlc/skill/proposal-intake/SKILL.md:72` ("closes once its spec exists") → T029 (skill rewrite for US1/US2)
  - [x] `openwiki/projects/repository.md:36` (`speckit-belay-close-proposal`) → T076
  - [x] `openwiki/runbooks/backlog.md:4,15,46-47` → T076 (wiki refresh of backlog page)
  - [x] `openwiki/runbooks/index.md:3,7,9` (page descriptions) → T076
  - [x] `openwiki/runbooks/pdlc.md:4,14,22-25` → T076
  - [x] `openwiki/runbooks/spec-kit.md:4,42-46` → T076
  - [x] `openwiki/process/spec-driven-development.md:30` (hook "then closes it") → T077
  - [x] `openwiki/invariants/secrets-management.md:22` (the `pdlc` token row) → T078
  - [x] `openwiki/decisions/adr-0005-operator-tool-mcp-servers.md:31` (pdlc token scope) → no change: an ADR summary records the decision as made; T001 adds the "superseded in part" note
  - [x] `openwiki/invariants/secrets-management.md:20-21,24`, `docs/runbooks/ci.md:209,220`, `docs/repo-foundation-setup.md:278,318-321` (other tokens' `read:repository`) → no change: those tokens are unchanged. `ci.md` gains the workflow in T079, and `CI_DIGEST_TOKEN`'s use changes only if T006 shows the fallback is needed (then → T078)
  - [x] `.claude/skills/speckit-git-commit/SKILL.md`, `.claude/skills/speckit-specify/SKILL.md`, `.specify/extensions/**` (`after_specify` as a generic hook name) → no change: Spec Kit core text about hook points, not BELAY's hook
- [X] T003 Measure MCP Apps in Claude Desktop on the workstation (research R9, items 1 to 3), with a throwaway
  extension `pdlc-pane-probe` built in the scratchpad. Never commit it. Record in `specs/016-pdlc-spec-intake/research.md`
  R9:
  - whether an app renders **beside** the chat, and how it asks for that;
  - whether an app-only tool call reaches the server, and a later model turn sees it;
  - whether the page can be told to re-render.
  - **Done when**: R9 says "Measured on the host (date)" for all three. If (1) fails, the maintainer is asked about
    FR-035 and FR-036 (spec Assumptions), and the answer is recorded before Phase 10 starts.
  - **Measured 2026-11-27, three passes**: (1) yes, via `ui/request-display-mode fullscreen`; (2) yes, but served by
    a different server process from the model's, so all state is on disk; (3) by polling an app-only read tool. Adds
    `read_pane_document` (app-only) to the contract; Phase 10 tasks implement it with the pane
- [X] T004 [P] Measure the Spec Kit scripts on the workstation (R1 unverified 1 and 2):
  - `pwsh` present, or Windows PowerShell 5.1 running `create-new-feature-branch.ps1 -DryRun -Json` and
    `resolve-template.ps1 spec-template -Json` in a copy of BELAY;
  - the dry run's `BRANCH_NAME` equal to a real run in the dev container for the same description.

  Record in research.md R1.
  - **Done when**: R1 names the interpreter used and the observed `BRANCH_NAME` pair.
- [X] T005 [P] Measure the widened token (R6). The operator creates a test token with `write:issue` +
  `write:repository` and protects `ci-smoke`'s `main`. From the dev container, with R2's `GIT_CONFIG_*` header:
  - push a new branch to `ci-smoke` (accepted);
  - push to its `main` (refused by the forge);
  - read `/repos/{o}/ci-smoke/branch_protections` with this token (status recorded, for `default_branch_protected`).

  Delete the test branch afterwards with the operator's agreement. Record in research.md R6.
  - **Done when**: all three answers are recorded with their HTTP or git exit status.
- [X] T006 [P] Measure CI credentials and the merge lookup (R10, R11) with a throwaway workflow on a `ci-smoke`
  branch, run by `workflow_dispatch`:
  - can `github.token` comment on and close an issue in its own repository;
  - does `GET /repos/{o}/{r}/commits/{sha}/pull` exist on this forge build.
  - does a step with `if: always()` run in a job cancelled by `cancel-in-progress`, and what `job.status` it sees
    (R12, for the outcomes step).

  Record in research.md R10, R11 and R12. Remove the throwaway workflow branch.
  - **Done when**: all three are recorded. If the run token is refused, T078 gains the `CI_DIGEST_TOKEN` usage change.
- [X] T007 [P] Measure attaching a reporter (R12) in the dev container:
  - does `NODE_OPTIONS="--test-reporter=… --test-reporter-destination=…"` reach `node --test` under
    `pnpm nx run pdlc:test` (which already passes its own `--test-reporter` flags) and under `scripts:test`
    (`check-coverage.mjs --run`)?
  - are the default outputs unchanged?

  Record in research.md R12 which path (NODE_OPTIONS, or an opt-in `--report <file>` per target) the design uses.
  - **Done when**: R12 names the path with the observed output.
- [X] T008 Settle M9 (`pwsh` on the CI runner). Run `command -v pwsh` in a `guardrails`-shaped job on a branch. Then
  ask the maintainer: (a) install a pinned, checksum-verified `pwsh` in `guardrails`, or (b) an operator-run tier for
  the script-executing tests. Record the answer in research.md's decision table and in ADR-0006.
  - **Done when**: M9 has an answer and a date. T022 and T037 follow it.
  - **Answered 2026-11-27: (a)**, install a pinned `pwsh` in `guardrails` (research M9). The image was measured, not
    the live runner, by the maintainer's choice. Adds T022a and T022b.
- [X] T008a **Record the test baseline** (FR-040, the template task this feature adds, applied to itself once T054c
  lands; until then run `node scripts/count-repo-metrics.mjs --json` and record `testDeclarations` here). This spec's
  Input names proposal #91, which is closed under 014's close-on-spec, so nothing is posted: the no-proposal path.
  - **Done when**: the count and the commit are recorded in this task
  - **Recorded 2026-11-27**: `node scripts/count-repo-metrics.mjs --json` at `50a624d` → `testDeclarations: 1723`.
    Nothing posted (#91 is closed; `record-tests` does not exist yet)

---

## Phase 2: Foundational (shared contracts and guards)

**Purpose**: the stage model, the trailer and the extended allowlist that every story uses.

**⚠️ CRITICAL**: no user story work starts before this phase is complete.

- [X] T009 [P] Test: the four stage labels in the shared contract and in `backlog.mjs`. In
  `mcp-servers/pdlc/tests/unit/master-copies.test.mjs`, assert `contract/proposal-labels.json` holds
  `status/spec-in-progress`, `status/ready-to-plan`, `status/in-engineering` and `status/merged`, with data-model.md
  "Label contract" colours and descriptions. Extend the existing TAXONOMY copy guard in
  `scripts/__tests__/backlog.test.mjs` to the four.
  - **Scenarios covered**: FR-011
  - **Verify RED**: `node --test mcp-servers/pdlc/tests/unit/master-copies.test.mjs` and
    `node --test scripts/__tests__/backlog.test.mjs` → expected: failing — `missing label status/spec-in-progress`
- [X] T010 Add the four labels to `mcp-servers/pdlc/contract/proposal-labels.json` and `scripts/backlog.mjs`
  `TAXONOMY` (data-model.md Label contract) (prerequisite: T009 RED)
  - **Verify GREEN**: same commands as T009 → expected: 0 failures; then `pnpm nx run scripts:test` and
    `pnpm nx run pdlc:test` still pass
- [X] T011 [P] Test: the stage trailer grammar ([contracts/stages.md](contracts/stages.md) "The stage trailer").
  Write `scripts/__tests__/stage-trailer.test.mjs` from fixtures in `scripts/__tests__/fixtures/stage-trailer/`:
  - render, then parse, round-trips for each stage and for `withdrawn`;
  - most-recent wins;
  - the withdrawn list collects every `withdrawn` trailer;
  - a malformed trailer is ignored, with a warning;
  - a branch character outside `[A-Za-z0-9._/-]` is refused.
  - **Scenarios covered**: FR-015, FR-016, FR-019 (data-model.md `Proposal issue.feature_branch`,
    `Proposal issue.withdrawn_branches`)
  - **Verify RED**: `node --test scripts/__tests__/stage-trailer.test.mjs` → expected: failing —
    `Cannot find module '../lib/stage-trailer.mjs'`
- [X] T012 Implement `scripts/lib/stage-trailer.mjs` (prerequisite: T011 RED)
  - **Verify GREEN**: `node --test scripts/__tests__/stage-trailer.test.mjs` → expected: 0 failures
- [X] T013 [P] Test: the server's stages module. In `mcp-servers/pdlc/tests/unit/stages.test.mjs`:
  - the transition table, every allowed row passing and every other (from, to, caller) pair refused
    `stage_transition_refused` ([contracts/stages.md](contracts/stages.md) "Transitions");
  - `stage_ambiguous` for two stage labels or none (data-model.md `Proposal issue.stage`);
  - label-swap planning removes only the old stage id;
  - **cross-check**: the same trailer fixture directory as T011 gives identical results through
    `src/stages.mjs`.
  - **Scenarios covered**: US4-AC1, FR-010, FR-023
  - **Verify RED**: `node --test mcp-servers/pdlc/tests/unit/stages.test.mjs` → expected: failing —
    `Cannot find module '../../src/stages.mjs'`
- [X] T014 Implement `mcp-servers/pdlc/src/stages.mjs` (prerequisite: T013 RED; T012 done)
  - **Verify GREEN**: `node --test mcp-servers/pdlc/tests/unit/stages.test.mjs` → expected: 0 failures
- [X] T015 [P] Test: extended git allowlist (research R4). In `mcp-servers/pdlc/tests/unit/git-runner.test.mjs`:
  - each new shape is accepted with valid arguments;
  - each is refused with any extra or altered argument: `push` with `--force`, `+`, `--delete`, `--mirror`, a
    different destination, or a default-branch destination; `commit` without `--no-verify`; `add` of a path outside
    `specs/<NNN-slug>`; `reset` other than `--soft <sha>`; `worktree` verbs other than `add -b` and
    `list --porcelain`;
  - the push-target guard refuses `push_target_refused` for the default branch even in a valid shape.
  - **Scenarios covered**: US8-AC2, US8-AC3, FR-021
  - **Verify RED**: `node --test mcp-servers/pdlc/tests/unit/git-runner.test.mjs` → expected: failing —
    `git push is not on the allowlist` for the valid push shape
- [X] T016 Extend `isAllowedGitCall` and add the push-target guard in `mcp-servers/pdlc/src/git-runner.mjs`. Keep the
  existing verbs' rules unchanged (prerequisite: T015 RED)
  - **Verify GREEN**: `node --test mcp-servers/pdlc/tests/unit/git-runner.test.mjs` → expected: 0 failures; then
    `node --test mcp-servers/pdlc/tests/unit/local-copy.test.mjs` still passes

**Checkpoint**: the labels, trailer, transitions and allowlist are ready.

---

## Phase 3: User Story 1 - Write a spec from a ready proposal (Priority: P1) 🎯 MVP

**Goal**: from Claude Desktop, start a spec from a ready proposal through the repository's own specify step.

**Independent Test**: spec.md User Story 1 "Independent Test", via `pdlc:integration` against a local bare repository
with BELAY's `.specify/`, and by hand per quickstart §2 step 1.

### Tests for User Story 1 (REQUIRED — TDD checkpoint format) ⚠️

- [ ] T017 [P] [US1] Test: Spec Kit inspection (R3, R14). In `mcp-servers/pdlc/tests/unit/spec-kit-runner.test.mjs`,
  with fixture `.specify/` trees in `tests/fixtures/spec-kit/`:
  - `initialised: false` without `init-options.json`;
  - `supported: false` for a version outside 1.4.x;
  - `script` and `feature_numbering` read;
  - every hook in R3's table classified (`server`, `not_run`, `unsupported`);
  - `ok: false` for an unknown mandatory hook.
  - **Scenarios covered**: FR-005, US7-AC1 (inspection half)
  - **Verify RED**: `node --test mcp-servers/pdlc/tests/unit/spec-kit-runner.test.mjs` → expected: failing —
    `Cannot find module '../../src/spec-kit-runner.mjs'`
- [ ] T018 [P] [US1] Test: running the scripts (R1). In the same file, with injected `execFile` and git doubles,
  assert:
  - the call order: clone a scratch clone at `<clone_root>/.pdlc-scratch/<Repo>-<random>` with
    `clone --shared --no-checkout <copy path>`, then copy the remote refs into it, then `checkout --detach`;
  - the script's `cwd` is **inside the scratch clone**, never the copy or a worktree;
  - the dry-run argv: interpreter chosen by `script`, a fixed script path inside the scratch clone,
    `-DryRun -Json -ShortName`;
  - the child environment has **no** `GIT_CONFIG_*`, `PDLC_FORGE_TOKEN` or `Authorization` value;
  - `BRANCH_NAME` and `FEATURE_NUM` parsed;
  - the scratch folder is deleted on success **and** on failure;
  - a leftover scratch folder from an earlier crash is removed at the next `start_spec` for that repository;
  - a scratch path outside `.pdlc-scratch/` is refused `path_outside_feature`.
  - **Scenarios covered**: US1-AC1, US8-AC6 (token never in a child that runs repository code)
  - **Verify RED**: `node --test mcp-servers/pdlc/tests/unit/spec-kit-runner.test.mjs` → expected: failing — as T017
- [ ] T019 [P] [US1] Test: spec files and the path guard (R5). In `mcp-servers/pdlc/tests/unit/spec-files.test.mjs`:
  - `spec.md` and `checklists/*.md` are accepted;
  - refused `path_outside_feature`: `..`, an absolute path, a symlink, `:` (an alternate data stream), and any other
    file in the folder;
  - the `revision` (data-model.md `Spec in progress.revision`) changes on every write and only then.
  - **Scenarios covered**: US8-AC1, FR-020
  - **Verify RED**: `node --test mcp-servers/pdlc/tests/unit/spec-files.test.mjs` → expected: failing —
    `Cannot find module '../../src/spec-files.mjs'`
- [ ] T020 [P] [US1] Test: worktree creation and state (R2). In `mcp-servers/pdlc/tests/unit/spec-worktree.test.mjs`,
  with a git double:
  - the git call sequence is fetch every head, then `worktree add -b <branch> <path> origin/<default>`;
  - the state file has data-model.md `Spec in progress` fields `recorded_remote_tip` (null), `branch`, `spec_dir` and
    `last_start_or_reopen`;
  - `spec_state_inconsistent` when the state file and `worktree list` disagree;
  - `branch_exists`;
  - a withdrawn branch is never reused (data-model.md `Proposal issue.withdrawn_branches`).
  - **Scenarios covered**: US1-AC1, US1-AC5, FR-004
  - **Verify RED**: `node --test mcp-servers/pdlc/tests/unit/spec-worktree.test.mjs` → expected: failing —
    `Cannot find module '../../src/spec-worktree.mjs'`
- [ ] T021 [US1] Test: the tools `check_spec_kit`, `start_spec`, `get_spec` and `write_spec_file` through the handlers
  in `mcp-servers/pdlc/tests/unit/tools.test.mjs`, and their names and schemas in
  `mcp-servers/pdlc/tests/unit/tool-contract.test.mjs` and `manifest.test.mjs` ([contracts/tools.md](contracts/tools.md)):
  - `start_spec` refuses `not_ready_proposal` for a draft or a non-proposal issue;
  - `spec_already_in_progress` returns the existing branch;
  - `start_spec` writes `spec.md` from `TEMPLATE_CONTENT` with the Input line
    `Proposal #<n>: <title>` plus the body (FR-003);
  - the stage moves to `spec-in-progress` with a trailer `via Claude Desktop`;
  - `write_spec_file` refuses outside `spec-in-progress`;
  - `get_spec` reports `proposal_updated_since_start: true` after the proposal's `updated_at` moves past the
    value saved at start (data-model.md `Spec in progress.proposal_updated_at_start`; spec Edge Cases).
  - **Scenarios covered**: US1-AC1, US1-AC2, US1-AC3, US1-AC4, US1-AC5
  - **Verify RED**: `node --test mcp-servers/pdlc/tests/unit/tools.test.mjs` then
    `node --test mcp-servers/pdlc/tests/unit/tool-contract.test.mjs` → expected: failing — `unknown tool start_spec`
    and `tools/list differs from the contract`
- [ ] T022a [P] [US1] Test: the pinned `pwsh` install (M9). In `scripts/__tests__/install-pwsh.test.mjs`, mirroring
  `install-trivy.test.mjs` with injected fetch, extract and version:
  - a matching sha256 installs and checks `pwsh --version`; a mismatch refuses and installs nothing; a download that
    fails three times refuses; a wrong reported version removes the binary; `--print-pin` prints the pin; bad
    arguments exit 2.
  Extend `refresh-pin-checksum.test.mjs` and `check-renovate-config.test.mjs` for a `pwsh` pin (the version and the
  sha256 move together, under `PowerShell/PowerShell`), and a guard that `guardrails.yml` installs `pwsh` through
  `install-pwsh.mjs` before the `pdlc:integration` step.
  - **Scenarios covered**: plan Testing ("`pdlc:integration` needs `pwsh`"), research M9
  - **Verify RED**: `node --test scripts/__tests__/install-pwsh.test.mjs` → expected: failing —
    `Cannot find module '../install-pwsh.mjs'`
- [ ] T022b [US1] Implement `scripts/install-pwsh.mjs` with `PWSH_PIN` 7.7.0 and its sha256 read once from the
  release's published hashes, the `refresh-pin-checksum.mjs` entry, the Renovate regex manager and post-upgrade task,
  and the `guardrails` step before `pdlc:integration`; add the pin to `docs/runbooks/ci.md` with T079
  (prerequisite: T022a RED)
  - **Verify GREEN**: `node --test scripts/__tests__/install-pwsh.test.mjs`, `node --test scripts/__tests__/refresh-pin-checksum.test.mjs`
    and `node --test scripts/__tests__/check-renovate-config.test.mjs` → expected: 0 failures; then
    `pnpm nx run scripts:lint` passes
- [ ] T022 [US1] Integration test: start a spec for real. In
  `mcp-servers/pdlc/tests/integration/spec-lifecycle.integration.test.mjs`:
  - make a bare repository seeded with a copy of BELAY's `.specify/` and one `specs/001-x/`, plus a remote branch
    `002-other` (the number-clash case);
  - clone with the server's local copy, then `start_spec` through the real `spec-kit-runner` with real `pwsh`;
  - assert branch `003-<slug>`, the worktree on it, the copy still on `main`, and `git status` clean in the copy;
  - fail, never skip, when `pwsh` is missing (Test Type Integrity; follows M9 from T008 for where it runs).
  - **Scenarios covered**: US1-AC1, SC-007 (copy's default branch untouched)
  - **Verify RED**: `node --test mcp-servers/pdlc/tests/integration/spec-lifecycle.integration.test.mjs` → expected:
    failing — `start_spec is not a function`

### Implementation for User Story 1

- [ ] T023 [P] [US1] Implement `mcp-servers/pdlc/src/spec-kit-runner.mjs` (R1, R3, R14) (prerequisite: T017, T018 RED)
  - **Verify GREEN**: `node --test mcp-servers/pdlc/tests/unit/spec-kit-runner.test.mjs` → expected: 0 failures
- [ ] T024 [P] [US1] Implement `mcp-servers/pdlc/src/spec-files.mjs` (R5; data-model.md `Spec in progress.revision`)
  (prerequisite: T019 RED)
  - **Verify GREEN**: `node --test mcp-servers/pdlc/tests/unit/spec-files.test.mjs` → expected: 0 failures
- [ ] T025 [P] [US1] Implement `mcp-servers/pdlc/src/spec-worktree.mjs` create, resume and state (R2; data-model.md
  `Spec in progress.worktree_path`, `.recorded_remote_tip`, `.last_start_or_reopen`) (prerequisite: T020 RED)
  - **Verify GREEN**: `node --test mcp-servers/pdlc/tests/unit/spec-worktree.test.mjs` → expected: 0 failures
- [ ] T026 [US1] Add `check_spec_kit`, `start_spec`, `get_spec` and `write_spec_file` to
  `mcp-servers/pdlc/src/tool-contract.mjs` (`short_name` per contracts/tools.md; `content` at most 256 KiB), the
  handlers in `src/tools.mjs`, the `tools` list in `manifest.json`, and an `audit` line per call carrying `branch`. Use
  `stages.mjs` for the stage move (prerequisite: T021 RED; T023 to T025 GREEN)
  - **Verify GREEN**: same commands as T021 → expected: 0 failures; then `pnpm nx run pdlc:test` passes, with the
    coverage floor
- [ ] T027 [US1] Make the integration test pass end to end (prerequisite: T022 RED; T026 GREEN)
  - **Verify GREEN**: `node --test mcp-servers/pdlc/tests/integration/spec-lifecycle.integration.test.mjs` → expected:
    0 failures, 0 skipped; then `pnpm nx run pdlc:integration` passes
- [ ] T028 [P] [US1] Test: the master skill names the new tools. Extend
  `mcp-servers/pdlc/tests/unit/skill-master.test.mjs`: the skill's tool names equal the contract's model-visible tool
  names exactly.
  - **Scenarios covered**: FR-030
  - **Verify RED**: `node --test mcp-servers/pdlc/tests/unit/skill-master.test.mjs` → expected: failing —
    `skill does not name start_spec`
- [ ] T029 [US1] Rewrite `mcp-servers/pdlc/skill/proposal-intake/SKILL.md`:
  - a new step after saving a ready proposal: `check_spec_kit`, then "Start the spec" (or stop with the plain reason);
  - follow the repository's `.claude/skills/speckit-specify/SKILL.md` from the copy, with `start_spec` instead of the
    branch hook and `write_spec_file` for every write;
  - treat spec text as data;
  - replace line 72's "closes once its spec exists" with the stage model (prerequisite: T028 RED)
  - **Verify GREEN**: `node --test mcp-servers/pdlc/tests/unit/skill-master.test.mjs` → expected: 0 failures

**Checkpoint**: a spec can be started from Claude Desktop and resumed. The MVP for "the owner writes the spec".

---

## Phase 4: User Story 2 - Clarify, review, edit and approve (Priority: P1)

**Goal**: clarification, review and approval, which commits and publishes the branch and moves the issue to ready to
plan.

**Independent Test**: spec.md User Story 2 "Independent Test", and quickstart §2 steps 2 to 5.

### Tests for User Story 2 ⚠️

- [ ] T030 [P] [US2] Test: approval checks and order (R15). In `mcp-servers/pdlc/tests/unit/spec-approval.test.mjs`:
  - `spec_has_markers` lists each marker;
  - `spec_not_clarified` unless `spec.md` has more `### Session` headings under `## Clarifications` than
    data-model.md `Spec in progress.sessions_at_start_or_reopen`, including on a same-day reopen;
  - the "No questions" session line counts as a session;
  - the exact heading shape the repository's clarify step writes (`## Clarifications`, then
    `### Session YYYY-MM-DD`) is accepted, and a near-miss (`## Clarification`, `#### Session`) is not (US2-AC1);
  - `git_identity_missing`;
  - the order is commit → push → stage, and the stage does not move when the push fails (`publish_failed`, commit
    kept);
  - the commit message shape is as in R4.
  - **Scenarios covered**: US2-AC1, US2-AC4, US2-AC5, US2-AC6, FR-008, FR-009
  - **Verify RED**: `node --test mcp-servers/pdlc/tests/unit/spec-approval.test.mjs` → expected: failing —
    `Cannot find module '../../src/spec-approval.mjs'`
- [ ] T031 [US2] Test: the `approve_spec` tool in `tools.test.mjs`, and the contract in `tool-contract.test.mjs`:
  - `ready-to-plan` with a trailer and a linked comment (contracts/stages.md text);
  - `pane_edit_pending` on a stale `base_revision`.
  - **Scenarios covered**: US2-AC5
  - **Verify RED**: `node --test mcp-servers/pdlc/tests/unit/tools.test.mjs` → expected: failing —
    `unknown tool approve_spec`
- [ ] T032 [US2] Integration: extend `spec-lifecycle.integration.test.mjs`. Write `spec.md` with a clarifications
  session, approve, then assert:
  - the bare remote has the branch, with one commit touching only `specs/003-<slug>/`;
  - the remote's `main` is unchanged;
  - resume in a fresh server instance reads the same files.
  - **Scenarios covered**: US2-AC3, US2-AC5, SC-001 (machine half), SC-007
  - **Verify RED**: `node --test mcp-servers/pdlc/tests/integration/spec-lifecycle.integration.test.mjs` → expected:
    failing — `unknown tool approve_spec`

### Implementation for User Story 2

- [ ] T033 [US2] Implement `mcp-servers/pdlc/src/spec-approval.mjs` (prerequisite: T030 RED)
  - **Verify GREEN**: `node --test mcp-servers/pdlc/tests/unit/spec-approval.test.mjs` → expected: 0 failures
- [ ] T034 [US2] Add `approve_spec` to the contract, the handlers and the manifest (prerequisite: T031, T032 RED;
  T033 GREEN)
  - **Verify GREEN**: same commands as T031 and T032 → expected: 0 failures; then `pnpm nx run pdlc:test` and
    `pnpm nx run pdlc:integration` pass
- [ ] T035 [US2] Extend the master skill:
  - clarify by following the repository's `speckit-clarify` prompt, one question at a time with suggested answers as
    buttons, recording the session (or the "No questions" line);
  - review section by section, showing each edit before keeping it;
  - **Approve** relays refusals in plain words (US2-AC2, US2-AC4, US2-AC6);
  - extend `skill-master.test.mjs`: the skill names `approve_spec`, and its clarify step names `## Clarifications`,
    `### Session` and the "No questions" line (US2-AC1, finding U6).
  - **Verify RED**: `node --test mcp-servers/pdlc/tests/unit/skill-master.test.mjs` → expected: failing —
    `skill does not name approve_spec`
  - **Verify GREEN**: `node --test mcp-servers/pdlc/tests/unit/skill-master.test.mjs` → expected: 0 failures

**Checkpoint**: proposal to approved, published spec, entirely in Claude Desktop (SC-001 machine side).

---

## Phase 5: User Story 3 - See ready specs and pick one up (Priority: P1)

**Goal**: `ready` shows ready-to-plan specs with their branch. Planning moves the issue to in engineering and locks
the spec.

**Independent Test**: spec.md User Story 3 "Independent Test", and quickstart §3.

### Tests for User Story 3 ⚠️

- [ ] T036 [P] [US3] Test: `backlog.mjs ready` and `stage` ([contracts/stages.md](contracts/stages.md) "Ready
  listing"; [contracts/backlog-stage-cli.md](contracts/backlog-stage-cli.md)). In `scripts/__tests__/backlog.test.mjs`,
  with the existing fake forge:
  - `ready` lists `ready-to-plan` items with `branch:` and `spec:` from the latest trailer;
  - it hides `spec-in-progress` and `in-engineering` with the two count notes;
  - draft, ready and bot-managed are unchanged;
  - `stage` refusals: non-proposal, bot-managed, missing `spec.md`, transition not allowed (exit 2);
  - idempotent re-run (exit 0, `already <stage>`);
  - comment before the label swap.
  - **Scenarios covered**: US3-AC1, US3-AC3, US4-AC4, SC-003
  - **Verify RED**: `node --test scripts/__tests__/backlog.test.mjs` → expected: failing — `unknown command stage`
- [ ] T037 [P] [US3] Test: the hooks and the gate.
  - In `scripts/__tests__/extensions-yml.test.mjs`: `after_specify` and `after_plan` each carry the
    `belay` `speckit.belay.spec-stage` mandatory entry, and `speckit.belay.close-proposal` is gone.
  - In `scripts/__tests__/check-speckit-overrides.test.mjs`: the gate reports both as registered
    `EXTENSION_HOOKS` (`local: true`), the `speckit-belay-spec-stage` skill as `PROJECT_OWNED`, and `hook-lost` when
    either entry is removed.
  - **Scenarios covered**: FR-012, FR-013
  - **Verify RED**: `node --test scripts/__tests__/extensions-yml.test.mjs` and
    `node --test scripts/__tests__/check-speckit-overrides.test.mjs` → expected: failing — `expected
    speckit.belay.spec-stage under after_plan`
- [ ] T038 [P] [US3] Test: the lock in the server. In `tools.test.mjs`, at `in-engineering`, `write_spec_file`,
  `approve_spec`, `reopen_spec` and `withdraw_spec` each refuse `document_locked`, citing that planning started
  (data-model.md `Spec in progress.locked`).
  - **Scenarios covered**: US3-AC4, FR-018
  - **Verify RED**: `node --test mcp-servers/pdlc/tests/unit/tools.test.mjs` → expected: failing — `expected refusal
    document_locked`

### Implementation for User Story 3

- [ ] T039 [US3] Implement the `stage` verb and the `ready` changes in `scripts/backlog.mjs`, using
  `scripts/lib/stage-trailer.mjs`. `stage` never closes an issue (data-model.md `Proposal issue.state`: closed only at
  merged). Remove the `close-proposal` verb and its `--help` text (prerequisite: T036 RED)
  - **Verify GREEN**: `node --test scripts/__tests__/backlog.test.mjs` → expected: 0 failures
- [ ] T040 [US3] Replace `.claude/skills/speckit-belay-close-proposal/` with
  `.claude/skills/speckit-belay-spec-stage/SKILL.md`, per contracts/backlog-stage-cli.md "Hook". The `plan.md`
  presence picks the stage. Update `.specify/extensions.yml` (both hook entries) and
  `scripts/check-speckit-overrides.mjs` (`EXTENSION_HOOKS`, `PROJECT_OWNED`) (prerequisite: T037 RED)
  - **Verify GREEN**: same commands as T037 → expected: 0 failures; then `node scripts/check-speckit-overrides.mjs`
    exits 0
- [ ] T041 [US3] Enforce the lock in `mcp-servers/pdlc/src/tools.mjs`: read the stage before every spec write
  (prerequisite: T038 RED)
  - **Verify GREEN**: `node --test mcp-servers/pdlc/tests/unit/tools.test.mjs` → expected: 0 failures
- [ ] T042 [US3] Integration: in `spec-lifecycle.integration.test.mjs`, check out the published branch in a second
  clone and run `.specify/scripts/powershell/setup-plan.ps1 -Json` there. It resolves `specs/003-<slug>/` with no
  `feature.json` and no fix-up (R5, SC-002 machine half).
  - **Scenarios covered**: US3-AC2, SC-002, FR-028
  - **Verify RED**: write the test before the approve step it depends on publishes in the fixture. Run
    `node --test mcp-servers/pdlc/tests/integration/spec-lifecycle.integration.test.mjs` → expected: failing —
    `setup-plan.ps1: FEATURE_SPEC not found` (the branch has no `specs/003-<slug>/spec.md` yet)
  - **Verify GREEN**: `node --test mcp-servers/pdlc/tests/integration/spec-lifecycle.integration.test.mjs` → expected:
    0 failures

**Checkpoint**: the hand-off works from both sides. Proposal → approved spec → ready listing → plan → in engineering.

---

## Phase 6: User Story 8 - The server refuses anything outside the feature's own spec (Priority: P1)

**Goal**: the remaining guards, and take-latest when the branch changed on the forge.

**Independent Test**: spec.md User Story 8 "Independent Test". Every refusal code in contracts/tools.md "New refusal
codes" is observed.

### Tests for User Story 8 ⚠️

- [ ] T043 [P] [US8] Test: branch changed and take-latest (R8). In `spec-worktree.test.mjs`:
  - `branch_changed` returns commits and a diffstat;
  - `take_latest_spec` backs up first, then soft-resets an unpublished commit onto the recorded tip only, then runs
    the three-way merge per file, with conflicts listed;
  - `nothing_to_take`;
  - no published commit is reset (data-model.md `Spec in progress.recorded_remote_tip`).
  - **Scenarios covered**: US8-AC4, FR-022, SC-011
  - **Verify RED**: `node --test mcp-servers/pdlc/tests/unit/spec-worktree.test.mjs` → expected: failing —
    `takeLatest is not a function`
- [ ] T044 [P] [US8] Test: stage target and secrets.
  - In `write-guards.test.mjs`, a stage change aimed at an issue other than the spec's proposal is refused.
  - In `secret-sinks.test.mjs`, the token is absent from every new tool's result, the audit lines, the
    `execFile` argv, the Spec Kit child's environment, the worktree's `.git/config` and the state file; spec text is
    absent from argv (commit messages carry no spec text).
  - **Refusal changes nothing** (FR-025, finding U1): add `mcp-servers/pdlc/tests/helpers/assert-unchanged.mjs`. It
    snapshots the fake forge's write log and, for git, the refs, `git status --porcelain` and the hashes of the
    feature folder's files. Every refusal test added in Phases 3 to 11 wraps its call in it, and it fails on any
    difference.
  - **One audit line per call** (constitution Logging, finding U7): extend 014's audit test, which loops over the
    contract, to every new tool, including the app-only `save_pane_edit`. Each call, allowed or refused, emits
    exactly one `audit` line before its result.
  - **Scenarios covered**: US8-AC5, US8-AC6, FR-024, FR-025
  - **Verify RED**: `node --test mcp-servers/pdlc/tests/unit/write-guards.test.mjs` and
    `node --test mcp-servers/pdlc/tests/unit/secret-sinks.test.mjs` → expected: failing — `unknown tool
    take_latest_spec` (the sink sweep iterates the contract)
- [ ] T045 [US8] Integration: in `spec-lifecycle.integration.test.mjs`:
  - push a second commit to the bare remote's feature branch, and approve: refused `branch_changed`;
  - `take_latest_spec`, with one conflicting and one clean edit: the conflict is reported and the clean edit is
    merged;
  - approve again: published;
  - a direct push to the bare remote's `main` through the server's git runner is refused `push_target_refused`;
  - each refusal above leaves the bare remote's refs, the copy and the worktree byte-identical, checked with the
    T044 helper against real git (FR-025).
  - **Scenarios covered**: US8-AC2, US8-AC4, SC-011, FR-025
  - **Verify RED**: `node --test mcp-servers/pdlc/tests/integration/spec-lifecycle.integration.test.mjs` → expected:
    failing — `unknown tool take_latest_spec`

### Implementation for User Story 8

- [ ] T046 [US8] Implement the remote check and take-latest in `mcp-servers/pdlc/src/spec-worktree.mjs`, and
  `take_latest_spec` in the contract, the handlers and the manifest (prerequisite: T043, T045 RED)
  - **Verify GREEN**: same commands as T043 and T045 → expected: 0 failures
- [ ] T047 [US8] Close the guard gaps T044 found in `src/tools.mjs` and `src/spec-kit-runner.mjs` (prerequisite: T044
  RED)
  - **Verify GREEN**: same commands as T044 → expected: 0 failures; then `pnpm nx run pdlc:test` passes
- [ ] T048 [US8] Skill: on `branch_changed`, show what changed and offer **Take latest** or **Stop**. Show conflicts
  for the author to resolve, and never publish until they approve again. Extend `skill-master.test.mjs` for
  `take_latest_spec`.
  - **Verify RED**: `node --test mcp-servers/pdlc/tests/unit/skill-master.test.mjs` → expected: failing —
    `skill does not name take_latest_spec`
  - **Verify GREEN**: `node --test mcp-servers/pdlc/tests/unit/skill-master.test.mjs` → expected: 0 failures

**Checkpoint**: every guard in FR-020 to FR-024 has an observed refusal (SC-006).

---

## Phase 7: User Story 4 - One issue follows the feature to merge (Priority: P2)

**Goal**: on merge, CI moves the issue to merged and closes it, with test counts.

**Independent Test**: spec.md User Story 4 "Independent Test", and quickstart §4.

### Tests for User Story 4 ⚠️

Revised 2026-11-27 for decision M10 (research R12): no test target runs a second time. Task IDs T054a to T054d are
inserted, not renumbered, so references to T055 onwards stay valid.

- [ ] T049 [P] [US4] Test: the result collector (R12). In `scripts/__tests__/collect-test-results.test.mjs`, run
  `node --test` on fixture tests (one pass, one fail, one skip, one todo, nested) with the collector as reporter.
  Assert one JSON line per test case, with the file from the repository root, the full name path and the outcome
  (data-model.md `Merge record.outcomes`).
  - **Scenarios covered**: FR-038
  - **Verify RED**: `node --test scripts/__tests__/collect-test-results.test.mjs` → expected: failing —
    `Cannot find module '../lib/collect-test-results.mjs'`
- [ ] T050 [P] [US4] Test: `feature-merged.mjs` ([contracts/feature-merged.md](contracts/feature-merged.md)). In
  `scripts/__tests__/feature-merged.test.mjs`, with a fake forge, a fixture git repository (two commits, the second
  adding test declarations) and fixture collector reports:
  - close form: PR found by the API, and by title fallback;
  - not from a proposal → exit 0, nothing written; two markers → exit 0, warning, nothing written; an issue that is
    not an open proposal → exit 0;
  - created = `count-repo-metrics` declarations at the merge minus at the parent, including a negative delta; an
    unreadable parent → `unknown (<reason>)`, never 0;
  - closing comment then label then close; idempotent re-run; run token first, `CI_DIGEST_TOKEN` on a 401 or 403
    (R11); `--dry-run` writes nothing;
  - outcomes form: per-target passed, failed, skipped, todo summed from the reports; skip and todo never in passed; a
    missing or unparsable report → that target `unknown` with its reason; `--job-status cancelled` adds the
    partial-run line; idempotent by the `pdlc-outcomes` trailer; never changes a label or closes; **always exits 0**,
    including on a failed write and on no proposal;
  - neither form spawns a test run (asserted by an injected spawn that fails the test if it sees `nx` or `node --test`);
  - a closed-without-merge PR never reaches the script (no push) — asserted on the workflow trigger in T051.
  - **Scenarios covered**: US4-AC2, US4-AC3, FR-014, FR-038, FR-039, SC-010
  - **Verify RED**: `node --test scripts/__tests__/feature-merged.test.mjs` → expected: failing —
    `Cannot find module '../feature-merged.mjs'`
- [ ] T051 [P] [US4] Test: config and workflow guards. In `scripts/__tests__/feature-merged-workflow.guard.test.mjs`:
  - `scripts/feature-merged.config.json` targets equal the test targets in `.forgejo/workflows/guardrails.yml`;
  - `feature-merged.yml` triggers on `push` to `main` and on `workflow_dispatch` only; runner `belay`; timeout 5;
    `fetch-depth: 2`; a concurrency group with no `cancel-in-progress`; no step runs `nx` or a test target;
  - `guardrails.yml`'s `guardrails` job has a last step running `feature-merged.mjs --outcomes` with
    `if: always() && github.event_name == 'push'` and `continue-on-error: true`, and its timeout is still 10;
  - the tokens pass through env only; a digest step is present in `feature-merged.yml`;
  - neither new step is named in branch protection's required checks (documented assertion).
  - **Scenarios covered**: FR-014, FR-039, plan Constraints ("a merge is never blocked", no second test run)
  - **Verify RED**: `node --test scripts/__tests__/feature-merged-workflow.guard.test.mjs` → expected: failing —
    `ENOENT .forgejo/workflows/feature-merged.yml`
- [ ] T054a [P] [US4] Test: `backlog.mjs record-tests` ([contracts/feature-merged.md](contracts/feature-merged.md)
  "Template count comments"). Extend `scripts/__tests__/backlog.test.mjs`, with a fake forge and a fixture git
  repository:
  - `--point baseline` counts `HEAD`; `--point close-out` also counts the merge base with `origin/<default>` and
    prints the delta;
  - counts are printed on stdout in every case;
  - no `Proposal #<n>`, two markers, a closed issue and a non-proposal issue → prints why, posts nothing, exit 0;
  - an open proposal → one comment with the contract text, no label change;
  - a missing credential → exit 3 with the counts still printed; a 403 → exit 4; a transport failure → exit 5;
  - bad `--point` → exit 2.
  - **Scenarios covered**: FR-040
  - **Verify RED**: `node --test scripts/__tests__/backlog.test.mjs` → expected: failing —
    `Unknown command: record-tests`
- [ ] T054b [P] [US4] Test: the tasks-template override carries the two count tasks. Extend
  `scripts/__tests__/check-speckit-overrides.test.mjs` (or the override's existing guard): the override holds a
  REQUIRED **Record the test baseline** task in Phase 1 and a REQUIRED **Record the test count** task immediately
  before **Open the PR**, each naming `backlog.mjs record-tests` with its `--point`, the "not from a proposal: nothing
  posted, not a failure" rule and the "on a non-zero exit, record the counts and the exit code, report it, and
  continue" rule; and the EXCEPTION comment lists both as required.
  - **Scenarios covered**: FR-040
  - **Verify RED**: `node --test scripts/__tests__/check-speckit-overrides.test.mjs` → expected: failing —
    `tasks-template override has no "Record the test baseline" task`

### Implementation for User Story 4

- [ ] T052 [P] [US4] Implement `scripts/lib/collect-test-results.mjs` (prerequisite: T049 RED)
  - **Verify GREEN**: `node --test scripts/__tests__/collect-test-results.test.mjs` → expected: 0 failures
- [ ] T053 [US4] Implement `scripts/feature-merged.mjs` (both forms) and `scripts/feature-merged.config.json`. Count
  with `measureCommit` from `scripts/count-repo-metrics.mjs`, imported, never re-implemented. Cite data-model.md
  `Merge record.proposal` (exactly one marker, or none) and `Proposal issue.state` (the close happens only here, at
  merged). Attach the reporter to the three test targets by the path T007 chose (research R12, measured 2026-11-27: the
  opt-in argument, never `NODE_OPTIONS`): `check-coverage.mjs --run --results <file>` for `scripts:test`, and an
  optional results argument for `mcp-servers/pdlc/project.json` `test` and `integration`, keeping default output
  unchanged. Cover `--results` in `scripts/__tests__/check-coverage.test.mjs` first (RED: unknown flag), and assert
  a child `node` a test spawns does not inherit the collector. Add the `scripts:feature-merged` Nx target (prerequisite: T050 RED; T052 GREEN)
  - **Verify GREEN**: `node --test scripts/__tests__/feature-merged.test.mjs` → expected: 0 failures; then
    `pnpm nx run scripts:test` passes
- [ ] T054 [US4] Add `.forgejo/workflows/feature-merged.yml`, add the reporter attachment and the final outcomes step
  to `guardrails.yml`'s `guardrails` job, and update the CI digest coverage gate (`check-ci-digest-coverage`) for the
  new steps (prerequisite: T051 RED; T006 answers whether an `always()` step runs in a cancelled job)
  - **Verify GREEN**: `node --test scripts/__tests__/feature-merged-workflow.guard.test.mjs` and
    `node --test scripts/__tests__/check-ci-digest-coverage.test.mjs` → expected: 0 failures; then
    `pnpm nx run scripts:lint` passes
- [ ] T054c [US4] Implement the `record-tests` verb in `scripts/backlog.mjs`, importing `measureCommit` and the
  proposal-marker parser shared with `feature-merged.mjs` (prerequisite: T054a RED; T053 GREEN)
  - **Verify GREEN**: `node --test scripts/__tests__/backlog.test.mjs` → expected: 0 failures; then
    `pnpm nx run scripts:test` passes
- [ ] T054d [US4] Add the two REQUIRED count tasks to `.specify/templates/overrides/tasks-template.md` and to its
  EXCEPTION comment (contract text above), then run `node scripts/check-speckit-overrides.mjs` (prerequisite: T054b
  RED; T054c GREEN)
  - **Verify GREEN**: `node --test scripts/__tests__/check-speckit-overrides.test.mjs` → expected: 0 failures; then
    `node scripts/check-speckit-overrides.mjs` exits 0

**Checkpoint**: the stage model closes on merge (SC-004, SC-010 after the feature merges).

---

## Phase 8: User Story 5 - Reopen an approved spec (Priority: P2)

**Goal**: reopen until planning starts; approving again publishes on the same branch.

**Independent Test**: spec.md User Story 5 "Independent Test".

- [ ] T055 [P] [US5] Test: `reopen_spec`. In `tools.test.mjs` and `tool-contract.test.mjs`:
  - `ready-to-plan` → `spec-in-progress` with the reopen text;
  - `last_start_or_reopen` and `sessions_at_start_or_reopen` are reset to the current date and session count, so
    approving again needs a new clarification session (data-model.md `Spec in progress.last_start_or_reopen`,
    `Spec in progress.sessions_at_start_or_reopen`);
  - re-approval comment says "re-approved";
  - `document_locked` at `in-engineering`.
  - **Scenarios covered**: US5-AC1, US5-AC2, US5-AC3, FR-017
  - **Verify RED**: `node --test mcp-servers/pdlc/tests/unit/tools.test.mjs` → expected: failing —
    `unknown tool reopen_spec`
- [ ] T056 [US5] Implement `reopen_spec` (contract, handler, manifest, skill). Extend the integration test with
  approve → reopen → edit → approve: two commits on the same branch (prerequisite: T055 RED)
  - **Verify GREEN**: `node --test mcp-servers/pdlc/tests/unit/tools.test.mjs`, then
    `node --test mcp-servers/pdlc/tests/integration/spec-lifecycle.integration.test.mjs` → expected: 0 failures

---

## Phase 9: User Story 7 - Stop cleanly where Spec Kit is not set up (Priority: P2)

**Goal**: no Spec Kit means proposal only, with a plain reason, and nothing created.

**Independent Test**: spec.md User Story 7 "Independent Test", and quickstart §6.

- [ ] T057 [P] [US7] Test:
  - `start_spec` against a repository without `.specify/` refuses `spec_kit_unavailable`, and the git double sees no
    write call;
  - the integration test with a bare repository without `.specify/` shows no new branch on the remote and none in
    the copy;
  - `skill-master.test.mjs` asserts the skill's no-Spec-Kit wording.
  - **Scenarios covered**: US7-AC1, US7-AC2, SC-005
  - **Verify RED**: `node --test mcp-servers/pdlc/tests/unit/tools.test.mjs` → expected: failing — `expected no git
    write calls, saw fetch`
- [ ] T058 [US7] Make `start_spec` check Spec Kit before any git call, and finish the skill's wording (prerequisite:
  T057 RED)
  - **Verify GREEN**: same commands as T057 → expected: 0 failures

---

## Phase 10: User Story 9 - Review and edit side by side (Priority: P2)

**Goal**: the in-progress proposal and spec in the right-hand pane, with direct edits that are never lost.

**Prerequisite**: T003 measured that a pane beside the chat is possible, or the maintainer has re-decided FR-035 and
FR-036.

**Independent Test**: spec.md User Story 9 "Independent Test".

- [ ] T059 [P] [US9] Test: the pane module (R9). In `mcp-servers/pdlc/tests/unit/document-pane.test.mjs`:
  - `show_document` attaches `_meta.ui.resourceUri` `ui://pdlc/document-pane.html` and returns `revision` and
    `read_only` (data-model.md `Pane document.read_only`);
  - `save_pane_edit` and `read_pane_document` are announced with `_meta.ui.visibility: ["app"]`;
  - **two module instances over one clone root** (standing in for the two server processes T003 measured): a save
    through one is seen by `read_pane_document` and `get_spec` through the other, and the module holds no state
    between calls (revision and `model_read_snapshot` come from disk);
  - it writes through the R5 path guard, or to the draft store only;
  - it refuses `document_locked` and `pane_edit_pending` (data-model.md `Pane document.revision`);
  - drafts are deleted after a successful create or update.
  - **Scenarios covered**: US9-AC1, US9-AC3, US9-AC4, FR-035 to FR-037
  - **Verify RED**: `node --test mcp-servers/pdlc/tests/unit/document-pane.test.mjs` → expected: failing —
    `Cannot find module '../../src/document-pane.mjs'`
- [ ] T060 [P] [US9] Test: no pane edit is lost. In `proposals-refine.test.mjs` and `tools.test.mjs`:
  - `create_proposal`, `update_proposal` and `write_spec_file` refuse `pane_edit_pending` when the draft or spec
    revision moved past the base;
  - `get_spec` and `get_proposal_draft` return `pane_changes`;
  - an old skill that sends no `draft_revision`, with no draft present, still works (R16).
  - **Scenarios covered**: US9-AC2, US9-AC3, FR-036
  - **Verify RED**: `node --test mcp-servers/pdlc/tests/unit/proposals-refine.test.mjs` → expected: failing —
    `expected refusal pane_edit_pending`
- [ ] T061 [P] [US9] Test: the page. In `mcp-servers/pdlc/tests/unit/document-pane-page.test.mjs`, check
  `ui/document-pane.html` statically:
  - one file;
  - no external `src` or `href`;
  - an inline script with no `eval` or `new Function`;
  - the JSON-RPC message names it uses match the measured protocol subset from T003 (`ui/initialize`,
    `ui/notifications/initialized`, `ui/notifications/tool-result`, `ui/notifications/host-context-changed`,
    `ui/request-display-mode`, `tools/call`), and it never uses `ui/update-model-context`;
  - it requests `fullscreen` on load, and states it is inline when `fullscreen` is not offered;
  - it polls `read_pane_document` every 2 s and never overwrites text the author is typing;
  - a read-only mode disables every editor.
  - **Scenarios covered**: US9-AC4, M7
  - **Verify RED**: `node --test mcp-servers/pdlc/tests/unit/document-pane-page.test.mjs` → expected: failing —
    `ENOENT ui/document-pane.html`
- [ ] T062 [US9] Implement `mcp-servers/pdlc/src/document-pane.mjs` (data-model.md `Pane document.kind`: `proposal` or
  `spec` only; any other value is refused by the zod schema), the resource registration in `src/server.mjs`,
  `show_document`, `get_proposal_draft`, `save_pane_edit` and `read_pane_document` in the contract and manifest, and `draft_revision` on
  `create_proposal` and `update_proposal` (prerequisite: T059, T060 RED)
  - **Verify GREEN**: same commands as T059 and T060 → expected: 0 failures
- [ ] T063 [US9] Write `mcp-servers/pdlc/ui/document-pane.html` (M7), and include `ui/` in `scripts/pack.mjs`'s stage
  (prerequisite: T061 RED)
  - **Verify GREEN**: `node --test mcp-servers/pdlc/tests/unit/document-pane-page.test.mjs` → expected: 0 failures;
    then `pnpm nx run pdlc:pack` produces a bundle containing `ui/document-pane.html`
- [ ] T064 [US9] Skill: open the pane with `show_document` when reviewing or editing; take in `pane_changes` and say
  what was taken in; fall back to the chat when the pane is unavailable (FR-037). Extend `skill-master.test.mjs`.
  - **Verify RED**: `node --test mcp-servers/pdlc/tests/unit/skill-master.test.mjs` → expected: failing —
    `skill does not name show_document`
  - **Verify GREEN**: `node --test mcp-servers/pdlc/tests/unit/skill-master.test.mjs` → expected: 0 failures

---

## Phase 11: User Story 6 - Withdraw a spec in progress (Priority: P3)

**Goal**: withdraw back to a proposal stage, deleting nothing and never reusing the branch.

**Independent Test**: spec.md User Story 6 "Independent Test".

- [ ] T065 [P] [US6] Test: `withdraw_spec`. In `tools.test.mjs` and `tool-contract.test.mjs`:
  - `to: ready|draft`;
  - a `withdrawn` trailer;
  - no git or file delete call;
  - the state file is marked withdrawn;
  - `document_locked` at `in-engineering`;
  - a later `start_spec` creates a new feature number (data-model.md `Proposal issue.withdrawn_branches`).
  - **Scenarios covered**: US6-AC1, US6-AC2, US6-AC3, FR-019
  - **Verify RED**: `node --test mcp-servers/pdlc/tests/unit/tools.test.mjs` → expected: failing —
    `unknown tool withdraw_spec`
- [ ] T066 [US6] Implement `withdraw_spec` (contract, handler, manifest, skill wording) (prerequisite: T065 RED)
  - **Verify GREEN**: `node --test mcp-servers/pdlc/tests/unit/tools.test.mjs` → expected: 0 failures

---

## Phase 12: Polish & Cross-Cutting Concerns

- [ ] T067 Bump `mcp-servers/pdlc/manifest.json` and `package.json` to **0.2.0**. Update `long_description` and the
  `forge_token` description (`write:issue` + `write:repository`, R6). Extend `check_setup` with the stage labels and
  `default_branch_protected`, test first in `setup-check.test.mjs` (RED: `expected missing_labels to include
  status/ready-to-plan`). Also, test first in `proposals.test.mjs`, `list_proposals` and `get_proposal` take the
  four stage ids in their `status` filter and result (contracts/tools.md "Changed 014 tools"; finding U5). RED:
  `status: Invalid enum value 'ready-to-plan'`.
  - **Verify GREEN**: `node --test mcp-servers/pdlc/tests/unit/setup-check.test.mjs`,
    `node --test mcp-servers/pdlc/tests/unit/proposals.test.mjs` and
    `node --test mcp-servers/pdlc/tests/unit/manifest.test.mjs` → expected: 0 failures; then `pnpm nx run pdlc:lint`
- [ ] T068 [P] Extend `pdlc:integration-forge` (`mcp-servers/pdlc/tests/integration-forge/`) with the full lifecycle
  against `ci-smoke`, including a push to its protected `main` refused by the forge (quickstart §1). Test branches are
  named `pdlc-it-<run id>-…`, and the helper removes them after the operator agrees in the runbook. The test prints
  how long `start_spec` took, against the plan's 30 s target (finding P1).
  - **Done when**: `pnpm nx run pdlc:integration-forge` passes with 0 skipped, run by the operator, and the
    `start_spec` time is recorded in `docs/runbooks/pdlc.md`
- [ ] T069 [P] Guard test: nothing in BELAY's tooling references the server (014's independence guard). Extend `scripts/__tests__/pdlc-independence.guard.test.mjs` to
  `scripts/feature-merged.mjs`, `scripts/lib/*`, `.forgejo/workflows/feature-merged.yml` and
  `.claude/skills/speckit-belay-spec-stage/` (FR-031). RED by naming a new file before it exists, then GREEN.
  - **Verify GREEN**: `node --test scripts/__tests__/pdlc-independence.guard.test.mjs` → expected: 0 failures
- [ ] T070 Write the MCM hand-off additions (FR-033) in `docs/runbooks/pdlc.md` § hand-off:
  - the four labels;
  - the `stage` verb and both hooks;
  - the `feature-merged` workflow, the `guardrails` outcomes step and their config;
  - the tasks-template count tasks and `record-tests`;
  - that BELAY's counter recognises `node:test` declarations only, so MCM names a counting rule for its own test
    kinds before adopting the counts;
  - the ready-listing change;
  - the confirmation steps for SC-004 and SC-010 in MCM.
  - **Done when**: the section lists each item and its order, and a reader can carry it out without asking
- [ ] T071 [P] Update `.claude/skills/forgejo-issues/SKILL.md`: the stage table, ready-to-plan pick-up (check out
  the named branch), close-on-merge, and `stage` replacing `close-proposal` (lines 20, 93 to 95)
  - **Done when**: the old terms are gone from it, and the stages match contracts/stages.md
- [ ] T072 [P] Update `docs/runbooks/backlog.md`: the verb list (line 23), the pick-up and close paragraphs (lines 114
  to 117), the four labels, and the ready-listing notes
  - **Done when**: `close-proposal` and `Superseded by spec` appear only in a dated "until feature 016" note
- [ ] T073 [P] Update `docs/runbooks/pdlc.md`:
  - what it can do (lines 12 to 18), the token scope table (line 39);
  - the spec stage, pane, refusal codes and measured facts from T003 to T007;
  - the rebuild note;
  - the file table (lines 170 to 171);
  - the hand-off lines (193, 204), with T070.
  - **Done when**: every hit in T002 for this file is resolved
- [ ] T074 [P] Update `docs/runbooks/spec-kit.md`: rows 5a and 7 (the hooks and the skill), line 79, the reinstall
  steps (lines 158 to 160), and the tasks-template override's two new required count tasks (FR-040)
  - **Done when**: `node scripts/check-speckit-overrides.mjs` passes and the runbook rows match its inventory
- [ ] T075 [P] Update `mcp-servers/pdlc/README.md` (lines 6 and 17)
  - **Done when**: it states the default-branch-read-only, feature-branch-published model and the stage model
- [ ] T076 Refresh the openwiki pages whose `resource` changed, with the `wiki-refresh` skill:
  - `openwiki/runbooks/{backlog,pdlc,spec-kit}.md`;
  - `openwiki/runbooks/index.md` descriptions;
  - `openwiki/projects/repository.md` line 36.

  Then run `node scripts/wiki-refresh.mjs --stale`, then `--record <page>` for each.
  - **Done when**: `node scripts/wiki-refresh.mjs --stale` reports nothing, and the OKF gate (V17) passes
- [ ] T077 [P] Update `openwiki/process/spec-driven-development.md` (canonical): the proposal step's stages, the hook
  moving the issue rather than closing it, and close on merge (line 30)
  - **Done when**: the lifecycle text matches contracts/stages.md
- [ ] T078 [P] Update `openwiki/invariants/secrets-management.md` (canonical): the `pdlc` token row's scope
  (`write:repository`); and `CI_DIGEST_TOKEN`'s users if T006 showed the fallback is used
  - **Done when**: the rows match research M5 and M6 as measured
- [ ] T079 [P] Add the `feature-merged` workflow and the `guardrails` outcomes step to `docs/runbooks/ci.md`: trigger,
  not required, token, re-run by `workflow_dispatch` with `sha`, no second test run, and reading their comments
  - **Done when**: the page names the workflow and how to re-run it
- [ ] T080 **Close-out re-search**: re-run T002's searches for the OLD identifiers (`close-proposal`,
  `close-on-spec`, `closes once its spec`, `read-only local cop`, `never commits`, `Superseded by spec`, and
  `read:repository` on the `pdlc` token row). Every remaining hit in a doc that states current procedure is fixed or
  justified here.
- [ ] T081 Run the full checks CI runs, and the gates the diff touches:
  - `pnpm nx run scripts:lint`
  - `pnpm nx run scripts:test`
  - `pnpm nx run pdlc:lint`
  - `pnpm nx run pdlc:test`
  - `pnpm nx run pdlc:integration`
  - `node scripts/check-speckit-overrides.mjs`
  - **Done when**: all exit 0, with 0 skipped (watch the skip count)
- [ ] T082 Run [quickstart.md](quickstart.md) §2 to §7 on the workstation and BELAY after the bundle is rebuilt and
  re-uploaded. §4 (merge) and §7 (server absent) complete only after this PR merges and with the next proposal; record
  them on the backlog item that tracks this feature's acceptance.
  - **Done when**: each section's expected outcome is observed and noted with its date. Note the observed
    `start_spec` time (§2 step 1), the `feature-merged` run time and the `guardrails` run time on `main` (§4) against
    the plan's performance goals
    (finding P1)
- [ ] T082a **Record the test count**: `node scripts/backlog.mjs record-tests --spec specs/016-pdlc-spec-intake --point close-out`
  after the last code commit. Expected: counts printed, "not an open proposal (#91 is closed); nothing posted", exit 0.
  - **Done when**: the counts, the delta and the exit code are recorded in this task
- [ ] T083 **Open the PR** from a real branch, with the repository's PR tools (`docs/runbooks/ci.md`):
  1. `git push origin HEAD:016-pdlc-spec-intake`
  2. `node scripts/forge-pr.mjs open --head 016-pdlc-spec-intake --title "Feature 016: PDLC spec intake (proposal item #91)" --body-file <file>`
  3. `node scripts/ci-status.mjs watch --pr <n>`, until it exits 0
  4. `node scripts/forge-pr.mjs merge <n> --expect-head <full sha>`

  Tick this task in the branch's LAST commit and quote the branch and the PR number. **CI evidence is never recorded
  here**: the run ids, the CI verdict and the merge sha go in the PR's closing comment. After merge, run
  `node scripts/backlog.mjs setup-labels` once so the four labels exist (quickstart Prerequisites).

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**:
  - T001 (ADR approval) blocks every code task.
  - T003 blocks Phase 10.
  - T004 and T008 block T022; T022b lands before the first push that contains T022.
  - T005 blocks T068.
  - T006 blocks T053, T054 and T078.
  - T007 blocks T053.
  - T054c and T054d follow T053 (shared marker parser and `measureCommit` import).
- **Foundational (Phase 2)**: blocks every story. T012 before T014, which cross-checks against the same fixtures.
- **US1 (Phase 3)** → **US2 (Phase 4)**: approval needs a started spec.
- **US3 (Phase 5)**: the `backlog.mjs`, hooks and gate tasks (T036, T037, T039, T040) need only Phase 2. The lock
  (T038, T041) and the setup-plan check (T042) need US2.
- **US8 (Phase 6)**: needs US2 (publish exists).
- **US4 (Phase 7)**: needs only Phase 2 (labels and trailer). It can run in parallel with US1 to US3.
- **US5, US6, US7**: need US2 (US5, US6) or US1 (US7).
- **US9 (Phase 10)**: needs US1 and T003.
- **Polish**: after the stories it documents. T083 is last.

### Within each story

Tests are written and verified RED before implementation, and the paired implementation is verified GREEN. Then the
contract, manifest and skill move together (FR-030).

### Parallel opportunities

- Phase 1: T004 to T007 are independent measurements.
- Phase 2: T009, T011, T013 and T015 are different files.
- US1: T017 to T020 are tests in different files; T023 to T025 are implementations in different files.
- US4 can proceed in parallel with US1 to US3: `scripts/` only, no server file.
- US4: T049, T050, T051, T054a and T054b are tests in different files.
- Polish: T071 to T079 are different documents.

## Parallel Example: User Story 1

```bash
Task: "T017/T018 Spec Kit runner tests in mcp-servers/pdlc/tests/unit/spec-kit-runner.test.mjs"
Task: "T019 path guard tests in mcp-servers/pdlc/tests/unit/spec-files.test.mjs"
Task: "T020 worktree tests in mcp-servers/pdlc/tests/unit/spec-worktree.test.mjs"
# then
Task: "T023 src/spec-kit-runner.mjs"   Task: "T024 src/spec-files.mjs"   Task: "T025 src/spec-worktree.mjs"
```

## Implementation Strategy

### MVP first

The MVP is Phases 1 and 2, then US1 → US2 → US3. That proves SC-001 to SC-003: the owner writes and approves, and the
Architect picks up. Stop and validate with quickstart §2 and §3.

### Incremental delivery

1. Add US8, the remaining guards and take-latest (SC-006, SC-011).
2. Add US4, close on merge with counts (SC-004, SC-010).
3. Add US5 and US7 (reopen, no Spec Kit).
4. Add US9 (the pane), gated on T003.
5. Add US6 (withdraw).

PR batching (`openwiki/process/pull-request-batching.md`): one PR unless a failure would be ambiguous. US4 (`scripts/`
and CI only) is the natural candidate to split if `guardrails` results would otherwise be hard to read.

---

## Completion Checklist

Before marking `016-pdlc-spec-intake` complete, verify every success criterion from [spec.md](spec.md):

- [ ] **SC-001**: proposal → approved, committed spec on a published branch, zero visits to VS Code, the forge or a
  terminal (quickstart §2)
- [ ] **SC-002**: `/speckit-plan` on the branch with zero fix-ups (quickstart §3; T042)
- [ ] **SC-003**: `ready` shows 100% of ready-to-plan specs with branch, and 0% of the others (T036)
- [ ] **SC-004**: one issue through every stage, closing only on merge (quickstart §4; T050)
- [ ] **SC-005**: no Spec Kit → plain message, zero branches, commits or files (T057, quickstart §6)
- [ ] **SC-006**: every guard in FR-020 to FR-024 has an observed refusal (Phases 2, 3 and 6)
- [ ] **SC-007**: zero server commits on the default branch; zero other branches (T022, T032, T045)
- [ ] **SC-008**: server absent → the VS Code route moves through every stage; lint and test pass with no skip
  (quickstart §7; T069)
- [ ] **SC-009**: a chat edit and a pane edit of each document reach the saved proposal and committed spec
  (quickstart §2 step 3; T060)
- [ ] **SC-010**: the created count matches `count-repo-metrics.mjs` at the merge and its parent, the outcomes match
  the `guardrails` log, and no second test run happened (quickstart §4; T050, T051)
- [ ] **SC-011**: take latest keeps 100% of unpublished edits or shows them as conflicts (T043, T045)
- [ ] All test tasks used the TDD checkpoint format (Verify RED confirmed before implementation)
- [ ] `pnpm nx run pdlc:test`: unit and contract tests pass, at or above 70% line coverage
- [ ] `pnpm nx run pdlc:integration`: real git and real Spec Kit scripts pass, 0 skipped
- [ ] `pnpm nx run pdlc:integration-forge`: operator-run, passes, 0 skipped
- [ ] `pnpm nx run pdlc:lint` and `pnpm nx run scripts:lint`: no errors
- [ ] `pnpm nx run scripts:test`: passes
- [ ] `rtk gain`: above 80% token compression confirmed (run last)
