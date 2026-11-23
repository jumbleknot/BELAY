# ADR-0001: pnpm is the only JavaScript package manager and Nx the only task runner

- **Status:** Accepted
- **Date:** 2026-11-21 (decided, at the repository's foundation) · 2026-11-23 (recorded, back-filled)
- **Approved by:** the maintainer, 2026-11-21 (constitution v1.0.0, Common Technology Stack and Standards)
- **Related:** backlog item 50; [package-manager enforcement](../../openwiki/invariants/package-manager-enforcement.md), [Nx as the task runner](../../openwiki/invariants/nx-task-runner.md)

## Context

BELAY is shared tooling that other repositories consume, so its commands have to give the same result
for a developer, an AI coding session and CI. MovieCollectionManager (MCM), which BELAY is ported
from, learned three things the hard way:

- with more than one package manager, lock files and install behaviour diverge;
- a tool run directly, rather than through one runner, ends up with different flags locally and in CI;
- a second `packageManager` declaration drifts a whole major version behind the first once a bot
  maintains each copy separately.

## Decision

**pnpm is the only package manager**, enforced by the root `preinstall` hook (`only-allow pnpm`),
pinned once in the root `packageManager` field, and installed with `--frozen-lockfile`. **Nx is the
only task runner.** Every test, lint, build, e2e and deploy operation is an Nx target. CI's whole check
surface is `pnpm nx run scripts:lint` and `pnpm nx run scripts:test`.

The one exception is the operator CLIs (`ci-status.mjs`, `forge-pr.mjs`, `backlog.mjs`,
`taskstoissues.mjs`). They take different arguments on every call, so they run directly with `node`,
while their tests still run through Nx.

No other language toolchain is chosen. Adding one (Rust, Python or anything else) is a new structural
decision and needs its own ADR.

Alternatives considered:
- npm or yarn workspaces. Rejected: the tooling, gates and lock-file handling ported from MCM assume
  pnpm, and pnpm's `allowBuilds` gives an explicit supply-chain control over install scripts.
- Running tools directly with no task runner. Rejected: local runs and CI drift apart, and nothing
  makes "the command CI runs" a single, named thing.

## Consequences

- Every package with an install script needs an explicit `allowBuilds` entry in `pnpm-workspace.yaml`.
  An undecided package is a hard install error under pnpm 11 and later.
- `check-toolchain-consistency.mjs` keeps the pnpm, Node and Nx pins in agreement across workflows and
  Dockerfiles.
- A new project under `backend/`, `frontend/`, `agents/`, `mcp-servers/`, `packages/` or `tools/` adds
  Nx targets. If it brings a new language, it also needs a new ADR.
