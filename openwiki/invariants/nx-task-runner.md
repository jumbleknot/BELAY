---
type: Convention
title: Nx as the universal task runner
description: Why every test, lint, build, e2e and deploy operation goes through an Nx target rather than the underlying tool, the two scripts targets that are CI's whole check surface, and the deliberate exception for operator CLIs whose arguments vary per invocation.
tags: [nx, monorepo, tooling, build]
timestamp: 2026-11-22
---

# Nx as the universal task runner

The constitution's **Monorepo Build Tool** principle requires every test, lint, build, e2e and deploy
operation to run through an Nx target, as `pnpm nx run <project>:<target>`. pnpm scripts in
`package.json` may exist only as implementation details called by a target, never as the main way to
run something.

Today the workspace has one project, `scripts` (`scripts/project.json`), with two targets:

| Target | What it runs |
| --- | --- |
| `pnpm nx run scripts:lint` | every gate and its selftest: the Spec Kit override gate, the CI digest-coverage gate, and the secret-scan, redactor, digest and `ci-status` selftests |
| `pnpm nx run scripts:test` | `node --test "scripts/__tests__/*.test.mjs"` |

**These two commands are exactly what CI runs** (see [CI guardrails](../runbooks/ci.md)), so running
them locally reproduces the required check.

## Gotchas

- **Operator CLIs are run directly with `node`, and that is not drift.** `scripts/ci-status.mjs`,
  `scripts/forge-pr.mjs`, `scripts/backlog.mjs` and `scripts/taskstoissues.mjs` take different
  arguments on every call and are typed by a human or an agent several times in one turn. They are
  not test, lint or build operations, so they get no target. Their unit tests still run inside Nx,
  through `scripts:test`, so nothing escapes the gate. The dividing line is *who types the command*:
  fixed-argument gate, build, test and lifecycle operations get targets, and tools whose flags vary
  per call do not. MovieCollectionManager also had a cost reason: a target took about 60 seconds of
  project-graph computation there, against 0.09 seconds for the same script run directly. BELAY's
  graph is small, about 1 second per target, so the reason here is the varying arguments.
- **BELAY runs its gates through Nx in CI too.** MovieCollectionManager's constitution v2.12.0 lets
  CI run `scripts/` gates directly with `node`, to avoid that 60-second cost. BELAY did not adopt the
  exception, because at about 1 second per target nothing needs it.
- **A gate may also be run on its own for speed while iterating**, for example
  `node scripts/check-speckit-overrides.mjs`. That is fine for a quick check. The target is still the
  definition of "passes", so run it before you push.
- **A new project gets targets, not package.json scripts.** When a project appears under
  `backend/`, `frontend/`, `agents/`, `mcp-servers/`, `packages/` or `tools/`, its operations are Nx
  targets from the start. The constitution names the Nx plugins each stack uses. Adding one is a
  structural decision, so ask first.
- **Lockstep groups are exact.** `nx`, any `@nx/*` and `@playwright/test`, when added, are pinned to
  an exact version, because their packages must move together. Other dev dependencies may use `^`, since the lock file pins
  every install (constitution, **Dependency Security**).
- **`test` is cached in `nx.json`.** Its inputs are the project's own files. A test that depends on
  state Nx cannot see, such as a live forge or a running database, must not be cached. Mark such a
  target `cache: false` when one is added, or a stale pass is replayed from cache.

- **No Nx plugin for coding assistants is installed, by decision.** `nx configure-ai-agents` would
  enable the `nx@nx-claude-plugins` Claude Code plugin in `.claude/settings.json` and write an Nx
  block into `CLAUDE.md`. BELAY tried it on 2026-11-22 and removed it, as MovieCollectionManager did,
  because it went unused there for a long time. It also pulled an unpinned third-party marketplace
  into every session. Don't re-run the generator without asking. `configure-ai-agents --check`
  reporting agents as "not configured" is expected.

See [package-manager enforcement](./package-manager-enforcement.md) for how dependencies get
installed in the first place.
