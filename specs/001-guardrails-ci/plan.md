# Implementation Plan: Guardrails CI

**Branch**: `001-guardrails-ci` | **Date**: 2026-11-22 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-guardrails-ci/spec.md`

## Summary

BELAY gets its first CI: a Forgejo Actions `guardrails` workflow that runs on every PR and every push to `main`. It runs two Nx targets on the `ci-homelab` runner:
- the Spec Kit override gate and the digest-coverage gate (`scripts:lint`);
- every script test (`scripts:test`).

Every job ends with MovieCollectionManager's (MCM's) failure digest. The digest posts a redacted, upserted PR comment, or a commit status, and stores fuller evidence in the package registry.

To get there, BELAY becomes a pnpm + Nx workspace like MCM, with `yaml` as its first dev dependency. The implementation is MCM's, ported with as few changes as possible:
- `install-pnpm.sh`, `ci-log-step.sh`;
- `secret-scan.mjs`, `ci-digest-redact.mjs`, `ci-failure-digest.mjs`, `check-ci-digest-coverage.mjs`;
- their tests;
- the `guardrails.yml` job shape.

Only MCM coupling is stripped. [research.md](research.md) records each reuse decision.

## Technical Context

**Language/Version**: JavaScript (Node ESM `.mjs`). Node ≥24 locally, Node 26.13.1 in CI (constitution). POSIX `bash` for the two shell scripts.

**Primary Dependencies**: pnpm 12.21.0 (`packageManager`), Nx 24.0.6, `yaml` `^2.9.1` (dev dependency). `nx` is exact because it is a lockstep group. The committed lock file pins every install (constitution v1.0.1). Forgejo Actions with `actions/checkout` and `actions/setup-node` at MCM's pinned SHAs.

**Storage**: none. Digests go to the forge: PR comments, commit statuses, and the generic package `<repo>-ci-failures`. Step logs go to `$HOME/<repo>-ci-step-logs` on the runner.

**Testing**: `node:test`, run through `pnpm nx run scripts:test`. Each gate also has a `--selftest`, run through `pnpm nx run scripts:lint`.

**Target Platform**: the Forgejo Actions runner `ci-homelab` (label `ubuntu-latest`, Linux container), and developer machines on Windows (Git Bash / PowerShell) and Linux.

**Project Type**: repository tooling. CI configuration plus CLI scripts.

**Performance Goals**: a guardrails run finishes within its 10-minute job timeout, and is typically a couple of minutes, most of it the install.

**Constraints**:
- **Node built-ins and workspace dependencies only** (FR-022).
- **Tokens from the environment only**, never argv or logs.
- **Digest must never change a job's outcome** (FR-009).
- **The Spec Kit gate stays install-free.**
- **No MCM names** in anything ported (SC-008).

**Scale/Scope**: one workflow and one job. Six ported scripts and five ported test files (about 3,400 lines of tests). Workspace root files. Two runbooks plus AGENTS.md.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How |
| --- | --- | --- |
| AI Assistant Constraints: spec stays technology-agnostic, plan holds the how | ✅ | Tooling specifics live here and in research.md. The spec names only platform facts the feature is about (see the checklist note). |
| AI Assistant Constraints: behaviour-descriptive identifiers, no FR/spec IDs in code | ✅ | Ported files drop MCM's `feature 042` and `FR-0xx` comment tags. FR references may stay in tests and docs only. |
| Security / Data Protection: secrets management | ✅ | `CI_DIGEST_TOKEN` is an Actions secret, read from env only. Every published byte passes the fail-closed redactor (FR-013). |
| Security: principle of least privilege | ✅ | The digest token is purpose-scoped (`write:issue`, `write:package`, `read:repository`). No script holds an admin token; branch protection is set by hand. |
| Security: dependency security (pinned versions, automated scanning) | ⚠️ partial | Per constitution v1.0.1, the committed lock file and `--frozen-lockfile` pin every install, `nx` is exact as a lockstep group, and `yaml` uses `^`. Automated vulnerability scanning arrives with SAST in issue #1. See Complexity Tracking. |
| Test-Driven Development (NON-NEGOTIABLE) | ✅ | Each ported script lands with its MCM tests, ported first and watched failing before the script exists (tasks follow Verify RED / Verify GREEN). The workflow, workspace and docs tasks use "Done when". |
| Logging & Monitoring: sensitive data prohibition | ✅ | The digest and step logs pass the redactor. Tokens are never echoed. |
| Common Stack: pnpm is the package manager | ✅ / ⚠️ | `packageManager: pnpm@12.21.0` and `only-allow pnpm`. A one-off `npm install --global pnpm` bootstraps pnpm in CI, because Node 26 has no corepack. See Complexity Tracking. |
| Common Stack: Nx runs all test and lint operations | ✅ | `scripts` Nx project with `lint` and `test` targets. CI invokes only those (research R2). |
| Common Stack: a single root `.gitignore` | ✅ | `.nx/` and the pnpm store are added to the root `.gitignore`. `node_modules/` is already there. |
| Monorepo Directory Structure | ✅ | New files sit in existing top-level folders (`scripts/`, `docs/runbooks/`) plus `.forgejo/` and the root workspace files. |

**Post-design re-check (after Phase 1):** unchanged. No new violations were introduced by data-model.md, the contracts or quickstart.md.

## Project Structure

### Documentation (this feature)

```text
specs/001-guardrails-ci/
├── spec.md
├── plan.md              # this file
├── research.md          # Phase 0: reuse decisions R1–R11
├── data-model.md        # Phase 1: run, digest, evidence, exemption, workspace
├── quickstart.md        # Phase 1: how to validate end to end
├── contracts/
│   ├── guardrails-workflow.md   # triggers, job, steps, status context
│   └── script-clis.md           # CLI contract of every ported script and Nx target
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks), not created here
```

### Source Code (repository root)

```text
package.json                     # new: @belay/workspace, pnpm pin, nx + yaml devDependencies
pnpm-workspace.yaml              # new: packages globs, allowBuilds, supply-chain notes
pnpm-lock.yaml                   # new: committed
nx.json                          # new: no plugins, defaultBase main
.gitignore                       # + .nx/, .pnpm-store/
.forgejo/workflows/guardrails.yml          # new
scripts/
├── project.json                 # new: Nx project "scripts" (lint, test)
├── install-pnpm.sh              # ported
├── ci-log-step.sh               # ported
├── secret-scan.mjs              # ported (rules: anthropic, tmdb v3/v4)
├── ci-digest-redact.mjs         # ported
├── ci-failure-digest.mjs        # ported
├── check-ci-digest-coverage.mjs # ported (uses yaml)
├── check-speckit-overrides.mjs  # existing, unchanged
├── lib/                         # existing (argv-contract, is-main, extensions-yml)
└── __tests__/
    ├── ci-log-step.test.mjs               # ported
    ├── ci-digest-redact.test.mjs          # ported
    ├── ci-failure-digest.test.mjs         # ported
    ├── check-ci-digest-coverage.test.mjs  # ported
    └── (existing gate + parser tests)
docs/runbooks/ci.md              # new: guardrails, digest, runner, secret, branch protection
docs/runbooks/spec-kit.md        # edit: the gate runs in CI
AGENTS.md                        # edit: toolchain convention, CI, commands
```

**Structure Decision**: repository tooling. Everything lives in `scripts/` as one Nx project, beside the existing gate. No product project is created.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
| --- | --- | --- |
| npm used once in CI to install pnpm itself (`scripts/install-pnpm.sh`) | Node 26 ships without corepack, and pnpm has to come from somewhere before it can manage anything. This is MCM's tested approach. | corepack isn't available. A pnpm standalone installer script would add an unpinned download from the internet. |
| No automated dependency vulnerability scanning yet | Scanning is MCM's SAST job, tracked in issue #1. The one dependency, `yaml` (pinned, with no transitive dependencies), plus `nx` keep the exposure small until then. | Pulling SAST into this feature would roughly double its scope, against the user's deliberate deferral to issue #1. |
