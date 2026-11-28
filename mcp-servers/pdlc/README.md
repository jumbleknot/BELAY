# `pdlc`: the proposal-intake MCP server

An **operator-tool MCP server** (constitution 1.1.0, [ADR-0005](../../docs/decisions/ADR-0005-operator-tool-mcp-servers.md),
[ADR-0006](../../docs/decisions/ADR-0006-pdlc-spec-intake.md)). Claude Desktop launches it over stdio on the
operator's workstation. It lets a Claude Desktop session file and refine **feature proposals** as forge issues in any
repository under the configured owner, then write each one's **spec** with that repository's own Spec Kit and publish
it on a feature branch. It keeps a local copy of each repository whose default branch is **read-only**.

It is built from feature 014 ([spec](../../specs/014-pdlc-proposal-intake/spec.md),
[tool contract](../../specs/014-pdlc-proposal-intake/contracts/tools.md),
[body contract](../../specs/014-pdlc-proposal-intake/contracts/proposal-body.md)) and extended by feature 016
([spec](../../specs/016-pdlc-spec-intake/spec.md), [tool contract](../../specs/016-pdlc-spec-intake/contracts/tools.md),
[stages](../../specs/016-pdlc-spec-intake/contracts/stages.md)).

## What it can and cannot do

- **Proposal tools** (014): `list_repos`, `repo_status`, `sync_repo`, `check_setup`, `list_proposals`,
  `get_proposal`, `create_proposal`, `update_proposal`, `add_comment`.
- **Spec tools** (016): `check_spec_kit`, `start_spec`, `get_spec`, `write_spec_file`, `approve_spec`,
  `reopen_spec`, `withdraw_spec`, `take_latest_spec`.
- **The right-hand pane** (016): `show_document` and `get_proposal_draft` for the model, and the app-only
  `save_pane_edit` and `read_pane_document` for the page `ui/document-pane.html`
  (`ui://pdlc/document-pane.html`).
- **Stages, not closing.** A proposal moves `ready` → `spec-in-progress` → `ready-to-plan` (and back, or withdrawn)
  through this server, each move a comment with a trailer first and the label second. Claude Code's `after_plan`
  hook moves it to `in-engineering`, and **only the merge closes it**, in CI (`feature-merged`). No close, reopen,
  delete, free labelling, milestone, assignee or bulk tool.
- **The default branch is read-only; the feature branch is published.** The default-branch copy is fast-forward only
  (`clone`, `fetch`, `merge --ff-only`, read-only queries) and a dirty, off-branch, diverged or foreign copy is
  refused, not repaired. A spec is written in its own worktree under `<clone root>/.pdlc-specs/`, committed under
  the author's git identity on approval, and pushed **only to its own feature branch**. Every git call is checked
  against exact allowed shapes, and a protected default branch is the forge's second line of defence. Never stash.
- **Files**: only `spec.md` and `checklists/*.md` inside the spec folder, and the server's own state and drafts
  under the clone root.
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
pnpm nx run pdlc:integration-forge   # real forge, ci-smoke; PDLC_IT_TOKEN (write:issue + write:repository), fails without a token
pnpm nx run pdlc:pack                # target/pdlc/pdlc-<version>.mcpb + proposal-intake-<version>.zip
```

Installing and configuring it on the workstation, updating the skill, the audit trail and the hand-off to
another repository are in [docs/runbooks/pdlc.md](../../docs/runbooks/pdlc.md).

## Changing the contract

A change to a tool name, parameter name or enum value, or to a heading or section id, is **breaking**.
The same pull request updates the skill, the manifest's `tools` array and every target repository's form
copy, and bumps the major version. The contract and master-copy tests fail until they agree.
