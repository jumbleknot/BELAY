# Implementation Plan: Guardrail gate ports and registry retention

**Branch**: `005-guardrail-gate-ports` | **Date**: 2026-11-23 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/005-guardrail-gate-ports/spec.md`

## Summary

Port MovieCollectionManager (MCM) gate families into BELAY's `scripts/` as plain-Node ESM scripts.
Each gets a selftest and `node --test` unit tests, and each is wired into the `scripts:lint` Nx target
as its own command. The required `guardrails` job already runs that target under the failure digest.
Then add one scheduled workflow for registry retention. Every port comes from MCM `main` at `fc2b953`
(2026-11-23). The porting rule is the issue's: change only what removes MCM coupling.

| Gate / tool | MCM source | BELAY outcome | Item |
|---|---|---|---|
| topology scrub | `scripts/check-topology-scrub.mjs` | **port as-is** (no coupling) | item #2 |
| secret scan (tree) | `scripts/secret-scan.mjs` | **wire** the existing BELAY copy's scan mode into lint | item #1 |
| toolchain consistency | `scripts/check-toolchain-consistency.mjs` | **port, trimmed** to BELAY's surfaces ([R2](research.md#r2)) | item #1 |
| OpenWiki conformance | `check-openwiki-okf.mjs` + `openwiki-{fingerprint,front-matter,links,stamp}.mjs` | **port** | item #28 |
| OpenWiki governance | `check-openwiki-governance.mjs` (+ `openwiki-policy.mjs`) | **port**; the policy module runs with no policy file ([R4](research.md#r4)) | item #28 |
| wiki refresh | `scripts/wiki-refresh.mjs` + `.claude/skills/wiki-refresh` | **port** | item #28 |
| registry retention | `registry-retention.mjs` + workflow + config | **port, trimmed** ([R5](research.md#r5)) | item #32 |
| argv secrets | `check-no-argv-secrets.mjs` | **port ahead of the surface** ([R8](research.md#r8)): the constitution requires Maestro | item #1 |
| inline secrets | `check-no-inline-secrets.mjs` | **port ahead of the surface** ([R8](research.md#r8)): the constitution requires `compose.yaml` with file secrets | item #1 |
| resource naming | `check-resource-naming.mjs` | **port, genericised** ([R8](research.md#r8)): contexts come from BELAY's project directories, not MCM's services | item #1 |
| override floor | `check-override-consistency.mjs` | **port ahead of the surface** ([R8](research.md#r8)): `pnpm-workspace.yaml` anticipates security overrides | item #1 |
| SAST | `sast-scan.mjs`, `check-sast-findings.mjs` | **defer** ([R6](research.md#r6)): re-filed as its own item | item #1 |
| Komodo, port-collision, restart-policy, server-import, realm, DAST | various | **drop**: MCM-specific, per item #1 itself | item #1 |

## Technical Context

**Language/Version**: Node 26 (ESM `.mjs`); CI pins 26.13.1, the constitution's version

**Primary Dependencies**: Node built-ins, plus `yaml` (already a root devDependency) for front
matter, `protected.yaml`, workflows and the retention config. No new dependency.

**Storage**: files only: front matter in `openwiki/**/*.md`, `openwiki/protected.yaml` and
`infrastructure-as-code/forgejo/registry-retention.yaml`

**Testing**: `node --test "scripts/__tests__/*.test.mjs"` via `pnpm nx run scripts:test`. Each gate's
`--selftest` also runs in `scripts:lint`.

**Target Platform**: the `belay` runner (`node:26-bookworm`) and the dev container

**Project Type**: repository tooling (CLI gates plus one scheduled workflow)

**Performance Goals**: all the new lint commands together add less than 60 s to `guardrails` (SC-003).
Each gate reads the tracked tree once.

**Constraints**:
- No real tailnet host, forge host or credential in any committed file, tests included. Fixtures are
  built from fragments.
- Exit codes are 0/1/2, plus 5 when retention cannot resolve a protected digest.
- No gate is weakened to make the current tree pass.

**Scale/Scope**: about 4,000 lines ported, about 12 new test files, and the 8 derived openwiki pages
fingerprinted

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status |
|---|---|
| Behaviour-descriptive identifiers (no FR/T ids in names) | PASS: script names describe the check |
| Technology agnosticism in spec | PASS: the spec names only user-facing files; tooling stays in this plan |
| TDD (NON-NEGOTIABLE), RED/GREEN checkpoint format | PASS, with a note. Every port lands its tests first and is verified RED, against a missing module or a mutation; tasks.md records each. The constitution's "user approval" of test cases happens at PR review, because the maintainer asked for end-to-end implementation in one session |
| Test type integrity | PASS: all are unit tests. Retention's forge API is injected, with no HTTP mocking library, and nothing goes under `tests/integration/` |
| Secrets management | PASS: the registry credential is an Actions secret, read from env only and never echoed |
| Dependency security: lockstep groups exact | PASS, and now **enforced** by the toolchain gate |
| Package manager / Nx | PASS: every gate runs through `scripts:lint`; no npm or yarn |
| Structural decisions need the maintainer | PASS: no new toolchain, plugin, dependency or top-level folder. `infrastructure-as-code/forgejo/` sits inside an existing top-level folder. SAST is deferred precisely because it would need a new toolchain |
| Doc-impact sweep | PASS: recorded in tasks.md |

Re-check after design: unchanged.

## Project Structure

### Documentation (this feature)

```text
specs/005-guardrail-gate-ports/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── gate-cli.md            # the shared CLI and exit-code contract of every gate
│   └── registry-retention.md  # config schema, report format, exit codes
└── tasks.md
```

### Source Code (repository root)

```text
scripts/
├── check-topology-scrub.mjs            # new
├── check-toolchain-consistency.mjs     # new (trimmed port)
├── check-openwiki-okf.mjs              # new
├── check-openwiki-governance.mjs       # new
├── openwiki-fingerprint.mjs            # new (shared)
├── openwiki-front-matter.mjs           # new (shared)
├── openwiki-links.mjs                  # new (shared)
├── openwiki-policy.mjs                 # new (shared; BELAY has no policy file)
├── openwiki-stamp.mjs                  # new (shared)
├── wiki-refresh.mjs                    # new
├── registry-retention.mjs              # new (trimmed port)
├── check-no-inline-secrets.mjs         # new (ported ahead of compose)
├── check-no-argv-secrets.mjs           # new (ported ahead of Maestro)
├── check-override-consistency.mjs      # new (ported ahead of the first override)
├── check-resource-naming.mjs           # new (genericised)
├── secret-scan.mjs                     # existing; its scan mode is now wired into lint
├── project.json                        # the lint target gains the new commands
└── __tests__/                          # one test file per new module
.forgejo/workflows/registry-retention.yml               # new; scheduled, report-only by default
infrastructure-as-code/forgejo/registry-retention.yaml  # new; mode: report
.claude/skills/wiki-refresh/SKILL.md    # new
openwiki/**                             # fingerprints recorded; enforcement wording
AGENTS.md, docs/runbooks/{ci,devcontainer}.md, openwiki/runbooks/ci.md  # the rule and the gate docs
```

**Structure Decision**: everything here is repository tooling. It lives with the existing gates in
`scripts/`, is tested in `scripts/__tests__/`, and runs through the existing `scripts` Nx project.
The one new workflow follows `devcontainer-image.yml`'s shape: runner `belay`, `ci-log-step.sh` and
the failure digest.

## Delivery

One branch and one pull request. The batching rule (openwiki/process/pull-request-batching.md) asks
whether a red build could be attributed to one change. It could: every gate is its own line in
`scripts:lint` and has its own test file, so a failure names its gate. Commits are grouped per
backlog item, so review can go item by item.

## Complexity Tracking

No constitution violations to justify.
