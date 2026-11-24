# Implementation Plan: The learnings ledger and its scripted measurement log

**Branch**: `013-learnings-ledger` | **Date**: 2026-11-24 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/013-learnings-ledger/spec.md`

## Summary

One new operator script, `scripts/count-repo-metrics.mjs`, measures the committed tree of one commit (`--rev`,
default `HEAD`). It reads only through git object commands (`ls-tree`, `cat-file --batch`, `rev-list`), so the working
copy cannot affect it (research R1). Each tracked file goes into exactly one line category through one pure function,
`classifyPath` (R2). Its `--append-log <file>` mode writes a new column straight into the learnings document's log
table, between markers, so **no number in Part 3 is ever typed by hand** (R5). That closes the transcription gap
MCM measured, as well as the counting gap.

The document is `docs/BELAY-Learnings.md`:
- Part 1 is the story.
- Part 2 is the ledger, seeded only from lessons already recorded in the repository (R6).
- Part 3 is the log: a column for `main` at the branch point, back-filled with the first merged feature.
- A "how to update" section says what may be edited in place and what may only be appended.

The quarterly drift audit gains a step that runs the script. The wiki gains a concept page for the document, and
the doc-drift summary is refreshed.

## Technical Context

**Language/Version**: Node 26 (ESM `.mjs`)

**Primary Dependencies**: `yaml` (already a workspace dependency, for the allowlists and nothing else);
`lib/argv-contract.mjs` (`partitionArgsWithValues`, `wantsHelp`, `dieOnArgvError`); `lib/is-main.mjs`. No new
dependency.

**Storage**: none. The log table in `docs/BELAY-Learnings.md` is the only persisted output.

**Testing**: `node:test` under `scripts:test`, with the coverage gate (70% per module). The tests build throwaway git
repositories in a temporary directory with known content. This is the established pattern: eight existing test files
run `git init`. They then assert every metric exactly. The pure parts (`classifyPath`, the declaration counter, the
table merge) have their own table-driven tests.

**Target Platform**: the dev container and any full clone. Not CI: a shallow checkout cannot give a commit count (R4).

**Project Type**: repository tooling (the `scripts` Nx project)

**Performance Goals**: under 5 seconds on the current tree (~650 tracked files), using one `cat-file --batch` call.

**Constraints**:
- it reads only committed objects;
- it fails, without printing metrics, on an unknown rev or outside a git repository;
- it never prints a wrong commit count from a shallow history;
- `--append-log` writes only between its markers, and refuses a duplicate column.

**Scale/Scope**: 1 script and 1 test file, 1 new document, 1 runbook step, and 1 new wiki concept plus refreshes.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Status |
| --- | --- |
| **Structural decisions** | PASS. No new toolchain, folder or dependency. `docs/` already exists. |
| **TDD (NON-NEGOTIABLE)** | PASS. A stub that exports the functions and throws comes first, so RED fails on assertions, not on a missing module. Then GREEN. |
| **Test Type Integrity** | PASS. These are unit tests against real `git` on throwaway repositories. Nothing is mocked, and nothing claims a live forge. |
| **Code Coverage: 70%** | PASS by design: the module matches `scripts/*.mjs` in `coverage-policy.yaml`. |
| **Behavior-descriptive identifiers** | PASS. `count-repo-metrics.mjs`, `classifyPath`, `countTestDeclarations`, `mergeLogColumn`. |
| **Argument contract** | PASS. `--append-log` mutates a file, so arguments go through `partitionArgsWithValues`: an unknown flag exits 2 and never falls through to a default. |
| **Secrets / topology scrub** | PASS. No credential, and no host. The script makes no network call. |
| **Nx as the task runner** | PASS. Tests run under `scripts:test`. The script is an operator command, the documented exception. It is not a gate, so it gets no `scripts:lint` entry. |
| **Documentation (doc-impact sweep)** | PASS, in tasks.md. `docs/runbooks/doc-drift.md` gains the step; `openwiki/runbooks/doc-drift.md` is refreshed (V17); a new concept page and an AGENTS.md index line are added. |

Re-checked after Phase 1 design: unchanged.

## Project Structure

```text
specs/013-learnings-ledger/
├── plan.md · research.md (R1–R7) · data-model.md · quickstart.md
├── contracts/cli.md
├── checklists/requirements.md
└── tasks.md                                   # /speckit-tasks

scripts/
├── count-repo-metrics.mjs                     # new (US1, plus --append-log for US2 and US3)
└── __tests__/count-repo-metrics.test.mjs      # new
docs/
├── BELAY-Learnings.md                         # new (US2)
└── runbooks/doc-drift.md                      # + the ledger-and-log step in the quarterly audit (US3)
openwiki/
├── projects/learnings-ledger.md               # new concept; resource: docs/BELAY-Learnings.md
└── runbooks/doc-drift.md                      # refreshed (its resource changes)
AGENTS.md                                      # one index line under Projects
```

**Structure Decision**: the existing `scripts` project, as features 009–012 did. The document sits at the top of
`docs/` beside `repo-foundation-setup.md`, the name the backlog item gives it.

## Complexity Tracking

No constitution violations.
