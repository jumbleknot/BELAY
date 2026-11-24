# ADR-0003: The dev container runs in a dedicated Docker Sandbox microVM with default-deny egress

- **Status:** Accepted
- **Date:** 2026-11-22 (decided, feature 004) · 2026-11-23 (recorded, back-filled)
- **Approved by:** the maintainer, through feature 004's spec and plan ([specs/004-devcontainer-sandbox/](../../specs/004-devcontainer-sandbox/plan.md))
- **Related:** [the dev container runbook](../runbooks/devcontainer.md); MCM feature 060

## Context

AI coding sessions run unattended in the development environment, often several at once. The
environment therefore has to bound what a session can reach and what it can leak:

- network egress;
- the forge tokens;
- an `ANTHROPIC_API_KEY`, which would silently switch billing to per-token.

It also has to be reproducible, because a recreate that rebuilds the toolchain can silently pick up
different versions. MovieCollectionManager (MCM) found that its first container isolation had holes,
namely sibling containers and secrets baked into image layers, and moved its engine into a Docker
Sandbox microVM (MCM feature 060).

## Decision

BELAY's dev container runs inside **its own** Docker Sandbox microVM, `belay`, which has its own
container engine and volumes:

- **Egress is default-deny**, governed host-side by one committed allowlist
  (`.devcontainer/egress-allowlist.json`). A self-check runs at every container start and proves that
  a blocked destination is refused.
- **The toolchain is a prebuilt image** that CI publishes (`belay-devcontainer`). The sandbox pins it
  by digest, so a recreate is a download, not a rebuild.

Alternatives considered (feature 004's research):
- A second container inside MCM's VM. Rejected: MCM's container already uses 10 of the VM's 16 GiB,
  it would widen MCM's policy surface, and removing MCM's sandbox would destroy BELAY with it.
- A larger VM. Rejected: it cannot run alongside MCM's VM on this host.
- Keeping MCM's Docker-in-Docker path. Rejected: it exists in MCM only for the Android emulator's
  `/dev/kvm`, and BELAY has no Android work.
- Reusing MCM's image. Rejected: it is 13 GB, mostly Android, and named and published for MCM.

## Consequences

- The image is **never built inside the sandbox**, because building it needs hosts the allowlist
  deliberately excludes. It is built in CI, or on a host engine with open egress.
- A destination a new tool needs is a reviewed allowlist change, not a session-local workaround.
- Worktrees live in the container's overlay under `/home/coder/worktrees/`, so they do not survive a
  container rebuild. Push before anything risky.
- A digest pin never moves by itself. Keeping the base image current is the job of the dependency bot
  ([ADR-0004](ADR-0004-renovate-dependency-bot.md)) and of the image CVE scan (backlog item 49).
