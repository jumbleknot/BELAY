<!-- forked-from: .specify/templates/tasks-template.md sha256=fc29a233f6f5a27ca31f1aa46b596af6500c627441c6e62b2bc4a1d721525842 spec-kit=1.4.2 -->
---

description: "Task list for feature 005: guardrail gate ports and registry retention"
---

# Tasks: Guardrail gate ports and registry retention

**Input**: Design documents from `/specs/005-guardrail-gate-ports/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: REQUIRED in this repository (constitution "Test-Driven Development", NON-NEGOTIABLE). Every
test task and its paired implementation task use the TDD checkpoint format in
`docs/templates/feature-test-tasks-template.md`. Ported behaviour is new to BELAY, so RED is "module
not found" only where the test also asserts behaviour. A RED counts only when the failure count is
non-zero. Documentation and config tasks use the "Done when" form.

**Source**: every port is from MovieCollectionManager (MCM) `main` at `fc2b953`, read from a
read-only clone. **Rule**: change only what removes MCM coupling (FR-003).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependencies)
- **[Story]**: US1 topology (item #2) · US2 secret scan + toolchain (item #1) · US3 OpenWiki
  (item #28) · US4 retention (item #32)

---

## Phase 1: Setup

- [x] T001 Create the worktree `/home/coder/worktrees/005-guardrail-gate-ports` on branch
  `005-guardrail-gate-ports` from `origin/main`, with a real `CI=true pnpm install --frozen-lockfile`
  - **Done when**: `pnpm nx run scripts:lint && pnpm nx run scripts:test` pass on the untouched branch
    (the baseline)
- [x] T002 **Doc-impact sweep**. This feature adds gates. It renames nothing, and changes the meaning
  of the statements that say these rules are unenforced or the work is pending. Command, per term:
  `git grep -n -F "<term>" -- '*.md' '*.yaml' '*.mjs' ':!specs/' ':!docs/proposals/' ':!docs/decisions/'`.
  Terms: `not yet gated`, `NOT YET ENFORCED`, `item #28`, `item #32`, `issue #1`, `V17`,
  `scripts:lint`, `secret-scan`, `topology`, `tailnet host`, `Nothing deletes`, `wiki-refresh`,
  `by review`. Hits and dispositions:
  - `AGENTS.md:20` "not yet gated (no V17 here; item #28)" → T045
  - `openwiki/protected.yaml:13` "NOT YET ENFORCED" → T032
  - `openwiki/process/wiki-maintenance.md:37` "is backlog item #28" → T032
  - `openwiki/INSTRUCTIONS.md:8` "kept by review", and §9 (`:227`, `:230`) → T032
  - `openwiki/invariants/feature-validation-checklist.md:43` "checked by review only" → T032
  - `docs/runbooks/devcontainer.md:206` "Nothing deletes old images yet (backlog item #32)" → T042
  - `scripts/secret-scan.mjs:10` "tracked separately (issue #1)" → T014
  - `scripts/__tests__/backlog.test.mjs:18`, `ci-digest-redact.test.mjs:19` "a topology-scrub gate,
    issue #1" → T011 (comment now names the real gate)
  - `docs/runbooks/ci.md:25-28` lint list ("the secret-scan … selftests") → T046
  - `openwiki/invariants/nx-task-runner.md:20`, `openwiki/invariants/testing-tiers.md:20-21` gate
    lists → T047
  - `openwiki/invariants/secrets-management.md:45` "its selftest runs in `scripts:lint`" → T047
  - `docs/repo-foundation-setup.md:260,505` → no change: a dated playbook of what was done when BELAY
    was founded. Line 505 is an example of filing, not current procedure
  - `docs/superpowers/specs/**` → no change: a design record, superseded once a spec exists
  - `README.md:30`, `docs/runbooks/spec-kit.md:22`, `openwiki/runbooks/ci.md:16,61`,
    `openwiki/process/pull-request-batching.md:29`, `openwiki/invariants/feature-validation-checklist.md:20`
    → no change: they name `scripts:lint` generically ("every gate"), which stays true

---

## Phase 2: Foundational

- [x] T003 Clone MCM read-only into the session scratchpad, and record the source commit (`fc2b953`)
  in plan.md
  - **Done when**: plan.md names the commit, and no MCM file is copied without a header saying it is
    a port

**Checkpoint**: the user stories are independent. Each touches its own scripts and tests. The shared
files (`scripts/project.json`, the runbooks, `AGENTS.md`) are integrated in the Polish phase.

---

## Phase 3: User Story 1 - Topology scrub (Priority: P1) 🎯 MVP

**Goal**: a real tailnet host in any tracked file fails the required check (item #2).

**Independent Test**: quickstart step 2.

### Tests for User Story 1 ⚠️

- [x] T010 [P] [US1] Port MCM's topology tests to `scripts/__tests__/check-topology-scrub.test.mjs`,
  or write them where MCM has none. They cover: a placeholder passes, a real-shaped host fails and is
  named, `--selftest` exits 0, and an unknown flag exits 2. Build real-shaped hosts from fragments
  - **Scenarios covered**: US1-AC1, US1-AC2, US1-AC3
  - **Verify RED**: `node --test scripts/__tests__/check-topology-scrub.test.mjs` → expected: ≥1
    failing, `Cannot find module …check-topology-scrub.mjs`

### Implementation for User Story 1

- [x] T011 [US1] Port `scripts/check-topology-scrub.mjs` (research R3). Update the two test comments
  that say "a topology-scrub gate, issue #1" to name `scripts/check-topology-scrub.mjs`
  - **Verify GREEN**: the T010 command → 0 failures; `node scripts/check-topology-scrub.mjs` exits 0
    on the tree

---

## Phase 4: User Story 2 - Secret scan and toolchain consistency (Priority: P1)

**Goal**: credential-shaped strings and toolchain drift fail the required check (item #1).

**Independent Test**: quickstart step 3, and a planted key fails `node scripts/secret-scan.mjs`.

### Tests for User Story 2 ⚠️

- [x] T012 [P] [US2] Add `scripts/__tests__/secret-scan.test.mjs`. It covers: a tree-scan of a
  fixture git repository holding a fragment-built key exits 1 and names the file but not the value,
  and a clean fixture exits 0. It needs a `--dir`/cwd seam if the script lacks one
  - **Scenarios covered**: US2-AC1
  - **Verify RED**: `node --test scripts/__tests__/secret-scan.test.mjs` → expected: ≥1 failing (no
    seam yet)
- [x] T013 [P] [US2] Port `scripts/__tests__/check-toolchain-consistency.test.mjs`, trimmed to the
  kept rules (research R2). It covers: two Node majors, a job without a pinned setup-node, a pnpm
  version outside `packageManager`, a nested `packageManager`, a range on `nx`, `@nx/*` and
  `@playwright/test`, a floor violation, and the clean BELAY tree
  - **Scenarios covered**: US2-AC2, US2-AC3, US2-AC4, US2-AC5
  - **Verify RED**: `node --test scripts/__tests__/check-toolchain-consistency.test.mjs` → expected:
    ≥1 failing, `Cannot find module`

### Implementation for User Story 2

- [x] T014 [US2] Give `scripts/secret-scan.mjs` the test seam T012 needs, and replace its header's
  "tracked separately (issue #1)" with the fact that the tree scan runs in `scripts:lint`
  - **Verify GREEN**: the T012 command → 0 failures; `node scripts/secret-scan.mjs` exits 0
- [x] T015 [US2] Port `scripts/check-toolchain-consistency.mjs` (research R2). It is trimmed to
  BELAY's pin sites and adds the lockstep-exact rule for `nx`, `@nx/*` and `@playwright/test`. Fix
  any drift the first run finds in the files, never in the gate
  - **Verify GREEN**: the T013 command → 0 failures; `node scripts/check-toolchain-consistency.mjs`
    and `--selftest` exit 0

---

## Phase 5: User Story 3 - OpenWiki gates (Priority: P2)

**Goal**: the knowledge bundle's rules are enforced, and fingerprints are recorded by a tool
(item #28).

**Independent Test**: quickstart steps 4 and 5.

### Tests for User Story 3 ⚠️

- [x] T020 [P] [US3] Port `scripts/__tests__/openwiki-fingerprint.test.mjs`,
  `openwiki-links.test.mjs` and `openwiki-stamp.test.mjs`
  - **Scenarios covered**: US3-AC1, US3-AC3 (links)
  - **Verify RED**: `node --test scripts/__tests__/openwiki-{fingerprint,links,stamp}.test.mjs` →
    expected: ≥1 failing, `Cannot find module`
- [x] T021 [P] [US3] Port `scripts/__tests__/check-openwiki-okf.test.mjs`, with its fixtures
  re-pointed at BELAY-shaped bundles
  - **Scenarios covered**: US3-AC1, US3-AC3
  - **Verify RED**: `node --test scripts/__tests__/check-openwiki-okf.test.mjs` → expected: ≥1
    failing, `Cannot find module`
- [x] T022 [P] [US3] Port `scripts/__tests__/check-openwiki-governance.test.mjs`, with its
  managed-region cases narrowed to BELAY's Spec Kit region and an absent-policy-file case added
  (research R4)
  - **Scenarios covered**: US3-AC4, US3-AC5
  - **Verify RED**: `node --test scripts/__tests__/check-openwiki-governance.test.mjs` → expected: ≥1
    failing, `Cannot find module`
- [x] T023 [P] [US3] Port `scripts/__tests__/wiki-refresh.test.mjs`
  - **Scenarios covered**: US3-AC2
  - **Verify RED**: `node --test scripts/__tests__/wiki-refresh.test.mjs` → expected: ≥1 failing,
    `Cannot find module`

### Implementation for User Story 3

- [x] T024 [US3] Port `scripts/openwiki-front-matter.mjs`, `openwiki-fingerprint.mjs`,
  `openwiki-links.mjs`, `openwiki-stamp.mjs` and `openwiki-policy.mjs` (data-model.md "Derived page")
  - **Verify GREEN**: the T020 command → 0 failures
- [x] T025 [US3] Port `scripts/check-openwiki-okf.mjs`
  - **Verify GREEN**: the T021 command → 0 failures; `--selftest` exits 0
- [x] T026 [US3] Port `scripts/check-openwiki-governance.mjs` (research R4: no policy file, BELAY's
  managed regions, MCM's budgets)
  - **Verify GREEN**: the T022 command → 0 failures; `--selftest` exits 0
- [x] T027 [US3] Port `scripts/wiki-refresh.mjs` and `.claude/skills/wiki-refresh/SKILL.md`. The
  skill's examples name BELAY pages, not MCM's
  - **Verify GREEN**: the T023 command → 0 failures
- [x] T028 [US3] Run both gates on the real bundle, and fix every finding in the pages or the brief,
  never with an allowlist (FR-003)
  - **Done when**: both gates' scan modes exit 0 on the tree
- [x] T029 [US3] Record a `resource-sha256` on every derived page with `wiki-refresh.mjs --record`,
  and compute any `protected.yaml` passage fingerprints with governance's `--fingerprint` mode
  (data-model.md "Derived page", "Authoritative page")
  - **Done when**: `node scripts/wiki-refresh.mjs --stale` prints nothing and exits 0
- [x] T032 [US3] State enforcement in `openwiki/INSTRUCTIONS.md` (intro and §9),
  `openwiki/process/wiki-maintenance.md`, the `openwiki/protected.yaml` header and
  `openwiki/invariants/feature-validation-checklist.md`, naming the gates (FR-034)
  - **Done when**: the sweep terms `NOT YET ENFORCED`, `item #28` and `by review` have no
    current-procedure hit in `openwiki/`

---

## Phase 6: User Story 4 - Registry retention (Priority: P3)

**Goal**: old `belay-devcontainer` versions are reported, and deletable on a double key (item #32).

**Independent Test**: quickstart step 6.

### Tests for User Story 4 ⚠️

- [x] T035 [P] [US4] Port `scripts/__tests__/registry-retention.test.mjs`, replacing MCM's
  git-history protection cases with `protect:` list cases (research R5). Cases: a protected digest
  is kept, a missing protected digest gives exit 5 and no deletes, `--apply` against `mode: report`
  gives exit 2, a referenced child is kept, an unlisted package is never deleted, the workflow passes
  `--apply` only on an apply dispatch, and the committed config parses with `mode: report`
  - **Scenarios covered**: US4-AC1 … US4-AC5
  - **Verify RED**: `node --test scripts/__tests__/registry-retention.test.mjs` → expected: ≥1
    failing, `Cannot find module`

### Implementation for User Story 4

- [x] T036 [US4] Port `scripts/registry-retention.mjs` (contracts/registry-retention.md;
  data-model.md "Retention configuration", "Retention row")
  - **Verify GREEN**: the T035 command → 0 failures
- [x] T037 [P] [US4] Add `infrastructure-as-code/forgejo/registry-retention.yaml` (`mode: report`,
  `belay-devcontainer` 4/21, and `belay-ci-failures` at the durations floor) and
  `.forgejo/workflows/registry-retention.yml` (weekly, runner `belay`, setup-node pinned, report
  before delete, failure digest)
  - **Verify GREEN**: the T035 command → 0 failures; `node scripts/check-ci-digest-coverage.mjs` and
    `node scripts/check-toolchain-consistency.mjs` exit 0
- [x] T042 [US4] `docs/runbooks/devcontainer.md`: state the retention window, the `protect:` re-pin
  step and the report→apply switch, replacing "Nothing deletes old images yet (backlog item #32)";
  `docs/runbooks/ci.md`: the `registry-retention` workflow and its `REGISTRY_CLEANUP_TOKEN` secret
  - **Done when**: the sweep term `Nothing deletes` has no hit

---

## Phase 6b: User Story 5 - Gates ahead of their surfaces (Priority: P2)

**Goal**: the compose, Maestro and override gates are in place before the first such change
(research R8).

**Independent Test**: each selftest exits 0, and each scan exits 0 on the tree and prints its
file count.

### Tests for User Story 5 ⚠️

- [ ] T060 [P] [US5] Port `scripts/__tests__/check-override-consistency.test.mjs` from MCM
  - **Scenarios covered**: US5-AC3
  - **Verify RED**: `node --test scripts/__tests__/check-override-consistency.test.mjs` → expected:
    ≥1 failing, `Cannot find module`
- [ ] T061 [P] [US5] Write `scripts/__tests__/check-no-inline-secrets.test.mjs` (MCM has none): a
  literal credential, a password-bearing URL and an inline `${VAR:-default}` each fail and are named
  without the value; a pure `${VAR}` passes; `*_FILE` keys pass; 0 compose files prints a count of 0
  and exits 0; an unknown flag exits 2
  - **Scenarios covered**: US5-AC1
  - **Verify RED**: `node --test scripts/__tests__/check-no-inline-secrets.test.mjs` → expected: ≥1
    failing, `Cannot find module`
- [ ] T062 [P] [US5] Write `scripts/__tests__/check-no-argv-secrets.test.mjs` (MCM has none): a
  secret-named `--env` to `maestro` fails, including across a backslash continuation; a non-secret
  name passes; the count is printed; an unknown flag exits 2
  - **Scenarios covered**: US5-AC2
  - **Verify RED**: `node --test scripts/__tests__/check-no-argv-secrets.test.mjs` → expected: ≥1
    failing, `Cannot find module`
- [ ] T063 [P] [US5] Write `scripts/__tests__/check-resource-naming.test.mjs` (MCM has none): a
  fixture monorepo with `backend/foo-service/` accepts `foo-service-store-postgres-data` and a
  `foo-service` container, and rejects an unknown context, an underscore-prefixed name, a non-`-network`
  network, and a `container_name` ≠ service key; adding `agents/bar/` admits `bar-*` without a gate
  edit
  - **Scenarios covered**: US5-AC4, US5-AC5
  - **Verify RED**: `node --test scripts/__tests__/check-resource-naming.test.mjs` → expected: ≥1
    failing, `Cannot find module`

### Implementation for User Story 5

- [ ] T064 [US5] Port `scripts/check-override-consistency.mjs` (MCM names in comments and examples
  replaced with BELAY's)
  - **Verify GREEN**: the T060 command → 0 failures; scan and `--selftest` exit 0
- [ ] T065 [US5] Port `scripts/check-no-inline-secrets.mjs`, removing MCM's named allowlist entries
  and keeping the generic suffix rules (research R8)
  - **Verify GREEN**: the T061 command → 0 failures; scan and `--selftest` exit 0
- [ ] T066 [US5] Port `scripts/check-no-argv-secrets.mjs`, with MCM's wrapper path (`maestro-run.sh`)
  generalised and the scope set to BELAY's tree
  - **Verify GREEN**: the T062 command → 0 failures; scan and `--selftest` exit 0
- [ ] T067 [US5] Port `scripts/check-resource-naming.mjs` with the generic grammar (research R8)
  - **Verify GREEN**: the T063 command → 0 failures; scan and `--selftest` exit 0
- [ ] T068 [US5] Wire the four gates into `scripts/project.json` `lint` (selftest + scan each), and
  name them in `docs/runbooks/ci.md` and the wiki gate lists; refresh derived pages with
  `wiki-refresh.mjs --record`
  - **Done when**: `pnpm nx run scripts:lint` passes every line, and `wiki-refresh.mjs --stale` exits 0

---

## Phase 7: Polish & Cross-Cutting Concerns

- [x] T044 Wire every new gate into `scripts/project.json` `lint`, each as its own selftest + scan
  command: topology, the secret-scan tree scan, toolchain, okf, governance. Add `wiki-refresh.mjs
  --stale`
  - **Done when**: `pnpm nx run scripts:lint` runs and passes every line
- [x] T045 `AGENTS.md`: replace "not yet gated (no V17 here; item #28)" with the gate's name, and add
  the gate line "never commit a tailnet host" naming `check-topology-scrub.mjs` (FR-012), within the
  governance size budget
  - **Done when**: `node scripts/check-openwiki-governance.mjs` exits 0
- [x] T046 [P] `docs/runbooks/ci.md`: the lint list names every new gate, and a short section per gate
  covers what it checks, how to fix a hit, and its exit codes
  - **Done when**: every new script name appears in `docs/runbooks/ci.md`
- [x] T047 [P] `openwiki/invariants/nx-task-runner.md`, `testing-tiers.md`, `secrets-management.md`,
  `openwiki/runbooks/ci.md`: gate lists updated; derived pages refreshed with `wiki-refresh.mjs
  --record` after their sources change
  - **Done when**: `node scripts/wiki-refresh.mjs --stale` exits 0
- [ ] T048 File the SAST backlog item (research R6; filed as item #37), and comment the outcome on items #1, #2, #28 and
  #32: the per-candidate disposition table from plan.md, and how each criterion was verified
  - **Done when**: the new item exists, and each of the four items has a comment
- [x] T049 **Close-out re-search**: re-run T002's searches. Every remaining hit in a doc that states
  current procedure is fixed, or justified here
- [x] T050 Run quickstart.md steps 1–5 (step 6's live report needs the registry secret)
- [x] T051 Final checks: `pnpm nx run scripts:lint`, `pnpm nx run scripts:test` (watch the skip
  count), and `node scripts/check-speckit-overrides.mjs`
- [ ] T052 **Open the PR** from a real branch, with the repository's PR tools (`docs/runbooks/ci.md`):
  1. `git push origin HEAD:005-guardrail-gate-ports`
  2. `node scripts/forge-pr.mjs open --head 005-guardrail-gate-ports --title "…" --body-file <file>`
  3. `node scripts/ci-status.mjs watch --pr <n>`, until it exits 0
  4. `node scripts/forge-pr.mjs merge <n> --expect-head <full sha>`

  Tick this task in the branch's LAST commit, quoting the branch and the PR number. **CI evidence is
  never recorded here.**

---

## Dependencies & Execution Order

- Setup → Foundational → US1 … US4. The four stories are independent: each owns its scripts and
  tests, so they run in parallel.
- Polish depends on all four. T044–T047 edit the shared files. T047 runs after T042 and T046,
  because those edit files that derived pages cite.

## Parallel Example

```text
Agent A: T010–T015 (US1 + US2: topology, secret scan, toolchain)
Agent B: T020–T032 (US3: OpenWiki)
Agent C: T035–T037 (US4: retention)
Agents D/E: T060–T067 (US5: gates ahead of their surfaces)
Lead:    T042, T044–T052 (integration, docs, backlog, PR)
```

## Implementation Strategy

US1 is the MVP: it closes the gate that a real leak already exposed. The other stories add to it
without changing it.
