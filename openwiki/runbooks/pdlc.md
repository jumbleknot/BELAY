---
type: Runbook
title: The pdlc server — proposal intake from Claude Desktop
description: How the pdlc operator-tool MCP server lets a Claude Desktop session on the workstation file and refine feature proposals as forge issues and keep read-only local copies — building and installing the .mcpb with its four settings, the dedicated pdlc token and its two scopes, the skill update rule, the audit trail in the host's stderr log joined to the forge timeline by correlation_id, the refusal codes, and the hand-off that makes another repository (MCM) accept proposals.
tags: [pdlc, mcp, claude-desktop, proposals, runbook]
resource: docs/runbooks/pdlc.md
resource-sha256: f44d14cdd6d4c179b61cd3c0c5096d41a8b7c90704a9c76b8cb263bcccc4219f
timestamp: 2026-11-26T01:35:34.471Z
---

# The pdlc server — proposal intake from Claude Desktop

`pdlc` ([ADR-0005](../decisions/adr-0005-operator-tool-mcp-servers.md)) is a local stdio MCP server that Claude
Desktop launches on the workstation. Its nine tools list the owner's repositories, keep a read-only local copy of
each, check that a repository is set up for proposals, and read, create, update and comment on proposals (issues
labelled `type/proposal`). It is built with `pnpm nx run pdlc:pack` into a `.mcpb` extension and a skill zip.
Full detail is in [docs/runbooks/pdlc.md](../../docs/runbooks/pdlc.md).

## Gotchas

- **It never closes a proposal.** Closing is Claude Code's, in the target repository (`backlog.mjs
  close-proposal` in BELAY, run by the `after_specify` hook). There is no close, delete, relabel or bulk tool.
- **Nothing BELAY runs depends on it** (FR-035). The web form, `ready`, pick-up and close-on-spec work with the
  server uninstalled, and a guard test fails on any reference to it from BELAY's tooling.
- **A dedicated token**, named `pdlc`, with `write:issue` + `read:repository` only, used by nothing else, held only
  in the extension's sensitive setting (encrypted at rest under a key Windows DPAPI protects for the user). It never reaches argv, results, logs or `.git/config`: git authenticates
  through `GIT_CONFIG_*` in each child's environment.
- **The local copies are fast-forward only.** A dirty, off-branch, diverged or foreign copy is refused and left
  byte-identical; the operator fixes it in their own tools.
- **The audit log is the host's capture of stderr**, one `audit` line per call, allowed or refused, joined to the
  forge's issue timeline by `correlation_id`. Measured: it lands in Claude Desktop's general
  `%LOCALAPPDATA%\Claude\logs\main.log`, which rolls at about 10 MiB through five files, so retention is by
  volume (about five weeks when measured) and lines are picked out by `"service":"pdlc"`. The per-server log is
  named from the manifest's `display_name`, which must therefore be a valid Windows file name. It says "connected" even when
  the server refused to start, so a startup failure is read from `main.log`.
- **The workstation needs only Git for Windows.** Measured on the Microsoft Store build: the server runs on
  Claude Desktop's own Node (v24), and finds `git` on the user's inherited `PATH`. Its data folder is under
  `%LOCALAPPDATA%\Claude-Data`, not `%APPDATA%\Claude`.
- **Run sessions in a plain chat, never in a Project coordinator (Beta) project.** Measured 2026-11-26: that
  project type's threads do not get the installed extension, so the skill finds no tools and stops. Nothing is
  connected in advance; the plain chat asks for access to the clone folder when the skill first reads it, and the
  operator approves.
- **Rebuild and re-upload after every merge** that changes the server or the master skill. Nothing updates itself.
- **A contract change is breaking.** A tool, parameter, enum, heading or section-id change moves the skill, the
  manifest and every target's form copy in the same PR; `check_setup` reports a target's copy as `out_of_step`.
