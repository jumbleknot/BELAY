---
type: Decision
title: ADR-0001 — pnpm and Nx only
description: Why pnpm is the only JavaScript package manager and Nx the only task runner in BELAY — enforced by preinstall and a single packageManager pin, with CI's whole check surface as two Nx targets — the operator-CLI exception, and why any other language toolchain is a new decision rather than a default.
tags: [decision, adr, pnpm, nx, toolchain]
resource: docs/decisions/ADR-0001-pnpm-and-nx-only.md
resource-sha256: 67da30d3f21879d702e793c40facb040e8e80872336323b34a5b1fc8e61a24c4
timestamp: 2026-11-23T23:53:08.873Z
---

# ADR-0001 — pnpm and Nx only

Accepted at the repository's foundation (2026-11-21) and back-filled on 2026-11-23. pnpm is the only
package manager. It is enforced, not encouraged: the root `preinstall` hook runs `only-allow pnpm`,
and pnpm's version is pinned once, in the root `packageManager`. Nx is the only task runner, and CI
runs exactly `scripts:lint` and `scripts:test`. The reason is that a developer, a session and CI must
get the same result from the same command.

## Gotchas

- **No other language toolchain is chosen.** Rust or Python arriving with a first project is a new
  structural decision and needs its own ADR. The constitution's stack sections describe what such a
  project *would* use, not a decision already taken.
- **Operator CLIs are the one exception**: they run with `node` directly because their arguments vary
  per call. Their tests still run through Nx.
- The operational detail lives in [package-manager enforcement](../invariants/package-manager-enforcement.md)
  and [Nx as the task runner](../invariants/nx-task-runner.md). This page carries only the decision.
