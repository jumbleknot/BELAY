# Research: SAST stage prep and step durations

## R1 — The Rust toolchain: a pinned, verified `rustup-init` {#r1}

- **Decision**: download
  `https://static.rust-lang.org/rustup/archive/1.29.3/x86_64-unknown-linux-gnu/rustup-init`, verify
  its sha256 against the committed pin, then run it with
  `-y --profile minimal --default-toolchain 1.100.0 --no-modify-path`. `$HOME/.cargo/bin` is appended
  to `$GITHUB_PATH`.
- **Why not `sh.rustup.rs | sh`** (MCM's, and the dev-container image's): the `belay-ci-curl-pipe-shell`
  rule accepts only uv's pinned installer, and a piped script cannot be pinned by digest. The rule's
  "sh.rustup.rs arrives with stage 2" note is updated to say it did not.
- **Why a toolchain at all**: the ported cargo-audit scanner calls `cargo` itself (`assertToolchain('cargo')`,
  `cargo audit …`, and `cargo tree --edges no-dev` for runtime-vs-dev scope). The prebuilt cargo-audit
  alone cannot run it.
- **The toolchain pin**: 1.100.0, the dev-container image's (`.devcontainer/toolchain.Dockerfile`,
  `--default-toolchain 1.100.0`). A guard keeps the two equal (FR-003).
- **The rustup-init sha256 — how it was obtained, and its limit**:
  `b1c8cb14e30889e7e2999e6b69e62d9e9b9ffc0f4df8180564d306d9680e6c55`. The published `.sha256` could not
  be read: `static.rust-lang.org` is excluded from the dev container's egress (maintainer, 2026-11-23:
  keep it excluded), and the web-fetch tool could not resolve it either. rustup GitHub releases carry
  no binaries. The value is the sha256 of the dev container's `~/.cargo/bin/rustup`, which
  `rustup-init` installs by copying itself, and `rustup --version` reports 1.29.3. **This is derived,
  not published.** It is verified on the runner by SC-002; if it is wrong, the step fails closed,
  naming both digests, which is the safe direction.

## R2 — cargo-audit: the prebuilt release binary {#r2}

- **Decision**: `cargo-audit-x86_64-unknown-linux-musl-v0.23.0.tgz` from the rustsec/rustsec GitHub
  release `cargo-audit/v0.23.0`, sha256
  `4f01c74ed84b2dffd0b1d37012a62cdf2a92c96e25bdf8eec7fcc0d4d3eb7811`.
- **Evidence** (2026-11-23): the digest is the one GitHub's release API publishes for the asset; the
  downloaded file hashed to the same value; the archive holds
  `cargo-audit-x86_64-unknown-linux-musl-v0.23.0/cargo-audit`, a static x86-64 ELF reporting
  `cargo-audit-audit 0.23.0`.
- **Version**: 0.23.0 is MCM's pin (`cargo install … --version 0.23.0`). musl, so it does not depend
  on the runner's glibc.

## R3 — One script, two subcommands, injected effects {#r3}

- **Decision**: `scripts/sast-prepare.mjs rust|python`. Discovery reuses the scanners' own functions:
  `trackedFiles(['*Cargo.lock'])` (now exported from `sast-scan.mjs`, a one-word change; same pathspec
  as `cargoAuditSet`) and `discoverPythonProjects().locked`. Downloads use Node's `fetch`; extraction
  `tar`; every effect goes through an injected `{ fetchBytes, exec, appendPath, log }` so tests run
  with no network.
- **Pins** live as exported constants in the script (FR-009). The workflow carries none.
- **Python**: `uv sync --frozen` in each locked project, in order; the first failure fails the step.
  Unlocked `pyproject.toml` projects are not synced; the scan already fails on them (feature 006).

## R4 — Ordering in the `sast` job {#r4}

- After "Install uv" (Python needs it) and before "Install workspace dependencies"; both prepare steps
  sit together so a reader sees the stage-2/3 toolchains in one place. Each runs through
  `ci-log-step.sh` (`sast-prepare-rust`, `sast-prepare-python`).

## R5 — Scanner-enable consistency guard {#r5}

- **Decision**: a test reads `git ls-files` and `security/sast/scan.yaml`: a tracked `Cargo.lock`
  requires `cargo-audit` enabled; a tracked `uv.lock` under a project directory requires `pip-audit`.
- **Why**: without it, the first crate's PR would install a toolchain and then audit nothing, green.
  The reverse (enabled, no lockfile) already fails the scan.

## R6 — Durations on every green run {#r6}

- **Decision**: in the digest's `counts` mode, when a job has no e2e counts sources but has a
  durations file, publish **only** `step-durations.tsv` as the version `<run>--<job>`, then prune
  expired versions. A pure `countsPublication({ sources, durations })` returns `bundle`,
  `durations-only` or `nothing`.
- **Cost**: one version of a few hundred bytes per green job per run, pruned at `RETENTION_DAYS` (30)
  on every publish, exactly as counts versions are (test mm7). The `registry-retention.yaml` floor
  (25 runs × 4 publishing jobs = 100) is unchanged: the same four jobs publish.
- **Guard updated at the cause**: test mm5 asserted that a non-e2e green job publishes nothing. It now
  asserts that it publishes the durations file and nothing else, and nothing when there is no file.
- **Readers**: `ci-status durations` reads `step-durations.tsv` per version already; `ci-status
  failure` fetches `bundle.json.gz` only for a failed job.

## R7 — Verification on the runner (SC-002) {#r7}

- **Decision**: a throwaway branch on top of this one adds a minimal Rust crate (`tools/sast-probe-rs`,
  one `serde` dependency) and Python project (`tools/sast-probe-py`, one `requests` dependency), both
  locked, and enables both scanners. Dispatch `guardrails.yml` on it with `forge-pr.mjs dispatch`, read
  the result from `/actions/tasks`, and delete the branch. It is never opened as a PR.
- **Result** (2026-11-23):
  - **Local (T012)**, dev container, baked cargo 1.100.0 plus the downloaded cargo-audit: `sast-prepare
    python` synced the probe project. The full scan ran `cargo-audit` (1 finding, `time@0.3.20`
    correctly scoped `dev`, the probe's dev-dependency) and `pip-audit` (with `requests==2.31.0`, its
    advisories blocked as runtime; with `requests>=2.32.5`, 0 findings, gate passed). `sast-prepare rust`
    failed closed naming `static.rust-lang.org … ENOTFOUND`, as expected behind the egress policy.
  - **Runner (SC-002)**: `guardrails.yml` dispatched on throwaway branch `008-probe` (`3abd7c8`), run
    8262. `sast` succeeded. Its published durations: `sast-prepare-rust` 9 s exit 0 (so the derived
    `rustup-init` sha256 matched what the runner downloaded, and Rust 1.100.0 and cargo-audit installed),
    `sast-prepare-python` 0 s, `sast-static-scan` 14 s exit 0 with both scanners enabled. `guardrails`
    failed on one test only: `sast-scan.guard.test.mjs`'s "--only naming a scanner the committed config
    does not enable" instrument check, which needs one scanner left disabled. A probe artifact (it
    enabled all four); the stage that enables the fourth scanner must rework that test. Branch deleted.
  - The same run proved US4 on a real green job: `ci-status durations --job sast` sampled run 8262.
