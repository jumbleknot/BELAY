---
type: Runbook
title: The pdlc server — proposal intake from Claude Desktop
description: How the pdlc operator-tool MCP server lets a Claude Desktop session on the workstation file and refine feature proposals as forge issues, write each one's spec with the repository's own Spec Kit and publish it on a feature branch, and show a proposal or spec in the right-hand pane — the default branch read-only, building and installing the .mcpb with its four settings, the dedicated pdlc token and its two scopes (write:repository since feature 016), the measured host facts, the skill update rule, the audit trail in the host's stderr log joined to the forge timeline by correlation_id, the refusal codes, and the hand-off that makes another repository (MCM) accept proposals and specs.
tags: [pdlc, mcp, claude-desktop, proposals, runbook]
resource: docs/runbooks/pdlc.md
resource-sha256: 1d056a9108484591cc2fbd99d2e81773b55394fd41b6460e5c9a21737e0e1442
timestamp: 2026-11-28T16:55:06.739Z
---

# The pdlc server — proposal intake from Claude Desktop

`pdlc` ([ADR-0005](../decisions/adr-0005-operator-tool-mcp-servers.md)) is a local stdio MCP server that Claude
Desktop launches on the workstation. Its tools list the owner's repositories, keep a local copy of each whose
default branch is read-only, check that a repository is set up for proposals and for Spec Kit, and read, create,
update and comment on proposals (issues labelled `type/proposal`). Since feature 016
([ADR-0006](../decisions/adr-0006-pdlc-spec-intake.md)) they also write a proposal's spec in a worktree of its own
with the repository's own Spec Kit scripts, commit it under the author's git identity on approval, publish **only its
feature branch**, move the proposal through its stages, and show a proposal or a spec in the right-hand pane. It is built with `pnpm nx run pdlc:pack` into a `.mcpb` extension and a skill zip.
Full detail is in [docs/runbooks/pdlc.md](../../docs/runbooks/pdlc.md).

## Gotchas

- **It never closes a proposal.** It moves it to `spec-in-progress` and `ready-to-plan` (or back, or withdrawn);
  Claude Code's `after_plan` hook moves it to `in-engineering`; only the merge closes it, in CI (`feature-merged`).
  There is no close, delete, free-relabel or bulk tool.
- **Nothing BELAY runs depends on it.** The web form, `ready`, pick-up, the stage hooks and close on merge work with
  the server uninstalled, and a guard test fails on any reference to it from BELAY's tooling.
- **It never pushes to a default branch.** Every git call is matched against exact allowed shapes, a push goes only to
  the spec's own feature branch, and a protected default branch is the forge's second refusal (measured). Branch
  numbers come from the repository's own script, run as a dry run in a credential-free scratch clone; a branch not
  yet published is invisible to the numbering.
- **A dedicated token**, named `pdlc`, with `write:issue` + `write:repository` only (`read:repository` before 016;
  scopes cannot be widened, so upgrading means a new token), used by nothing else, held only
  in the extension's sensitive setting (encrypted at rest under a key Windows DPAPI protects for the user). It never reaches argv, results, logs or `.git/config`: git authenticates
  through `GIT_CONFIG_*` in each child's environment.
- **The default-branch copies are fast-forward only.** A dirty, off-branch, diverged or foreign copy is refused and
  left byte-identical; the operator fixes it in their own tools. Specs live in worktrees under `.pdlc-specs\`, drafts
  under `.pdlc-drafts\`, both in the clone folder.
- **The pane's calls and the model's calls are served by two server processes** (measured), so the server keeps no
  state in memory: revisions are hashes of files on disk. The page asks for the `fullscreen` display mode, shown as
  the right-hand pane, and polls every 2 seconds; a save against an old revision is refused `pane_edit_pending`, and
  the author's text is kept, so no edit is lost. A saved proposal and its spec share one page as tabs (the proposal,
  then each spec file), and an **Open beside the chat** button asks again when the page is shown inline. A spec file
  opens as an editable Preview (with a switch to the Markdown source); only the blocks the author edited are rewritten.
- **The audit log is the host's capture of stderr**, one `audit` line per call, allowed or refused, joined to the
  forge's issue timeline by `correlation_id`. Measured: it lands in Claude Desktop's general
  `%LOCALAPPDATA%\Claude\logs\main.log`, which rolls at about 10 MiB through five files, so retention is by
  volume (about five weeks when measured) and lines are picked out by `"service":"pdlc"`. The per-server log is
  named from the manifest's `display_name`, which must therefore be a valid Windows file name. It says "connected" even when
  the server refused to start, so a startup failure is read from `main.log`.
- **The workstation needs Git for Windows, a git identity and the built-in Windows PowerShell 5.1.** Measured on
  the Microsoft Store build: the server runs on Claude Desktop's own Node (v24), finds `git` on the user's inherited
  `PATH`, and runs Spec Kit's `ps` scripts with `powershell.exe` when `pwsh` is absent (same output, measured). Its data folder is under
  `%LOCALAPPDATA%\Claude-Data`, not `%APPDATA%\Claude`.
- **Run sessions in a plain chat, never in a Project coordinator (Beta) project.** Measured 2026-11-26: that
  project type's threads do not get the installed extension, so the skill finds no tools and stops. Nothing is
  connected in advance; the plain chat asks for access to the clone folder when the skill first reads it, and the
  operator approves.
- **The live-forge tier needs a 016-scoped token.** `pdlc:integration-forge` publishes a spec branch on `ci-smoke`, so
  it takes an operator-made `write:issue` + `write:repository` token as `PDLC_IT_TOKEN`; the dev container's
  `FORGE_ISSUE_TOKEN` cannot push. Its published branches stay until the operator agrees to delete them.
- **Rebuild and re-upload after every merge** that changes the server or the master skill. Nothing updates itself.
  A rebuild meant for installing bumps the server's patch version, which also names the skill zip.
- **A contract change is breaking.** A tool, parameter, enum, heading or section-id change moves the skill, the
  manifest and every target's form copy in the same PR; `check_setup` reports a target's copy as `out_of_step`.
