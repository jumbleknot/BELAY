<!-- forked-from: .specify/templates/tasks-template.md sha256=fc29a233f6f5a27ca31f1aa46b596af6500c627441c6e62b2bc4a1d721525842 spec-kit=1.4.2 -->
---

description: "Task list for feature 008: SAST stage prep and step durations"
---

# Tasks: SAST stage 2/3 toolchain preparation, and per-step durations on every run

**Input**: `/specs/008-sast-stage-prep-step-durations/`

**Tests**: REQUIRED (constitution TDD), RED then GREEN per pair.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [x] T001 Worktree `/home/coder/worktrees/008-prep` on `008-sast-stage-prep-step-durations`, real
  frozen install. Also tick feature 007's T026 (item #43 closed after the merge)
  - **Done when**: `scripts:lint` and `scripts:test` pass on the untouched branch
- [x] T002 **Doc-impact sweep**. Command, per term:
  `git grep -n -i -F "<term>" -- '*.md' '*.yaml' '*.yml' ':!specs/' ':!docs/proposals/' ':!docs/decisions/' ':!docs/superpowers/' ':!.specify/'`.
  Terms: `only on failure`, `on failure`, `durations`, `counts mode`, `no Rust`, `stage 1 only`,
  `uv sync`, `cargo-audit`, `Stages 2 to 4`. Hits:
  - `docs/runbooks/sast.md:112-121` (stage table; job steps) → T030
  - `docs/runbooks/ci.md:133,186` (`belay-ci-failures` floor; `durations` reads "recent bundles") → T031
  - `docs/repo-foundation-setup.md:259` ("On failure, publishes a redacted digest") → T031
  - `infrastructure-as-code/forgejo/registry-retention.yaml:30` (the floor) → still true, no change
  - `security/sast/rules/belay-ci-curl-pipe-shell.yaml:36-38` ("sh.rustup.rs arrives with stage 2") → T013
  - `security/sast/allowlist.yaml:20`, `.forgejo/workflows/guardrails.yml:89` (stage comments) → T013

---

## Phase 2: User Stories 1–2 - The prepare script (P1)

### Tests ⚠️

- [x] T005 [P] [US1] [US2] `scripts/__tests__/sast-prepare.test.mjs`: no lockfile → nothing installed,
  exit 0; a Cargo.lock → rustup-init and cargo-audit fetched from the pinned URLs, verified, run with
  the pinned toolchain, `~/.cargo/bin` appended to PATH; a digest mismatch → throws naming both
  digests, nothing executed; Python → `uv sync --frozen` per locked project, first failure throws;
  unknown subcommand → exit 2
  - **Scenarios covered**: US1-AC1–AC3, US2-AC1–AC2
  - **Verify RED**: `node --test scripts/__tests__/sast-prepare.test.mjs` → ≥1 failing, `Cannot find module`

### Implementation

- [x] T006 [US1] [US2] `scripts/sast-prepare.mjs` (research R1–R3); export `trackedFiles` from
  `sast-scan.mjs`
  - **Verify GREEN**: the T005 command → 0 failures, 0 skipped

---

## Phase 3: User Story 3 - Guards and wiring (P1)

### Tests ⚠️

- [x] T010 [US3] In `sast-prepare.test.mjs`: the Rust pin equals `toolchain.Dockerfile`'s; a tracked
  lockfile requires its scanner enabled (research R5). In `guardrails-workflow.test.mjs`: both
  prepare steps exist, run through `ci-log-step.sh`, after uv and before the scan; the "stage 1 only"
  test is updated at the cause (no `rustup`/`cargo install`/`uv sync` outside the prepare script)
  - **Verify RED**: `node --test scripts/__tests__/guardrails-workflow.test.mjs` → ≥1 failing (no such steps)

### Implementation

- [x] T011 [US3] Add the two steps to the `sast` job (research R4)
  - **Verify GREEN**: the T010 commands → 0 failures; `check-ci-digest-coverage.mjs` exits 0
- [x] T012 [US3] Local check: in a scratch clone, a tiny locked Rust crate and Python project with both
  scanners enabled: `sast-prepare.mjs python` syncs, and the scan reports `cargo-audit` and `pip-audit`
  as run (dev container's baked Rust)
- [x] T013 [P] Comments: the curl-pipe rule's stage-2 note; `scan.yaml`, `allowlist.yaml` and the job
  comment name the prepared steps

---

## Phase 4: User Story 4 - Durations on every green run (P1)

### Tests ⚠️

- [x] T020 [US4] `ci-failure-digest.test.mjs`: `countsPublication` returns `durations-only` for no
  sources plus a durations file, `nothing` for neither, `bundle` for sources; mm5 updated at the cause;
  a green non-e2e job with a durations file says it publishes durations and exits 0 on transport failure
  - **Verify RED**: `node --test scripts/__tests__/ci-failure-digest.test.mjs` → ≥1 failing

### Implementation

- [x] T021 [US4] `ci-failure-digest.mjs` counts mode (research R6)
  - **Verify GREEN**: the T020 command → 0 failures; `ci-failure-digest.mjs --selftest` exits 0

---

## Phase 5: Polish

- [x] T030 [P] `docs/runbooks/sast.md`: job steps, stage table ("prepared; enable the scanner"), pins
- [x] T031 [P] `docs/runbooks/ci.md`, `docs/repo-foundation-setup.md`: durations publish on every
  green run; refresh `openwiki/runbooks/sast.md` and `ci.md` (`wiki-refresh.mjs --stale`, `--record`)
- [x] T032 SC-002 on the runner (research R7); delete the throwaway branch
- [x] T033 Close-out re-search: re-run T002's searches
- [x] T034 Final `scripts:lint`, `scripts:test` (skip count), `scripts:sast`, `check-speckit-overrides.mjs`
- [x] T035 **Open the PR** (branch `008-sast-stage-prep-step-durations`, PR #45):
  `git push origin HEAD:008-sast-stage-prep-step-durations`; `node scripts/forge-pr.mjs open …`;
  `node scripts/ci-status.mjs watch --pr <n>`; merge only on the maintainer's approval.
  **CI evidence is never recorded here.**
- [x] T036 After the merge: comment on items #39, #40 and #41 with what is now prepared and measured

## Dependencies

T005 → T006 → T010 → T011 → T012. T020 → T021 is independent of Phases 2–3. T032 needs T011.
