# Implementation Plan: Backlog Tooling and Tasks-to-Issues

**Branch**: `003-backlog-taskstoissues` | **Date**: 2026-11-22 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/003-backlog-taskstoissues/spec.md`

## Summary

This feature ports MovieCollectionManager's (MCM's) backlog tooling into BELAY:
- **`scripts/backlog.mjs`:**
  - reads: `list`, `ready`, `show`, `validate-form`;
  - writes: `create` (which refuses duplicates), `update`, `comment`, `dep` (which refuses cycles), `setup-labels`, `setup-milestone`;
  - writes are checked against origin's owner and repo, unknown labels and milestones are refused locally, and the exit codes are 0 to 5;
  - it uses `FORGE_ISSUE_TOKEN`, with `FORGE_TOKEN` as the read fallback.
- **A project-owned `/speckit-taskstoissues` skill,** registered with the Spec Kit gate.
- **The `forgejo-issues` rules skill, the backlog runbook and the backlog issue form.**

MCM coupling is stripped: the `MCM_` token names, `status/bot-managed`, Renovate, the dev container and MCM infrastructure. The label set is created on BELAY, issue #1 is labelled, and the command runs on this feature's own task list. See [research.md](research.md), R1–R10.

## Technical Context

**Language/Version**: JavaScript (Node ESM). Node ≥24 locally, 26.13.1 in CI.

**Primary Dependencies**: none new. Node built-ins, plus `ci-status.mjs` (`forgeEndpoint`, `stripControlChars`) and `ci-digest-redact.mjs` (`redactForPublication`), both already in BELAY.

**Storage**: none. State lives in the Forgejo tracker: issues, labels, milestones and dependencies.

**Testing**: `node:test` with a stubbed `fetch` (`fakeFetch`), no network, run through `pnpm nx run scripts:test`.

**Target Platform**: the maintainer's machine (Windows Git Bash / PowerShell) and agents, talking to the Forgejo API at `origin`.

**Project Type**: repository tooling. One CLI in the `scripts` Nx project, plus two skills, a runbook and an issue form.

**Performance Goals**: one tracker call per page, up to 50 rows. Tasks-to-issues on a task list of about 30 tasks finishes in a few minutes, because each create is one request.

**Constraints**:
- Tokens come from the environment only, and never reach argv, output, logs or files.
- Every write is checked against origin's owner and repo.
- Pull requests are never listed (`type=issues`).
- MCM coupling is stripped (spec FR-019).

**Scale/Scope**: about 900 lines of CLI, 650 lines of tests, one fixture, two skills, a runbook, an issue form, one gate registration, and the live setup.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How |
| --- | --- | --- |
| AI Assistant Constraints: spec technology-agnostic, plan holds the how | ✅ | Endpoints and file layout live here and in research.md. |
| Security: secrets management | ✅ | `FORGE_ISSUE_TOKEN` and `FORGE_TOKEN` come from the environment only. The `(no-leak)` test is mutation-checked (research R6). |
| Security: least privilege | ✅ | Issue writes use the `write:issue` token, never the repository-write git credential (R1). |
| Security: input validation and output encoding | ✅ | Every printed line goes through redaction and control-character stripping (R2). Labels and milestones are validated locally. |
| Test-Driven Development (NON-NEGOTIABLE) | ✅ | MCM's tests are ported first and watched RED. Docs, skills, the form and the live setup use "Done when". |
| Common Stack: Nx for test and lint | ✅ | Tests run through `scripts:test`. The CLI runs directly, like feature 002's CLIs (R10). |
| Spec Kit ownership rules (AGENTS.md) | ✅ | `/speckit-taskstoissues` is project-owned, registered in `PROJECT_OWNED` and the inventory runbook in the same change (R4). |

**Post-design re-check:** unchanged. No violations.

## Project Structure

### Documentation (this feature)

```text
specs/003-backlog-taskstoissues/
├── spec.md
├── plan.md               # this file
├── research.md           # R1–R10: reuse decisions
├── data-model.md         # item, label set, milestone, dependency, task issue
├── quickstart.md         # validation, including the live label setup and tasks-to-issues runs
├── contracts/
│   ├── backlog-cli.md    # backlog.mjs commands, options and exit codes
│   └── taskstoissues.md  # the /speckit-taskstoissues flow
├── checklists/requirements.md
└── tasks.md              # /speckit-tasks
```

### Source Code (repository root)

```text
scripts/
├── backlog.mjs                                   # ported (R1–R3, R7)
└── __tests__/
    ├── backlog.test.mjs                          # ported (R6)
    └── fixtures/backlog/blocked-close-412.json   # ported
scripts/check-speckit-overrides.mjs               # edit: PROJECT_OWNED entry for the taskstoissues skill (R4)
.claude/skills/speckit-taskstoissues/SKILL.md     # new, project-owned (R4)
.claude/skills/forgejo-issues/SKILL.md            # new (R8)
.forgejo/issue_template/backlog-item.yaml         # new (R5)
docs/runbooks/backlog.md                          # new (R8)
docs/runbooks/spec-kit.md                         # edit: inventory row for the project-owned skill (R4)
docs/runbooks/ci.md                               # edit: the backlog token line points at backlog.md
AGENTS.md                                         # edit: scripts row and runbook link
```

**Structure Decision**: one more CLI in the existing `scripts` project, plus two Claude skills. No new Nx project.

## Complexity Tracking

No constitution violations to justify.
