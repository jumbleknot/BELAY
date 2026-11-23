<!-- forked-from: .specify/templates/tasks-template.md sha256=fc29a233f6f5a27ca31f1aa46b596af6500c627441c6e62b2bc4a1d721525842 spec-kit=1.4.2 -->
---

description: "Task list for feature 007: SAST dependency-downgrade gate"
---

# Tasks: SAST dependency-downgrade gate

**Input**: `/specs/007-dependency-downgrade-gate/`. **Baseline**: MCM `main` at `fc2b953`.

**Tests**: REQUIRED (constitution TDD). The ported test lands first and is verified RED against the
missing module, then GREEN.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [x] T001 Worktree `/home/coder/worktrees/007-downgrade` on `007-dependency-downgrade-gate`, real
  frozen install; read-only MCM clone at `fc2b953`
  - **Done when**: `scripts:lint` and `scripts:test` pass on the untouched branch
- [x] T002 **Doc-impact sweep**. This feature makes some dev-scope advisories block, which changes the
  meaning of "dev-scope never blocks". Command, per term:
  `git grep -n -i -F "<term>" -- '*.md' '*.yaml' '*.yml' '*.mjs' ':!specs/' ':!docs/proposals/' ':!docs/decisions/' ':!docs/superpowers/'`.
  Terms: `item #43`, `downgrade`, `not ported`, `dev-scope`, `dev-only`, `never block`.
  Hits:
  - `docs/runbooks/sast.md:62` ("Dev-scope advisories … never block") → T020
  - `openwiki/runbooks/sast.md:22` (same) → T021
  - `.forgejo/workflows/guardrails.yml:84` (job comment: dev-scope findings are warnings) → T011
  - `security/sast/allowlist.yaml:6`, `scripts/check-sast-findings.mjs` (describe the main gate only;
    still true) → no change
  - No "not ported" note exists for this gate (research R9)
- [x] T003 Confirm the imports behave as in MCM (research R1)
  - **Done when**: the function-body diffs are recorded in research R1

---

## Phase 2: User Stories 1–3 - The check (P1/P2) 🎯 MVP

### Tests ⚠️

- [x] T005 [P] [US1] [US2] [US3] Port `scripts/__tests__/check-dependency-downgrade.test.mjs`: ranges,
  lockfile reading, the rule, the allowlist, the CLI contract. Generic nested-workspace fixture
  (research R5); the wiring test moves to T010 (R3); add the unknown-base-ref case (R4)
  - **Scenarios covered**: US1-AC1–AC6, US2-AC1–AC2, US3-AC1–AC4
  - **Verify RED**: `node --test scripts/__tests__/check-dependency-downgrade.test.mjs` → ≥1 failing,
    `Cannot find module`

### Implementation

- [x] T006 [US1] [US2] [US3] Port `scripts/check-dependency-downgrade.mjs` (research R2)
  - **Verify GREEN**: the T005 command → 0 failures, 0 skipped

---

## Phase 3: User Story 4 - Wired into the `sast` job (P1)

### Tests ⚠️

- [x] T010 [US4] Extend `scripts/__tests__/guardrails-workflow.test.mjs`: the downgrade step exists,
  runs after the gate, is PR-only, takes `BASE_REF` from `github.base_ref`, and runs through
  `ci-log-step.sh` with `--base "origin/$BASE_REF"` (research R3)
  - **Scenarios covered**: US4
  - **Verify RED**: `node --test scripts/__tests__/guardrails-workflow.test.mjs` → ≥1 failing (no such step)

### Implementation

- [x] T011 [US4] Add the step to `.forgejo/workflows/guardrails.yml`'s `sast` job after the gate; update
  the job comment (T002)
  - **Verify GREEN**: the T010 command → 0 failures; `node scripts/check-ci-digest-coverage.mjs` exits 0

---

## Phase 4: Polish

- [x] T020 [P] `docs/runbooks/sast.md`: the job's step list gains the check; "When the gate goes red"
  covers it (what it means, how to fix, how to accept); the dev-scope sentence names the exception
- [x] T021 [P] `openwiki/runbooks/sast.md` refreshed; `node scripts/wiki-refresh.mjs --stale`, then
  `--record openwiki/runbooks/sast.md`
  - **Done when**: `wiki-refresh.mjs --stale` exits 0
- [x] T022 Demonstration (SC-002, research R8) in a throwaway worktree, never pushed
  - **Done when**: the main gate exits 0 and the check exits 1, naming the package and advisory
- [x] T023 Close-out re-search: re-run T002's searches
- [x] T024 Quickstart steps 1–4; final `scripts:lint`, `scripts:test` (skip count), `scripts:sast`;
  `semgrep-native.json` `.errors` lists only the two known files
- [x] T025 **Open the PR** (branch `007-dependency-downgrade-gate`, PR #44) from a real branch:
  `git push origin HEAD:007-dependency-downgrade-gate`; `node scripts/forge-pr.mjs open …`;
  `node scripts/ci-status.mjs watch --pr <n>`; merge with
  `node scripts/forge-pr.mjs merge <n> --expect-head <sha>` only on the maintainer's approval.
  **CI evidence is never recorded here.**
- [ ] T026 After the merge: close item #43 with a comment saying how each acceptance criterion was
  verified

## Dependencies

T005 → T006. T010 → T011. Phase 2 and Phase 3 touch different files and can run in parallel. T020–T022
need T006 and T011. T025 needs everything above it.
