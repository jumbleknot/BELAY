---

description: "Task list for feature 004: dev container on Docker Sandbox"
---

# Tasks: Dev container on Docker Sandbox

**Input**: Design documents from `specs/004-devcontainer-sandbox/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/cli.md](contracts/cli.md), [quickstart.md](quickstart.md)

**Tests**: REQUIRED in this repository (project override; constitution "Test-Driven Development", NON-NEGOTIABLE). Every test task and its paired implementation task use the TDD checkpoint format in `docs/templates/feature-test-tasks-template.md`:
- the test task names the acceptance scenarios it covers, and gives a **Verify RED** command with the expected failure;
- the implementation task that follows gives a **Verify GREEN** command with the expected pass.

Documentation, config and operator tasks use the "Done when" form instead.

**Organization**: tasks are grouped by user story. The source material is MovieCollectionManager (MCM) at `ab1f68ca`; each task names the MCM file it ports.

**Phase order is driven by dependencies, not only by priority.**
- The first sandbox bring-up (US1, T026) needs two things that come from other stories:
  - the **allowlist and its generator** (US2), to apply the policy before anything pulls;
  - a **CI-built image pin** (US4).
- The image cannot be built inside the sandbox, because rustup's hosts are not allowlisted (research R5). So US2 and US4 are implemented first.
- Each story is still testable on its own. US2 and US4 are proven by their own tests and by T021, before any sandbox exists.

**Testing notes.**
- Bash-script tests use `scripts/__tests__/shell-probe.mjs`, so a host without a usable bash skips with a reason. CI always has bash.
- `devcontainer.json` is JSONC. The guard tests strip comments with a small string-aware helper inside the test, never with a regex that would also eat `//` inside a string such as `unix:///var/…`.
- `open-sandbox.ps1` cannot run in CI, which has no `pwsh`. It gets a static guard, and its behaviour is checked by hand (T027).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependencies)
- **[Story]**: the user story this task belongs to (US1 to US5)

---

## Phase 1: Setup

- [x] T001 **Doc-impact sweep** (constitution, "Documentation"). Run on 2026-11-22 while generating this file, with
  `git grep -n -F "<term>" -- '*.md' ':!specs/' ':!docs/proposals/' ':!docs/decisions/'` per term.
  - **Terms:** `devcontainer`, `dev container`, `planned, not built`, `To write`, `scripts:lint`, `runs-on`,
    `own repository runner`, `kvm`, `ci-homelab`, `ANTHROPIC_API_KEY`, `/workspaces/belay`, `worktree`,
    `mcm-dotfiles`, `open-sandbox`, `egress`.
  - **Hits and dispositions:**
    - `docs/runbooks/devcontainer.md` (status note, the *To write* sections, credentials, worktree section) → T036
    - `openwiki/runbooks/devcontainer.md` (title, description, "planned, not built") → T037
    - `openwiki/runbooks/index.md:5` (the "planned" description) → T037
    - `AGENTS.md:64` (index entry "planned; the worktree rule") → T037
    - `AGENTS.md:9` (the worktree gate links `#shared-dev-container-commit-from-a-worktree`): no change. T036 keeps that heading verbatim, so the anchor still resolves.
    - `openwiki/quickstart.md:51`: no change. The row stays true.
    - `docs/runbooks/ci.md:25` (the list of what `scripts:lint` runs) → T038
    - `docs/runbooks/ci.md:74–75` (`runs-on: belay`, "why its own runner") → T038, adding the `devcontainer-image` exception
    - `openwiki/runbooks/ci.md:47` ("The runner is BELAY's own") → T039
    - `openwiki/invariants/nx-task-runner.md:20` (the `scripts:lint` table row; the new build target) → T040
    - `openwiki/invariants/testing-tiers.md:20` (the Gates row) → T040
    - `openwiki/projects/repository.md` (the layout table lacks `.devcontainer/`) and `README.md:30` (Development) → T041
    - The other `scripts:lint` hits (`AGENTS.md:17,49`, `docs/runbooks/spec-kit.md:22`, `feature-validation-checklist.md:20,23`, `secrets-management.md:45`, `pull-request-batching.md:29`, `openwiki/runbooks/ci.md:15,53`, `openwiki/runbooks/spec-kit.md:16`): no change. They describe running the target, and that is unchanged.
    - `ANTHROPIC_API_KEY` in `AGENTS.md:7` and `secrets-management.md:30,33`: no change. The rule is unchanged and the dev container applies it.
    - `docs/superpowers/specs/2026-11-22-speckit-forgejo-parity-design.md` (`ci-homelab`, own runner, `scripts:lint`): no change. It is a dated design record, so history.
    - `egress` hits in the constitution, the templates and the wiki ("regression"): no change, because they are false matches.
    - `mcm-dotfiles`, `open-sandbox`, `/workspaces/belay` (beyond the files above): no other hits.

- [x] T002 Confirm the line-ending rules cover the new file types: `.gitattributes` stores `*.sh` as LF and `*.ps1` as CRLF.
  - **Done when:** `git check-attr eol -- .devcontainer/x.sh scripts/open-sandbox.ps1` reports `lf` and `crlf`. If it doesn't, ask before editing `.gitattributes`, because it is a repository-wide convention.

---

## Phase 2: Foundational (the container configuration and the toolchain image)

**⚠️ Blocks** every story: US1, US3 and the sandbox bring-up need the configuration, and US4 publishes this image.

- [x] T003 [P] Write the dev-container config guard in `scripts/__tests__/devcontainer-config.guard.test.mjs`
  - **Scenarios covered:** US1-AC2, US3-AC1, US3-AC5, US4-AC3 (the pin check is wired), FR-001 to FR-006, FR-011, FR-013, FR-014 and FR-019. Contract: [research R3](research.md).
  - **Asserts, on `.devcontainer/devcontainer.json`:**
    - `build.dockerfile` is `Dockerfile`, and `build.args.BASE_IMAGE` is exactly `${localEnv:BELAY_DEVCONTAINER_IMAGE:belay-devcontainer}`.
    - The `docker-outside-of-docker:1` feature has `moby: true` and `dockerDashComposeVersion: "none"`.
    - `runArgs` contains `--network=host`, `--restart=always`, `--memory=5g`, `--memory-swap=5g`, and `--env-file` followed by `${localEnv:HOME}/.belay-devcontainer-secrets.env`.
    - `remoteUser` is `coder` and `updateRemoteUserUID` is `true`.
    - `workspaceMount`, `workspaceFolder` and `capAdd` are all absent.
    - `mounts` matches [data-model.md, Persistent volumes](data-model.md) exactly: the names and targets of `belay-claude`, `belay-pnpm-store` and `belay-commandhistory`.
    - `containerEnv` has exactly these keys and no others:
      - `DOCKER_HOST=unix:///var/run/docker-host.sock`;
      - `DOCKER_CONFIG=/home/coder/.docker-sandbox`;
      - `CLAUDE_CONFIG_DIR=/home/coder/.claude`;
      - `FORGE_REGISTRY_HOST`;
      - the three markers in [data-model.md, Markers](data-model.md) (`BELAY_DEVCONTAINER`, `BELAY_DEVCONTAINER_PLATFORM` and `DEVCONTAINER_PERSONAL_LAYER`) with their values.

      This rules out any credential key, including `ANTHROPIC_API_KEY`.
    - The lifecycle commands name scripts that exist under `.devcontainer/`, in the order given in research R3. `initializeCommand` runs `check-image-pin.sh` **before** `gen-container-secrets-env.sh`.
    - The file contains no `mcm` substring.
  - **Verify RED:** `node --test scripts/__tests__/devcontainer-config.guard.test.mjs` → expected: every test failing, with `ENOENT … .devcontainer/devcontainer.json`.

- [x] T004 Create `.devcontainer/devcontainer.json`, ported from MCM's `.devcontainer/sandbox/devcontainer.json` per research R3 and keeping its explanatory comments where they still apply, and the thin `.devcontainer/Dockerfile` (`ARG BASE_IMAGE=belay-devcontainer` / `FROM ${BASE_IMAGE}`, with MCM's header explaining the seam). This needs T003 verified RED.
  - The `mounts` follow [data-model.md, Persistent volumes](data-model.md), and the marker variables follow [data-model.md, Markers](data-model.md).
  - Leave out `forwardPorts`, the Ollama and Android hooks, the app-path chowns, `OPENWIKI_*`, `MCM_USAGE_*` and `capAdd`.
  - The lifecycle scripts it names are created as empty stubs that exit 0, until their stories fill them: `check-image-pin.sh`, `gen-container-secrets-env.sh`, `fix-workspace-ownership.sh`, `persist-claude-config.sh`, `ensure-rtk-hook.sh` and `assert-egress-governed.sh`.
  - **Verify GREEN:** `node --test scripts/__tests__/devcontainer-config.guard.test.mjs` → expected: 0 failures. Then `pnpm nx run scripts:test` still passes.

- [x] T005 [P] Write the toolchain image guard in `scripts/__tests__/toolchain-dockerfile.guard.test.mjs`
  - **Scenarios covered:** US1-AC2, US4-AC4, FR-005, FR-017, [research R5 and R6](research.md).
  - **Asserts, on `.devcontainer/toolchain.Dockerfile`:**
    - The first `FROM` is `node:26-bookworm@sha256:<64 hex>`, and its major equals the `node-version` major in `.forgejo/workflows/guardrails.yml`.
    - `ARG SPECKIT_VERSION` equals `v` + `.specify/init-options.json` `speckit_version`.
    - `usermod -u 1100 node` and `useradd … -u "${USER_UID}"` with `USER_UID=1000` both appear **before** the first `rustup` line.
    - rustup uses `--profile minimal`.
    - `POWERSHELL_VERSION` is set, and `libicu72` is installed.
    - `COPY package.json scripts/install-pnpm.sh` is the last `COPY`, and the line after it runs `install-pnpm.sh`.
    - Absent, because the image holds no personal tools: `android`, `gradle`, `openwiki`, `cargo install`, `iptables`, `docker-compose` and `rtk`.
    - No `ENV` or `ARG` name matches `/TOKEN|SECRET|PASSWORD|API_KEY/`.
  - **Verify RED:** `node --test scripts/__tests__/toolchain-dockerfile.guard.test.mjs` → expected: all failing, with `ENOENT … toolchain.Dockerfile`.

- [x] T006 Create `.devcontainer/toolchain.Dockerfile`, a slim port of MCM's per research R5 and R6, keeping the reason comments for each layer. Add a header note that the image is built in CI or on a host engine with open egress, never inside the sandbox. This needs T005 verified RED. It follows [data-model.md, Toolchain image](data-model.md), "Must not contain".
  - **Verify GREEN:** `node --test scripts/__tests__/toolchain-dockerfile.guard.test.mjs` → 0 failures.

**Checkpoint:** the configuration and the image definition exist and are guarded.

---

## Phase 3: User Story 2 — Egress is denied by default, from one list (P1)

**Goal:** the canonical allowlist (MCM's minus the movie-metadata API, with neutral wording), its generator, its check in `scripts:lint`, and the start-time self-check.

**Independent test:** quickstart step 1, and T007 and T008. The policy is applied and probed live during the bring-up (T026, quickstart step 6).

### Tests (written first)

- [x] T007 [P] [US2] Write `scripts/__tests__/gen-egress-policy.test.mjs`
  - **Scenarios covered:** US2-AC2, US2-AC4, FR-007, FR-008, FR-009. Contract: [contracts/cli.md, gen-egress-policy](contracts/cli.md).
  - **Asserts, with `--file` fixtures in temp directories:**
    - `--check` exits 0 on a valid list.
    - `--check` exits 1 and names the index and domain for each of: an IP, a `host:port`, a URL, a `.ts.net` host, a duplicate domain, an unknown group, an empty reason and a non-boolean `cdnRotating`.
    - `--format sbx-policy` is ordered by group, then domain.
    - `--forge-host h.example.test` appends `allow network h.example.test`. No flag means no extra line. A quoted host exits 2.
    - The tool never writes a file: the directory listing is the same before and after.
    - **On the real `.devcontainer/egress-allowlist.json`:**
      - `--check` exits 0, and there are exactly 102 destinations.
      - `api.themoviedb.org` is absent from `destinations` and present in `$removedFromMcmBaseline`.
      - **Neutral wording:** no string value **anywhere in the file**, including `reason`, `$comment`, `$schemaNotes`, `$consideredAndExcluded` and `$mustNeverAppearHere`, matches `/\bmcm\b|mc-service|movie-mcp|web-api-mcp|spreadsheet-mcp|@mcm\/|\bBFF\b|movie[- ]assistant|\bfeature \d{3}\b|item #\d+|docs\/proposals\//i`.
  - **Verify RED:** `node --test scripts/__tests__/gen-egress-policy.test.mjs` → expected: all failing, with `Cannot find module … gen-egress-policy.mjs`.

- [x] T008 [P] [US2] Write `scripts/__tests__/assert-egress-governed.test.mjs`, using bash through `shell-probe.mjs`, with a stub `curl` on `PATH` whose behaviour is set by environment variable
  - **Scenarios covered:** US2-AC3, FR-010. Contract: [contracts/cli.md, assert-egress-governed](contracts/cli.md).
  - **Asserts:**
    - Blocked refused and allowed reached → exit 0 and `PASS`.
    - Blocked reachable → exit 1, naming the host.
    - Allowed unreachable → exit 1 with `severed rather than filtered`.
    - No `curl` → exit 1.
    - `EGRESS_BLOCKED_PROBE` and `EGRESS_ALLOWED_PROBE` override the defaults.
  - **Verify RED:** `node --test scripts/__tests__/assert-egress-governed.test.mjs` → expected: failing, because the T004 stub exits 0 without `PASS`.

### Implementation

- [x] T009 [US2] Create `scripts/gen-egress-policy.mjs`, ported from MCM's: the names, help text and default path are BELAY's, and its behaviour is per contracts/cli.md. This needs T007 verified RED.
  - Its `--check` enforces [data-model.md, Egress allowlist](data-model.md): the rules for `destinations[].domain`, `destinations[].group`, `destinations[].reason`, `destinations[].cdnRotating` (a boolean when present) and `destinations[]` (unique domains, at least one entry).

- [x] T010 [US2] Create `.devcontainer/egress-allowlist.json` from MCM's at `ab1f68ca`, per [research R8](research.md). This needs T007 verified RED.
  - Remove `api.themoviedb.org`, leaving 102 entries ([data-model.md](data-model.md), Egress allowlist, `destinations[]`).
  - Record the removal under `$removedFromMcmBaseline` (data-model.md, Egress allowlist, `$removedFromMcmBaseline`).
  - Reword every `reason` (data-model.md, Egress allowlist, `destinations[].reason`) and every note neutrally, keeping every measured fact, date, error string and host pair.
  - Keep each entry's `domain` and `group` unchanged (data-model.md, Egress allowlist, `destinations[].domain` and `destinations[].group`).
  - **Verify GREEN (T009 + T010):** `node --test scripts/__tests__/gen-egress-policy.test.mjs` → 0 failures. Then `node scripts/gen-egress-policy.mjs --format sbx-policy | wc -l` prints 102.

- [x] T011 [US2] Add `node scripts/gen-egress-policy.mjs --check` to the `lint` target in `scripts/project.json`.
  - **Done when:** `pnpm nx run scripts:lint` runs the check, and a deliberately malformed entry makes it fail. Revert the entry afterwards.

- [x] T012 [US2] Implement `.devcontainer/assert-egress-governed.sh`, ported from MCM with the neutral probe variable names. This needs T008 verified RED.
  - **Verify GREEN:** `node --test scripts/__tests__/assert-egress-governed.test.mjs` → 0 failures, with a skip count of 0.

**Checkpoint:** the allowlist, its generator and the self-check are ready to apply.

---

## Phase 4: User Story 4 — The image is built in CI and pinned by digest (P2; before US1 because the bring-up consumes the pin)

**Goal:**
- the `devcontainer-image` workflow publishes `belay-devcontainer` from the shared host runner, only when its inputs change, and never for pull-request code;
- a missing or undigested pin is reported at every `devcontainer up`;
- a local build is possible on a host engine with open egress.

**Independent test:** T021, a dispatched build publishing a digest that is then resolved from the registry, plus quickstart step 9.

### Tests (written first)

- [x] T013 [P] [US4] Port MCM's `scripts/__tests__/devcontainer-image-gate.test.mjs`, adapted to BELAY's paths
  - **Scenarios covered:** US4-AC1, US4-AC2, FR-018. Contract: [contracts/cli.md, devcontainer-image-gate](contracts/cli.md).
  - **Covers:**
    - a non-push event → `build=true`;
    - a zero or missing `before` → `build=true`;
    - each image input changed → `true`;
    - a `package.json` edit with `packageManager` unchanged → `false`;
    - `packageManager` moved → `true`;
    - an unresolvable diff → `true` (fail-safe).
  - **Verify RED:** `node --test scripts/__tests__/devcontainer-image-gate.test.mjs` → expected: all failing, with `Cannot find module … devcontainer-image-gate.mjs`.

- [x] T014 [P] [US4] Write `scripts/__tests__/devcontainer-image-workflow.guard.test.mjs`
  - **Scenarios covered:** US4-AC1, US4-AC2, FR-018, FR-020, [research R7](research.md).
  - **Asserts, on `.forgejo/workflows/devcontainer-image.yml`:**
    - The triggers are exactly `workflow_dispatch`, `push` and `schedule`. There is **no** `pull_request` and **no** `pull_request_target`.
    - The `push.paths` include `.devcontainer/toolchain.Dockerfile`, `.devcontainer/Dockerfile`, the workflow itself, `scripts/install-pnpm.sh`, `scripts/devcontainer-image-gate.mjs` and `package.json`.
    - The schedule is `0 6 * * 5`.
    - There is one job, `build-publish`, with `runs-on: kvm` and a `timeout-minutes`.
    - The image name is `belay-devcontainer`.
    - The push step writes a `…/belay-devcontainer@sha256` reference to `$GITHUB_STEP_SUMMARY` (FR-018, "report the published digest-pinned reference").
    - Every `run:` step goes through `scripts/ci-log-step.sh` except the failure digest.
    - The last step is the failure digest, with `if: always()` and `continue-on-error: true`.
    - The file contains no `mcm` substring.
  - **Verify RED:** `node --test scripts/__tests__/devcontainer-image-workflow.guard.test.mjs` → expected: all failing, with `ENOENT … devcontainer-image.yml`.

- [x] T015 [P] [US4] Write the tests for `scripts/build-devcontainer-image.mjs` in `scripts/__tests__/build-devcontainer-image.test.mjs`
  - **Scenarios covered:** FR-019 (the local build path). Contract: [contracts/cli.md, build-devcontainer-image](contracts/cli.md).
  - **Asserts:**
    - `--help` exits 0 and prints the usage, which says the command needs an engine with open egress.
    - An unknown argument exits 2.
    - `--tag` with no value exits 2.
    - With `PATH` set to a directory holding only a failing `docker` stub, it exits 2 with `docker not found`.
    - With a stub that records its arguments, it calls `build -f <root>/.devcontainer/toolchain.Dockerfile -t belay-devcontainer <root>`, or the `--tag` value.
  - **Verify RED:** `node --test scripts/__tests__/build-devcontainer-image.test.mjs` → expected: all failing, with `Cannot find module … build-devcontainer-image.mjs`.

- [x] T016 [P] [US4] Write `scripts/__tests__/check-image-pin.test.mjs`, using bash through `shell-probe.mjs`
  - **Scenarios covered:** US4-AC3, FR-019, and the edge case "the image pin is missing or unexported". Contract: [contracts/cli.md, check-image-pin](contracts/cli.md). Rule: [data-model.md, Sandbox environment file](data-model.md), `BELAY_DEVCONTAINER_IMAGE`.
  - **Asserts:**
    - A ref with `@sha256:<64 hex>` → `✓ pinned: sha256:…`, and the registry host is **not** printed.
    - Unset, empty, or `belay-devcontainer` (no digest) → a `⚠` warning naming `set -a` and the runbook.
    - The exit code is always 0.
  - **Verify RED:** `node --test scripts/__tests__/check-image-pin.test.mjs` → expected: failing, because the T004 stub prints nothing (`missing "pinned"`).

### Implementation

- [x] T017 [US4] Create `scripts/devcontainer-image-gate.mjs`, ported from MCM. It reuses the existing `scripts/lib/argv-contract.mjs` and `scripts/lib/is-main.mjs`. This needs T013 verified RED.
  - **Verify GREEN:** `node --test scripts/__tests__/devcontainer-image-gate.test.mjs` → 0 failures.

- [x] T018 [US4] Create `.forgejo/workflows/devcontainer-image.yml`, ported from MCM per [contracts/cli.md](contracts/cli.md) and research R7, with a header comment explaining the `kvm` exception and the no-PR rule. This needs T014 verified RED.
  - **Verify GREEN:** `node --test scripts/__tests__/devcontainer-image-workflow.guard.test.mjs` → 0 failures. Then `pnpm nx run scripts:lint` passes: the digest-coverage gate accepts the new workflow, and `guardrails-workflow.test.mjs` still pins `guardrails` to `belay`.

- [x] T019 [US4] Create `scripts/build-devcontainer-image.mjs`, ported from MCM with the default tag `belay-devcontainer` and the open-egress note in its usage, and add the Nx target `build-devcontainer-image` to `scripts/project.json`. This needs T015 verified RED.
  - **Verify GREEN:** `node --test scripts/__tests__/build-devcontainer-image.test.mjs` → 0 failures. Then `pnpm nx show project scripts` lists the target.

- [x] T020 [US4] Implement `.devcontainer/check-image-pin.sh` per contracts/cli.md. This needs T016 verified RED. It follows [data-model.md, Sandbox environment file](data-model.md), `BELAY_DEVCONTAINER_IMAGE`.
  - **Verify GREEN:** `node --test scripts/__tests__/check-image-pin.test.mjs` → 0 failures, with a skip count of 0. Then T003's guard still passes.

- [x] T021 [US4] **Operator:**
  1. Set the BELAY repository variables `REGISTRY`, `NS` and `REGISTRY_USER`, and the secret `REGISTRY_TOKEN` (`write:package`).
  2. Push the branch, and dispatch the workflow on it with `node scripts/forge-pr.mjs dispatch devcontainer-image.yml --ref 004-devcontainer-sandbox`.
  3. Resolve the digest from the registry's `manifests/<sha>` endpoint (research R7), and record the pinned reference for T026.
  - **Done when:** the run published `belay-devcontainer:<sha>`, and its digest resolves from the registry.

**Checkpoint:** an image pin exists before any sandbox does.

---

## Phase 5: User Story 1 — Open an isolated BELAY environment in one step (P1) 🎯 MVP

**Goal:** a container that comes up at `/workspaces/belay` with correct ownership, from the CI-pinned image, behind the policy, and a one-step launcher.

**Independent test:** from a stopped `belay` sandbox, `.\scripts\open-sandbox.ps1` lands VS Code in the container, where `pnpm nx run scripts:lint` and `scripts:test` pass (quickstart steps 4–5).

### Tests (written first)

- [x] T022 [P] [US1] Write the tests for `.devcontainer/fix-workspace-ownership.sh` in `scripts/__tests__/fix-workspace-ownership.test.mjs`, using bash through `shell-probe.mjs`
  - **Scenarios covered:** FR-003, the uid-mismatch edge case.
  - **Asserts:**
    - A temp tree owned by the current user prints `nothing to repair` and exits 0.
    - A missing workspace prints `nothing to do` and exits 0.
    - With no argument, the script's default path is `/workspaces/belay`, read from the script text.
    - It runs `git config --global --add safe.directory`, observed with a `HOME` pointing at a temp directory.
  - **Verify RED:** `node --test scripts/__tests__/fix-workspace-ownership.test.mjs` → expected: failing, because the T004 stub prints nothing (`missing "nothing to repair"`).

- [x] T023 [P] [US1] Write the static guard for `scripts/open-sandbox.ps1` in `scripts/__tests__/open-sandbox.guard.test.mjs`
  - **Scenarios covered:** US1-AC1, US1-AC3, US1-AC4, FR-021. Contract: [contracts/cli.md, open-sandbox.ps1](contracts/cli.md).
  - **Asserts:**
    - The parameter defaults are `belay`, `/workspaces/belay` and `/workspaces/belay/.devcontainer/devcontainer.json`.
    - The descriptor string keeps the key order `hostPath`, `localDocker`, `configFile.$mid`, `path`, `scheme`.
    - The URI uses `dev-container%2B` and `ssh-remote%2B`.
    - The SSH wait is deadline-based with `$deadlineSeconds = 120`.
    - The script uses `sbx run --name` and never contains `sbx start`.
    - It reads `sbx ls --format json`.
    - Every `& sbx` or `& ssh` call goes through `Invoke-Native`, so there is no bare native call outside that helper.
    - A `-PrintOnly` path exists.
    - The "sandbox does not exist" error names `docs/runbooks/devcontainer.md` (US1-AC4).
    - The file is saved with CRLF line endings.
  - **Verify RED:** `node --test scripts/__tests__/open-sandbox.guard.test.mjs` → expected: all failing, with `ENOENT … open-sandbox.ps1`.

### Implementation

- [x] T024 [US1] Implement `.devcontainer/fix-workspace-ownership.sh`, ported from MCM with the default `${BELAY_WORKSPACE:-/workspaces/belay}`. This needs T022 verified RED.
  - **Verify GREEN:** `node --test scripts/__tests__/fix-workspace-ownership.test.mjs` → 0 failures, with a skip count of 0 on a host with bash.

- [x] T025 [US1] Create `scripts/open-sandbox.ps1`, ported from MCM with BELAY defaults and saved with CRLF line endings. This needs T023 verified RED.
  - **Verify GREEN:** `node --test scripts/__tests__/open-sandbox.guard.test.mjs` → 0 failures.

- [x] T026 [US1] **Operator:** bring the sandbox up from nothing (quickstart steps 2, 3, 5 and 6, without the dotfiles yet).
  1. **Create the sandbox:** `sbx create --name belay -m 8g --skills=off shell <empty dir>`.
  2. **Apply the policy immediately**, from T009 and T010: `node scripts/gen-egress-policy.mjs --format sbx-policy --forge-host <forge host>`, then `sbx policy allow network <d> --sandbox belay` for each line. Run `sbx policy ls belay`; the count must be 103. Dismiss anything in `sbx policy approval ls`; never approve it.
  3. **Provision the VM:** install the devcontainer CLI, add the forge registry as an insecure registry and restart with `sbx stop belay`, run `ldconfig`, and set the git identity and the credential store.
  4. **Write `~/.belay-sandbox-env`** per [data-model.md, Sandbox environment file](data-model.md): `KEY='value'` lines with no `export`, mode 600, no `ANTHROPIC_API_KEY` line, and the pin from T021.
  5. **Clone** into `/workspaces/belay` and check out this branch.
  6. **Build the container:** `set -a; . ~/.belay-sandbox-env; set +a`, then `devcontainer up … 2>&1 | tee ~/devcontainer-up.log`.
  7. **Commit** the generated `.devcontainer/devcontainer-lock.json`.
  - **Done when:**
    - `check-image-pin.sh` printed `✓ pinned`, and the build pulled the image without compiling the toolchain;
    - inside the container, `pnpm nx run scripts:lint` and `scripts:test` pass (SC-002), and `pwsh -File .specify/scripts/powershell/check-prerequisites.ps1 -Json -PathsOnly` returns JSON;
    - `docker run --rm busybox sh -c "sleep 3; echo engine-seam-ok"` prints `engine-seam-ok`. That proves no output is truncated (FR-006);
    - `postStart` printed `[assert-egress-governed] PASS`, and quickstart step 6 shows 0 of 5 blocked hosts reachable and 5 of 5 allowed hosts reachable (SC-003, US2);
    - `stat -c %a ~/.belay-sandbox-env` prints `600`, and `grep -c ANTHROPIC_API_KEY ~/.belay-sandbox-env` prints `0`;
    - the lock file is committed.

- [x] T027 [US1] **Operator:** check the launcher (quickstart step 4).
  - **Done when:**
    - after `sbx stop belay`, `.\scripts\open-sandbox.ps1` lands VS Code in `/workspaces/belay` inside the container within 3 minutes (SC-001);
    - `-PrintOnly` prints the `vscode-remote://dev-container%2B…@ssh-remote%2Bbelay.sbx/workspaces/belay` URI;
    - the container was back without any manual start, which proves the restart policy after an idle-stop (FR-004).

**Checkpoint:** US1 works. This is the MVP.

---

## Phase 6: User Story 3 — Credentials stay out, and logins survive (P2)

**Goal:** the out-of-band credential file, persistent Claude config, an RTK hook that is actually wired, and the personal layer with a generalised guard.

**Independent test:** quickstart steps 7–8.

### Tests (written first)

- [x] T028 [P] [US3] Write `scripts/__tests__/gen-container-secrets-env.test.mjs`, using bash through `shell-probe.mjs`
  - **Scenarios covered:** US3-AC1, US3-AC2, US3-AC5, FR-011, FR-012, FR-013. Contract: [contracts/cli.md, gen-container-secrets-env](contracts/cli.md).
  - **Asserts, using a temp source file holding `FORGE_TOKEN='a b'`, `FORGE_ISSUE_TOKEN` with an embedded newline, and `ANTHROPIC_API_KEY='x'`:**
    - The output contains `FORGE_TOKEN=a b`, with no quotes.
    - `FORGE_ISSUE_TOKEN` is skipped with a message naming it.
    - `ANTHROPIC_API_KEY` is never written.
    - The output file has mode `600`.
    - stdout and stderr never contain either value.
    - A missing source file gives an empty output file and exit 0.
    - The exit code is always 0.
  - **Verify RED:** `node --test scripts/__tests__/gen-container-secrets-env.test.mjs` → expected: failing (`missing FORGE_TOKEN=a b`).

- [x] T029 [P] [US3] Write `scripts/__tests__/persist-claude-config.test.mjs`, using bash through `shell-probe.mjs`
  - **Scenarios covered:** US3-AC3, FR-014.
  - **Asserts, in a temp `HOME` with `CLAUDE_CONFIG_DIR` set:**
    - With no `$CLAUDE_CONFIG_DIR` directory → exit 0 and no file is created.
    - The target already valid → no change.
    - A legacy `~/.claude.json` is copied, not moved, onto the target.
    - With no legacy file, the newest **parseable** `backups/.claude.json.backup.*` is restored and an unparseable newer one is skipped.
    - No symlink is ever created.
  - **Verify RED:** `node --test scripts/__tests__/persist-claude-config.test.mjs` → expected: failing (`target not created`).

- [x] T030 [P] [US3] Write `scripts/__tests__/ensure-rtk-hook.test.mjs`, using bash and node
  - **Scenarios covered:** US3-AC4, FR-016.
  - **Asserts:**
    - With no `~/.claude/tools/bin/rtk` → exit 0 and `settings.json` is untouched. The message names the BELAY `devcontainer up` command with `--dotfiles-repository`.
    - With a stub `rtk` binary, it adds one `PreToolUse` `Bash` entry running `rtk hook claude`, and a second run adds nothing.
    - Invalid JSON in `settings.json` is not overwritten.
    - `settings.json.pre-rtk-hook.bak` is created before the first write.
  - **Verify RED:** `node --test scripts/__tests__/ensure-rtk-hook.test.mjs` → expected: failing (`hook not wired`).

### Implementation

- [x] T031 [US3] Implement `.devcontainer/gen-container-secrets-env.sh`, ported from MCM, per [data-model.md, Container secrets file](data-model.md): bare `KEY=value` lines, only `FORGE_TOKEN` and `FORGE_ISSUE_TOKEN`, a newline-bearing value skipped, mode 600, rewritten from empty. It reads its source per [data-model.md, Sandbox environment file](data-model.md), uses the `BELAY_*` path variables and prints names and lengths only. This needs T028 verified RED.
  - **Verify GREEN:** `node --test scripts/__tests__/gen-container-secrets-env.test.mjs` → 0 failures, with a skip count of 0.

- [x] T032 [US3] Implement `.devcontainer/persist-claude-config.sh`, ported from MCM with the volume named `belay-claude` in its messages ([data-model.md, Persistent volumes](data-model.md)). This needs T029 verified RED.
  - **Verify GREEN:** `node --test scripts/__tests__/persist-claude-config.test.mjs` → 0 failures.

- [x] T033 [US3] Implement `.devcontainer/ensure-rtk-hook.sh`, ported from MCM with BELAY's install message. This needs T030 verified RED.
  - **Verify GREEN:** `node --test scripts/__tests__/ensure-rtk-hook.test.mjs` → 0 failures.

- [x] T034 [US3] **External, needs the maintainer's approval:** generalise the guard in `jumbleknot/mcm-dotfiles` `install.sh` so it proceeds when `MCM_DEVCONTAINER=1` **or** `DEVCONTAINER_PERSONAL_LAYER=1` is set ([data-model.md, Markers](data-model.md)), and still logs and exits 0 otherwise. Update the README to match. Prepare the change in a scratch clone and show the diff to the maintainer. Push only after they approve it.
  - **Done when:**
    - the pushed commit is on `master` (the default branch) of `mcm-dotfiles`: `4d0e130`;
    - `bash install.sh` with neither variable set prints the skip line and exits 0, observed in a scratch `HOME`;
    - MCM's next recreate is unaffected, because its marker still works.

- [x] T035 [US3] **Operator:** recreate the `belay` container, with `--dotfiles-repository https://github.com/jumbleknot/mcm-dotfiles` and the output captured to `~/devcontainer-up.log`. Then log in to Claude Code and `gh` once.
  - **Done when:**
    - quickstart step 7 finds 0 occurrences of each token value in the image history, the image config, the container's process list **and** `~/devcontainer-up.log` (SC-004);
    - `ANTHROPIC_API_KEY` is absent in the container, and `ci-status.mjs status --branch main` works;
    - after a second `--remove-existing-container` recreate, step 8 shows no re-login, `rtk hook` is wired and `rtk gain` reports compression (SC-005);
    - that recreate rebuilt 0 toolchain layers and finished in under 10 minutes (SC-006).

**Checkpoint:** credentials, persistence and the pinned recreate are proven.

---

## Phase 7: User Story 5 — The environment is documented end to end (P3)

**Goal:** the runbook replaces the "planned" note, and the wiki and index follow it.

- [x] T036 [US5] Rewrite `docs/runbooks/devcontainer.md` from "planned" to the procedure measured in T021, T026, T027 and T035, covering FR-022:
  - prerequisites;
  - bring-up from nothing (create, policy, VM provisioning, the env file, clone, up, dotfiles);
  - the one-step launcher;
  - building the image in CI or on an open-egress host, never in the sandbox;
  - recreate and re-pin, including the manifest-digest recipe, the `check-image-pin.sh` warning, and the "re-pin before recreate" retention warning that points to item #32;
  - sandbox recreate and resize;
  - the `sbx` upgrade ritual;
  - the idle-stop, and the false "daemon failed to start" failure;
  - the approval-queue rule;
  - credentials, including the VS Code-forwarded git credential limit from research R4;
  - the measured traps;
  - the existing worktree section, with its heading **"Shared dev container: commit from a worktree" kept verbatim** (the `AGENTS.md:9` anchor depends on it).

  Remove the *To write* sections.
  - **Done when:** the status note is gone, every FR-022 topic has a section, and `git grep -n "To write" docs/runbooks/devcontainer.md` is empty.

- [x] T037 [US5] Refresh `openwiki/runbooks/devcontainer.md` against the rewritten runbook: the title, description, summary and gotchas, and the `timestamp`. Update its description in `openwiki/runbooks/index.md`, and the `AGENTS.md` knowledge-index entry for it (drop "planned").
  - **Done when:** no "planned" wording remains in the three files, and the ad-hoc wiki checker (or the OKF gate, once item #28 lands) reports no dead links or mismatched descriptions.

---

## Phase 8: Polish & cross-cutting concerns

- [x] T038 [P] Update `docs/runbooks/ci.md`:
  - add the allowlist check to the `scripts:lint` list (line 25);
  - add a "devcontainer-image" section covering triggers, the gate, the variables and secret, the digest recipe and the failure digest;
  - amend "Runner" (lines 74–75) with the `kvm` exception and its no-pull-request rule.
  - **Done when:** these three changes are made.

- [x] T039 [P] Refresh `openwiki/runbooks/ci.md` against the changed `docs/runbooks/ci.md`: the runner gotcha now names the image-job exception.
  - **Done when:** the summary matches the runbook.

- [x] T040 [P] Update `openwiki/invariants/nx-task-runner.md` (the `scripts:lint` row and the new `scripts:build-devcontainer-image` target, noting its open-egress requirement) and `openwiki/invariants/testing-tiers.md` (the Gates row now includes the allowlist check).
  - **Done when:** both tables match `scripts/project.json`.

- [x] T041 [P] Add `.devcontainer/` to the layout table in `openwiki/projects/repository.md`, and a dev-container pointer to `README.md` (Development).
  - **Done when:** both name `docs/runbooks/devcontainer.md`.

- [x] T042 **Close-out re-search:** re-run T001's searches for the old identifiers (`planned, not built`, `To write`, and the runner rule's old wording). Every remaining hit in a document that states current procedure is fixed or justified here.
  - Run 2026-11-23 over `*.md` outside `specs/`, `docs/proposals/` and `docs/decisions/`, for `planned, not built`, `To write`, `planned; the worktree rule`, `The planned shared dev container`, `BELAY's CI is one`, `The runner is BELAY's own.`, `is planned`, `not built yet`. One hit: `openwiki/runbooks/ci.md:12` ("BELAY's CI is one workflow") → fixed to name the image workflow. No other hits.

- [x] T043 **SC-007, from nothing, by the runbook alone.**
  1. Back up per the runbook.
  2. Run `sbx rm belay --force`.
  3. Bring the environment up again following **only** `docs/runbooks/devcontainer.md` (T036), without this tasks list, the quickstart or MCM. Record every place the runbook was insufficient, and fix it in the runbook.
  4. Then run quickstart steps 1 and 4 to 9 against the result.
  - **Done when:** the runbook alone reached a passing `scripts:lint` and `scripts:test`, every gap found is fixed in the runbook, and each quickstart step's expected result holds.
  - Run 2026-11-23 in a throwaway `belay-verify` sandbox, as the maintainer chose (it keeps the working `belay` and its logins; step 8, the logins, is not needed for lint and test). Following only the runbook: 103 rules over default-deny, the Node block verbatim, the image pulled by digest, `devcontainer up` with the dotfiles in 409 s, then lint passes and 668/668 tests pass with 0 skipped. Two gaps were found and fixed in the runbook: steps 4 and 5 had no exact commands for moving the credential and the tokens into the VM over stdin, and the kit has no `/etc/docker`. `belay-verify` was then removed.

- [x] T044 Final validation checklist: `pnpm nx run scripts:lint`, `pnpm nx run scripts:test` (with a skip count you can explain), `node scripts/check-speckit-overrides.mjs`, the secret scan, the ad-hoc wiki checker, and `rtk gain` last.
  - **Done when:** all of them pass.

- [x] T045 **Open the PR** from a real branch, with the repository's PR tools (`docs/runbooks/ci.md`):
  1. `git push origin HEAD:004-devcontainer-sandbox`
  2. `node scripts/forge-pr.mjs open --head 004-devcontainer-sandbox --title "…" --body-file <file>`
  3. `node scripts/ci-status.mjs watch --pr <n>`, until it exits 0
  4. `node scripts/forge-pr.mjs merge <n> --expect-head <full sha>`

  Tick this task in the branch's LAST commit and quote the branch and the PR number. **CI evidence is never recorded here.** The run ids, the CI verdict and the merge sha go in the PR's closing comment.
  - Branch `004-devcontainer-sandbox`; the PR number is in its title commit message and the closing comment.

---

## Dependencies & execution order

- **Setup (T001–T002)** → **Foundational (T003–T006)**, which blocks every story.
- **US2 (T007–T012)** and **US4 (T013–T021)** can be developed in parallel once Foundational is done. Both must finish before the sandbox bring-up:
  - T026 needs the generator and allowlist (T009, T010), and the CI pin (T021);
  - T021 needs the toolchain image definition (T006) and the workflow (T018).
- **US1 (T022–T027):** its code tasks (T022–T025) need only Foundational. Its operator tasks (T026, T027) need US2 and US4.
- **US3 (T028–T035):** its code tasks need only Foundational. T035 needs T026 and T034's approval.
- **US5 (T036–T037)** comes after T026, T027 and T035, because it documents the measured procedure.
- **Polish (T038–T045)** comes last. T043 needs T036. T045 is the final commit.

**Within each story:** a test task must be verified RED before its implementation, and the implementation is then verified GREEN with the same command.

## Parallel opportunities

- T003, T005, T007, T008, T013, T014, T015, T016, T022, T023, T028, T029 and T030 are all new test files with no shared state, so they can be written in parallel.
- After Foundational, the code tasks of US2, US4, US1 and US3 touch different files.
- T038 to T041 touch different docs.

```text
# Example: write the US4 tests together
T013 devcontainer-image-gate.test.mjs
T014 devcontainer-image-workflow.guard.test.mjs
T015 build-devcontainer-image.test.mjs
T016 check-image-pin.test.mjs
```

## Implementation strategy

1. **Foundation:** Setup and Foundational, giving the guarded configuration and the image definition.
2. **What the bring-up needs:** US2 (the allowlist, generator and self-check) and US4 (the CI-published pin, the pin check, and the local build for open-egress hosts).
3. **MVP:** US1. Bring the sandbox up behind the policy from the CI pin, then prove the launcher (quickstart steps 2–6).
4. **Add US3:** credentials, persistence and the personal layer. T034 waits for the maintainer.
5. **Add US5 and Polish,** including the from-nothing run that follows only the runbook (T043). Then open the PR.

## Completion checklist

Before marking `004-devcontainer-sandbox` complete, verify every success criterion from [spec.md](spec.md):

- [ ] **SC-001**: from a stopped sandbox, one command reaches the container within 3 minutes, with no manual step (T027)
- [ ] **SC-002**: `scripts:lint` and `scripts:test` pass in the container, with the same result as CI (T026)
- [ ] **SC-003**: 0 of 5 blocked hosts reachable, and 5 of 5 allowed hosts reachable (T026)
- [ ] **SC-004**: 0 credential values in the image, the configuration, the process list and the build output (T035)
- [ ] **SC-005**: 0 re-logins after a recreate, with RTK active (T035)
- [ ] **SC-006**: a pinned recreate rebuilds 0 toolchain layers, in under 10 minutes (T035)
- [ ] **SC-007**: the runbook alone gets from nothing to a passing run (T043)
- [ ] Platform parity: N/A. This is a toolchain and environment feature, not a UI flow.
- [ ] Every test task used the TDD checkpoint format, with Verify RED confirmed before implementation
- [ ] `pnpm nx run scripts:lint`: every gate and selftest passes, including the allowlist check
- [ ] `pnpm nx run scripts:test`: every script test passes, and the skip count is explained
- [ ] Wiki pages whose `resource` changed are refreshed in this PR (T037, T039)
- [ ] `rtk gain`: compression confirmed. Run it last.
