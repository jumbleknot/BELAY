# Decision records (ADRs)

An architecture decision record (ADR) is a short, dated document that states one decision, the
context that forced it, and what it costs. It is how a decision survives the session that made it.
A spec records what one feature decided at the time. An ADR records a choice that outlives any one
feature, and every later feature has to work within it.

## When an ADR is required

Write one for every **structural decision**, in the sense of `AGENTS.md`'s gate "a structural decision
is asked, not taken":

- a new language toolchain, build plugin or top-level folder;
- a new dependency with an install script;
- a new bot, service account or long-lived credential;
- reversing or replacing a decision already recorded here.

The maintainer's yes is what the ADR records. **Ask first, then write the ADR** in the same PR as the
first change that depends on it, or earlier. A structural change with no ADR, or an ADR with no
recorded approval, is a review finding.

Do not write one for a choice that one spec settles and nothing later depends on. That belongs in the
feature's `plan.md` or `research.md`.

## Rules

- **Numbered in order and never renumbered**: `ADR-NNNN-<slug>.md`, starting at `ADR-0001`.
- **The decision is never rewritten.** A changed decision is a new ADR that names the one it
  supersedes. The old ADR's status changes to `Superseded by ADR-NNNN`, and that is the only edit it
  gets. Context and consequences may gain a dated note when a stated consequence is measured.
- **Back-filled ADRs say so.** A decision taken before this folder existed records the date it was
  taken *and* the date it was written down.
- **Every ADR gets a concept page** under `openwiki/decisions/` that cites it as its `resource`
  ([the brief](../../openwiki/INSTRUCTIONS.md), §4d), so a missing page still means a missing document.
- **No forge host, tailnet address or credential value** appears here, as anywhere in the tree.

## Template

```markdown
# ADR-NNNN: <the decision, as a statement>

- **Status:** Proposed | Accepted | Superseded by ADR-NNNN
- **Date:** YYYY-MM-DD (decided) · YYYY-MM-DD (recorded, if back-filled)
- **Approved by:** the maintainer, YYYY-MM-DD (how: PR, conversation, backlog item)
- **Related:** backlog items, specs, other ADRs

## Context

What forced a choice: the problem, the constraint, the measurement. Facts, with dates.

## Decision

What was chosen, in one paragraph. Then the alternatives considered and why each was rejected.

## Consequences

What this costs and what it commits later work to. Name every gate, file or credential it adds.
```

## Index

| ADR | Decision | Status |
| --- | --- | --- |
| [ADR-0001](ADR-0001-pnpm-and-nx-only.md) | pnpm is the only JavaScript package manager and Nx the only task runner | Accepted |
| [ADR-0002](ADR-0002-session-maintained-wiki.md) | The `openwiki/` bundle is maintained by the coding session, with no generator | Accepted |
| [ADR-0003](ADR-0003-docker-sandbox-devcontainer.md) | The dev container runs in a dedicated Docker Sandbox microVM with default-deny egress | Accepted |
| [ADR-0004](ADR-0004-renovate-dependency-bot.md) | A self-hosted Renovate bot proposes dependency, digest and lockfile updates | Accepted |
| [ADR-0005](ADR-0005-operator-tool-mcp-servers.md) | Operator-tool MCP servers are local stdio Node servers, shipped as Claude Desktop Extensions (constitution 1.1.0) | Accepted; superseded in part by ADR-0006 |
| [ADR-0006](ADR-0006-pdlc-spec-intake.md) | The `pdlc` server writes and publishes one feature's spec branch, and a proposal stays open until it merges | Accepted |
