---
type: Runbook
title: The dev container — credentials and the worktree rule
description: The planned shared dev container's runbook, created ahead of the container — the credential rule (never ANTHROPIC_API_KEY), why sessions sharing one checkout must commit from their own git worktree, how far a symlinked node_modules gets you before an Nx target needs a real install, the traps, and why a worktree does not survive a rebuild.
tags: [devcontainer, git, worktree, credentials, runbook]
resource: docs/runbooks/devcontainer.md
timestamp: 2026-11-22
---

# The dev container — credentials and the worktree rule

**The dev container is planned, not built.** Its runbook,
[docs/runbooks/devcontainer.md](../../docs/runbooks/devcontainer.md), exists ahead of it so the rules
that apply inside it have one home from the start. Its paths (`/workspaces/belay`,
`/home/coder/worktrees/`) are the intended layout and must be confirmed when the container lands.

Two rules are written so far. **Credentials:** `ANTHROPIC_API_KEY` is never set anywhere AI coding
runs, and forge tokens come from the host environment, never from a committed file. **The worktree
rule:** several assistant sessions share one container and one checkout, including the git index
and the checked-out branch, so each session commits from its own `git worktree` under
`/home/coder/worktrees/`, never from `/workspaces/belay`.

## Gotchas

- **`git checkout -b`, `git add -A` or `git stash` in the shared checkout rewrites another session's
  work**, silently, and the damage lands on the other session.
- **`/workspaces` is not writable**, so a worktree under `/workspaces/.worktrees/` fails with a
  `Permission denied` that looks like a git problem.
- **A symlinked `node_modules` covers `node --test` and the gate scripts, not `pnpm nx`.** Any Nx
  target fails with `ERR_PNPM_UNSAFE_MODULES_DIR` until you run a real
  `CI=true pnpm install --frozen-lockfile` in the worktree. The obvious workarounds don't work.
- **`node_modules` is ignored without a trailing slash**, so the symlink is ignored too. With a slash,
  `git add -A` commits the symlink and every CI install fails with `ENOTDIR`.
- **A worktree does not survive a container rebuild.** Push before any risky container operation,
  then run `git worktree prune`.
- **Forge-API work needs no worktree.** Opening, watching and merging PRs, and backlog edits, are
  HTTP calls that never touch the index.
