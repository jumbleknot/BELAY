# Research: SAST and SCA gate, stage 1

Baseline: MCM `main` at `fc2b953`: `specs/033-sast-semgrep/` (spec, research, data model,
contracts), `scripts/sast-scan.mjs`, `scripts/check-sast-findings.mjs`, `scripts/allowlist-expiry.mjs`,
`scripts/lib/scanner-retry.mjs`, `security/sast/`, and the `sast` job in `.forgejo/workflows/guardrails.yml`.

## R1 — Port all four scanners; enable two {#r1}

- **Decision**: port the orchestrator with all four scanner implementations unchanged, and add a
  committed enabled-scanner list (`security/sast/scan.yaml`: `scanners: [semgrep, pnpm-audit]`). A
  scanner not on the list is skipped and reported as `not enabled` (never `clean`). `--only` can
  still narrow the list, but can never add a scanner the config does not enable.
- **Rationale**: the issue asked that stage 2 and 3 be a list entry plus a toolchain step (FR-022).
  Deleting the cargo and pip code now would mean re-porting it later, and their MCM tests keep
  them honest in the meantime.
- **Alternatives**: port only Semgrep and pnpm audit. Rejected: stage 2/3 would be a second port.

## R2 — Separate `sast` job in `guardrails.yml`, as in MCM {#r2}

- **Decision**: one job, `sast`, in `guardrails.yml`, `runs-on: belay`, `timeout-minutes: 15`.
  Steps:
  1. checkout with `fetch-depth: 0`;
  2. setup-node (same SHA and version as guardrails), then install pnpm;
  3. fetch the PR base ref;
  4. install uv from its pinned installer URL;
  5. frozen install;
  6. run the gate's selftest, then the custom-rule fixtures;
  7. scan: changed-scope on PRs, full on push;
  8. run the gate;
  9. upload the reports (`actions/upload-artifact`, MCM's pinned SHA);
  10. the failure digest.
- **Not ported**: the apt build dependencies and the Rust and cargo-audit step (stage 2), and the
  Python env syncs (stage 3).
- **Context name**: `guardrails / sast`. Making it required is the maintainer's branch-protection step
  after the first green run.

## R3 — Custom rules {#r3}

| MCM rule | BELAY | Why |
|---|---|---|
| `mcm-ci-curl-pipe-shell` | **port** as `belay-ci-curl-pipe-shell` | Generic workflow invariant. The accepted-URL list keeps only uv's pinned installer, and drops rustup and Maestro until those stages |
| `mcm-no-token-logging` | **port** as `belay-no-token-logging` | The constitution: logs never contain tokens, secrets or PII |
| `mcm-no-jwt-payload-tracing` | **port** as `belay-no-jwt-payload-tracing` | The same constitutional rule, for traces |
| `mcm-no-console-in-bff` | **defer** | Bound to MCM's BFF path; BELAY's equivalent (no direct stdout in services) needs BELAY's first service layout |
| `mcm-auth-before-authz` | **defer** | Bound to MCM's `createMcServiceClient` API |

Each ported rule keeps its fixtures, which are renamed. A rule's paths, if any, are rewritten to
BELAY's layout.

## R4 — Semgrep packs {#r4}

- **Decision**: keep MCM's five packs (`p/typescript`, `p/react`, `p/nodejs`, `p/python`,
  `p/owasp-top-ten`). A pack with no matching files costs a registry fetch and nothing else, and it is
  in place before the surface arrives (feature 005's rule). `p/secrets` stays absent (FR-006).

## R5 — Seeding the allowlist {#r5}

- **Decision**: run a full scan on the branch, and add one entry per **blocking** finding present,
  each with a justification written after reading the finding (false positive, or accepted risk and
  why). Non-blocking findings need no entry. If a finding is a real defect that is cheap to fix,
  fix it instead of allowlisting it.
- **Note**: BELAY's tree is `scripts/`, workflows and Dockerfiles. Expect few findings.

## R6 — Dependencies {#r6}

- **Decision**: add no new npm dependency. If the ported orchestrator or its tests need one (MCM's
  `sast-scan.guard.test.mjs` once needed `ajv`), stop and ask the maintainer, since that is a
  structural decision.

## R7 — Pins {#r7}

- uv installer: `https://astral.sh/uv/<pin>/install.sh`, at MCM's pin unless it is older than BELAY's
  dev-container uv. Semgrep: `SEMGREP_PIN` in `sast-scan.mjs`, at MCM's pin.
- The toolchain-consistency gate pins Node only. A uv-pin consistency rule is out of scope; the
  runbook names where the pins live.
