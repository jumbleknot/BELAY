---
type: Decision
title: ADR-0004 — a self-hosted Renovate bot proposes updates
description: The maintainer's 2026-11-23 approval of a self-hosted Renovate bot on Forgejo Actions to keep BELAY's SHA, digest, lockstep and lockfile pins current — propose only, never automerge, a human merges — what is fixed now and what is left to the feature spec (backlog item 47), and why the bot is not done until its health loop (backlog item 48) is.
tags: [decision, adr, renovate, dependencies, supply-chain]
resource: docs/decisions/ADR-0004-renovate-dependency-bot.md
resource-sha256: 927ef85b5de52131ffdeffbe5b12056135f4fa5f2d9aa874c737e4c6603a7abf
timestamp: 2026-11-23T23:53:09.011Z
---

# ADR-0004 — a self-hosted Renovate bot proposes updates

Accepted on 2026-11-23. BELAY pins nearly everything: action SHAs, the base-image digest, the exact
lockstep groups and the lock file. A pinned thing never updates itself, and other repositories consume
these pins. Renovate runs as a Forgejo Actions workflow with its own bot account, because the hosted
app supports only GitHub. It only **proposes**: `automerge` is false, CI judges, a human merges.

## Gotchas

- **The ADR fixes the boundaries, not the configuration.** The schedule, groups and holds come from the
  feature spec that backlog item 47 requires. The fixed points are digest pinning, lockfile
  maintenance, a release-age cooling-off period, security updates exempt from the schedule, and a
  justification plus a re-check rule on every hold.
- **The bot is not done until its health loop is** (backlog item 48). MCM's bot was broken in four
  independent ways that nobody noticed, and a silent bot is worse than none.
- **A new long-lived credential**: the bot token lives only in an Actions secret, never in the dev
  container. The [secrets posture](../invariants/secrets-management.md) gains it with the spec.
- **No wiki page may cite a file the bot rewrites** ([ADR-0002](adr-0002-session-maintained-wiki.md)).
