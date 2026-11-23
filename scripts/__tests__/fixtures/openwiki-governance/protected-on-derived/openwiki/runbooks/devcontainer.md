---
type: Runbook
title: The dev container
description: Where the shared dev container comes from and the worktree rule.
resource: docs/runbooks/devcontainer.md
tags: [devcontainer]
---

# The dev container

Other sessions share the container, so commit from a worktree.

## A skipped test reads as a pass

`node --test` exits 0 when every test is skipped, so a credential-driven skip looks like a
green run. Read the skip count before calling a run a pass, and name the missing input before
retiring a tier to CI.
