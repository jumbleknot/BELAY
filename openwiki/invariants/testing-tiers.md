---
type: Convention
title: Testing tiers and what gates a merge
description: The test and gate tiers BELAY has today — node:test unit tests and self-testing gates, both run through Nx and required by the guardrails check — the constitution's unit, integration and E2E definitions a new project inherits, why a skip is treated as a false green, and the rule that a failing guard is fixed at its cause, never deleted.
tags: [testing, tdd, ci, gates]
timestamp: 2026-11-22
---

# Testing tiers and what gates a merge

TDD is mandatory (constitution, **Test-Driven Development**): tests written, then approved, then
failing, then the implementation, then passing, then refactoring. Every test task in a `tasks.md`
uses the Verify RED / Verify GREEN format (see
[test authoring conventions](../process/test-authoring-conventions.md)).

## What exists today

| Tier | What it is | Run with | Gates a merge? |
| --- | --- | --- | --- |
| **Gates** | Repository checks that scan the tree and fail on drift: the Spec Kit override gate, the CI digest-coverage gate, the egress allowlist check, the secret scan, the topology scrub, toolchain consistency, the inline-secret, argv-secret, override-floor and resource-naming gates (which guard compose files, Maestro and overrides ahead of their arrival), and the OpenWiki OKF and governance gates | `pnpm nx run scripts:lint` | **Yes**, through the required `guardrails` check |
| **Selftests** | Each gate's `--selftest`, plus the secret-scan, redactor, digest and `ci-status` selftests. They prove a detector still detects, so a gate cannot pass vacuously | `pnpm nx run scripts:lint` | **Yes** |
| **Unit** | `node:test` files in `scripts/__tests__/*.test.mjs`. Forge calls are made against fakes and fixtures, never the real forge | `pnpm nx run scripts:test` | **Yes** |
| **Coverage** | The unit tests run under Node's built-in coverage, then `scripts/check-coverage.mjs` fails if any source module (`scripts/*.mjs`, `scripts/lib/*.mjs`) or the total is below **70% of lines**, or if a source module is missing from the report. A module no test loads is absent from the report, not shown at 0%, so it fails as uncovered. Branches are reported, not gated. The floor and any expiring exceptions live in one place, `scripts/coverage-policy.yaml` | `pnpm nx run scripts:test` (the same run as Unit) | **Yes** |
| **Image CVE scans** | Not run by `scripts:lint` or `scripts:test`, because they need Trivy and the network. The dev-container build scans its image **before push** and publishes nothing on a fixable Critical. `image-scan.yml` sweeps every third-party image Tuesday and Friday and on change. The `image-scan` and `check-image-findings` selftests run in `scripts:lint`. See [image scanning](../runbooks/image-scanning.md) | `devcontainer-image.yml`, `image-scan.yml` | The builder gate blocks **publication**. The sweep is **not** a required merge check (research R8 of feature 010) |

The `pdlc` server (`mcp-servers/pdlc/`, feature 014) adds three tiers of its own:

| Tier | What it is | Run with | Gates a merge? |
| --- | --- | --- | --- |
| **pdlc unit and contract** | `node:test` files in `mcp-servers/pdlc/tests/unit/`, with fetch and git doubles injected; the contract test connects a real MCP client to the real server over the SDK's in-memory transport. Then the same 70% coverage gate, through `check-coverage.mjs --policy mcp-servers/pdlc/coverage-policy.yaml` | `pnpm nx run pdlc:test` | **Yes** |
| **pdlc integration (real git)** | Real `git` against local `file://` bare repositories: blobless clone, fast-forward, and every copy refusal, with no doubles and no forge | `pnpm nx run pdlc:integration` | **Yes** |
| **pdlc integration (real forge)** | The real forge and the real `ci-smoke` repository, never mocked. It maps `FORGE_ISSUE_TOKEN` to `PDLC_FORGE_TOKEN` at the point of use and **fails, never skips**, without it | `pnpm nx run pdlc:integration-forge` | **No**: operator-run in the dev container, because nothing in CI talks to a live forge |

## What a new project inherits

The constitution defines the tiers a project under `backend/`, `frontend/` or `agents/` must have:
unit tests (a single function in isolation, where external dependencies may be mocked), integration
tests (real dependencies, **never** mocked), and E2E tests (critical user flows on a real device or
simulator). **Test Type Integrity** is non-negotiable: a test's classification must match what it
actually exercises. Each tier gets its own Nx target, and CI decides which ones gate a merge.

## Gotchas

- **Run the tiers your DIFF touches, not the ones you remember.** Work out the targets from what
  changed. A change to `.specify/` or `.claude/skills/speckit-*` needs the Spec Kit gate. A change to
  a workflow needs the digest-coverage gate and `guardrails-workflow.test.mjs`. A change to a script
  needs its tests. A tier you did not think of is a tier that did not run. Since both targets are
  cheap, run both before every push.
- **A skipped test exits 0 and reads as a pass, so watch the SKIP COUNT.** `node --test` reports
  skips separately. A test that skips because the host is missing something (for example
  `ci-log-step`'s tests without a usable bash) must skip *with a reason*, and
  `scripts/__tests__/shell-probe.mjs` treats a missing script as a failure, not a skip. A reasonless
  skip is the false green this discipline exists to prevent.
- **"It can't run in this environment" needs the same proof as "it passes".** A skip driven by a
  credential or a tool is almost always a missing *file* or *setting*, not a missing capability.
  Name the missing input, and check whether a documented command supplies it, before you leave the
  tier to CI.
- **A guard that fails because you changed what it protects is UPDATED at the cause, never
  deleted.** Make it assert the new premise, so it still fails if that regresses. A guard removed
  for being inconvenient is the regression it was written to catch. The Spec Kit gate's
  `resolution-broken` code says this outright, and the same holds for every gate here.
- **A selftest is part of the gate.** When you add a failure code to a gate, add the selftest case
  that proves it is detected, in the same change.

See [the validation checklist](./feature-validation-checklist.md) for the sequence a feature runs
before it is marked complete, and [CI guardrails](../runbooks/ci.md) for the workflow that runs
these targets.
