# Feature Specification: SAST stage 2/3 toolchain preparation, and per-step durations on every run

**Feature Branch**: `008-sast-stage-prep-step-durations`

**Created**: 2026-11-23

**Status**: Draft

**Input**: The maintainer, 2026-11-23, after feature 007: "a sast step that installs cargo-audit, or
runs uv sync, only when a tracked lockfile exists, plus a guard test" and "record each step's
duration on every run".

## Context

**Stages 2 and 3** (items #39 and #40) wait for the first Rust crate and the first Python project.
Today enabling `cargo-audit` or `pip-audit` with nothing to audit fails the required `sast` job by
design. So the first crate's or project's PR would have to design and land a toolchain install
under time pressure. This feature lands those installs **now, dormant**: each runs only when its
lockfile is tracked, so today's runs are unchanged.

**Step durations** (item #41's trigger). `ci-log-step.sh` already records every wrapped step's
duration on every run, but the file reaches the forge only inside a **failure** bundle. `sast` has
never failed, so `ci-status durations --job sast` has no sample, and item #41's trigger ("installs
dominate the job's time") cannot be measured from real runs.

## Clarifications

Session 2026-11-23 (maintainer):
- **Q: How does the Rust toolchain arrive on the runner?** → A version-pinned `rustup-init` binary,
  sha256-verified before it runs (never `curl | sh`), installing a pinned minimal toolchain equal to
  the dev-container image's. cargo-audit is the prebuilt, sha256-pinned release binary, never
  compiled in the job.
- **Q: Add `static.rust-lang.org` to the dev container's egress allowlist?** → No. It stays under
  `$consideredAndExcluded` (installing vendor binaries mid-session is a different trust decision).
  The dev container's baked Rust is used to test locally; the download itself is verified on the
  runner.
- **Q: Trigger?** → A **tracked** lockfile, discovered exactly as the scanners discover them
  (`*Cargo.lock` anywhere; `uv.lock` under the project directories).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The first Rust crate is audited without a toolchain change (Priority: P1)

A contributor adds the first Rust crate (a tracked `Cargo.lock`). The `sast` job installs a pinned,
verified Rust toolchain and cargo-audit, and the scan audits the crate.

**Independent Test**: on a branch with a tracked `Cargo.lock` and `cargo-audit` enabled, the `sast`
job installs both and the scan reports `cargo-audit` as run.

**Acceptance Scenarios**:

1. **Given** no tracked `Cargo.lock`, **When** the job runs, **Then** the step installs nothing and
   says why, and exits 0.
2. **Given** a tracked `Cargo.lock`, **Then** the step downloads the pinned `rustup-init` and
   cargo-audit, verifies each sha256 before use, installs a minimal pinned toolchain, and puts both on
   `PATH` for later steps.
3. **Given** a download whose sha256 differs from the pin, **Then** the step fails, naming the file
   and both digests, and runs nothing it downloaded.

---

### User Story 2 - The first Python project is audited without a toolchain change (Priority: P1)

A contributor adds the first Python project (a tracked `uv.lock` under a project directory). The
job runs `uv sync --frozen` in each such project before the scan.

**Acceptance Scenarios**:

1. **Given** no tracked `uv.lock` under a project directory, **Then** nothing is synced and the step
   says why, and exits 0.
2. **Given** tracked projects, **Then** each is synced with `uv sync --frozen`; one failing sync fails
   the step (a project is never skipped).

---

### User Story 3 - The prepared steps cannot silently rot (Priority: P1)

**Acceptance Scenarios**:

1. A guard test fails if either step is removed, moves after the scan, stops running through
   `ci-log-step.sh`, or moves before the uv install.
2. A guard test fails if the job's Rust toolchain pin differs from the dev-container image's.
3. A guard test fails when a `Cargo.lock` is tracked but `cargo-audit` is not enabled in
   `security/sast/scan.yaml`, and likewise for `uv.lock` and `pip-audit`. A lockfile that would be
   installed for and then not audited is the gap this closes.

---

### User Story 4 - Every green job's step durations are readable (Priority: P1)

**Acceptance Scenarios**:

1. **Given** a job that passed and has no e2e counts sources, **When** the digest step runs, **Then**
   it publishes the job's `step-durations.tsv`, and nothing else, as the run's version in the bundle
   package, then prunes expired versions.
2. **Given** a job that passed with no durations file, **Then** nothing is published, as today.
3. **Given** a cancelled run, or an unknown job status, **Then** nothing is published, as today.
4. **Given** a publication failure, **Then** the job's result is unchanged (exit 0).
5. `ci-status durations --job sast` lists per-step timings from green runs.

### Edge Cases

- A durations-only version holds no `bundle.json.gz`. `ci-status failure` fetches a bundle only for a
  failed job, so it never reads one; if it did, the absent bundle reads as "no bundle", never as a
  failure.
- A step with no calibrated ceiling still records its duration (the ceiling column is empty).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The `sast` job MUST install the Rust toolchain and cargo-audit only when a `Cargo.lock`
  is tracked, discovered with the same pathspec the cargo-audit scanner uses.
- **FR-002**: Every downloaded binary MUST be verified against a committed sha256 before it runs.
  No installer is piped into a shell.
- **FR-003**: The Rust toolchain pin MUST equal the dev-container image's; a guard enforces it.
- **FR-004**: The `sast` job MUST `uv sync --frozen` every tracked Python project the pip-audit
  scanner would audit, and only when one exists; any failure fails the step.
- **FR-005**: Both steps MUST run through `ci-log-step.sh`, after uv is installed and before the scan.
- **FR-006**: A tracked lockfile whose scanner is not enabled MUST fail `scripts:test`.
- **FR-007**: A passing job with a durations file and no counts sources MUST publish the durations
  file alone, using the purpose-scoped credential, then prune expired versions.
- **FR-008**: Durations publication MUST NOT change a job's result, and MUST NOT publish for a
  cancelled run or an unknown status.
- **FR-009**: The pins MUST have one source: the prepare script's constants.

## Success Criteria *(mandatory)*

- **SC-001**: On today's tree the `sast` job's two new steps exit 0 having installed nothing.
- **SC-002**: A dispatched run of a throwaway branch carrying a tiny tracked Rust crate and Python
  project, with both scanners enabled, installs both toolchains on the runner and the scan reports
  `cargo-audit` and `pip-audit` as run.
- **SC-003**: After this merges, `ci-status durations --job sast` and `--job guardrails` show
  samples from green runs.
- **SC-004**: `scripts:lint` and `scripts:test` pass with 0 skipped.

## Assumptions

- The `belay` runner has open egress to `static.rust-lang.org`, GitHub release assets, crates.io and
  PyPI (MCM's runner installs from all of them). SC-002 verifies it.
- The runner image (`node:26-bookworm`) is x86_64 Linux with glibc, `tar` and `sha256sum`.
- Stage 2 and 3 themselves (enabling the scanners, the real-run scope checks) remain items #39 and
  #40.
