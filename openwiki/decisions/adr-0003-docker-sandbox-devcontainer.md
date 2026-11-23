---
type: Decision
title: ADR-0003 — the dev container in a dedicated Docker Sandbox microVM
description: Why BELAY's dev container runs in its own Docker Sandbox microVM with host-side default-deny egress and a CI-published, digest-pinned toolchain image — the rejected alternatives (sharing MCM's VM, a larger VM, Docker-in-Docker, reusing MCM's image) and what it costs (no in-sandbox image builds, worktrees that do not survive a rebuild, pins that never move by themselves).
tags: [decision, adr, devcontainer, sandbox, egress]
resource: docs/decisions/ADR-0003-docker-sandbox-devcontainer.md
resource-sha256: 6611dbecdfdb529c7935dae9491989d191e2a81dff8af120abfece8c1691ef0f
timestamp: 2026-11-23T23:53:08.967Z
---

# ADR-0003 — the dev container in a dedicated Docker Sandbox microVM

Accepted through feature 004 (2026-11-22) and back-filled on 2026-11-23. Unattended AI sessions run
here, so the environment bounds what they can reach and leak. Egress is default-deny, enforced
host-side from one committed allowlist and self-checked at every start. Tokens never enter an image
layer or a command line, and `ANTHROPIC_API_KEY` is never set. The toolchain is a CI-published image
pinned by digest, so a recreate is a download, not a rebuild.

## Gotchas

- **The image is never built inside the sandbox.** Building it needs hosts the allowlist deliberately
  excludes.
- **A digest pin never moves by itself.** The weekly rebuild reuses the pinned base, so a base-image
  patch arrives only through a pin change: the dependency bot ([ADR-0004](adr-0004-renovate-dependency-bot.md))
  proposes the change, and the image CVE scan (backlog item 49) shows when one is urgent.
- **Sharing MCM's VM was rejected**: MCM's container already uses 10 of the VM's 16 GiB, and removing
  MCM's sandbox would destroy BELAY with it.
- Daily use, recreate, re-pin and the worktree rule are in [the dev container runbook](../runbooks/devcontainer.md).
