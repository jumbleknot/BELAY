# `pdlc`: the proposal-intake MCP server

An **operator-tool MCP server** (constitution 1.1.0, [ADR-0005](../../docs/decisions/ADR-0005-operator-tool-mcp-servers.md)).
Claude Desktop launches it over stdio on the operator's workstation. It lets a Claude Desktop session
file and refine **feature proposals** as forge issues in any repository under the configured owner,
and it keeps read-only local copies of those repositories for the session to read.

It is built from feature 014: [spec](../../specs/014-pdlc-proposal-intake/spec.md),
[tool contract](../../specs/014-pdlc-proposal-intake/contracts/tools.md),
[body contract](../../specs/014-pdlc-proposal-intake/contracts/proposal-body.md).

## What it can and cannot do

- **Nine tools**: `list_repos`, `repo_status`, `sync_repo`, `check_setup`, `list_proposals`,
  `get_proposal`, `create_proposal`, `update_proposal`, `add_comment`.
- **No close, reopen, delete, label, milestone, assignee, bulk or file-write tool.** A proposal is closed
  by Claude Code in the target repository (`backlog.mjs close-proposal` in BELAY), never by this server.
- **Git is fast-forward only**: `clone`, `fetch`, `merge --ff-only` and read-only queries. Never commit,
  branch, push, stash or reset. A dirty, off-branch, diverged or foreign copy is refused, not repaired.
- **The token** never appears in argv, results, logs or `.git/config`.

## Layout

| Path | Is |
| --- | --- |
| `src/` | The server (`server.mjs` is the entry point) |
| `contract/` | The **master** issue form and label definitions every target repository copies |
| `skill/proposal-intake/` | The **master** Claude Desktop skill that drives the tools |
| `manifest.json` | The Claude Desktop Extension (`.mcpb`) manifest |
| `tests/unit/` | Unit and contract tests (`pdlc:test`, gating) |
| `tests/integration/` | Real git against local bare repositories (`pdlc:integration`, gating) |
| `tests/integration-forge/` | The real forge, `ci-smoke` (`pdlc:integration-forge`, operator-run) |
| `scripts/` | `pack.mjs` (the bundle) and the lint helper |

## Commands

```bash
pnpm nx run pdlc:lint                # syntax + mcpb validate
pnpm nx run pdlc:test                # unit + contract, 70% coverage floor
pnpm nx run pdlc:integration         # real git
pnpm nx run pdlc:integration-forge   # real forge; needs FORGE_ISSUE_TOKEN, fails without it
pnpm nx run pdlc:pack                # target/pdlc/pdlc-<version>.mcpb + proposal-intake.zip
```

Installing and configuring it on the workstation, updating the skill, the audit trail and the hand-off to
another repository are in [docs/runbooks/pdlc.md](../../docs/runbooks/pdlc.md).

## Changing the contract

A change to a tool name, parameter name or enum value, or to a heading or section id, is **breaking**.
The same pull request updates the skill, the manifest's `tools` array and every target repository's form
copy, and bumps the major version. The contract and master-copy tests fail until they agree.
