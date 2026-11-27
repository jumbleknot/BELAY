---
type: Decision
title: ADR-0006 — the pdlc server writes one feature's spec branch; a proposal stays open until merge
description: Feature 016's amendment of four feature 014 decisions — the pdlc server may now create, commit and publish one feature's spec branch from Claude Desktop (never the default branch, never force), running the target repository's own Spec Kit scripts in a credential-free scratch clone; a proposal moves through stage labels and closes on merge in CI; the pdlc token widens to write:repository (M5); the merge workflow's credential (M6); the hand-written MCP App pane (M7); and which parts of ADR-0005 it supersedes.
tags: [decision, adr, mcp, pdlc, spec-kit, claude-desktop]
resource: docs/decisions/ADR-0006-pdlc-spec-intake.md
resource-sha256: d512ed2132f176bf3a076fa54eddb3b329ce36e56feab586fb8c1d21a5cc4a93
timestamp: 2026-11-27T21:41:01.777Z
---

# ADR-0006 — PDLC spec intake

Feature 016 moves the spec stage into Claude Desktop. Feature 014's `pdlc` server kept read-only
copies and its proposals closed once a spec existed. Now the server creates, commits and publishes
**one feature's spec branch**, and a proposal issue stays open through stage labels
(`spec-in-progress`, `ready-to-plan`, `in-engineering`) until its branch merges, when CI closes it.
The VS Code route still works with the server absent.

## Gotchas

- **The target repository's own Spec Kit runs, never a copy.** The server runs its branch script as a
  `-DryRun -Json` and its `resolve-template` script, then creates the branch itself through the git
  allowlist.
- **Repository code runs only in a scratch clone** under `<clone_root>/.pdlc-scratch/`, with no
  credential, no shell and a local-path `origin`, deleted afterwards. Nothing a script does reaches the
  copy, a spec worktree or the forge.
- **Exact git shapes, not new verbs.** The only push is the recorded feature branch onto itself: no
  force, no `+`, no delete, never the default branch. No published commit is rewritten.
- **The `pdlc` token widens** to `write:issue` + `write:repository` (M5). It is bounded by the push
  guard and by branch protection, which the operator confirms by hand per target repository (see the
  [secrets posture](../invariants/secrets-management.md)).
- **Closing on merge is CI's job**, in a non-gating `feature-merged` workflow that also counts the
  feature's tests. It is never a server operation and never blocks a merge.
- **Counting adds no test run (M10).** "Created" is `count-repo-metrics.mjs` test declarations at the
  merge minus its parent, read from git. The outcomes are the whole suite's, from the merged commit's
  own `guardrails` run. The tasks template records a baseline and a close-out count on the issue, and
  posts nothing, without failing, when there is no proposal.
- **Supersedes part of [ADR-0005](adr-0005-operator-tool-mcp-servers.md)**: the `read:repository` scope
  and the read-only-copies premise. The rest of ADR-0005 stands.
