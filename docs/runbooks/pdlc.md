# The `pdlc` server: proposal intake from Claude Desktop

`pdlc` is the operator-tool MCP server ([ADR-0005](../decisions/ADR-0005-operator-tool-mcp-servers.md),
constitution 1.1.0) that lets a **Claude Desktop** session on the Windows workstation capture and refine
**feature proposals** in any repository under the configured owner. It lives in
[`mcp-servers/pdlc/`](../../mcp-servers/pdlc/README.md) and ships as a Claude Desktop Extension (`.mcpb`), with the
`proposal-intake` skill beside it.

Feature: [specs/014-pdlc-proposal-intake](../../specs/014-pdlc-proposal-intake/spec.md). Tool contract:
[contracts/tools.md](../../specs/014-pdlc-proposal-intake/contracts/tools.md).

**What it can do, and nothing else**: list the owner's repositories; keep a read-only local copy of each (clone and
fast-forward only); check that a repository is set up for proposals; list, read, create and update proposals
(issues labelled `type/proposal`); comment on them. It never closes, reopens, deletes or relabels arbitrary issues,
and never commits, branches, pushes or stashes. A proposal is closed by **Claude Code in the target repository**
(`backlog.mjs close-proposal` in BELAY), never by the server.

**Nothing BELAY runs depends on it** (FR-035). The web form, `ready`, pick-up and close-on-spec work identically with
the server uninstalled; `scripts/__tests__/pdlc-independence.guard.test.mjs` enforces it.

## Install on the workstation

### Prerequisites

- **Claude Desktop**, current version, on Windows.
- **Git for Windows 2.31 or later** on the `PATH`. The server authenticates each git call through
  `GIT_CONFIG_COUNT`, which arrived in 2.31.
- A **clone folder** for the read-only local copies, for example `E:\Programming\pdlc-clones`. Create it before
  installing; the server refuses to start if it does not exist.

### Create the `pdlc` token

Create a **new** forge access token named `pdlc`, in the forge's user settings → Applications, with exactly these
scopes and nothing else:

| Scope | Why |
| --- | --- |
| `write:issue` | Create, edit and comment on proposals |
| `read:repository` | List the owner's repositories (`/repos/search`), read the proposal form, clone |

It is used by nothing else: not the dev container, not CI, not another tool. Store it only in the extension's
settings (below). **To revoke it**, delete the `pdlc` token in the same settings page; nothing else stops working,
because nothing else uses it. Then create a new one and paste it into the extension's settings.

### Build the two files (dev container)

```bash
pnpm nx run pdlc:pack
# → target/pdlc/pdlc-<version>.mcpb        the extension
# → target/pdlc/proposal-intake.zip        the skill
```

Download both to the workstation (VS Code Explorer → right-click → **Download**).

### Install the extension and fill in the four settings

1. In Claude Desktop, **Settings → Extensions → Advanced settings → Install Extension…**, and pick
   `pdlc-<version>.mcpb` (or drag it onto the Extensions page). Replace the earlier version when updating.
2. Fill in the settings. Each is required; a missing one stops the server at startup with a log line naming it.

   | Setting | Variable | Value |
   | --- | --- | --- |
   | Forge URL | `PDLC_FORGE_URL` | The forge root, `http://<forge host>:3000` on the tailnet. The scheme is used as written; no path |
   | Forge owner | `PDLC_FORGE_OWNER` | The one account whose repositories the server may address |
   | Forge token (pdlc) | `PDLC_FORGE_TOKEN` | The `pdlc` token. A sensitive setting: masked, stored as recorded under "Measured on the host" |
   | Clone folder | `PDLC_CLONE_ROOT` | The clone folder created above |

3. Enable the extension.

### Connect the clone folder and add the skill

1. In the Claude Desktop project you use for proposals, add the clone folder as a connected folder, so the session
   can read each repository's files (`openwiki/`, `specs/`, the constitution) from its local copy.
2. **Settings → Skills → Upload skill**, and pick `proposal-intake.zip`. Replace the earlier copy.

### Update the skill whenever the master changes

The master skill is `mcp-servers/pdlc/skill/proposal-intake/SKILL.md`. A change to it, or to the tool contract,
merges with a pull request; after it merges, rebuild with `pdlc:pack` and re-upload `proposal-intake.zip`
(and reinstall the `.mcpb` if the server changed). Nothing updates itself.

### Measured on the host

Measured on 2026-11-25 with a throwaway extension on the workstation (Claude Desktop, Microsoft Store build), and
recorded in research R12. The rows still marked *pending* are not to be relied on yet.

| Fact | Observed |
| --- | --- |
| Is `git` found from the extension, and from which `PATH` | Yes. The extension inherits the user's full `PATH`; `git` resolved to `C:\Program Files\Git\cmd\git.exe` (Git for Windows 2.53.0). No `git_path` setting is needed |
| The Node version Claude Desktop bundles | v24.22.3, run by `Claude.exe` itself, not a system Node. The manifest requires `>=20.0.0` |
| Where the server's stderr lands (the audit log), and its rotation and retention | *pending T006* |
| Where a `sensitive` setting is stored | *pending T006* |

## The audit trail

Constitution 1.1.0 (§ Operator-Tool MCP Servers) makes the audit log **the host's capture of the server's stderr**,
together with **the forge's issue timeline** for writes. The server never opens a log file itself.

- **Every tool call writes exactly one `audit` line** to stderr before its result is returned, allowed or refused:

  ```json
  {"ts":"…","level":"INFO","service":"pdlc","event":"audit","correlation_id":7,"tool":"update_proposal",
   "repo":"BELAY","number":42,"decision":"refused","code":"stale","outcome":"refused: stale"}
  ```

  It carries no body, no section text and no token. `correlation_id` is the MCP request id.
- **Where it is**: the host's log for `pdlc` (location under "Measured on the host").
- **To find one call**: search the log for `"correlation_id":<id>` (in PowerShell, `Select-String`), or for
  `"event":"audit"` and the tool name. Writes are also logged at INFO with the tool, repository and issue number.
- **To match a write to its effect**: open the issue named by `repo` and `number`; its timeline on the forge shows
  the edit, label change or comment, with the same timestamp to the second. The forge keeps writes permanently, so
  only refusal lines can age out, with the host's retention (under "Measured on the host").
- **Integrity**: the server has no file-write tool and never touches the log folder. The logged-in OS user can edit
  the file; that is accepted for a one-operator workstation (constitution 1.1.0).

## Troubleshooting by refusal code

Every refusal says what was refused and why, and changes nothing (FR-019).

| Code | Means | Do |
| --- | --- | --- |
| `unknown_repo` | Not a repository under the configured owner (or an `owner/repo` form was given) | Use a name from `list_repos`. The owner is fixed by the setting |
| `not_a_proposal` | The issue lacks `type/proposal`, or is a pull request | The server touches proposals only |
| `bot_managed` | The issue carries `status/bot-managed` | It is the dependency bot's; leave it |
| `unknown_label` | The repository lacks a proposal label | Run `check_setup`, then fix it in Claude Code in that repository |
| `stale` | The issue changed since `expected_updated_at` | Read it again with `get_proposal`, merge, then update with the new `updated_at` |
| `duplicate_title` | An open proposal has the same title | Update that one (its number is in the refusal) |
| `copy_dirty` | The local copy has changes or untracked files | The copy is read-only: remove them in your own tools |
| `copy_off_branch` | The copy is on another branch, or detached | Switch it back to the default branch yourself |
| `copy_diverged` | The copy has local commits | Reset it yourself, or delete the folder and sync again |
| `copy_foreign` | The folder is not a copy of this repository (another origin, not a repository, inside another) | Move it aside; sync clones a fresh copy |
| `invalid_input` | A schema or size limit failed (body or comment over 64 KiB, title over 255) | Shorten it |
| `forge_auth` | The forge refused the token (401/403), naming the capability | Check the token's two scopes, or that it was not revoked |
| `forge_unreachable` | The forge could not be reached, or failed | Check the tailnet; nothing was written |
| `not_found` | No such issue | Check the number |

If the server does not start at all, its log names the missing or invalid setting (`PDLC_FORGE_URL`,
`PDLC_FORGE_OWNER`, `PDLC_FORGE_TOKEN` or `PDLC_CLONE_ROOT`); the token's value is never printed.

## Hand off to a target repository (worked example: MCM)

This is the guide for making another repository, MCM first, accept proposals (FR-026). It states what the target
must do. BELAY's own adoption is the worked example to copy from:

| BELAY file | What it shows |
| --- | --- |
| `.forgejo/issue_template/proposal.yaml` | The form copy, byte-identical to `mcp-servers/pdlc/contract/proposal.yaml` |
| `scripts/backlog.mjs` (`TAXONOMY`, `selectReadyItems`, `close-proposal`) | The two labels, ready-excludes-drafts, close-on-spec |
| `.specify/extensions.yml` (`after_specify` → `belay` `speckit.belay.close-proposal`) and `.claude/skills/speckit-belay-close-proposal/SKILL.md` | The close-on-spec hook and its skill, registered in the Spec Kit gate |
| `.claude/skills/forgejo-issues/SKILL.md` ("Proposals") | The backlog skill: states, pick-up, close |
| `scripts/__tests__/backlog.test.mjs` (feature 014 block), `scripts/__tests__/pdlc-independence.guard.test.mjs` | The tests and the no-dependency guard |

### Before starting in the target

1. Feature 014 has merged in BELAY, so the master form and label definitions are final.
2. The `pdlc` server is installed (above) and the full loop has been proven on BELAY (quickstart §5).

### In a Claude Code session in the target (from a worktree, on a feature branch)

1. Copy `docs/proposals/claude-desktop-proposal-intake/PRD-ProposalsInBacklog.md` into the target's
   `docs/proposals/` and run `/speckit-specify` from it, then plan, tasks and implement as usual. That feature must
   deliver:
   - **The form**: a copy of BELAY's master form at `.forgejo/issue_template/proposal.yaml`, byte-identical to the
     master. It takes effect only from the default branch.
   - **The labels**: `type/proposal` and `status/proposal-draft` added to the label set the target's backlog tool
     creates and checks, with the colours and descriptions in `mcp-servers/pdlc/contract/proposal-labels.json`, so
     an unknown-label filter is refused rather than returning everything.
   - **Ready means ready**: the target's ready-work listing shows a ready proposal (`status/needs-spec`) and never a
     draft (`status/proposal-draft`).
   - **Pick-up**: the target's backlog skill explains the two states, how to pick up a ready proposal and feed its
     body to `/speckit-specify` (BELAY's convention: `Proposal #<n>: <title>` then the body), and the close-on-spec
     rule.
   - **Close-on-spec**: when a feature came from a proposal, the proposal is closed with a comment linking its
     `specs/NNN-*/` folder once that folder exists. The target decides whether this is a registered local edit to
     its specify skill or an after-specify hook (its own Spec Kit upgrade rules apply), and how the specify run
     learns which proposal it came from. BELAY chose a hook plus a `Proposal #<n>` marker in the spec's Input line.
   - **Docs**: the target's backlog runbook (labels, form, states) and its lifecycle page (stage 1 now lives in the
     backlog), with the wiki pages that summarise them refreshed in the same pull request.
   - **Tests and gates**: tests for the label and ready-listing changes; form validation passing for both forms;
     the wiki gates passing.
   - **No dependency on the server** (FR-035): nothing in the target calls, requires or checks for the `pdlc`
     server. The web form, ready listing, pick-up and close-on-spec all work with the server absent.
2. After that pull request merges, run the target's label setup **once** so the two labels exist on the forge.

### Confirm the hand-off

1. In Claude Desktop, run `check_setup` for the target: it returns `ok: true`.
2. File a proposal into the target from Claude Desktop and confirm it as ready.
3. In Claude Code in the target, the ready-work listing shows it; pick it up and run `/speckit-specify` from it.
4. The proposal is closed, with a comment linking the new spec folder (SC-007).
5. Repeat steps 2 to 4 **with the server stopped**, filing the proposal through the web form instead: the target's
   flow still works end to end (SC-010).

### Keeping in step

When BELAY's master form or labels change, `check_setup` reports the target's copy as `out_of_step`. The copy is
refreshed by hand in a pull request in the target.
