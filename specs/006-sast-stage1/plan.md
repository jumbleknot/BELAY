# Implementation Plan: SAST and SCA gate, stage 1 (Semgrep and pnpm audit)

**Branch**: `006-sast-stage1` | **Date**: 2026-11-23 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/006-sast-stage1/spec.md`

## Summary

Port MCM feature 033's orchestrator and gate (`scripts/sast-scan.mjs`, `scripts/check-sast-findings.mjs`,
`scripts/allowlist-expiry.mjs`, `scripts/lib/scanner-retry.mjs`) with their tests, and its config
tree (`security/sast/`). Then add a `sast` job to `guardrails.yml`. The baseline is MCM `main` at
`fc2b953`. All four scanner implementations are ported unchanged, but the new enabled-scanner list
turns on only `semgrep` and `pnpm-audit` (research R1). Custom rules are ported where BELAY's
constitution states the same invariant (R3). The allowlist is seeded from a full scan of the tree
at landing (R5).

## Technical Context

**Language/Version**: Node 26 (ESM `.mjs`); uv pinned (MCM's `0.13.9`) installing Semgrep pinned
(MCM's `1.185.0`) through `uvx`

**Primary Dependencies**: Node built-ins, `yaml` (existing). Scanners: Semgrep (via uv), `pnpm audit`.
`ajv` only if the ported orchestrator validates its report schema with it; otherwise none (R6).

**Storage**: `security/sast/` config files; reports written to `security/sast/reports/` (gitignored)

**Testing**: `node --test` via `scripts:test`; the gate's `--selftest` in `scripts:lint`; `semgrep
--test` over the custom rules' fixtures in the `sast` job

**Target Platform**: the `belay` runner (`node:26-bookworm`), and the dev container (uv preinstalled;
egress to semgrep.dev, PyPI, astral.sh and the npm registry already allowlisted)

**Project Type**: repository tooling plus one CI job

**Performance Goals**: `guardrails / guardrails` unchanged. The `sast` job finishes inside a 15-minute
timeout; MCM measured SCA at about 2 s, and BELAY's tree is far smaller than MCM's

**Constraints**: keyless, no new secret (FR-016/017); `--metrics=off --disable-version-check` on
Semgrep; no credential in any report (FR-018)

**Scale/Scope**: about 1,900 lines ported, 5 test files, about 4 custom rules

## Constitution Check

| Principle | Status |
|---|---|
| Structural decision (new toolchain) | PASS: the maintainer approved uv on the runner on 2026-11-23 (item #37) |
| Behaviour-descriptive identifiers | PASS: custom rule ids become `belay-*`, describing the invariant |
| TDD, RED/GREEN | PASS: ported tests first; for rules, fixture-first via `semgrep --test` |
| Test type integrity | PASS: unit tests only; scanner processes are injected or fixture-fed |
| Secrets management | PASS: keyless; no new secret; p/secrets stays off (FR-006) |
| Dependency security (`npm audit`-class scanning required) | PASS: this feature is that requirement |
| Nx | PASS: `scripts:sast` target; the job calls it |
| Doc-impact sweep | PASS: in tasks.md |

## Project Structure

```text
scripts/
├── sast-scan.mjs              # orchestrator (port; enabled-scanner list added)
├── check-sast-findings.mjs    # gate (port)
├── allowlist-expiry.mjs       # gate helper (port)
├── lib/scanner-retry.mjs      # transient-failure retry (port)
├── project.json               # + `sast` target; lint gains the gate selftest
└── __tests__/                 # check-sast-findings, allowlist-expiry, sast-scan guard, retry guard
security/sast/
├── README.md
├── scan.yaml                  # NEW: enabled scanners (semgrep, pnpm-audit)
├── semgrep.yaml               # rule packs
├── severity-map.yaml
├── allowlist.yaml             # seeded at landing
└── rules/belay-*.yaml + fixtures
.forgejo/workflows/guardrails.yml   # + `sast` job
.gitignore                     # security/sast/reports/
docs/runbooks/sast.md          # new runbook (+ openwiki page if warranted)
```

**Structure Decision**: tooling lives with the other gates in `scripts/`; config-as-code lives in
`security/`, an existing top-level folder.

## Complexity Tracking

None.
