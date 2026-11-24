# Implementation Plan: Coverage gate for the scripts project

**Branch**: `009-scripts-coverage-gate` | **Date**: 2026-11-24 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/009-scripts-coverage-gate/spec.md`

## Summary

A new gate, `scripts/check-coverage.mjs`, does three things:
- runs the `scripts` test suite under Node's built-in coverage, writing an lcov report;
- fails if any source module, or the total, is below the 70% line floor;
- fails if any source module is **missing** from the report.

The floor, the source patterns and the (empty) exception list live once, in `scripts/coverage-policy.yaml`.
`scripts:test` becomes "run with coverage, then gate", and the gate's `--selftest` joins `scripts:lint`.
The SAST orchestrator is raised from 67.8% above the floor by testing three pure transforms (research R7).
The register of unenforced rules and the pages that describe `scripts:test` are updated.

The measurements that shaped it are in [research.md](research.md):
- child-process code **is** measured (R1);
- an unloaded module is **absent**, not 0% (R1, R5);
- the built-in threshold checks only the total (R2);
- coverage costs +1% of the suite's run time (R4).

## Technical Context

**Language/Version**: Node 26 (ESM `.mjs`), the version pinned by the toolchain-consistency gate

**Primary Dependencies**:
- Node built-ins: the `node:test` runner's coverage (`--experimental-test-coverage`, `--test-coverage-include`) and its `lcov` reporter;
- `yaml`, already a workspace dependency;
- `scripts/allowlist-expiry.mjs` for exception expiry.

No new package.

**Storage**: `scripts/coverage-policy.yaml` (committed); `coverage/scripts.lcov` (generated, already
gitignored by `coverage/` and `*.lcov`)

**Testing**: `node --test` via `scripts:test`. The gate's logic is pure (lcov text plus policy plus a
module list plus `today` in, verdict out), and is unit-tested with in-memory inputs. `--run` gets one
end-to-end test against a tiny fixture project.

**Target Platform**: the `belay` runner (`guardrails` job) and the dev container

**Project Type**: repository tooling (the `scripts` Nx project)

**Performance Goals**: the `guardrails-test` step grows by ≤ 50% (SC-004). It measured +1% (R4)

**Constraints**:
- fails closed on a missing or empty report or an invalid policy;
- one source of truth for the floor and the include patterns;
- the gate never masks a failing test, nor the reverse;
- the verdict is printed last, for the CI digest.

**Scale/Scope**:
- one new script (~250 lines) with its test;
- one policy file;
- three exports plus tests in `sast-scan.mjs`;
- `project.json` (two lines);
- about six documents.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Status |
| --- | --- |
| **Code Coverage: minimum 70%** (Quality Standards) | **Strengthened**: this feature is the first mechanical enforcement of it, for the one project that has tests |
| **TDD (NON-NEGOTIABLE)** | PASS: the gate's tests are written and observed failing first. The `sast-scan.mjs` exports get tests, and the mutation RED is SC-005 |
| **Test Type Integrity** | PASS: unit tests on pure logic with in-memory inputs. The single `--run` test drives a real `node --test` process against a fixture, with no mocks of the runner |
| **Structural decisions** (`AGENTS.md`, ADR rule) | PASS, none: no new toolchain, build plugin or dependency. Coverage is Node's built-in feature. `coverage/` is a gitignored output directory, not a tracked top-level folder |
| **Behavior-Descriptive Identifiers** | PASS: `check-coverage.mjs` and `coverage-policy.yaml`, with no requirement IDs in names |
| **Nx as the task runner** | PASS: it runs inside `scripts:test` and `scripts:lint`. CI's command (`pnpm nx run scripts:test`) is unchanged |
| **Dependency Security** | PASS: no new dependency |
| **Secrets management** | PASS: no credential involved; the report holds file paths and counts only |
| **Documentation (doc-impact sweep)** | PASS: `scripts:test`'s meaning changes, so the sweep searches for the old command text (`node --test "scripts/__tests__/*.test.mjs"`) and `scripts:test` across every procedure document (tasks.md T001) |

Re-checked after Phase 1 design: unchanged. The design adds no dependency and no new CI step.

## Project Structure

### Documentation (this feature)

```text
specs/009-scripts-coverage-gate/
├── plan.md              # This file
├── research.md          # Phase 0: R1–R9
├── data-model.md        # Phase 1: policy, exception, module result, verdict
├── quickstart.md        # Phase 1: validation scenarios
├── contracts/
│   └── check-coverage-cli.md
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
scripts/
├── check-coverage.mjs                    # NEW: --run | gate | --selftest
├── coverage-policy.yaml                  # NEW: floor 70, include patterns, exceptions: []
├── sast-scan.mjs                         # export toSarif, normalizeCargoAudit, emitProposedAllowlist
├── project.json                          # test → check-coverage.mjs --run; lint += --selftest
└── __tests__/
    ├── check-coverage.test.mjs           # NEW: verdict rules, policy validation, --run end to end
    ├── fixtures/coverage-run/            # NEW: a two-module fixture project for the --run test
    └── sast-scan-transforms.test.mjs     # NEW: toSarif, normalizeCargoAudit, emitProposedAllowlist

openwiki/invariants/unenforced-rules.md   # coverage row removed for scripts/; item 54 row (done in spec commit)
openwiki/invariants/testing-tiers.md      # a Coverage row in "What exists today"
openwiki/invariants/feature-validation-checklist.md
openwiki/invariants/nx-task-runner.md     # scripts:test's command
docs/runbooks/ci.md (+ openwiki/runbooks/ci.md), docs/runbooks/spec-kit.md, docs/repo-foundation-setup.md   # per the sweep
```

**Structure Decision**: the existing `scripts` Nx project. No new project, and no workflow change (R8).

## Complexity Tracking

None.
