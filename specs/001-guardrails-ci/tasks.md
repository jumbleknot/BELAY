---

description: "Task list for feature 001: guardrails CI"
---

# Tasks: Guardrails CI

**Input**: Design documents from `specs/001-guardrails-ci/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: REQUIRED in this repository (project override; constitution "Test-Driven Development", NON-NEGOTIABLE). Every test task and its paired implementation task use the TDD checkpoint format in `docs/templates/feature-test-tasks-template.md`. Documentation and config tasks use that template's "Done when" form.

**Organization**: tasks are grouped by user story, so each story can be implemented and tested on its own.

**Source to port**: `E:\Programming\VSCode\MovieCollectionManager` (MCM). "Port" means copy the MCM file, then change only what [research.md](research.md) lists for it. Every port follows **R-strip**:
- remove MCM feature and item numbers and incident stories from comments;
- remove FR tags from code identifiers and comments (constitution "Behavior-Descriptive Identifiers");
- keep all behaviour.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependencies)
- **[Story]**: the user story this task belongs to (US1–US4)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: turn BELAY into a pnpm + Nx workspace (research R1, R2), and find every doc this feature makes stale.

- [X] T001 Create the workspace root files.
  - **Files:** `package.json`, `pnpm-workspace.yaml`, `nx.json`, `.gitignore` (append `.nx/` and `.pnpm-store/`). Run `pnpm install` to create `pnpm-lock.yaml`.
  - **Field values:** [data-model.md](data-model.md) → Workspace (`package.json`, `pnpm-workspace.yaml`, `nx.json` rows). `nx` is exact and `yaml` uses `^`, per constitution v1.0.1 "Dependency Security".
  - **Supply-chain notes:** port MCM's `pnpm-workspace.yaml` header comments explaining why `allowBuilds` exists, why overrides belong in this file, and why there's no `minimumReleaseAge`. Leave out MCM's package entries and incident history.
  - **Install scripts:** decide every package pnpm reports as wanting an install script, as an explicit `true`/`false` with a one-line reason.
  - **Done when:**
    - `pnpm install --frozen-lockfile` exits 0 with no `ERR_PNPM_IGNORED_BUILDS`;
    - `git status --short` shows no `node_modules/` or `.nx/`;
    - `pnpm nx --version` prints 24.0.6.
- [X] T002 Create the Nx project `scripts` in `scripts/project.json`.
  - **Targets:** `nx:run-commands` with `cwd` at the repository root and `parallel: false`. For now:
    - `lint` holds only the two `check-speckit-overrides.mjs` commands;
    - `test` holds `node --test "scripts/__tests__/*.test.mjs"`.

    Later tasks add the other `lint` commands from [contracts/script-clis.md](contracts/script-clis.md).
  - **Done when:**
    - `pnpm nx run scripts:lint` and `pnpm nx run scripts:test` both exit 0, and `scripts:test` runs all 66 existing tests;
    - the warm wall time of each target is recorded here. If either is more than about 10 s over the direct `node` command, stop and raise MCM's measured Nx-graph cost (research R2) before continuing.
  - **Measured 2026-11-22** (warm, `--skip-nx-cache`, Windows): `scripts:lint` 1.34 s against 0.42 s direct; `scripts:test` 2.20 s against 1.31 s direct (66 tests). Nx adds about 1 s, well under the threshold, so no MCM-style exception is needed.
- [X] T003 **Doc-impact sweep** (REQUIRED in every tasks.md; constitution "Documentation").
  - **Command:** for each term, `git grep -n -F "<term>" -- '*.md' ':!specs/' ':!docs/proposals/' ':!docs/decisions/' ':!docs/superpowers/'`.
  - **Terms (identifiers whose meaning this feature changes):** `by hand`, `no CI`, `No language toolchains`, `build system`, `node --test`, `check-speckit-overrides.mjs`, `package.json`, `pnpm`, `nx`, `ci-failures`, `ci-step-logs`, `guardrails`, `Run the gate`.
  - **Results** (searched 2026-11-22, while generating this file):
    - [x] `AGENTS.md:9`: "No language toolchains or build system have been chosen yet". → T020
    - [x] `AGENTS.md:20`: `scripts/` layout row (gate and tests only). → T020
    - [x] `AGENTS.md:51`: "Run the gate" via `node` only, with no CI. → T020
    - [x] `docs/runbooks/spec-kit.md:18-20`: local gate commands. → T021 (add the `pnpm nx run scripts:lint` / `scripts:test` equivalents)
    - [x] `docs/runbooks/spec-kit.md:24`: "The repository has no CI yet, so run the gate by hand". → T021
    - [x] `README.md` "Status": "Tooling will be added here". → T022 (this hit comes from AGENTS.md's "document a new tool in the README" practice, not from the grep)
    - [x] All other `by hand` hits (`AGENTS.md:50`, `spec-kit.md:40,65,80,131,133`): no change, they describe unrelated manual steps.
    - [x] Hits in `.specify/memory/constitution.md` and `docs/templates/feature-test-tasks-template.md`: no change, they already prescribe pnpm and Nx.
    - [x] Hits in `.claude/skills/speckit-implement/SKILL.md`: no change, it's a Spec Kit vendor file.
    - [x] `ci-failures`, `ci-step-logs`, `guardrails`: no hits outside `specs/`.

**Checkpoint**: the workspace installs, both Nx targets run, and the doc work is listed.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the CI bootstrap and the shared redaction layer that US1 and US2 depend on.

**⚠️ CRITICAL**: no user story work starts until this phase is complete.

- [X] T004 [P] Port `scripts/install-pnpm.sh` from MCM (research R4, R-strip).
  - **Done when:**
    - `bash scripts/install-pnpm.sh` exits 0 and `pnpm --version` prints 12.21.0;
    - run against a temp manifest with `"packageManager": "npm@10"`, it exits 2.
  - **Done 2026-11-22:** the bad `packageManager` case and the missing-manifest case both exit 2. The success path was deliberately not run on the maintainer's machine, because it would replace the global pnpm 10.33.0 that other repos use. Workflow step 3 proves it on the first CI run (T025).
- [X] T005 [P] Port `scripts/__tests__/ci-log-step.test.mjs` from MCM (research R5): rename the log directory to `$HOME/<repo>-ci-step-logs` ([data-model.md](data-model.md) → Evidence bundle.host directories), and apply R-strip.
  - **Scenarios covered:** FR-015. A failing command still fails through `tee` (`pipefail`), and output reaches the per-step log.
  - **Verify RED:** `node --test scripts/__tests__/ci-log-step.test.mjs` → expected: failing, with `ENOENT`/exit 127 for `scripts/ci-log-step.sh`.
- [X] T006 Port `scripts/ci-log-step.sh` from MCM (research R5): log directory `$HOME/<repo>-ci-step-logs`, with `<repo>` derived from `GITHUB_REPOSITORY` as data-model.md describes, and R-strip. Prerequisite: T005 verified RED.
  - **Verify GREEN:** `node --test scripts/__tests__/ci-log-step.test.mjs` → expected: 0 failures; then `pnpm nx run scripts:test` passes.
- [X] T007 [P] Port `scripts/__tests__/ci-digest-redact.test.mjs` from MCM (research R6, R7). Remove the cases for the `mcm-dev-credential` rule and the `mcm_` / `Mcm-dev-` shapes, and keep every other case.
  - **Scenarios covered:** US2-AC4. Every occurrence is rewritten; a surviving credential drops the excerpt; the forge host is redacted.
  - **Verify RED:** `node --test scripts/__tests__/ci-digest-redact.test.mjs` → expected: failing with `ERR_MODULE_NOT_FOUND` for `ci-digest-redact.mjs`.
- [X] T008 Port `scripts/secret-scan.mjs` and `scripts/ci-digest-redact.mjs` from MCM (research R6, R7, R-strip). Prerequisite: T007 verified RED.
  - **Rules:** `RULES` keeps exactly `anthropic-api-key`, `tmdb-v3-api-key` and `tmdb-v4-token` ([data-model.md](data-model.md) → Secret-scan rule.name). Leave out the `mcm-dev-credential` rule and its selftest fixtures.
  - **Lint target:** add `node scripts/secret-scan.mjs --selftest` and `node scripts/ci-digest-redact.mjs --selftest` to `scripts:lint` in `scripts/project.json`.
  - **Verify GREEN:** `node --test scripts/__tests__/ci-digest-redact.test.mjs` → expected: 0 failures; then `pnpm nx run scripts:lint` and `pnpm nx run scripts:test` pass.
  - **Done 2026-11-22:**
    - `scanText` also carried two non-`RULES` checks. `e2e-test-password-literal`, MCM's actual test-user password, was removed as MCM-specific. The generic credential-fallback and cassette-auth checks were kept.
    - The redactor's MCM session-cookie rewrite (`mcm_access_token`) and its test case were removed, because BELAY has no sessions.
    - Fail-closed test (d) now plants a `tmdb_key: <32 hex>` value. The scanner detects it and the generic rewrite does not touch it.
    - Result: 22 of 22 redactor tests pass, and both selftests pass.

**Checkpoint**: pnpm bootstraps, step logs are captured, and redaction works.

---

## Phase 3: User Story 1 - Every change is checked automatically (Priority: P1) 🎯 MVP

**Goal**: every PR and every push to `main` runs the gates and the script tests on `ci-homelab`, with one pass/fail result.

**Independent Test**: open a PR that keeps the guardrails intact and see green. Break a guarded file and see red, naming the cause (quickstart §2).

### Tests for User Story 1 (REQUIRED, TDD checkpoint format) ⚠️

- [X] T009 [US1] Write `scripts/__tests__/guardrails-workflow.test.mjs`. It parses `.forgejo/workflows/guardrails.yml` with `yaml` and asserts the [contracts/guardrails-workflow.md](contracts/guardrails-workflow.md) contract:
  - **Triggers:** exactly `workflow_dispatch`, `push.branches == ['main']` and an unscoped `pull_request`.
  - **Concurrency:** `concurrency.group == 'guardrails-${{ github.ref }}'` and `cancel-in-progress: true`.
  - **Job:** a single job `guardrails` with `runs-on: ubuntu-latest`.
  - **Steps:** steps 1–7 in contract order, with the exact action SHAs and `node-version: 26.13.1`. Steps 5 and 6 run `pnpm nx run scripts:lint` / `scripts:test` through `ci-log-step.sh`.
  - **Scenarios covered:** US1-AC1, AC4, AC5, AC6, AC7, plus FR-001 to FR-007 (the shape that makes them hold).
  - **Verify RED:** `node --test scripts/__tests__/guardrails-workflow.test.mjs` → expected: failing with `ENOENT` for `.forgejo/workflows/guardrails.yml`.

### Implementation for User Story 1

- [X] T010 [US1] Create `.forgejo/workflows/guardrails.yml` per research R3 and the contract.
  - **Comments:** MCM's triggers comment and its action-light header, both with R-strip.
  - **Digest step:** step 7 is copied verbatim from MCM's "Publish failure digest" step. Until T014 lands, it logs a missing-script error and is swallowed by `continue-on-error`.
  - Prerequisite: T009 verified RED.
  - **Verify GREEN:** `node --test scripts/__tests__/guardrails-workflow.test.mjs` → expected: 0 failures; then `pnpm nx run scripts:test` passes.
- [X] T011 [US1] Check failure detection by mutation, locally. This is the evidence for US1-AC2 and AC3.
  - Temporarily revert the registered edit in `.claude/skills/speckit-tasks/SKILL.md`. Restore it with `git checkout --`, never with a PowerShell text round-trip.
  - Temporarily break one assertion in `scripts/__tests__/ci-log-step.test.mjs`.
  - **Done when:**
    - `pnpm nx run scripts:lint` exits non-zero, naming `local-edit-reverted` and the file;
    - `pnpm nx run scripts:test` exits non-zero, naming the broken test;
    - both pass again after the restore.

**Checkpoint**: the workflow matches its contract. The live first run happens in T025.

---

## Phase 4: User Story 2 - A failure explains itself (Priority: P2)

**Goal**: a failed job gets one redacted, upserted digest on the PR, or a commit status, with fuller evidence in `belay-ci-failures`.

**Independent Test**: quickstart §3, a throwaway failing commit on the PR.

### Tests for User Story 2 (REQUIRED, TDD checkpoint format) ⚠️

- [X] T012 [US2] Port `scripts/__tests__/ci-failure-digest.test.mjs` from MCM (research R8, R-strip).
  - **Fixture names:**
    - the registry package becomes `<repo>-ci-failures` ([data-model.md](data-model.md) → Evidence bundle.package);
    - the host directories become `$HOME/<repo>-ci-step-logs` and `$HOME/<repo>-ci-last-failure` (Evidence bundle.host directories);
    - the test repository is `jumbleknot/BELAY`, so `belay-ci-failures`.
  - **Removed cases:** only those that assert MCM-named service containers.
  - **Kept cases:** the last-failure bundle owner-stamp cases, now using the prefixed directory.
  - **Added case:** two repositories under one owner publish to different packages.
  - **Scenarios covered:** US2-AC1 to AC7 (upsert by start-of-body marker, commit status off-PR, evidence link, redaction applied, cancelled run publishes nothing, never changes the outcome, token fallback order). See [data-model.md](data-model.md) → Failure digest.marker, Failure digest.channel, Credential (digest).
  - **Verify RED:** `node --test scripts/__tests__/ci-failure-digest.test.mjs` → expected: failing with `ERR_MODULE_NOT_FOUND` for `ci-failure-digest.mjs`.

### Implementation for User Story 2

- [X] T013 [US2] Port `scripts/ci-failure-digest.mjs` from MCM (research R8, R-strip).
  - **Package name:** derive it from `GITHUB_REPOSITORY` as `<repo>-ci-failures`, replacing `BUNDLE_PACKAGE = 'ci-failures'`.
  - **Directories:** use the same `<repo>-` prefix for the step-log and last-failure directories, matching T006's constant.
  - **Removed:** the MCM container-name ranking entries.
  - Prerequisite: T012 verified RED.
  - **Verify GREEN:** `node --test scripts/__tests__/ci-failure-digest.test.mjs` → expected: 0 failures; then `pnpm nx run scripts:test` passes.
  - **Done 2026-11-22.** 135 of 135 digest tests pass; the full suite passes 258, with 2 skipped (POSIX-only probes).
    - `repoSlug`, `bundlePackage` and `lastFailureDir` replace `BUNDLE_PACKAGE` and the hard-coded MCM directories.
    - MCM job and service names in fixtures became neutral ones.
    - Test (e2) now plants the `tmdb_key` value, because the old planted value matched only the removed MCM rule.
    - `#645e` now checks only the bundle writers that actually exist. BELAY has none, so the MCM count assertion was dropped.
    - **Ruling:** the digest's tool-generic evidence paths were kept, though dormant: Maestro mobile device diagnostics, Playwright counts, and run-health from a tally file. They name third-party tools, not MCM, and they activate only when a job leaves that evidence. Removing them would mean rewriting most of the 1,745-line module and its 135 tests, against the user's "reuse as much as possible". Cost if wrong: dead code paths until a BELAY job uses them.
- [X] T014 [US2] Add `node scripts/ci-failure-digest.mjs --selftest` to `scripts:lint` in `scripts/project.json`.
  - **Done when:** `pnpm nx run scripts:lint` exits 0, and its output includes the digest selftest's pass line.

**Checkpoint**: the digest is proven by its tests. The live evidence is T026.

---

## Phase 5: User Story 4 - `main` only accepts checked changes (Priority: P2)

**Goal**: one written procedure turns on protection for `main` and names the exact check to require.

**Independent Test**: quickstart §6.

- [ ] T015 [US4] Write `docs/runbooks/ci.md` (FR-017). Sections:
  - **What guardrails runs:** the triggers, the job, and the two Nx targets.
  - **Running it locally:** `pnpm install --frozen-lockfile`, then the targets.
  - **Reading a failure digest:** the PR comment, the commit status, and the `belay-ci-failures` evidence and how to fetch it.
  - **Runner:** `ci-homelab`, label `ubuntu-latest`, and how to check it's online and what labels it has.
  - **Secrets:** `CI_DIGEST_TOKEN` with scopes `write:issue`, `write:package`, `read:repository`, and the run-token fallback.
  - **Branch protection for `main`:** Settings → Branches → add a rule for `main`; disable direct pushes; enable required status checks with the guardrails context; save. Leave the context string as a marked placeholder until T025 records it.
  - **Adding a job:** the digest step is required, or `# ci-digest-exempt: <reason>`.
  - **Done when:** every FR-017 item has a section; the file is linked from `AGENTS.md` (T020) and `docs/runbooks/spec-kit.md` (T021); markdownlint shows no new warnings.
- [ ] T016 [US4] After T025's first green run: record the exact status-context string in `docs/runbooks/ci.md`, then hand the user the branch-protection steps.
  - **Done when:** the user reports protection is on, and a test `git push origin HEAD:main` from a scratch commit is refused (US4-AC1). Verify US4-AC2 on T026's red run: merge is blocked.

**Checkpoint**: `main` is protected.

---

## Phase 6: User Story 3 - Digest coverage cannot quietly erode (Priority: P3)

**Goal**: a job without a correctly guarded digest step fails guardrails, naming the job.

**Independent Test**: quickstart §5.

### Tests for User Story 3 (REQUIRED, TDD checkpoint format) ⚠️

- [X] T017 [US3] Port `scripts/__tests__/check-ci-digest-coverage.test.mjs` from MCM (research R9, R-strip). Replace MCM job names in the fixtures with neutral ones. See [data-model.md](data-model.md) → Digest exemption.marker, Digest exemption.reason.
  - **Scenarios covered:** US3-AC1 to AC6, plus the "unparseable workflow" edge case (exit 2).
  - **Verify RED:** `node --test scripts/__tests__/check-ci-digest-coverage.test.mjs` → expected: failing with `ERR_MODULE_NOT_FOUND` for `check-ci-digest-coverage.mjs`.

### Implementation for User Story 3

- [X] T018 [US3] Port `scripts/check-ci-digest-coverage.mjs` from MCM unchanged apart from R-strip. It keeps `import { parse } from 'yaml'`.
  - **Lint target:** add its `--selftest` and its scan to `scripts:lint`, as the contract orders them.
  - Prerequisite: T017 verified RED.
  - **Verify GREEN:** `node --test scripts/__tests__/check-ci-digest-coverage.test.mjs` → expected: 0 failures; then `pnpm nx run scripts:lint` passes on the real `.forgejo/workflows/guardrails.yml`.
  - **Done 2026-11-22.** 32 of 32 coverage tests pass; the full suite passes 290, with 2 skipped.
    - **Ruling:** MCM's coverage gate also requires every `run:` step to go through `ci-log-step.sh`, and it flagged BELAY's bare install steps 3 and 4. Following MCM, both are now wrapped (`guardrails-install-pnpm`, `guardrails-install-deps`). That gives install failures a step log. The contract test (T009), the contract document and research R3 were updated to match, with the contract test updated first and watched RED.
    - When imported, the gate scans the real workflows unless it's run with `--selftest`. Its test file therefore fails to load if a workflow has a gap, which is the same as in MCM.
- [X] T019 [US3] Mutation check (SC-006). On a scratch copy, delete step 7 from `guardrails.yml`, then run `node scripts/check-ci-digest-coverage.mjs`. Add `# ci-digest-exempt: test` to the job and run it again. Restore the file with `git checkout --`.
  - **Done when:**
    - without step 7: exit 1, naming `guardrails.yml` and job `guardrails`;
    - with the exemption: exit 0;
    - after the restore: clean.

**Checkpoint**: all four stories are implemented.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T020 [P] Update `AGENTS.md` (sweep hits `AGENTS.md:9`, `:20`, `:51`; FR-018, FR-024).
  - **Line 9:** replace the "no toolchains chosen" sentence with the pnpm + Nx convention. That's: `pnpm install --frozen-lockfile`; `pnpm nx run scripts:lint` / `scripts:test`; the lock file is committed; version pinning per constitution "Dependency Security".
  - **`scripts/` row:** mention the Nx project and the CI scripts.
  - **Layout:** add `.forgejo/workflows/`.
  - **"Run the gate":** CI runs it on every PR. Locally, run it before committing; it still needs no install.
  - **Link:** add `docs/runbooks/ci.md`.
  - **Done when:** the sweep terms `No language toolchains` and `no CI` no longer appear in `AGENTS.md`.
- [ ] T021 [P] Update `docs/runbooks/spec-kit.md` (sweep hits `:18-20`, `:24`).
  - **Local commands (lines 18-20):** add the `pnpm nx run scripts:lint` / `scripts:test` equivalents.
  - **Line 24:** replace "no CI yet, so run the gate by hand" with "the guardrails workflow runs the gate and its selftest on every PR and every push to `main` (see `docs/runbooks/ci.md`)".
  - **Done when:** `node scripts/check-speckit-overrides.mjs` passes, which keeps the inventory check green.
- [ ] T022 [P] Update `README.md` "Status": add a short "Development" section covering pnpm + Nx install and the two targets, linking `docs/runbooks/ci.md`.
  - **Done when:** the README names the install command and both targets.
- [ ] T023 SC-008 check. Run `git grep -niE 'mcm|movie|mc-service|komodo|kvm' -- scripts .forgejo package.json nx.json pnpm-workspace.yaml docs/runbooks/ci.md`.
  - **Done when:** there are no hits. The `tmdb-*` vendor-key rule names in `secret-scan.mjs` and its tests are the only expected matches for `tmdb`.
- [ ] T024 **Close-out re-search**: re-run T003's searches.
  - **Done when:** every remaining hit in a doc that states current procedure has been fixed, or is justified in this task.
- [ ] T025 **Open the PR** from a real branch: `git push origin HEAD:001-guardrails-ci`, then open a PR to `main`. This is by hand: the PR tooling is feature 002. Use Forgejo's UI, or one `POST /repos/jumbleknot/BELAY/pulls` with `FORGE_ISSUE_TOKEN` from the environment.
  - Confirm exactly one `guardrails` run, green, on `ci-homelab` (quickstart §2, SC-001). If it stays queued, change `runs-on` to the label `ci-homelab` advertises.
  - Tick this task in the branch's LAST commit, quoting the branch, the PR number and that commit's sha.
  - **CI evidence is never recorded here.** A file can't hold the CI result of the commit that contains it, and a commit added to record it is a new head that reruns every required CI job. The run ids, the CI verdict and the merge sha go in the PR's closing comment, and in the closing comment of each issue the PR resolves.
- [ ] T026 Live digest evidence (quickstart §3, SC-003, SC-004). On the PR, push a throwaway commit that fails one script test, then a second failing commit, then revert both.
  - **Done when:**
    - exactly one `<!-- ci-digest:job=guardrails -->` comment exists, updated by the second failure, and published with `CI_DIGEST_TOKEN`, not the degraded channel;
    - its evidence link resolves in `belay-ci-failures`;
    - the final head is green.

    The evidence goes in the PR's closing comment only.
- [ ] T027 Run [quickstart.md](quickstart.md) §1–§7 end to end, then merge once protection (T016) is on and the PR is green.
  - **Done when:** every quickstart "Expected" holds.


---

## Dependencies & Execution Order

- **Setup (T001–T003)** → **Foundational (T004–T008)** → user stories.
- **US1 (T009–T011)** needs T006, because the workflow runs steps through `ci-log-step.sh`.
- **US2 (T012–T014)** needs T006 and T008 (log directory and redactor).
- **US3 (T017–T019)** needs T010, because it scans the real workflow.
- **US4 (T015–T016):**
  - T015 can be written any time after T010;
  - T016 needs T025's first green run.
- **Polish:**
  - T020–T024 after the stories;
  - T025 after everything is committed;
  - T026 and T027 after T025;
  - the merge in T027 after T016.

### Parallel Opportunities

- T004, T005 and T007 touch different files and can run together.
- T020, T021 and T022 can run together.
- The test ports T012 and T017 can run together once Phase 2 is done.

## Parallel Example: Phase 2

```bash
Task: "Port scripts/install-pnpm.sh (T004)"
Task: "Port scripts/__tests__/ci-log-step.test.mjs (T005)"
Task: "Port scripts/__tests__/ci-digest-redact.test.mjs (T007)"
```

## Implementation Strategy

1. **MVP:** Setup + Foundational + US1 (T001–T011). With T025, that's a green CI on the PR.
2. **Next:** add US2, the digest (T012–T014), then US3, the coverage gate (T017–T019), each verified on its own.
3. **Then** the docs (T015, T020–T024), Open the PR (T025), the live digest evidence (T026), protection (T016), and the quickstart validation and merge (T027).
