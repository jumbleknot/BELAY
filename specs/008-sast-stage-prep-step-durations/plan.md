# Implementation Plan: SAST stage prep and step durations

**Branch**: `008-sast-stage-prep-step-durations` | **Date**: 2026-11-23 | **Spec**: [spec.md](spec.md)

## Summary

Two dormant install steps in the `sast` job, `scripts/sast-prepare.mjs rust` and `… python`, that act
only when a lockfile is tracked (research R1–R4), plus guards (R5). And one change to the digest's
`counts` mode, so a green job publishes its step durations (R6).

## Technical Context

**Language/Version**: Node 26 (ESM `.mjs`), bash (`ci-log-step.sh`, unchanged)

**Primary Dependencies**: Node built-ins; `sast-scan.mjs` (discovery); no new package

**Storage**: none committed; the runner's `$HOME/.cargo`, `$HOME/.rustup`; the bundle package

**Testing**: `node --test` via `scripts:test`; injected effects, no network

**Target Platform**: the `belay` runner; the dev container (baked Rust 1.100.0, uv 0.13.9)

**Constraints**: every binary sha256-verified before use (FR-002); no `curl | sh`; a measurement never
changes a job result (FR-008)

**Scale/Scope**: one new script (~200 lines) and test; two workflow steps; one digest branch

## Constitution Check

| Principle | Status |
|---|---|
| Structural decision (new toolchain) | PASS: the maintainer approved the Rust and Python installs on 2026-11-23, and kept `static.rust-lang.org` out of the dev-container egress |
| TDD, RED/GREEN | PASS: tests first per task |
| Test type integrity | PASS: unit tests with injected effects; the real install is SC-002 |
| Secrets management | PASS: no new secret; the digest uses its existing purpose-scoped credential |
| Dependency security | PASS: pinned, digest-verified binaries |
| Nx | PASS: runs under `scripts:test`/`scripts:lint` |
| Doc-impact sweep | PASS: in tasks.md |

## Project Structure

```text
scripts/
├── sast-prepare.mjs                      # NEW: rust | python
├── sast-scan.mjs                         # export trackedFiles (one word)
├── ci-failure-digest.mjs                 # counts mode: durations-only publication
└── __tests__/
    ├── sast-prepare.test.mjs             # NEW: plan, verify, install; scanner-enable guard; pin guard
    ├── ci-failure-digest.test.mjs        # mm5 updated at the cause; durations-only cases
    └── guardrails-workflow.test.mjs      # prepare steps; "stage 1 only" test updated at the cause
.forgejo/workflows/guardrails.yml         # + two steps
security/sast/rules/belay-ci-curl-pipe-shell.yaml   # comment: stage 2 needs no piped installer
docs/runbooks/sast.md, docs/runbooks/ci.md (+ openwiki pages)
```

## Complexity Tracking

None.
