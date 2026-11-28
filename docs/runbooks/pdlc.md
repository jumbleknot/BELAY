# The `pdlc` server: proposal intake from Claude Desktop

`pdlc` is the operator-tool MCP server ([ADR-0005](../decisions/ADR-0005-operator-tool-mcp-servers.md),
constitution 1.1.0) that lets a **Claude Desktop** session on the Windows workstation capture and refine
**feature proposals** in any repository under the configured owner. It lives in
[`mcp-servers/pdlc/`](../../mcp-servers/pdlc/README.md) and ships as a Claude Desktop Extension (`.mcpb`), with the
`proposal-intake` skill beside it.

Features: [specs/014-pdlc-proposal-intake](../../specs/014-pdlc-proposal-intake/spec.md) (proposals) and
[specs/016-pdlc-spec-intake](../../specs/016-pdlc-spec-intake/spec.md) (specs, the pane, close on merge;
[ADR-0006](../decisions/ADR-0006-pdlc-spec-intake.md)). Tool contract:
[016 contracts/tools.md](../../specs/016-pdlc-spec-intake/contracts/tools.md), which extends
[014's](../../specs/014-pdlc-proposal-intake/contracts/tools.md).

**What it can do, and nothing else**:

- list the owner's repositories, and keep a local copy of each whose **default branch is read-only** (clone and
  fast-forward only);
- check that a repository is set up for proposals (`check_setup`) and for specs (`check_spec_kit`);
- list, read, create and update proposals (issues labelled `type/proposal`), and comment on them;
- **write a proposal's spec** with the repository's own Spec Kit: `start_spec` creates the feature branch in a
  worktree of its own, the session writes and clarifies `spec.md`, and `approve_spec` commits it under the author's
  own git identity and **publishes the feature branch** (the only branch it ever pushes). `reopen_spec`,
  `withdraw_spec` and `take_latest_spec` cover going back, giving up and a branch changed on the forge;
- **move the proposal through its stages** (`spec-in-progress`, `ready-to-plan`, back to `ready` or `draft` on a
  withdrawal), always a comment first and the label second;
- show a proposal or a spec in the **right-hand pane**, where the author can type into it directly.

It never closes, reopens, deletes or relabels arbitrary issues; it never commits to, pushes to or resets a default
branch, and never stashes. Every git call is checked against an allowlist of exact command shapes first
(`git_verb_refused`, `push_target_refused`). Planning moves the proposal to `in-engineering` (Claude Code's
`after_plan` hook), and **only the merge closes it**, in CI (`feature-merged`, [ci.md](ci.md)), never the server.

**Nothing BELAY runs depends on it** (FR-031). The web form, `ready`, pick-up, the stage hooks and close on merge work
identically with the server uninstalled; `scripts/__tests__/pdlc-independence.guard.test.mjs` enforces it.

## Install on the workstation

### Prerequisites

- **Claude Desktop**, current version, on Windows.
- **Git for Windows 2.31 or later** on the `PATH`. The server authenticates each git call through
  `GIT_CONFIG_COUNT`, which arrived in 2.31.
- A **clone folder** for the local copies, for example `E:\Programming\pdlc-clones`. Create it before
  installing; the server refuses to start if it does not exist.
- **A git identity** on the workstation (`git config --global user.name` and `user.email`): an approved spec is
  committed under it, and `approve_spec` refuses `git_identity_missing` without it.
- **Windows PowerShell 5.1** (built in) or `pwsh`, to run a repository's Spec Kit `ps` scripts. The server prefers
  `pwsh` and falls back to `powershell.exe`, always with `-NoProfile -ExecutionPolicy Bypass` (process scope).

### Create the `pdlc` token

Create a **new** forge access token named `pdlc`, in the forge's user settings → Applications, with exactly these
scopes and nothing else:

| Scope | Why |
| --- | --- |
| `write:issue` | Create, edit, comment on and move the stage of proposals |
| `write:repository` | List the owner's repositories (`/repos/search`), read the proposal form, clone, and **push a feature branch** when a spec is approved. A protected default branch refuses its pushes at the forge (measured, below) |

Before feature 016 the second scope was `read:repository`. A token's scopes cannot be widened, so **to upgrade**:
create a new `pdlc` token with these two scopes, paste it into the extension's settings, then delete the old one.

It is used by nothing else: not the dev container, not CI, not another tool. Store it only in the extension's
settings (below). **To revoke it**, delete the `pdlc` token in the same settings page; nothing else stops working,
because nothing else uses it. Then create a new one and paste it into the extension's settings.

### Build the two files (dev container)

```bash
pnpm nx run pdlc:pack
# → target/pdlc/pdlc-<version>.mcpb        the extension
# → target/pdlc/proposal-intake-<version>.zip  the skill (same version as the server)
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
   | Forge token (pdlc) | `PDLC_FORGE_TOKEN` | The `pdlc` token. A sensitive setting: masked, and stored encrypted (see "Measured on the host") |
   | Clone folder | `PDLC_CLONE_ROOT` | The clone folder created above |

3. Enable the extension.

### Add the skill, and where to run a session

1. **Settings → Skills → Upload skill**, and pick `proposal-intake-<version>.zip`. Replace the earlier copy. A rebuild meant for
   installing bumps the server's patch version, so the two file names say which build is which.
2. **Start every proposal session in a plain chat**, not in a Claude Desktop project. Measured 2026-11-26 (research
   R12): a **Project coordinator (Beta)** project, with its coordinator and threads, does not get the installed
   extension. The skill finds no `pdlc` tools there and stops, as designed, even though `main.log` shows the server
   started cleanly. The same session in a plain chat works.
3. **Nothing needs connecting in advance.** The server finds the clone folder from its own setting. When the skill
   first reads a repository's files from its local copy (`openwiki/`, `specs/`, the constitution), the chat asks
   for access to the clone folder. Approve it: without it the session cannot check the idea against existing specs
   and wiki pages. The skill reads the copy and never writes to it; `sync_repo` is the only thing that changes it.

### Update the skill whenever the master changes

The master skill is `mcp-servers/pdlc/skill/proposal-intake/SKILL.md`. A change to it, or to the tool contract,
merges with a pull request; after it merges, rebuild with `pdlc:pack` and re-upload `proposal-intake-<version>.zip`
(and reinstall the `.mcpb` if the server changed). Nothing updates itself.

**Rebuild after feature 016** (server 0.2.1): reinstall the `.mcpb`, re-upload the skill, and replace the token
(above). Run `check_setup` on BELAY: `ok: true`, and `default_branch_protected: true`.

### Measured on the host

Measured on 2026-11-25 with a throwaway extension on the workstation (Claude Desktop, Microsoft Store build), and
recorded in research R12. Re-measure after a Claude Desktop update that changes its log handling: these rows are
the audit trail's location (ADR-0005).

| Fact | Observed |
| --- | --- |
| Is `git` found from the extension, and from which `PATH` | Yes. The extension inherits the user's full `PATH`; `git` resolved to `C:\Program Files\Git\cmd\git.exe` (Git for Windows 2.53.0). No `git_path` setting is needed |
| The Node version Claude Desktop bundles | v24.22.3, run by `Claude.exe` itself, not a system Node. The manifest requires `>=20.0.0` |
| Where the server's stderr lands (the audit log), and its rotation and retention | `%LOCALAPPDATA%\Claude\logs\main.log`, Claude Desktop's general log, each line behind a `<local time> [info] [UtilityProcess stderr]` prefix. It rolls over at about 10 MiB into `main1.log` … `main4.log`, five files in all, so retention is by volume and shared with everything else Claude Desktop logs: about five weeks when measured. Protocol traffic (method and id per message, no content) is in `mcp-server-pdlc proposal intake.log` beside it |
| Where a `sensitive` setting is stored | Encrypted at rest in `%LOCALAPPDATA%\Claude-Data\claude_<publisher id>\Claude Extensions Settings\<extension id>.json`, as `__encrypted__:…` (Electron `safeStorage`: AES-GCM under a key Windows DPAPI protects for your user). No plain-text copy anywhere in the data folder, and nothing in Credential Manager. Anything running as your Windows user can decrypt it |

Measured on 2026-11-27 for feature 016 (research R1, R6, R9, R10, R11):

| Fact | Observed |
| --- | --- |
| Which PowerShell runs Spec Kit's scripts (T004) | Only Windows PowerShell 5.1 (`powershell.exe`) on the workstation; no `pwsh`. Its branch-script dry run and `resolve-template` give the same answers as `pwsh` 7.6.5 in the dev container (template 4556 characters) |
| Which branch number a dry run picks (T004) | The next number after every branch **published** on the forge. A branch that exists only in a worktree or on another workstation is invisible to the numbering, so publish early |
| The widened token and branch protection (T005) | A `write:issue` + `write:repository` token pushes a new branch, is refused a push to a protected `main` by the forge (`Not allowed to push to protected branch main`), and can read branch protection (HTTP 200) |
| Does the pane render, and where (T003) | Inline in the conversation first; the page then asks for the `fullscreen` display mode, which Claude Desktop shows as the **right-hand pane**. `pip` is not offered |
| Who serves the pane's calls (T003) | A **different server process** from the model's calls (two pids, same Node v24.22.3), sharing the workstation's disk. So the server keeps no state in memory: revisions, drafts and snapshots are files under the clone folder |
| How a pane sees a chat edit (T003) | Nothing is pushed to an open page: it polls `read_pane_document` every 2 seconds. `ui/update-model-context` is accepted but the model never sees it, so a pane edit reaches the model only through a re-read (`pane_edit_pending`) |
| How long `start_spec` takes (T068, live forge, dev container, 2026-11-28) | 2.5 to 3.0 s over four runs against `ci-smoke` (sync, scratch clone, dry run, template, worktree, stage move), against the plan's 30 s target. Not yet measured from the workstation |
| Can CI's run token comment on and close an issue on `push` (T006) | Yes. `feature-merged` uses it; `CI_DIGEST_TOKEN` is only a fallback for a 401/403 |

## Specs from a proposal

The skill drives this; the tools refuse anything out of order. For a **ready** proposal in a repository whose
`check_spec_kit` is `supported`:

1. `start_spec` runs the repository's own branch script as a **dry run** in a credential-free scratch clone (under
   `.pdlc-scratch/`), creates the branch it named in a worktree at `<clone folder>\.pdlc-specs\<Repo>\<NNN-slug>\`,
   writes `spec.md` from the repository's own template, and moves the proposal to `spec-in-progress`. Several specs
   can be in progress at once, one per proposal. The default-branch copy is never switched.
2. The session writes and clarifies with `get_spec` and `write_spec_file` (`spec.md` and `checklists/*.md` inside the
   folder only; `path_outside_feature` otherwise). Edits stay uncommitted between sessions; `get_spec` resumes them.
3. `approve_spec` refuses while `[NEEDS CLARIFICATION]` markers remain (`spec_has_markers`) or clarification has not
   run (`spec_not_clarified`), and when the branch moved on the forge (`branch_changed`; then `take_latest_spec`).
   Otherwise it commits the folder under the author's git identity, pushes the feature branch, and moves the proposal
   to `ready-to-plan` with a link to the folder on the branch.
4. Until planning starts, `reopen_spec` takes it back to `spec-in-progress`, and `withdraw_spec` returns the proposal
   to `ready` or `draft` (the branch is kept and never reused). Once Claude Code runs `/speckit-plan` the proposal is
   `in-engineering` and the spec is read-only here (`document_locked`).

Each stage change posts a comment whose last line is a trailer, `<!-- pdlc-stage: stage=… branch=… spec=… -->`; the
contract is [stages.md](../../specs/016-pdlc-spec-intake/contracts/stages.md).

## The right-hand pane

`show_document` opens a proposal (by number, or a new draft) or a spec in the pane. The author types into it; it
saves 1.5 seconds after the last keystroke, against the revision it last read. When the chat changed the document
meanwhile, the save is refused `pane_edit_pending`, the author's text is kept below the reloaded document, and nothing
is lost. The model sees pane edits by reading again (`get_proposal_draft` reports `pane_changes`). A closed proposal,
or a spec past `spec-in-progress`, shows read-only. Where the pane is not available, the page says so and stays in the
conversation, which still works.

The page has one tab per document that exists: the proposal, and once it has a spec (`has_spec` in the result), one
tab per spec file, `spec.md` first. Opening either one loads the other beside it, and the tab chosen survives the 2 s
refresh. When `start_spec` runs while the proposal is open, the spec's tabs appear and `spec.md` is chosen. The page asks
to move beside the chat when it loads; when it is shown in the conversation instead, an **Open beside the chat** button
asks again.

Drafts live in `<clone folder>\.pdlc-drafts\<Repo>\` until the proposal is saved; a saved proposal's draft is
deleted.

## The audit trail

Constitution 1.1.0 (§ Operator-Tool MCP Servers) makes the audit log **the host's capture of the server's stderr**,
together with **the forge's issue timeline** for writes. The server never opens a log file itself.

- **Every tool call writes exactly one `audit` line** to stderr before its result is returned, allowed or refused:

  ```json
  {"ts":"…","level":"INFO","service":"pdlc","event":"audit","correlation_id":7,"tool":"update_proposal",
   "repo":"BELAY","number":42,"decision":"refused","code":"stale","outcome":"refused: stale"}
  ```

  It carries no body, no section text and no token. `correlation_id` is the MCP request id.
- **Where it is**: `%LOCALAPPDATA%\Claude\logs\main.log` and its older copies `main1.log` … `main4.log` (see
  "Measured on the host"). It is Claude Desktop's general log, so `pdlc`'s lines are picked out by their
  `"service":"pdlc"` field.
- **To find the calls**, newest file first:

  ```powershell
  $logs = "$env:LOCALAPPDATA\Claude\logs"
  Select-String -Path "$logs\main.log","$logs\main?.log" -SimpleMatch -Pattern '"service":"pdlc","event":"audit"'
  ```

  Add `| Select-String -SimpleMatch '"correlation_id":7'` for one call, or `'"tool":"update_proposal"'` for one
  tool. Writes are also logged at INFO with the tool, repository and issue number. The `correlation_id` is the MCP
  request id, which `mcp-server-pdlc proposal intake.log` shows as `id=7` on the matching `tools/call` line.
- **To match a write to its effect**: open the issue named by `repo` and `number`; its timeline on the forge shows
  the edit, label change or comment, with the same timestamp to the second. The `ts` inside each line is UTC; the
  prefix Claude Desktop adds is local time. The forge keeps writes permanently, so only refusal lines can age out,
  after about five weeks at the measured volume.
- **Integrity**: the server has no file-write tool and never touches the log folder. The logged-in OS user can edit
  the file; that is accepted for a one-operator workstation (constitution 1.1.0).

## The live-forge tier (`pdlc:integration-forge`, operator-run)

It runs against `ci-smoke`, which needs Spec Kit 1.4.x on a **protected** `main`, the proposal form and labels (the
tier creates missing labels). The spec lifecycle publishes a branch, so it needs a token with `write:issue` +
`write:repository`: give it as `PDLC_IT_TOKEN` for the run (for example read from a mode-600 file), never in a tracked
file. Without it the tier falls back to `FORGE_ISSUE_TOKEN`, and the lifecycle test fails at its first push.

```bash
PDLC_IT_TOKEN="$(cat ~/.config/belay/pdlc-test-token)" pnpm nx run pdlc:integration-forge
```

It closes every issue it creates. The feature branches it publishes (`NNN-pdlc-it-<run id>-life`) stay on `ci-smoke`
until the operator agrees to delete them.

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
| `copy_dirty` | The local copy has changes or untracked files | The default-branch copy is read-only: remove them in your own tools (specs live in `.pdlc-specs\`, not here) |
| `copy_off_branch` | The copy is on another branch, or detached | Switch it back to the default branch yourself |
| `copy_diverged` | The copy has local commits | Reset it yourself, or delete the folder and sync again |
| `copy_foreign` | The folder is not a copy of this repository (another origin, not a repository, inside another) | Move it aside; sync clones a fresh copy |
| `invalid_input` | A schema or size limit failed (body or comment over 64 KiB, title over 255) | Shorten it |
| `forge_auth` | The forge refused the token (401/403), naming the capability | Check the token's two scopes (`write:issue`, `write:repository`), or that it was not revoked |
| `forge_unreachable` | The forge could not be reached, or failed | Check the tailnet; nothing was written |
| `not_found` | No such issue | Check the number |
| `git_verb_refused` | A git call outside the allowlist's exact shapes | A defect: report it with the audit line |
| `push_target_refused` | A push to anything but the spec's own feature branch | A defect: nothing was pushed |
| `spec_kit_unavailable` | No local copy yet, or the repository's Spec Kit is absent or unsupported, its script failed, or no interpreter for its scripts was found (PowerShell, or bash from Git for Windows) | `sync_repo` first; otherwise set Spec Kit up in Claude Code in that repository. The proposal stays as it is |
| `spec_hook_unsupported` | A mandatory specify or clarify hook that the server does not know how to run (`check_spec_kit` lists each hook's handling) | Write that spec in Claude Code |
| `not_ready_proposal` | The proposal is not at `ready` | Mark it ready first, or check its stage with `get_proposal` |
| `spec_already_in_progress` | The proposal already has a spec | `get_spec` resumes it |
| `branch_exists` | The branch the script named already exists on the forge | Sync the copy and start again: the next number is picked |
| `no_spec_for_proposal` | The proposal has no spec in progress | `start_spec` first |
| `spec_state_inconsistent` | The worktree, its state file and the proposal's labels disagree | Look at the folder under `.pdlc-specs\` before trying again; nothing was changed |
| `path_outside_feature` | A write outside `spec.md` and `checklists/*.md` in the spec folder | Only those files are written |
| `document_locked` | The document is closed, or planning has started | Edit it in Claude Code on the branch |
| `pane_edit_pending` | The document changed since it was read (in the pane or the chat) | Read it again, take the change in, retry with the new revision |
| `stage_transition_refused` | The stage change is not in the stage table | Check the stage with `get_proposal` |
| `stage_ambiguous` | The proposal carries no stage label, or more than one | Fix its labels in the web UI so it has one |
| `spec_has_markers` | `[NEEDS CLARIFICATION]` markers remain | Clarify them first |
| `spec_not_clarified` | The clarify step has not run on this spec | Run clarification first |
| `branch_changed` | The feature branch moved on the forge since the spec was started or published | `take_latest_spec`, then approve again |
| `nothing_to_take` | The branch has not moved | Nothing to do |
| `git_identity_missing` | No `user.name` or `user.email` on the workstation | Set them with `git config --global`, then approve again |
| `publish_failed` | The commit was made but the push failed; the stage did not move | Approve again once the forge is reachable; the commit is kept and the push retried |

If the server does not start at all, `main.log` has one `"level":"ERROR"` line from it naming the missing or invalid
setting (`PDLC_FORGE_URL`, `PDLC_FORGE_OWNER`, `PDLC_FORGE_TOKEN` or `PDLC_CLONE_ROOT`), for example
`cannot start: PDLC_CLONE_ROOT does not exist`; the token's value is never printed. Find it with
`Select-String -Path "$env:LOCALAPPDATA\Claude\logs\main.log" -SimpleMatch '"service":"pdlc"' | Select-Object -Last 3`.
**Do not trust the per-server log for this**: measured, `mcp-server-pdlc proposal intake.log` still says `Server
started and connected successfully` and logs the client's `initialize` after the server has exited.

## Hand off to a target repository (worked example: MCM)

This is the guide for making another repository, MCM first, accept proposals and specs from Claude Desktop (014
FR-026, 016 FR-033). It states what the target must do. BELAY's own adoption is the worked example to copy from:

| BELAY file | What it shows |
| --- | --- |
| `.forgejo/issue_template/proposal.yaml` | The form copy, byte-identical to `mcp-servers/pdlc/contract/proposal.yaml` |
| `scripts/backlog.mjs` (`TAXONOMY`, `selectReadyItems`, `stage`, `record-tests`) | The labels, the ready listing by stage, the stage verb, the count comments |
| `scripts/lib/stage-trailer.mjs`, `scripts/__tests__/fixtures/stage-trailer/` | The trailer grammar and the transition table, shared with the server through fixtures |
| `.specify/extensions.yml` (`after_specify` and `after_plan` → `speckit.belay.spec-stage`; `before_plan` → `speckit.belay.feature-dir`) and their skills under `.claude/skills/speckit-belay-*/` | The two stage hooks, and the hook that lets `/speckit-plan` find a folder on a checked-out branch; registered in the Spec Kit gate |
| `.specify/templates/overrides/tasks-template.md` | The two count tasks: **Record the test baseline** first, **Record the test count** second to last |
| `.forgejo/workflows/feature-merged.yml`, `scripts/feature-merged.mjs`, `scripts/feature-merged.config.json` | Close on merge, with the created-test count |
| `.forgejo/workflows/guardrails.yml` (`--results` on each test step; the outcomes step before the digest), `scripts/lib/collect-test-results.mjs` | The suite outcomes from the run CI already makes |
| `.claude/skills/forgejo-issues/SKILL.md` ("Proposals") | The backlog skill: stages, both pick-ups, close on merge |
| `scripts/__tests__/backlog.test.mjs`, `feature-merged*.test.mjs`, `pdlc-independence.guard.test.mjs` | The tests and the no-dependency guard |

### Before starting in the target

1. Features 014 and 016 have merged in BELAY, so the master form, labels and trailer are final.
2. The `pdlc` server 0.2.1 or later is installed (above), with the `write:repository` token, and the full loop has been proven
   on BELAY ([016 quickstart](../../specs/016-pdlc-spec-intake/quickstart.md) §2 to §4).
3. The target's default branch is protected (no direct push): `check_setup` reports `default_branch_protected: true`.
   The server relies on the forge to refuse a push to it.
4. The target has Spec Kit initialised and `check_spec_kit` reports `supported`. Without it, proposals still work;
   only specs from Claude Desktop are refused (`spec_kit_unavailable`).

### In a Claude Code session in the target (from a worktree, on a feature branch)

1. Copy `docs/proposals/claude-desktop-proposal-intake/PRD-ProposalsInBacklog.md` into the target's
   `docs/proposals/` and run `/speckit-specify` from it, then plan, tasks and implement as usual. That feature must
   deliver, in this order:
   1. **The form**: a copy of BELAY's master form at `.forgejo/issue_template/proposal.yaml`, byte-identical to the
      master. It takes effect only from the default branch.
   2. **The labels**: all of `mcp-servers/pdlc/contract/proposal-labels.json` (`type/proposal`,
      `status/proposal-draft`, and the four stage labels `status/spec-in-progress`, `status/ready-to-plan`,
      `status/in-engineering`, `status/merged`) added to the label set the target's backlog tool creates and checks,
      with the same colours and descriptions, so an unknown-label filter is refused rather than returning everything.
   3. **The ready listing**: a ready proposal (`status/needs-spec`) and a ready-to-plan spec are listed, the latter
      with its `branch:` and `spec:` from the latest trailer; drafts, specs in progress and items in engineering are
      hidden and counted.
   4. **The stage verb and both hooks**: a verb equal to `backlog.mjs stage` (comment with trailer first, label second,
      refusing any move outside the stage table, idempotent), run by a mandatory `after_specify` hook
      (`spec-in-progress`) and a mandatory `after_plan` hook (`in-engineering`), both reading `Proposal #<n>` from the
      spec's **Input** line. If the target's Spec Kit, like 1.4.2, finds the feature folder only from
      `.specify/feature.json`, add the `before_plan` hook that writes it, so a branch checked out from Claude Desktop
      plans without a fix-up.
   5. **Close on merge**: a workflow on every push to the default branch, equal to `feature-merged.yml`, that closes
      the one open proposal the merged spec names, with the created-test count at the merge against its parent. It is
      not a required check and runs no test. On a forge where the run token cannot comment or close, give it a
      `write:issue` fallback secret.
   6. **The suite outcomes**: the target's CI test steps write a results report, and a last-but-one step posts the
      passed/failed/skipped/todo counts from that same run on a push to the default branch, never failing the job.
      Its target list lives in one config file, guarded against the CI steps.
   7. **The count tasks**: the target's tasks-template override gains the two tasks that run its equivalent of
      `record-tests` (`baseline`, then `close-out`), which warn and continue when there is no open proposal.
   8. **Docs**: the target's backlog runbook (labels, stages, form, both pick-ups, close on merge) and its lifecycle
      page, with the wiki pages that summarise them refreshed in the same pull request.
   9. **Tests and gates**: tests for the labels, the ready listing, the verb, the trailer (BELAY's fixtures can be
      copied), the close and the outcomes; form validation passing; the wiki gates passing.
   10. **No dependency on the server** (FR-031): nothing in the target calls, requires or checks for the `pdlc`
       server. The form, ready listing, pick-up, hooks and close on merge all work with it absent.
2. **Counting rule first.** BELAY's `scripts/count-repo-metrics.mjs` counts `node:test`-style declarations only: lines
   starting `test(`, `it(` or `t.test(` (and their `.skip`, `.todo`, `.only` forms) in a file under `__tests__/` or named
   `*.test.*`. A test kind it does not recognise counts as **zero**, so the created count would be silently low. Before
   adopting the counts, MCM names the counting rule for each of its own test kinds and implements it in its counter.
   The outcomes table needs only that each CI test step can write a results report.
3. After that pull request merges, run the target's label setup **once** so the six labels exist on the forge.

### Confirm the hand-off

1. In Claude Desktop, run `check_setup` for the target: `ok: true`, `default_branch_protected: true`. Run
   `check_spec_kit`: `supported`.
2. File a proposal into the target from Claude Desktop and confirm it as ready.
3. Start its spec, clarify it, and approve it: the issue shows `spec in progress`, then `ready to plan` with a link to
   the folder on the published branch.
4. In Claude Code in the target, the ready listing names the branch; check it out in a worktree and run
   `/speckit-plan`: the issue moves to `in engineering`. Finish the feature and merge it.
5. **SC-004**: the issue's timeline shows each stage in turn, never two stage labels at once, and it closes only when
   the merge lands, with `status/merged`.
6. **SC-010**: the closing comment's created count equals the target's counter run by hand at the merge commit and its
   parent; the outcomes comment that follows matches that commit's CI test log, per target; and CI ran the tests once.
7. Repeat steps 2 to 5 **with the server stopped**, filing the proposal through the web form and running
   `/speckit-specify` in Claude Code: the flow still works end to end.

### Keeping in step

When BELAY's master form or labels change, `check_setup` reports the target's copy as `out_of_step`. The copy is
refreshed by hand in a pull request in the target. A change to the trailer or the transition table changes BELAY's
fixtures first; copy them across in the same way.
