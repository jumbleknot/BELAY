# Implementation Plan: The dependency bot's health loop

**Branch**: `012-renovate-health-loop` | **Date**: 2026-11-24 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/012-renovate-health-loop/spec.md`

## Summary

This feature ports MovieCollectionManager's three health scripts, with five changes, each measured or required by the
spec:
1. **The jobs fail loudly.** MCM's always exit 0.
2. **The lock-file check reads the bot's own result** (research R3). It asks Renovate what happened to lock-file
   maintenance, through a `lock file: <result>` suffix that feature 011's verdict status gains. It also asks whether a
   window run happened at all. That lets it tell an already-current lock file from a dead channel.
3. **A watchdog in the bot's own run** fails when the weekly report is more than 8 days old (R6), so "silence is the
   alarm" has a listener.
4. **Everything is found by label**, never by a hard-coded issue number (R4, R5).
5. **The reaper honours branch-protection rules** (R7).

The pieces:
- `check-lockfile-refresh.mjs` and `renovate-health.mjs` run together in `renovate-health.yml` (Wednesday 08:30 UTC),
  so a week produces one comment.
- `reap-merged-branches.mjs` runs daily in `branch-reaper.yml` (03:30 UTC). It is a dry run unless scheduled or asked.
- A small `lib/forge-list.mjs` reads every forge listing to its end.

## Technical Context

**Language/Version**: Node 26 (ESM `.mjs`); YAML for the two workflows

**Primary Dependencies**:
- `yaml`, already a workspace dependency;
- `ci-status.mjs` (`parseRequiredGlobs`, `computeMergeVerdict`);
- `check-renovate-config.mjs` (`cronMinutes`, `judgeRun`);
- `lib/is-main.mjs`, `lib/argv-contract.mjs`, `ci-log-step.sh` and `ci-failure-digest.mjs`.

No new dependency.

**Storage**: none. The report's only record is the tracking issue's comments (data-model.md).

**Testing**: `node:test` under `scripts:test`, with the coverage gate. Every forge and git call is injected, so the tests
use fixtures only. Each script's `--selftest` runs in `scripts:lint` and as a workflow step. Workflow guards parse the
YAML.

**Target Platform**: the `belay` runner; the dev container for offline runs and dry runs.

**Project Type**: repository tooling (the `scripts` Nx project) plus CI

**Performance Goals**: each job under 5 minutes; the forge listings are under 100 rows today.

**Constraints**:
- no new secret;
- never post "healthy" from partial data;
- the reaper is a dry run by default, and fails closed;
- no host literal;
- no `${{ }}` inside `run:`.

**Scale/Scope**: 3 scripts, 1 library, 2 new workflows, 2 small changes to feature 011's script and workflow, and
runbook and wiki updates.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Status |
| --- | --- |
| **Structural decisions** | PASS. No new toolchain, folder or dependency. ADR-0004 already names this loop as a consequence. |
| **TDD (NON-NEGOTIABLE)** | PASS. Stubs first, then RED on assertions, then GREEN, for every script and the feature 011 changes. The workflow guards precede the YAML. |
| **Test Type Integrity** | PASS. Unit tests inject `fetch` and `git`, and none claims a live forge. The live proof is quickstart §2 and §3. |
| **Code Coverage: 70%** | PASS by design: all new modules are under `scripts:test`. |
| **Secrets management** | PASS. No new secret. `CI_DIGEST_TOKEN`'s documented use widens to the health report (R2), and the secrets page and CI runbook say so in the same PR. The run token deletes branches, and cannot push to protected `main`. |
| **Nx as the task runner** | PASS. Self-tests run in `scripts:lint` and tests in `scripts:test`. The scripts are CI and operator commands, the documented exception. |
| **Documentation (doc-impact sweep)** | PASS, in tasks.md. `docs/runbooks/renovate.md` gains "The health loop"; `ci.md` gains the two workflows and the 200 floor; the secrets page, its wiki pages and AGENTS.md change wording. |

Re-checked after Phase 1 design: unchanged.

## Project Structure

```text
specs/012-renovate-health-loop/
├── plan.md · research.md (R1–R9) · data-model.md · quickstart.md
├── contracts/ cli.md · workflows.md
├── checklists/requirements.md
└── tasks.md                                  # /speckit-tasks

scripts/
├── lib/forge-list.mjs                        # new: paginated reads that fail closed (R8)
├── check-lockfile-refresh.mjs                # new (US2)
├── renovate-health.mjs                       # new (US1), plus --check-freshness (R6)
├── reap-merged-branches.mjs                  # new (US3)
├── check-renovate-config.mjs                 # judgeRun appends "; lock file: <result>" (R3)
└── __tests__/ forge-list · check-lockfile-refresh · renovate-health · reap-merged-branches
              · renovate-health-workflows.guard (new) · check-renovate-config, renovate-workflow.guard (extended)
.forgejo/workflows/
├── renovate-health.yml · branch-reaper.yml   # new
└── renovate.yml                              # + the freshness watchdog step
infrastructure-as-code/forgejo/registry-retention.yaml   # keepNewest 150 → 200
docs/runbooks/renovate.md · ci.md             # the health loop; the workflows; the floor; CI_DIGEST_TOKEN's use
openwiki/…                                    # refreshed pages, secrets posture
```

**Structure Decision**: the existing `scripts` project and `.forgejo/workflows/`, as features 009–011 did.

## Complexity Tracking

No constitution violations.
