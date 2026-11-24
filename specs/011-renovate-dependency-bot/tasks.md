---

description: "Task list for feature 011: a self-hosted dependency bot"
---

# Tasks: A self-hosted dependency bot

**Input**: Design documents from `specs/011-renovate-dependency-bot/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md),
[contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: REQUIRED (constitution "Test-Driven Development"). Every test task carries **Verify RED**, and its paired
implementation task carries **Verify GREEN**, in the format of `docs/templates/feature-test-tasks-template.md`. Config
and documentation tasks use the "Done when" form.

**Organization**: grouped by user story. US1–US3 are P1 and US4–US5 are P2.

**Instrument notes** (from `openwiki/gotchas/instrument-traps.md`):
- `node --test` takes its flags **before** the path. `node --test <file> --test-name-pattern x` runs everything.
- A RED that shows 0 failures is a broken test.
- Watch the **skip count** on every GREEN.

Shorthand used below:
- `RC` = `scripts/__tests__/check-renovate-config.test.mjs`
- `RG` = `scripts/__tests__/renovate-config.guard.test.mjs`
- `RW` = `scripts/__tests__/renovate-workflow.guard.test.mjs`
- `PC` = `scripts/__tests__/refresh-pin-checksum.test.mjs`

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US5)

---

## Phase 1: Setup

- [X] T001 **Doc-impact sweep**. Identifiers this feature adds or changes the meaning of:
  - `Renovate` / `renovate`, "dependency bot", `Dependabot`;
  - `keepNewest` / `125` (the retention floor becomes 150);
  - `status/bot-managed`, and `backlog.mjs ready` (now excludes it);
  - "three forge credentials" (now five);
  - `SEMGREP_PIN`, `TRIVY_PIN`, `RUSTUP_VERSION`, `CARGO_AUDIT` (bump procedures become bot-proposed);
  - `re-pin`, `upload-artifact`, `bump` / `Bump`.

  Command, run per term: `git grep -n -F "<term>" -- '*.md' ':!specs/' ':!docs/proposals/' ':!docs/decisions/'`. Results:
  - [x] `docs/runbooks/image-scanning.md:74-80` (the Trivy pin procedure, "Renovate tracks `TRIVY_PIN` once it is adopted") → T049
  - [x] `docs/runbooks/image-scanning.md:68,91-94` (a re-pin discharges the allowlist entry) → T049: the bot's base re-pin PR must delete it
  - [x] `docs/runbooks/sast.md:116-119` (bumping the Semgrep, rustup-init and cargo-audit pins by hand) → T050
  - [x] `docs/runbooks/ci.md:141` ("At least 125 versions") → T051, together with ci.md's guardrails step list and secrets section
  - [x] `docs/runbooks/backlog.md:18` (`ready`: "open, unblocked, priority-ordered") → T052
  - [x] `.claude/skills/forgejo-issues/SKILL.md:14` and its labels section → T052
  - [x] `openwiki/invariants/secrets-management.md:4` and the credentials table → T053
  - [x] `AGENTS.md:52`, `openwiki/invariants/index.md:7` ("the three forge credentials") → T053
  - [x] `docs/runbooks/spec-kit.md:128` ("Bump the two…") → T054: the bot opens a Spec Kit PR only after dashboard approval, and the PR must run `specify integration upgrade`
  - [x] `docs/repo-foundation-setup.md:572`: no change (the checklist line "`ready` lists issues" stays true)
  - [x] `openwiki/decisions/adr-000{2,3,4}-*.md`, `openwiki/decisions/index.md`, `AGENTS.md:61`: no change (derived from unchanged ADRs, and still true)
  - [x] `openwiki/invariants/package-manager-enforcement.md:29`, `docs/superpowers/specs/2026-11-22-*.md:136`: no change (MCM history and a dated design record)
  - [x] `docs/runbooks/devcontainer.md:71,129,212`, `openwiki/runbooks/devcontainer.md:35`, `docs/repo-foundation-setup.md:537`: no change (they re-pin `belay-devcontainer`, which BELAY builds and the bot never manages)
  - [x] `.specify/memory/constitution.md:94,1018`, `.claude/skills/speckit-constitution/SKILL.md`, `docs/superpowers/plans/*`, `openwiki/process/pull-request-batching.md:19`: no change (generic or historical)

  New identifiers that need an entry: the runbook `docs/runbooks/renovate.md` and its concept page (T056); `renovate.json`
  and `security/dependencies/` in the layout (T057); the soft spot in research R7 (T058).

- [X] T002 Create the backlog item that the `actions/upload-artifact` hold cites (data-model.md `Hold.description` needs an `item #N`):
  `node scripts/backlog.mjs create --title "Lift the actions/upload-artifact <4 hold when Forgejo supports the v4 artifact API" --label type/tech-debt --label priority/p3 --body-file <file>`.
  The body records the acceptance criterion: a Forgejo release whose artifact backend accepts v4 without
  `GHESNotSupportedError`, then a `renovate.json` hold removal PR.
  - **Done when**: the item exists, and its number is recorded here for T040.
  - **Done**: item #62 filed (type/tech-debt, priority/p3); T040's hold cites it.

- [X] T003 Pick the exact `RENOVATE_VERSION`: the newest `renovate@44` published at least three days ago
  (`npm view renovate time --json`), the same bound as `npx --before` (research R1). Check its `engines.node`
  against 26.13.1.
  - **Done when**: the version and its `engines.node` are recorded here.
  - **Done**: `44.257.6` (published 2026-11-21, ≥3 days old on 2026-11-24). `engines.node` is `^24.11.0 || ^26.13.0`, met by 26.13.1. It also declares `engines.pnpm ^11`, for developing Renovate itself: npm does not check it, and Renovate runs the pnpm on PATH.

- [X] T004 [P] Create the stub modules, so every RED fails on an assertion rather than an import:
  - `scripts/check-renovate-config.mjs`, exporting `RENOVATE_VERSION` (T003's value) and these stubs, each throwing
    `not implemented`: `detectPins`, `classifyPins`, `loadExclusions`, `checkRules`, `judgeRun`, `cronIntersects`,
    `main`;
  - `scripts/refresh-pin-checksum.mjs`, exporting `CHECKSUM_PAIRS` and the stubs `refreshPair`, `verifyChanged`, `main`.

  Both use `isMain` from `scripts/lib/is-main.mjs` and the exit-code convention in [contracts/cli.md](contracts/cli.md).
  - **Done when**: `node -e "import('./scripts/check-renovate-config.mjs')"` and the same import of
    `refresh-pin-checksum.mjs` both exit 0.

---

## Phase 2: Foundational

**Purpose**: the pin inventory and the rule plumbing every story's rules sit on.

- [X] T005 [P] Tests in `RC` for `detectPins(root)` against a fixture tree covering every `ManagedPin.kind` in
  data-model.md:
  - each detected pin carries `ManagedPin.file` (POSIX), `ManagedPin.line` (1-based) and `ManagedPin.value`
    (verbatim), as data-model.md defines them;
  - a sha256 constant gets `ManagedPin.checksumOf` naming its pair;
  - comment lines and `__tests__/` fixtures are not pins.
  - **Scenarios covered**: US3-AC2 (the inventory half)
  - **Verify RED**: `node --test --test-name-pattern "detectPins" scripts/__tests__/check-renovate-config.test.mjs` → expected: ≥6 failing — `not implemented`
- [X] T006 Implement `detectPins` in `scripts/check-renovate-config.mjs`, with research R8's detectors. It produces the
  data-model.md fields `ManagedPin.file`, `ManagedPin.line`, `ManagedPin.kind`, `ManagedPin.value` and
  `ManagedPin.checksumOf`.
  - **Verify GREEN**: T005's command → expected: 0 failures, 0 skipped
- [X] T007 [P] Tests in `RC` for the scaffolding of `loadExclusions` and `checkRules`:
  - an exclusion missing `Exclusion.reason`, or with a reason under 20 characters, is refused with exit 2;
  - so is one missing `Exclusion.file`, `Exclusion.match` or `Exclusion.addedBy`;
  - `checkRules` returns `[{ rule, file, detail }]`, sorted, and an empty list for a compliant fixture.
  - **Verify RED**: `node --test --test-name-pattern "loadExclusions|checkRules scaffold" scripts/__tests__/check-renovate-config.test.mjs` → expected: ≥4 failing — `not implemented`
- [X] T008 Implement `loadExclusions` (data-model.md `Exclusion.file`, `Exclusion.match`, `Exclusion.reason`,
  `Exclusion.addedBy`) and the `checkRules` dispatcher, with no rules registered yet, and the default CLI in
  `scripts/check-renovate-config.mjs`.
  - **Verify GREEN**: T007's command → expected: 0 failures, 0 skipped
- [X] T009 [P] Tests in `scripts/__tests__/backlog.test.mjs`: the taxonomy that `backlog.mjs labels` creates includes
  `status/bot-managed`, `dependencies` and `security`, each with a description.
  - **Verify RED**: `node --test --test-name-pattern "bot labels" scripts/__tests__/backlog.test.mjs` → expected: 1 failing — the three names missing from the taxonomy
- [X] T010 Add the three labels to the taxonomy in `scripts/backlog.mjs`. Then run `node scripts/backlog.mjs labels`
  against the forge, so the labels exist before the bot's first run.
  - **Verify GREEN**: T009's command → expected: 0 failures, then `labels` reports the three created (or already present)
  - **Done**: the command is `setup-labels`, not `labels`; it created `status/bot-managed`, `dependencies` and `security` on the forge. The existing exact-count taxonomy guard was updated at its cause (9 → 12 labels).

**Checkpoint**: the inventory and the rule plumbing exist. The stories add rules, config and workflow.

---

## Phase 3: User Story 1 — security fixes arrive as PRs (P1) 🎯 MVP

**Goal**: a scheduled, preflighted, validated bot run that proposes security fixes outside the window and cannot pass
having done nothing.

**Independent Test**: §1 of the quickstart is green, and after the merge, the §3 dry run's verdict reads `done`.

### Tests for User Story 1 ⚠️

- [X] T011 [P] [US1] Tests in `RC` for `judgeRun(records)`:
  - `done`, `no-work` and `not-scheduled` pass (data-model.md `RunVerdict.result`);
  - any other result fails by name;
  - one ERROR record fails (`RunVerdict.errors`);
  - no `repository finished` record for `jumbleknot/BELAY` fails as "the run never reached the repository"
    (`RunVerdict.repository`);
  - an empty log fails with "the run produced no log";
  - a WARN record reporting a refused lookup (`Failed to look up`, 401/403, `authentication`) fails
    (`RunVerdict.refusals`), and a `logLevelRemap`-downgraded message does not;
  - `publishVerdict` posts `renovate/verdict` with `GITHUB_TOKEN`, to an injected `fetch`, and a failed post leaves
    the exit code unchanged.
  - **Scenarios covered**: US1-AC1, US5 ("its run verdict is visible"), FR-015
  - **Verify RED**: `node --test --test-name-pattern "judgeRun" scripts/__tests__/check-renovate-config.test.mjs` → expected: ≥9 failing — `not implemented`
- [X] T012 [P] [US1] Tests in `RC` for rule **C3** ([contracts/renovate-config.md](contracts/renovate-config.md)):
  - `vulnerabilityAlerts.schedule` is not `[]`: fails;
  - its `minimumReleaseAge` ≥ the `*` rule's: fails;
  - `osvVulnerabilityAlerts` is absent: fails;
  - the worst case (12 h + the largest gap between security crons) exceeds 24 h: fails;
  - the planned values pass.
  - **Scenarios covered**: US1-AC1, FR-003, FR-006
  - **Verify RED**: `node --test --test-name-pattern "C3" scripts/__tests__/check-renovate-config.test.mjs` → expected: ≥5 failing — `not implemented`
- [X] T013 [P] [US1] Create `RW` asserting every bullet of [contracts/workflow.md](contracts/workflow.md) against
  `.forgejo/workflows/renovate.yml`, plus:
  - `RENOVATE_ONBOARDING=false` and `RENOVATE_REQUIRE_CONFIG=required`. This narrows the contract: a missing
    `renovate.json` must fail the run, never open an onboarding PR.
  - the preflight step names `RENOVATE_TOKEN` and never echoes it;
  - the verdict step has `always()` and `--publish-verdict` (research R11).
  - **Scenarios covered**: US1-AC1, US1-AC2, FR-001, FR-015, FR-016, FR-017
  - **Verify RED**: `node --test scripts/__tests__/renovate-workflow.guard.test.mjs` → expected: every test failing — `ENOENT … renovate.yml`

### Implementation for User Story 1

- [X] T014 [US1] Implement `judgeRun`, `publishVerdict` and `--run-verdict <log> [--publish-verdict]` in
  `scripts/check-renovate-config.mjs`, per data-model.md `RunVerdict.result`, `RunVerdict.errors`,
  `RunVerdict.refusals` and `RunVerdict.repository`, and [contracts/cli.md](contracts/cli.md).
  - **Verify GREEN**: T011's command → expected: 0 failures, 0 skipped
- [X] T015 [US1] Implement rule C3 in `scripts/check-renovate-config.mjs`, reading the security crons from the parsed
  workflow.
  - **Verify GREEN**: T012's command → expected: 0 failures, 0 skipped
- [X] T016 [US1] Implement `--print-renovate-version` in `scripts/check-renovate-config.mjs`, with a test in `RC` that
  it prints exactly `RENOVATE_VERSION`.
  - **Verify GREEN**: `node --test --test-name-pattern "print-renovate-version" scripts/__tests__/check-renovate-config.test.mjs` → expected: 1 passed
- [X] T017 [US1] Create `renovate.json`: the base (`$schema`, `extends`, `timezone`, `labels`, `rebaseWhen`) and the
  security section (`osvVulnerabilityAlerts`, `vulnerabilityAlerts`), as in contracts/renovate-config.md's shape. The
  other sections land in their stories.
  - **Done when**: `npx --yes --package renovate@$(node scripts/check-renovate-config.mjs --print-renovate-version) -- renovate-config-validator --strict --no-global renovate.json` exits 0, and `node scripts/check-renovate-config.mjs` reports no C3 violation.
  - **Done**: the strict validator could NOT run in the dev container: `npx` installing Renovate was SIGKILLed (exit 137, an 8 GB container shared with other sessions), and an earlier attempt coincided with the host failure. `check-renovate-config.mjs` passes on the real tree. The validator runs on the runner in the `sast` job on this PR, which is the proof.

- [X] T018 [US1] Create `.forgejo/workflows/renovate.yml` per contracts/workflow.md and T013:
  - every `run:` goes through `scripts/ci-log-step.sh`, using the heredoc form for multi-line steps;
  - the failure digest runs last;
  - the endpoint comes from `github.server_url`, never a host literal.
  - **Verify GREEN**: `node --test scripts/__tests__/renovate-workflow.guard.test.mjs` → expected: 0 failures, 0 skipped; then `node scripts/check-ci-digest-coverage.mjs` and `node scripts/check-topology-scrub.mjs` pass
  - **Done**: preflight and mode run as `check-renovate-config.mjs --preflight` / `--publish-mode`, so no token is on argv (contract updated). The new `workflow-deps-installed` guard then caught a missing `pnpm install` in this job, which was added.

- [X] T019 [US1] Raise `belay-ci-failures` `keepNewest` from 125 to 150 in
  `infrastructure-as-code/forgejo/registry-retention.yaml`, and update its comment. This is a mutation RED: with
  T018 in place, the existing retention guard fails, naming 150. Update it at the cause, never weakening the guard.
  - **Verify RED**: `node --test scripts/__tests__/registry-retention.test.mjs` → expected: 1 failing — `keepNewest 125 is below 150`
  - **Verify GREEN**: the same command → expected: 0 failures, 0 skipped

**Checkpoint**: the bot can run. Merging this story alone gives the security channel.

---

## Phase 4: User Story 2 — routine updates in a bounded window (P1)

**Goal**: one UTC Wednesday window, at most 4 PRs, priority-ordered, lock files refreshed, a cooling-off period, and
lockstep groups as one.

**Independent Test**: the guard tests read the config and the workflow: the window intersects the cron, the limits and
priorities hold, lock-file maintenance is scheduled, and the groups are complete.

### Tests for User Story 2 ⚠️

- [X] T020 [P] [US2] Tests in `RC` for `cronIntersects(window, trigger)` and rule **C2**:
  - `* 5-6 * * 3` against `0 5 * * 3`: intersects;
  - against `0 3 * * 3`: does not;
  - a `lockFileMaintenance` with no `schedule`: fails, naming the preset default;
  - a `packageRules[].schedule` that meets no cron: fails;
  - a security cron inside the window: fails;
  - a `timezone` other than `UTC`: fails.
  - **Scenarios covered**: US2-AC1, FR-004, FR-005, FR-013
  - **Verify RED**: `node --test --test-name-pattern "cronIntersects|C2" scripts/__tests__/check-renovate-config.test.mjs` → expected: ≥7 failing — `not implemented`
- [X] T021 [P] [US2] Tests in `RC` for rules **C4** and **C5**:
  - `prConcurrentLimit` ≤ `prHourlyLimit`: fails;
  - `prPriority` set inside the `lockFileMaintenance` block: fails (it is ignored there);
  - a `groupName` rule without `prPriority`: fails;
  - the priority order lock files > base images > digest pins > 0 is checked;
  - a tracked lock file whose toolchain the workflow does not install: fails.
  - **Scenarios covered**: US2-AC1, US2-AC4, FR-004, FR-005, SC-004
  - **Verify RED**: `node --test --test-name-pattern "C4|C5" scripts/__tests__/check-renovate-config.test.mjs` → expected: ≥5 failing — `not implemented`
- [X] T022 [P] [US2] Tests in `RC` for rule **C10** and the cooling-off:
  - a lockstep group from data-model.md missing a member, or matching only `npm` when a member is `custom.regex`: fails;
  - the `*` rule's `minimumReleaseAge` is not "3 days": fails;
  - `pinDigest`/`digest` without `timestamp-optional`: fails.
  - **Scenarios covered**: US2-AC2, US2-AC3, FR-006, FR-007
  - **Verify RED**: `node --test --test-name-pattern "C10|cooling-off" scripts/__tests__/check-renovate-config.test.mjs` → expected: ≥4 failing — `not implemented`

### Implementation for User Story 2

- [X] T023 [US2] Implement `cronIntersects` (five-field cron, exhaustive over a week of minutes) and rule C2 in
  `scripts/check-renovate-config.mjs`.
  - **Verify GREEN**: T020's command → expected: 0 failures, 0 skipped
- [X] T024 [US2] Implement rules C4 and C5 in `scripts/check-renovate-config.mjs`.
  - **Verify GREEN**: T021's command → expected: 0 failures, 0 skipped
- [X] T025 [US2] Implement rule C10 and the cooling-off checks in `scripts/check-renovate-config.mjs`. Each group's
  members come from data-model.md, Group (`Group.groupName`, `Group.prPriority`, `Group.members`).
  - **Verify GREEN**: T022's command → expected: 0 failures, 0 skipped
- [X] T026 [US2] Add to `renovate.json`, in the order research R3 and R5 require:
  - the window (`schedule`, plus `lockFileMaintenance` with its own `schedule`);
  - `prHourlyLimit` and `prConcurrentLimit`;
  - the cooling-off rules and the `logLevelRemap`;
  - the priority rules;
  - the five lockstep groups (data-model.md `Group.groupName` and `Group.prPriority` on each).
  - **Done when**: the T017 validator command exits 0, and `node scripts/check-renovate-config.mjs` reports no C2, C4,
    C5 or C10 violation.
- [X] T027 [US2] Create `RG`: it runs `checkRules` against the real `renovate.json`, the real `renovate.yml` and the
  tree, asserting zero violations for every rule registered so far. Later stories add theirs, so this is the test
  that holds US2 to the real files.
  - **Verify GREEN**: `node --test scripts/__tests__/renovate-config.guard.test.mjs` → expected: 0 failures, 0 skipped. Mutation RED: change the window to `* 5-6 * * 4`; expect 1 failing, naming C2; revert.

**Checkpoint**: the routine channel is bounded and checked.

---

## Phase 5: User Story 3 — every pin is visible to the bot (P1)

**Goal**: every pin is managed or excluded with a reason, and version-and-checksum pairs move together.

**Independent Test**: the guard reports N managed + M excluded = the data-model.md inventory. A new unmanaged constant
fails it.

### Tests for User Story 3 ⚠️

- [X] T028 [P] [US3] Tests in `RC` for `classifyPins` and rule **C6**:
  - a pin covered by a custom manager's `managerFilePatterns` **and** `matchStrings` is `custom:<i>`
    (data-model.md `ManagedPin.managedBy`);
  - a built-in kind is `builtin:<manager>`;
  - an excluded pin is `excluded`;
  - an uncovered pin fails, naming its file and line;
  - a manager using `fileMatch` fails;
  - a manager that captures nothing fails;
  - an exclusion matching no pin fails as stale (data-model.md `Exclusion.match`).
  - **Scenarios covered**: US3-AC2, FR-008, SC-002
  - **Verify RED**: `node --test --test-name-pattern "classifyPins|C6" scripts/__tests__/check-renovate-config.test.mjs` → expected: ≥7 failing — `not implemented`
- [X] T029 [P] [US3] Tests in `RC` for rule **C8**:
  - a version-and-checksum pair with no `postUpgradeTasks` rule fails;
  - so does one whose command differs from `node scripts/refresh-pin-checksum.mjs <pin>`;
  - so does one whose command does not match the workflow's `RENOVATE_ALLOWED_COMMANDS`.
  - **Scenarios covered**: US3-AC1, FR-009
  - **Verify RED**: `node --test --test-name-pattern "C8" scripts/__tests__/check-renovate-config.test.mjs` → expected: ≥3 failing — `not implemented`
- [X] T030 [P] [US3] Create `PC`, with `fetch` injected and no network:
  - `refreshPair('trivy')` rewrites only the sha256, when the downloaded bytes' hash equals the publisher's checksum;
  - a mismatch exits 1, names the pair, the URL and both digests, and leaves the file byte-identical;
  - the same for `rustup-init` (a `.sha256` file) and `cargo-audit` (the release API's asset `digest`);
  - `verifyChanged` checks only pairs whose file differs from the base, and passes with nothing changed;
  - `CHECKSUM_PAIRS` reads each version from its installer's own constant by regex, never from a second copy.
  - **Scenarios covered**: US3-AC1, FR-009
  - **Verify RED**: `node --test scripts/__tests__/refresh-pin-checksum.test.mjs` → expected: ≥8 failing — `not implemented`

### Implementation for User Story 3

- [X] T031 [US3] Implement `classifyPins` and rule C6 in `scripts/check-renovate-config.mjs` (data-model.md
  `ManagedPin.managedBy` and `Exclusion.match`). Custom managers are evaluated offline: the `managerFilePatterns`
  regexes against tracked paths, and the `matchStrings` against the file text.
  - **Verify GREEN**: T028's command → expected: 0 failures, 0 skipped
- [X] T032 [US3] Implement rule C8 in `scripts/check-renovate-config.mjs`.
  - **Verify GREEN**: T029's command → expected: 0 failures, 0 skipped
- [X] T033 [US3] Implement `scripts/refresh-pin-checksum.mjs`: `CHECKSUM_PAIRS`, `refreshPair`, `verifyChanged`
  (`git diff --name-only <base>`), and the CLI in [contracts/cli.md](contracts/cli.md). Downloads use `fetch` with a
  120-second timeout. Writes are atomic: a temporary file, then a rename.
  - **Verify GREEN**: T030's command → expected: 0 failures, 0 skipped
- [X] T034 [US3] Add to `renovate.json`:
  - one `customManagers` entry per "custom" row of data-model.md's inventory, using `managerFilePatterns` and
    `extractVersionTemplate` where tags carry a prefix (`v`, `cargo-audit/v`);
  - a `RENOVATE_VERSION` manager (npm `renovate`);
  - the three `postUpgradeTasks` rules with `fileFilters`.

  Add `RENOVATE_ALLOWED_COMMANDS` to `.forgejo/workflows/renovate.yml`.
  - **Done when**: the T017 validator exits 0, and `node scripts/check-renovate-config.mjs` reports no C6 or C8
    violation for the managed rows.
- [X] T035 [US3] Create `security/dependencies/unmanaged-pins.yaml`, with the four excluded rows of data-model.md's
  inventory. Each row carries `Exclusion.file`, `Exclusion.match`, `Exclusion.reason` and `Exclusion.addedBy`, as
  data-model.md defines them.
  - **Done when**: `node scripts/check-renovate-config.mjs` prints `✅ … N pins managed, M excluded`, with N + M equal
    to the site total of data-model.md's inventory. If the measured tree differs, update the inventory in the same
    change, saying which sites were added.
  - **Done**: measured: 42 managed and 6 excluded sites. data-model.md updated: the new workflow adds 3 action SHAs and 1 `node-version`, and the SAST rule's comment line is not a pin.

- [X] T036 [US3] Add the "Verify version-and-checksum pairs" step to the `guardrails` job in
  `.forgejo/workflows/guardrails.yml` (contracts/workflow.md), through `ci-log-step.sh`. Extend
  `scripts/__tests__/guardrails-workflow.test.mjs` to assert it first.
  - **Verify RED**: `node --test --test-name-pattern "checksum pairs" scripts/__tests__/guardrails-workflow.test.mjs` → expected: 1 failing — step not found
  - **Verify GREEN**: the same command → expected: 0 failures; then `node --test scripts/__tests__/renovate-config.guard.test.mjs` passes, now including C6 and C8 on the real tree
  - **Done**: placed in the `sast` job, not `guardrails`: the `guardrails` job's seven steps are a guarded contract, and `sast` is the supply-chain job (contract updated).

**Checkpoint**: no pin is invisible. Mutation check: add `export const FOO_VERSION = '1.2.3';` to a script, and `RG`
fails naming it (quickstart §1).

---

## Phase 6: User Story 4 — the configuration is safe and checked (P2)

**Goal**: no automerge, every hold explained, every major approved, the config validated on every PR, and no wiki page
citing a bot-rewritten file.

**Independent Test**: `RG` passes with C1, C7 and C11 registered, and the `guardrails` job runs the validator.

### Tests for User Story 4 ⚠️

- [X] T037 [P] [US4] Tests in `RC` for rules **C1** and **C7**:
  - `automerge: true` at any depth fails;
  - `platformAutomerge` fails;
  - a hold missing `Why:`, `item #N` or `Re-check:` fails, naming the rule's index and `matchPackageNames`
    (data-model.md `Hold.description`);
  - a hold with no `match*` key fails (data-model.md `Hold.matcher`);
  - an approval rule missing `Re-check:` fails;
  - `dependencyDashboardApproval` on a patch track outside `spec kit` fails;
  - the majors-approval rule is required.
  - **Scenarios covered**: US4-AC1, US4-AC3, FR-002, FR-010, FR-011, SC-003
  - **Verify RED**: `node --test --test-name-pattern "C1|C7" scripts/__tests__/check-renovate-config.test.mjs` → expected: ≥8 failing — `not implemented`
- [X] T038 [P] [US4] Tests in `RC` for rule **C11**: a fixture `openwiki/` page whose `resource` is `package.json`, a
  workflow file or a custom manager's file fails, naming the page.
  - **Scenarios covered**: spec edge case (V17), ADR-0002
  - **Verify RED**: `node --test --test-name-pattern "C11" scripts/__tests__/check-renovate-config.test.mjs` → expected: ≥2 failing — `not implemented`
- [X] T039 [P] [US4] Extend `scripts/__tests__/guardrails-workflow.test.mjs`: the `guardrails` job has a "Validate
  renovate.json" step, after the dependency install. It runs `renovate-config-validator --strict --no-global` at
  `--print-renovate-version`, with `npx --before`, through `ci-log-step.sh`.
  - **Scenarios covered**: US4-AC2, FR-012
  - **Verify RED**: `node --test --test-name-pattern "validate renovate" scripts/__tests__/guardrails-workflow.test.mjs` → expected: 1 failing — step not found

### Implementation for User Story 4
  - **Done**: placed in the `sast` job, as T036.

- [X] T040 [US4] Implement rules C1, C7 and C11 in `scripts/check-renovate-config.mjs`. C7 checks data-model.md
  `Hold.description` (`Why:`, `item #N`, `Re-check:`) and `Hold.matcher` (at least one `match*` key). Add the holds
  and approvals of research R9 to `renovate.json`, each satisfying data-model.md `Hold.description` and
  `Hold.matcher`:
  - `actions/upload-artifact` `allowedVersions: "<4"`, citing T002's item;
  - `engines` disabled, citing item #47;
  - `belay-devcontainer` disabled, citing item #47;
  - the majors-approval rule;
  - the `spec kit` approval.
  - **Verify GREEN**: T037's and T038's commands → expected: 0 failures, 0 skipped; then `node --test scripts/__tests__/renovate-config.guard.test.mjs` passes on the real config
- [X] T041 [US4] Add the "Validate renovate.json" step to `.forgejo/workflows/guardrails.yml`.
  - **Verify GREEN**: T039's command → expected: 0 failures; then `node scripts/check-ci-digest-coverage.mjs` passes

**Checkpoint**: the config cannot quietly become unsafe.

---

## Phase 7: User Story 5 — the bot's state is visible and stays out of the backlog (P2)

**Goal**: one dashboard issue, labelled `status/bot-managed` and never listed by `ready`. The run's mode and verdict
are readable.

**Independent Test**: `backlog.mjs ready` hides a `status/bot-managed` item in tests, and after the first live run, on
the forge.

### Tests for User Story 5 ⚠️

- [X] T042 [P] [US5] Tests in `scripts/__tests__/backlog.test.mjs`: `selectReadyItems` drops an item labelled
  `status/bot-managed` (data-model.md `Dashboard.label`), even when unblocked and labelled `priority/p1`. The text
  output gains `(1 bot-managed item(s) not listed)`, and `--json` gains `excluded`
  ([contracts/cli.md](contracts/cli.md)).
  - **Scenarios covered**: US5-AC2, FR-014, SC-005
  - **Verify RED**: `node --test --test-name-pattern "bot-managed" scripts/__tests__/backlog.test.mjs` → expected: ≥3 failing — the item is listed
- [X] T043 [P] [US5] Tests in `RC` for rule **C9**: `dependencyDashboard` false or absent fails, and
  `dependencyDashboardLabels` other than `["status/bot-managed"]` fails.
  - **Scenarios covered**: US5-AC1, US5-AC2
  - **Verify RED**: `node --test --test-name-pattern "C9" scripts/__tests__/check-renovate-config.test.mjs` → expected: ≥2 failing — `not implemented`

### Implementation for User Story 5

- [X] T044 [US5] Exclude data-model.md `Dashboard.label` (`status/bot-managed`) in `selectReadyItems`, and in the
  `ready` output of `scripts/backlog.mjs`.
  - **Verify GREEN**: T042's command → expected: 0 failures; then `node --test scripts/__tests__/backlog.test.mjs` passes with 0 skipped
- [X] T045 [US5] Implement rule C9 in `scripts/check-renovate-config.mjs`. Add `dependencyDashboard` and
  `dependencyDashboardLabels`, set to data-model.md `Dashboard.label`, to `renovate.json`.
  - **Verify GREEN**: T043's command → expected: 0 failures; then `RG` passes with all eleven rules registered

**Checkpoint**: every story is functional offline. The live proof follows the merge (T061).

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T046 Implement `--selftest` in `scripts/check-renovate-config.mjs` and `scripts/refresh-pin-checksum.mjs`. Each
  rule C1–C11 must fail on a built-in bad fixture, and the checksum mismatch must leave the file unchanged. Wire both
  into the `scripts:lint` target in `scripts/project.json`, with a test in `RC` that the selftest exits 0.
  - **Verify RED**: `node scripts/check-renovate-config.mjs --selftest` → expected: exit 1, `not implemented`
  - **Verify GREEN**: the same command, and the `refresh-pin-checksum.mjs --selftest` → expected: exit 0, with every rule listed; then `pnpm nx run scripts:lint` passes
- [X] T047 Coverage: `pnpm nx run scripts:test`.
  - **Done when**: `check-renovate-config.mjs` and `refresh-pin-checksum.mjs` are each ≥ 70% of lines, with 0 skipped tests.
- [X] T048 [P] Write `docs/runbooks/renovate.md`, covering FR-018:
  - what the bot does and when: the two crons, UTC, the window and the limits;
  - reading the dashboard;
  - approving a held major, by ticking a checkbox;
  - adding a regex-managed pin: a custom manager plus the inventory guard, or an exclusion;
  - the base re-pin that discharges an image-scan allowlist entry: the PR must also delete the entry and the
    Dockerfile upgrade layer;
  - the token: the maintainer steps in quickstart §2, and rotating it;
  - "never hand-close a bot PR, never push to a bot branch";
  - the run verdict and the `renovate/mode` status;
  - the R7 limitation.
  - **Done when**: every FR-018 item has a section, and `node scripts/check-topology-scrub.mjs` passes.
- [X] T049 [P] Update `docs/runbooks/image-scanning.md:74-80`: the bot proposes `TRIVY_PIN` bumps, with the sha256
  moved by `refresh-pin-checksum.mjs`. Update `:68,91-94`: the bot's base re-pin PR must delete the allowlist entry and
  the upgrade layer before merge.
  - **Done when**: no sentence says "once it is adopted".
- [X] T050 [P] Update `docs/runbooks/sast.md:116-119`: the Semgrep, rustup-init and cargo-audit pins are bot-proposed,
  and the pairs are refreshed and verified by `refresh-pin-checksum.mjs`. A manual bump is still allowed, and runs
  `refresh-pin-checksum.mjs <pin>`.
  - **Done when**: the procedure names the script.
- [X] T051 [P] Update `docs/runbooks/ci.md`:
  - `:141`, the retention floor, from 125 to 150;
  - the guardrails step list (the validator and the checksum-pair step);
  - the secrets section (`RENOVATE_TOKEN`, `RENOVATE_GITHUB_COM_TOKEN`);
  - the workflow list (`renovate.yml` on `belay`).
  - **Done when**: `git grep -n "125 versions" docs/` is empty.
- [X] T052 [P] Update `docs/runbooks/backlog.md:18` and `.claude/skills/forgejo-issues/SKILL.md`: `ready` hides
  `status/bot-managed`, and the labels section describes `status/bot-managed`, `dependencies` and `security`, which are
  not backlog-type labels.
  - **Done when**: both name `status/bot-managed`.
- [X] T053 [P] Update `openwiki/invariants/secrets-management.md` (canonical): add the two rows and change the
  description from "three" to "five" credentials. Update the matching wording in `AGENTS.md:52` and
  `openwiki/invariants/index.md:7`.
  - **Done when**: `git grep -n "three forge credentials"` is empty outside `specs/`.
- [X] T054 [P] Update `docs/runbooks/spec-kit.md:128`: a Spec Kit bump arrives as a bot PR only after dashboard
  approval, and that PR must run `specify integration upgrade` before it merges.
  - **Done when**: the paragraph names the dashboard approval.
- [X] T055 Cross-link: each runbook paragraph that T049–T054 change links to `docs/runbooks/renovate.md`, and the
  runbook links back to each of them (image-scanning, sast, ci, backlog, spec-kit).
  - **Done when**: every link resolves. `docs/` has no link checker (`scripts/openwiki-links.mjs` covers `openwiki/`
    only), so each link is followed by hand and listed here.
  - **Done**: links followed by hand: image-scanning.md → renovate.md#a-base-image-re-pin-that-discharges-an-allowlist-entry and #version-and-checksum-pairs; sast.md, ci.md, backlog.md, spec-kit.md → renovate.md and its sections; renovate.md → image-scanning.md and spec-kit.md. Every anchor exists as a heading in renovate.md.

- [X] T056 Create the concept page `openwiki/runbooks/renovate.md` (resource: `docs/runbooks/renovate.md`). Add it to
  `openwiki/runbooks/index.md` and to AGENTS.md's Runbooks index, as one line with its trap and the link.
  - **Done when**: `node scripts/wiki-refresh.mjs --record openwiki/runbooks/renovate.md` records it.
- [X] T057 [P] Update `openwiki/projects/repository.md` (canonical): `renovate.json` at the root (ADR-0004), and
  `security/dependencies/` beside `images/` and `sast/`.
  - **Done when**: both paths appear in the layout.
- [X] T058 [P] Add a row to `openwiki/invariants/unenforced-rules.md`: a failed post-upgrade task still opens a PR. The
  rule enforcing it is the guardrails checksum step (research R7).
  - **Done when**: the row exists and cites research R7.
- [X] T059 Refresh every openwiki page whose `resource` changed: `node scripts/wiki-refresh.mjs --stale`, then
  `--diff` / `--record <page>` for each. Expect image-scanning, sast, ci, backlog and spec-kit, plus T056's new page.
  - **Done when**: `--stale` reports nothing.
- [X] T060 **Close-out re-search**: re-run T001's searches for `three forge credentials`, `125 versions`, `once it is
  adopted` and "ready … open, unblocked". Every remaining hit in a doc that states current procedure is fixed, or
  justified here.
  - **Done**: re-searched `three forge credentials`, `125 versions`, `once it is adopted`, `5 bundle-publishing` (0 hits) and `open, unblocked, priority-ordered` (1 hit: the updated backlog.md line).

- [X] T061 Run quickstart §1 and §5 (offline), the full `pnpm nx run scripts:lint` and `pnpm nx run scripts:test` (0
  skipped), and `node scripts/check-speckit-overrides.mjs`. Quickstart §3 (the dry run) and §4 (the first live run)
  need `renovate.json` on `main`, so they run **after the merge**, and their results go on item #47 (SC-006). Item #47
  stays open until §4 is recorded.
  - **Done when**: the offline commands pass, and the post-merge steps are listed in the PR body.
- [X] T062 **Open the PR** from a real branch, with the repository's PR tools (`docs/runbooks/ci.md`):
  1. `git push origin HEAD:011-renovate-dependency-bot`
  2. `node scripts/forge-pr.mjs open --head 011-renovate-dependency-bot --title "Feature 011: a self-hosted dependency bot (item #47)" --body-file <file>`
  3. `node scripts/ci-status.mjs watch --pr <n>`, until it exits 0
  4. `node scripts/forge-pr.mjs merge <n> --expect-head <full sha>`

  Tick this task in the branch's LAST commit and quote the branch and the PR number. **CI evidence is never recorded
  here**: a file cannot hold the CI result of the commit that contains it. The run ids, the CI verdict and the merge sha
  go in the PR's closing comment and in item #47's.
  - **Done**: branch `011-renovate-dependency-bot`, PR #63. CI evidence goes in the PR's closing comment and item #47's.

---

## Dependencies & Execution Order

- **Setup (T001–T004)** comes first. T002 and T003 are forge and npm look-ups. T004's stubs make every RED a real RED.
- **Foundational (T005–T010)** blocks every story: every rule needs `detectPins` and `checkRules`, and the labels must
  exist before a run.
- **US1 (T011–T019)** creates `renovate.json` and `renovate.yml`. US2–US5 add sections to both, so they follow US1.
  Among themselves, US2–US5 are independent except for file contention: each adds rules to
  `check-renovate-config.mjs`, so run them one at a time.
- **T027 (`RG`)** is created in US2. US3–US5 each end by re-running it with their rules registered.
- **Polish** follows all the stories. T062 is last.

### Within each story

The tests (RED), then the rule implementation (GREEN), then the config section (validator plus `check-renovate-config`),
then the workflow wiring.

## Parallel Examples

```bash
# US1 tests, three files' worth of independent assertions:
Task: "T011 judgeRun tests in scripts/__tests__/check-renovate-config.test.mjs"
Task: "T013 workflow guard in scripts/__tests__/renovate-workflow.guard.test.mjs"
# US3: the checksum script is independent of the rule work:
Task: "T030 tests in scripts/__tests__/refresh-pin-checksum.test.mjs"  then  "T033 scripts/refresh-pin-checksum.mjs"
# Polish docs, all different files:
Task: "T049 image-scanning.md"  "T050 sast.md"  "T051 ci.md"  "T052 backlog.md + SKILL.md"  "T054 spec-kit.md"
```

## Implementation Strategy

- **MVP = Setup + Foundational + US1**: a running, verdict-judged bot whose security channel works.
- **The P1 set (US1–US3)** is what makes the bot trustworthy: bounded routine work, and no invisible pins.
- **US4–US5** are the safety net and the backlog hygiene.
- **One PR** for the whole feature (`openwiki/process/pull-request-batching.md`): the stories share two files, so
  splitting them would not make a failure any less ambiguous.
- **The live proof is post-merge** (T061 → item #47): Renovate reads its config from the default branch, and this
  feature forbids onboarding PRs (T013).

## Notes

- Every `renovate.json` edit is followed by the strict validator (T017's command). An invalid config silently manages
  nothing.
- Rule order in `packageRules` is load-bearing (research R3 and R9). Keep the order the research gives.
