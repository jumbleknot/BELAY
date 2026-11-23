# Implementation Plan: SAST dependency-downgrade gate

**Branch**: `007-dependency-downgrade-gate` | **Date**: 2026-11-23 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/007-dependency-downgrade-gate/spec.md`

## Summary

Port MCM's `scripts/check-dependency-downgrade.mjs` and its test from MCM `fc2b953`, and add it as a
PR-only step in the `sast` job, right after the gate. Its three imports already exist on `main` and
behave as in MCM (research R1). Deliberate deviations are in research R2–R5.

## Technical Context

**Language/Version**: Node 26 (ESM `.mjs`)

**Primary Dependencies**: Node built-ins; `scripts/lib/argv-contract.mjs`, `scripts/sast-scan.mjs`,
`scripts/check-sast-findings.mjs` (existing). No new package (FR-010).

**Storage**: reads `security/sast/reports/pnpm-audit-native.json` (gitignored, written by the scan),
`security/sast/allowlist.yaml`, and base lockfiles through `git show <ref>:<path>`

**Testing**: `node --test` via `scripts:test`

**Target Platform**: the `belay` runner (`sast` job), and the dev container

**Project Type**: repository tooling plus one CI step

**Performance Goals**: well under a second; no network

**Constraints**: fail-closed (FR-007); PR-only (FR-009); no registry call (FR-004)

**Scale/Scope**: about 300 lines ported, one test file, one workflow step, one guard test

## Constitution Check

| Principle | Status |
|---|---|
| Structural decision | PASS: no new toolchain, dependency or folder |
| Behaviour-descriptive identifiers | PASS: MCM's names kept; they describe the behaviour |
| TDD, RED/GREEN | PASS: the ported test lands first and is verified RED (`Cannot find module`), then GREEN |
| Test type integrity | PASS: unit tests over fixture lockfiles and reports; CLI tests spawn the script |
| Secrets management | PASS: keyless; no new secret |
| Dependency security | PASS: closes a dependency-audit gap |
| Nx | PASS: runs under `scripts:test`; the CI step is a gate script like the others in the job |
| Doc-impact sweep | PASS: in tasks.md |

## Project Structure

```text
scripts/
├── check-dependency-downgrade.mjs              # port (research R2)
└── __tests__/
    ├── check-dependency-downgrade.test.mjs     # port (R3 moves wiring out, R4 adds one, R5 fixture)
    └── guardrails-workflow.test.mjs            # + the step's position and PR-only condition (R3)
.forgejo/workflows/guardrails.yml               # + PR-only step after the gate
docs/runbooks/sast.md                           # job steps, "When the gate goes red"
openwiki/runbooks/sast.md                       # refreshed summary
```

**Structure Decision**: the check sits with the other SAST gate scripts in `scripts/`.

## Complexity Tracking

None.
