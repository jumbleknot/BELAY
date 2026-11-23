---
type: Runbook
title: The dev container — Docker Sandbox, credentials, egress and the worktree rule
description: BELAY's dev container in the dedicated belay Docker Sandbox microVM — the one-step launcher, what survives a recreate versus sbx rm, how forge tokens reach the container without entering an image, bring-up from nothing (including the kit's missing Node), recreate and re-pin from the CI-published digest and recording the pin so retention keeps it, the default-deny egress allowlist and its approval-queue rule, the sbx upgrade ritual, the worktree rule, and the measured traps.
tags: [devcontainer, sandbox, egress, credentials, worktree, runbook]
resource: docs/runbooks/devcontainer.md
resource-sha256: c1dc351d2723008e473e023cce7a24635f2381ecb2b631b29a6f363f7bb70c16
timestamp: 2026-11-23T13:26:41.480Z
---

# The dev container — Docker Sandbox, credentials, egress and the worktree rule

BELAY's environment is a dev container inside the dedicated `belay` Docker Sandbox microVM (8 GiB)
on the Windows host, with the checkout at `/workspaces/belay`. Outbound traffic is default-deny,
governed host-side by `.devcontainer/egress-allowlist.json`. The container is built from the
digest-pinned `belay-devcontainer` image that CI publishes. `.\scripts\open-sandbox.ps1` takes you
from a stopped sandbox into VS Code in the container, measured at 9 s. Full procedure:
[docs/runbooks/devcontainer.md](../../docs/runbooks/devcontainer.md).

## Gotchas

- **`ANTHROPIC_API_KEY` is never set.** The forge tokens reach the container only through
  `--env-file`, written by `gen-container-secrets-env.sh` from the VM's `~/.belay-sandbox-env`. They
  never go in `containerEnv`, which is baked into image layers. Never paste `docker inspect
  <container>` output: an env-file value is, by design, in the container's runtime environment.
- **Git push and `forge-pr.mjs` work only in a VS Code terminal.** The container has no git
  credential of its own; git there uses the helper VS Code forwards from the VM's store.
- **`sbx rm` takes everything:** the clone, the volumes (logins, plugins, RTK), the env file and the
  policy. A container recreate keeps all of them, and was measured at 31–41 s with 0 toolchain
  layers rebuilt.
- **Never build the image inside the sandbox.** rustup's hosts are not allowlisted. CI builds it; a
  local build needs open egress.
- **The kit VM has no Node, and its package repository is blocked.** Install the official Node
  tarball from `nodejs.org`, which is allowlisted, then the devcontainer CLI.
- **Record every re-pin, or retention can delete it.** Retention keeps the newest 4
  `belay-devcontainer` versions or anything younger than 21 days. An older pin survives only if its
  digest is under `protect:` in `infrastructure-as-code/forgejo/registry-retention.yaml`, so each
  re-pin is followed by a PR that adds the new digest there and drops the old one. A digest is not a
  secret; the registry host stays in the VM's env file.
- **Configure the VM from the host, over stdin.** Bring-up's engine, git and env-file steps run from
  Git Bash through `sbx exec -i`, with every value piped on stdin, so no token appears in any
  process's argv.
- **Source the env file with `set -a`.** Otherwise the pin is not exported, and the build silently
  uses a stale local tag. `check-image-pin.sh` warns when that happens.
- **The first `git pull` after the lock file is committed upstream fails** on the VM's untracked
  `devcontainer-lock.json`. Compare it, delete it, then pull.
- **Refusals in `sbx policy approval ls` are dismissed, never approved.** A committed allowlist
  entry does nothing for a running sandbox until it is applied with `sbx policy allow network`.
- **`sbx start` does not exist.** Restart with `sbx run --name belay -d`, and trust SSH answering
  over its exit code.
- **Windows PowerShell 5.1 reads `sbx ls --format json` as one object.** Unroll it before filtering,
  or a stopped sandbox reads as running whenever another one is up.
- **Commit from a worktree, never from `/workspaces/belay`**, when other sessions share the
  container. A worktree does not survive a rebuild, so push first.
