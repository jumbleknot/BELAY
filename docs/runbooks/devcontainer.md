# Runbook: the dev container

> **Status: planned, not built yet.** BELAY has no `.devcontainer/` today. This runbook is created
> ahead of the container, so the rules that apply to it have one home from the start. Its paths
> (`/workspaces/belay` for the shared checkout, `/home/coder/worktrees/` for worktrees) are the
> intended layout. **When the container lands, confirm every path and command here against it**,
> and fill in the sections marked *To write*.

## Credentials

AI-assisted coding runs on the **subscription**. **`ANTHROPIC_API_KEY` must never be set** on the
host, in the dev container or in any sandbox, because Claude Code silently prefers it over a
subscription login and bills per token. A tool that needs a model key takes it under another name,
mapped to `ANTHROPIC_API_KEY` only in the process that uses it. The forge tokens (`FORGE_TOKEN`,
`FORGE_ISSUE_TOKEN`) are forwarded from the host's user environment. Never write them into a
committed file. See [the secrets posture](../../openwiki/invariants/secrets-management.md).

*To write:* how the container receives these variables (`localEnv` forwarding), and which ones it
needs.

## Shared dev container: commit from a worktree

**Several assistant sessions share one container and one checkout.** They share the filesystem,
the pnpm store and, the part that causes damage, **the git index and the checked-out branch**.
`git checkout -b`, `git add`, `git stash` and `git rebase` in `/workspaces/belay` are not private
acts. They change what every other session is looking at, mid-edit. The damage lands silently on
the *other* session, which sees files it did not write, a branch it did not create, or its
half-finished work swept into someone else's commit by `git add -A`.

**So never commit or switch branches in `/workspaces/belay` when another session may be active.
Add a worktree instead:**

```bash
git fetch -q origin main
git worktree add -b <branch> /home/coder/worktrees/<slug> origin/main
ln -sfn /workspaces/belay/node_modules /home/coder/worktrees/<slug>/node_modules
```

Treat "another session may be active" as the default when you have not checked. In Claude Code, the
session list shows the others. A worktree costs seconds, and a collision costs someone else's work.

### Traps

- **`/home/coder/...`, never `/workspaces/.worktrees/...`.** `/workspaces` itself is not writable.
  Only the checkout inside it is. The wrong path fails with a bare `Permission denied` that reads
  like a git problem rather than a path problem.
- **A symlinked `node_modules` is enough for `node --test` and the `scripts/*.mjs` gates, and for
  nothing that runs through `pnpm nx`.** pnpm checks dependencies before running a target, decides
  the symlinked tree is foreign, and refuses:

  ```text
  ERR_PNPM_UNSAFE_MODULES_DIR  Refusing to remove the modules directory at
  "/workspaces/belay/node_modules" because its resolved target is not a strict
  subdirectory of the project root at "/home/coder/worktrees/<slug>"
  ```

  That reads like a permissions bug in the target. Two plausible workarounds both fail, so don't
  spend the time: `npm_config_verify_deps_before_run=false` does not suppress the check, and
  `cp -al` cannot hardlink the tree because `/workspaces` and `/home/coder` are different devices
  (`Invalid cross-device link`). The only fix is a real install in the worktree:

  ```bash
  cd /home/coder/worktrees/<slug>
  rm -f node_modules                          # the symlink
  CI=true pnpm install --frozen-lockfile      # CI=true answers pnpm's purge prompt
  ```

  It writes only inside the worktree, and the content-addressed store is shared, so it does not
  disturb the other session. **Decide from the diff.** BELAY's required checks, `scripts:lint` and
  `scripts:test`, are Nx targets, so a change you push should be proven through them, which needs
  the real install.
- **`.gitignore` says `node_modules` with NO trailing slash. Keep it that way.** A trailing slash
  matches only a directory, so the symlink would not be ignored and `git add -A` would commit it.
  `git diff --stat` does not list untracked files, so reviewing the diff does not catch it. CI then
  checks out a symlink where pnpm needs a directory, and every install fails with
  `ENOTDIR: not a directory`, which reads like a broken toolchain. With any symlink into the main
  checkout, check `git status --porcelain`, not `git diff`, before committing.
- **Nx can hand you a STALE failure.** If an Nx failure's message doesn't match what is on disk,
  re-run it with `--skip-nx-cache` before diagnosing it.
- **A fresh worktree lacks gitignored files**, such as local `.env` files or generated reports. A
  gate that reads one rather than generating it fails in a way that looks like a code failure. Copy
  the input across from the main checkout. That is a missing input, not a missing capability.
- **Reads and forge-API work need no worktree.** `git fetch`, `git log`, `git show`, and everything
  done through the forge API (`forge-pr.mjs`, `ci-status.mjs`, `backlog.mjs`) are safe from the
  shared checkout. Only operations that move `HEAD` or touch the index need a worktree.

### A worktree does not survive a rebuild

`/home/coder/worktrees/` is on the container's own filesystem, so a rebuild deletes it, while
`git worktree list` (read from the checkout's `.git`, on the mounted volume) still lists it, marked
`prunable`. **Push the branch before any risky container operation.** A pushed branch and a merged
PR survive; uncommitted worktree changes do not. Afterwards, run `git worktree prune` in
`/workspaces/belay`.

### Cleanup

Clean up when the branch merges, or the next session inherits a stale tree:

```bash
git worktree remove /home/coder/worktrees/<slug>
git worktree prune
```

## To write when the container lands

- What the container is (image, base, how it is opened) and how to rebuild it.
- The toolchain it bakes in: Node, pnpm through `packageManager`, `pwsh` for the Spec Kit scripts, and
  RTK.
- Network egress, if it is restricted.
- Running the checks inside it: `pnpm nx run scripts:lint` and `pnpm nx run scripts:test`.
