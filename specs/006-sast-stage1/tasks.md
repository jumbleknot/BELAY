<!-- forked-from: .specify/templates/tasks-template.md sha256=fc29a233f6f5a27ca31f1aa46b596af6500c627441c6e62b2bc4a1d721525842 spec-kit=1.4.2 -->
---

description: "Task list for feature 006: SAST and SCA gate, stage 1"
---

# Tasks: SAST and SCA gate, stage 1 (Semgrep and pnpm audit)

**Input**: `/specs/006-sast-stage1/`. **Baseline**: MCM `main` at `fc2b953`, feature 033.

**Tests**: REQUIRED (constitution TDD). Ported tests land first and are verified RED, against a
missing module or a mutation, then GREEN. Custom rules are fixture-first.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [x] T001 Worktree `/home/coder/worktrees/006-sast-stage1` on `006-sast-stage1`, real frozen install;
  read-only MCM clone at `fc2b953`
  - **Done when**: `scripts:lint` and `scripts:test` pass on the untouched branch
- [x] T002 **Doc-impact sweep**. This feature adds tooling and a CI job. It changes the meaning of the
  statements that SAST is deferred, and of "guardrails runs one job". Command, per term:
  `git grep -n -F "<term>" -- '*.md' '*.yaml' ':!specs/' ':!docs/proposals/' ':!docs/decisions/' ':!docs/superpowers/'`.
  Terms: `item #37`, `SAST`, `Semgrep`, `semgrep`, `uv on the runner`, `guardrails / guardrails`.
  Hits:
  - `docs/repo-foundation-setup.md:496-497` ("Defer what needs a structural decision … SAST") → T031
  - `docs/repo-foundation-setup.md:585` ("item #37 holds the staged SAST port") → T031
  - `docs/repo-foundation-setup.md:292,566`, `docs/runbooks/ci.md:210` (the required context) → T030:
    add `guardrails / sast` as a second context once it has reported
  - `openwiki/runbooks/ci.md:17` ("Its one job") → T032

---

## Phase 2: Foundational

- [x] T003 [P] Port `scripts/lib/scanner-retry.mjs` (shared retry) and `scripts/allowlist-expiry.mjs`,
  with their tests (`allowlist-expiry.test.mjs`, and the retry cases MCM keeps in
  `sast-scan-retry.guard.test.mjs`)
  - **Verify RED**: `node --test scripts/__tests__/allowlist-expiry.test.mjs` → ≥1 failing, `Cannot find module`
  - **Verify GREEN**: the same command → 0 failures

---

## Phase 3: User Story 1 - Local scan, one report (P1) 🎯 MVP

### Tests ⚠️

- [x] T010 [P] [US1] Port `scripts/__tests__/sast-scan.guard.test.mjs` and `sast-scan-retry.guard.test.mjs`.
  Add cases for the enabled-scanner list: an unknown name exits 2; an empty list exits 2; `--only`
  outside the list exits 2; a disabled scanner reports `not-enabled`, never clean
  - **Scenarios covered**: US1-AC1, US1-AC2, US1-AC3
  - **Verify RED**: `node --test scripts/__tests__/sast-scan.guard.test.mjs` → ≥1 failing, `Cannot find module`

### Implementation

- [x] T011 [US1] Port `scripts/sast-scan.mjs` (research R1, R7); add `security/sast/scan.yaml`,
  `semgrep.yaml` (R4), `severity-map.yaml`, `README.md`; gitignore `security/sast/reports/`
  - **Verify GREEN**: the T010 commands → 0 failures; `node scripts/sast-scan.mjs --scope full` writes the
    report, with semgrep and pnpm-audit `ran` and the other two `not-enabled`
- [x] T012 [US1] Add the Nx target `scripts:sast` (full scan, then the gate)
  - **Done when**: `pnpm nx run scripts:sast` runs both

---

## Phase 4: User Story 2 - The gate blocks new High/Critical (P1)

### Tests ⚠️

- [x] T015 [P] [US2] Port `scripts/__tests__/check-sast-findings.test.mjs` and
  `allowlist-expiry-wiring.guard.test.mjs`
  - **Scenarios covered**: US2-AC1, US2-AC2, US2-AC3 (runtime vs dev scope)
  - **Verify RED**: `node --test scripts/__tests__/check-sast-findings.test.mjs` → ≥1 failing, `Cannot find module`

### Implementation

- [x] T016 [US2] Port `scripts/check-sast-findings.mjs`; add `--selftest` to `scripts:lint`
  - **Verify GREEN**: the T015 commands → 0 failures; `--selftest` exits 0
- [x] T017 [US2] Add the `sast` job to `.forgejo/workflows/guardrails.yml` (research R2), with the
  failure digest and the report artifact; extend `guardrails-workflow.test.mjs` to pin the job's
  shape (runner, timeout, steps, setup-node before Node, `--apply`-style inputs absent)
  - **Verify RED**: the extended workflow test fails before the job exists
  - **Verify GREEN**: it passes after, and `check-ci-digest-coverage.mjs` and
    `check-toolchain-consistency.mjs` exit 0

---

## Phase 5: User Story 3 - Allowlist (P2)

- [x] T020 [US3] Seed `security/sast/allowlist.yaml` from a full scan (research R5): 0 blocking findings, so the baseline is empty (recorded in its header). Each entry
  carries a real justification; a cheap real defect is fixed instead
  - **Done when**: `pnpm nx run scripts:sast` exits 0 on the branch (SC-006)

---

## Phase 6: User Story 4 - Custom rules (P2)

- [x] T025 [P] [US4] Port the rule fixtures first: `belay-ci-curl-pipe-shell`,
  `belay-no-token-logging`, `belay-no-jwt-payload-tracing` (research R3)
  - **Verify RED**: `node scripts/sast-scan.mjs --test-rules` fails while the rule files are absent
- [x] T026 [US4] Port the three rules (ids, paths and messages rewritten for BELAY; curl-pipe's accepted
  list = uv's pinned installer only)
  - **Verify GREEN**: `node scripts/sast-scan.mjs --test-rules` passes every rule

---

## Phase 7: Polish

- [x] T030 [P] `docs/runbooks/sast.md` (new): what runs, how to run it locally, the allowlist and expiry,
  the pins, stages 2–4; `docs/runbooks/ci.md`: the `sast` job and the second required context
- [x] T031 [P] `docs/repo-foundation-setup.md`: step 13's SAST paragraph says stage 1 is in place;
  history points at feature 006 and item #37's remaining stages
- [x] T032 [P] `openwiki/runbooks/ci.md` ("one job"), plus an openwiki page for the SAST runbook if the
  brief calls for one; record fingerprints with `wiki-refresh.mjs --record`
  - **Done when**: `wiki-refresh.mjs --stale` exits 0, and the okf and governance gates pass
- [x] T033 Close-out re-search: re-run T002's searches
- [x] T034 Quickstart steps 1–4; final `scripts:lint`, `scripts:test` (skip count),
  `check-speckit-overrides.mjs`
- [x] T035 Update item #37: stage 1 done, with evidence; stages 2–4 filed as items #39, #40, #41 (its
  acceptance criteria)
- [ ] T036 **Open the PR** from a real branch: `git push origin HEAD:006-sast-stage1`;
  `node scripts/forge-pr.mjs open …`; `node scripts/ci-status.mjs watch --pr <n>`;
  `node scripts/forge-pr.mjs merge <n> --expect-head <sha>` (merge only on the maintainer's approval).
  **CI evidence is never recorded here.**

## Dependencies

T003 → US1/US2. US1 and US2 can run in parallel (different files). US4 depends on T011 (`--test-rules`).
T020 depends on US1, US2 and US4. Polish runs last.
