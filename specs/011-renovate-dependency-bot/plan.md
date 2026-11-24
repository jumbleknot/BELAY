# Implementation Plan: A self-hosted dependency bot

**Branch**: `011-renovate-dependency-bot` | **Date**: 2026-11-24 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/011-renovate-dependency-bot/spec.md`

## Summary

Run Renovate as a scheduled Forgejo Actions workflow on the `belay` runner, as a dedicated bot account (ADR-0004). It
proposes PRs and never merges them. The design ports MovieCollectionManager's measured setup, with five deliberate
changes:
- a **UTC** window, which removes MCM's DST-intersection failure (research R2);
- a security channel every **six hours** with a 12-hour cooling-off, so SC-001's 24 hours holds (R4);
- an **exact, self-managed** Renovate version, so the bot proposes its own upgrades (R1);
- **version-and-checksum pairs** moved together by a post-upgrade task, with a guardrails step behind it (R7);
- a **pin-inventory guard**, so a pin the bot cannot see is a failing test, not a silent gap (R8).

Two new scripts carry the logic:
- `check-renovate-config.mjs`: policy rules C1–C11, the run verdict, and the Renovate version;
- `refresh-pin-checksum.mjs`: re-derives a pair's sha256, cross-checked against the publisher's checksum.

The workflow, `renovate.yml`, preflights the token, validates the config strictly, runs Renovate, and judges the run
from its JSON log, so a run that did nothing cannot pass. Smaller changes:
- `backlog.mjs ready` hides the dashboard;
- guardrails gains the validator and the checksum check;
- the retention floor rises to 150.

The live parts wait on the maintainer's one-time setup in [quickstart.md §2](quickstart.md#2-maintainer-setup-one-time-in-the-forges-web-ui):
the bot account, its token and an optional github.com read token.

## Technical Context

**Language/Version**: Node 26 (ESM `.mjs`) for the scripts; YAML for the workflow; JSON for `renovate.json`

**Primary Dependencies**:
- Renovate 44.x, an exact version, run by `npx` inside the job container. It is never a workspace dependency (R1).
- `yaml`, already a workspace dependency.
- `scripts/ci-log-step.sh`, `scripts/install-pnpm.sh`, `scripts/ci-failure-digest.mjs` and `scripts/lib/is-main.mjs`,
  all existing.

**Storage**:
- `renovate.json` at the root (ADR-0004 fixes its location);
- `security/dependencies/unmanaged-pins.yaml`, the exclusions;
- the dashboard issue on the forge.

**Testing**: `node:test` under `scripts:test`, and so under the coverage gate (70% of lines per module). The rules are
pure functions over parsed config, workflow and file text, and `fetch` is injected into the checksum script. The guard
tests run the rules against the real files. The live runs are the quickstart dispatches §3 and §4.

**Target Platform**: the `belay` runner (a `node:26-bookworm` job container with no Docker), and the dev container for
the offline checks.

**Project Type**: repository tooling (the `scripts` Nx project) plus CI

**Performance Goals**:
- the bot run should take under 10 minutes; MCM's takes 3–6 for a larger tree;
- the guardrails validator step should take under 60 seconds;
- the checksum step downloads nothing unless a pair's file changed.

**Constraints**:
- no host literal and no token in git;
- every `run:` through `ci-log-step.sh`, with the failure digest last;
- automerge impossible;
- the run fails loudly (FR-015);
- dispatch defaults to a dry run.

**Scale/Scope**: about 20 managed dependencies and 12 custom-manager sites (data-model.md inventory), with 4 PRs a
week at most.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Status |
| --- | --- |
| **Structural decisions** (`AGENTS.md`, ADR rule) | PASS. ADR-0004 approves Renovate and the top-level `renovate.json`. `npx` installs Renovate into a throwaway job container, so it adds no workspace dependency, no `allowBuilds` entry and no lock file change (R1). `security/dependencies/` sits beside `security/images/` and `security/sast/`, not at the top level. The new credential is ADR-0004's recorded consequence. |
| **Dependency Security**: kept up to date, scanned, pinned | **Strengthened**. This is the feature that moves the pins. Lockstep groups move as one (C10). The bot itself runs at an exact version installed `--before` three days (R1). Checksum pairs are cross-checked against the publisher (R7). |
| **Lockstep groups MUST be exact** | PASS. `nx` is exact today and the toolchain-consistency gate still runs on every bot PR. Lock-file maintenance cannot split a group (R6). |
| **TDD (NON-NEGOTIABLE)** and the RED/GREEN format | PASS. Every rule, the verdict and the checksum script have tests written first against stubs. The workflow guard precedes the YAML. Where `backlog.mjs ready` already exists, the RED is a mutation test. |
| **Test Type Integrity** | PASS. Unit tests inject `fetch` and use fixture logs; none claims a real Renovate run. The real runs are quickstart §3 and §4. |
| **Code Coverage: 70%** (feature 009 gate) | PASS by design. Both new modules are measured by `scripts:test`. |
| **Secrets management** | PASS. `RENOVATE_TOKEN` (and the optional `RENOVATE_GITHUB_COM_TOKEN`) live only as Actions secrets, belong to a dedicated restricted account with the minimum measured scopes (R13), and are never printed. The preflight reports *that* a call was refused, not the token. `secrets-management.md` gains both rows. |
| **Nx as the task runner** | PASS. The self-test runs in `scripts:lint` and the rules in `scripts:test`. `--run-verdict`, `--print-renovate-version` and the checksum CLI are CI and operator commands, the documented exception. |
| **Behavior-Descriptive Identifiers** | PASS: `check-renovate-config`, `refresh-pin-checksum`, `unmanaged-pins.yaml`. |
| **Documentation (doc-impact sweep)** | PASS, in tasks.md. A new runbook, `docs/runbooks/renovate.md`, with an openwiki concept page. The `ci.md`, `backlog.md`, `secrets-management`, `testing-tiers` and `repository.md` pages refresh. The unenforced-rules register gains the R7 known limitation. AGENTS.md gains index entries. |

Re-checked after Phase 1 design: unchanged. Recorded deviations from MCM (all stricter):
- the UTC window;
- the six-hourly security channel;
- the exact self-managed version;
- checksum pairs moved by the bot (MCM leaves the PR red for a human);
- the log-based verdict.

## Project Structure

### Documentation (this feature)

```text
specs/011-renovate-dependency-bot/
├── plan.md              # this file
├── research.md          # R1–R13
├── data-model.md        # managed pin, exclusion, hold, group, dashboard, run verdict, today's inventory
├── quickstart.md        # §1 offline · §2 maintainer setup · §3 dry run · §4 first live run · §5 checksum pairs
├── contracts/
│   ├── renovate-config.md   # policy rules C1–C11
│   ├── cli.md               # check-renovate-config, refresh-pin-checksum, backlog ready, retention
│   └── workflow.md          # renovate.yml steps and the guardrails steps
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
renovate.json                                   # new: the bot's config (ADR-0004)
security/dependencies/unmanaged-pins.yaml       # new: exclusions, each with a reason
.forgejo/workflows/renovate.yml                 # new: the scheduled bot
.forgejo/workflows/guardrails.yml               # + validator step, + checksum-pair step
scripts/
├── check-renovate-config.mjs                   # new: rules C1–C11, --run-verdict, --print-renovate-version, --selftest
├── refresh-pin-checksum.mjs                    # new: post-upgrade task and --verify-changed
├── backlog.mjs                                 # ready hides status/bot-managed; the taxonomy gains three labels
└── __tests__/
    ├── check-renovate-config.test.mjs          # new: each rule against fixtures
    ├── renovate-config.guard.test.mjs          # new: the rules against the real tree
    ├── renovate-workflow.guard.test.mjs        # new: workflow.md's assertions
    ├── refresh-pin-checksum.test.mjs           # new: injected fetch
    └── backlog.test.mjs                        # + ready excludes the dashboard
infrastructure-as-code/forgejo/registry-retention.yaml   # keepNewest 125 → 150
docs/runbooks/renovate.md                       # new: FR-018's runbook
openwiki/runbooks/renovate.md                   # new: concept page (resource: the runbook)
```

**Structure Decision**: everything lives in the existing `scripts` Nx project and `.forgejo/workflows/`, which is the
pattern of features 006, 009 and 010. Only `renovate.json` is new at the root, and ADR-0004 decides it.

## Complexity Tracking

No constitution violations.
