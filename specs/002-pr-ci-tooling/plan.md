# Implementation Plan: PR and CI-Status Tooling

**Branch**: `002-pr-ci-tooling` | **Date**: 2026-11-22 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/002-pr-ci-tooling/spec.md`

## Summary

This feature ports MovieCollectionManager's (MCM's) forge CLIs into BELAY, so an agent can run the whole push → PR → green → merge loop from a terminal:
- **`ci-status.mjs`:** `status`, `watch`, `failure` and `durations`, with a merge verdict from branch protection's required checks. Exit codes: 0 mergeable, 1 failed, 2 bad input or auth, 3 waiting.
- **`forge-pr.mjs`:** `open`, `merge --expect-head` and `dispatch`.
- **`lib/forge-credential.mjs`:** derives the forge from `origin`, and gets the write credential from `git credential fill`.

MCM's deploy pipeline and MCM names are stripped. Before the port, BELAY's digest module adopts MCM's repo-scoped package API (`bundlePackageFor` / `bundlePackagesFor`), which `ci-status` imports. The tasks-template override's "Open the PR" task and `docs/runbooks/ci.md` then point at the new commands. This feature's own PR is opened and merged with them. See [research.md](research.md), R1–R10.

## Technical Context

**Language/Version**: JavaScript (Node ESM `.mjs`). Node ≥24 locally, 26.13.1 in CI.

**Primary Dependencies**: none new. Node built-ins (`fetch`, `child_process`, `node:test`); tests use the existing `yaml` dev dependency.

**Storage**: none. `ci-status` keeps a small response cache in `<tmpdir>/<repo>-ci-status` (`CI_STATUS_CACHE_DIR` overrides it).

**Testing**: `node:test` with `globalThis.fetch` stubbed and `fill` / `ciStatus` injected. No network. Run through `pnpm nx run scripts:test`; the `ci-status` selftest runs through `scripts:lint`.

**Target Platform**: developer machines (Windows Git Bash / PowerShell, Linux) and agents, talking to the Forgejo API at `origin`.

**Project Type**: repository tooling. Three CLI modules in the `scripts` Nx project.

**Performance Goals**: a `failure` read finishes in under 10 s on the homelab network (spec SC-005). Every request has a time limit (`CI_HTTP_TIMEOUT_MS`).

**Constraints**:
- Credentials never go into argv, output, logs or files. Reads use `FORGE_TOKEN`; writes use the git credential.
- Every write is checked against the owner and repository from `origin`.
- MCM coupling is stripped (spec FR-020).

**Scale/Scope**: about 2,650 lines of ported code, about 2,500 lines of ported tests, 10 fixtures, one digest API alignment, one override task, and one runbook section.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How |
| --- | --- | --- |
| AI Assistant Constraints: spec technology-agnostic, plan holds the how | ✅ | Endpoints, flags and file layout live here and in research.md. |
| AI Assistant Constraints: behaviour-descriptive identifiers | ✅ | R-strip removes `(#1072)`-style item tags from test titles and FR tags from identifiers. |
| Security: secrets management | ✅ | `FORGE_TOKEN` comes from the environment; the write credential comes from the git credential helper straight into an Authorization header (spec FR-014). Tests plant a credential and assert it never appears in output (SC-004). |
| Security: least privilege | ✅ | Reads use the read-only token. Repository writes use the git credential only for open, merge and dispatch. |
| Security: dependency security | ✅ | No new dependencies. |
| Test-Driven Development (NON-NEGOTIABLE) | ✅ | Every ported module lands with its MCM tests, ported first and watched RED. The digest API alignment is test-first. Doc and override tasks use "Done when". |
| Logging: sensitive data prohibition | ✅ | `ci-status` passes everything it prints through `redactForPublication` (the forge host and credentials), as in MCM. |
| Common Stack: Nx runs test and lint operations | ✅ | Tests and selftests run through `scripts:test` / `scripts:lint`. The CLIs are operator tools, not test, lint or build operations, so they run directly (research R10). |
| Common Stack: pnpm | ✅ | Nothing new to install. |

**Post-design re-check:** unchanged. No violations.

## Project Structure

### Documentation (this feature)

```text
specs/002-pr-ci-tooling/
├── spec.md
├── plan.md               # this file
├── research.md           # R1–R10: reuse decisions
├── data-model.md         # target, verdict, required check, evidence bundle, write credential
├── quickstart.md         # end-to-end validation, including this feature's own PR
├── contracts/
│   └── cli.md            # ci-status, forge-pr and forge-credential contracts
├── checklists/requirements.md
└── tasks.md              # /speckit-tasks
```

### Source Code (repository root)

```text
scripts/
├── ci-status.mjs                  # ported; deploy pipeline removed (R2), FORGE_TOKEN (R4)
├── forge-pr.mjs                   # ported (R4)
├── lib/forge-credential.mjs       # ported (R4)
├── ci-failure-digest.mjs          # edit: bundlePackageFor / bundlePackagesFor / bundleRefFor / isEvidencePackage (R1)
├── project.json                   # edit: + ci-status --selftest in lint (R7)
└── __tests__/
    ├── ci-status.test.mjs         # ported (R6)
    ├── forge-pr.test.mjs          # ported, includes the forge-credential tests (R6)
    ├── ci-failure-digest.test.mjs # edit: package-API tests (R1)
    └── fixtures/ci/*.json         # ported, names neutralized
.specify/templates/overrides/tasks-template.md   # edit: "Open the PR" task names the tools (R8)
docs/runbooks/ci.md                              # edit: PRs and CI status section (R9)
AGENTS.md                                        # edit: scripts row names the new CLIs
```

**Structure Decision**: three new scripts beside feature 001's CI scripts, in the existing `scripts` Nx project. No new project.

## Complexity Tracking

No constitution violations to justify.
