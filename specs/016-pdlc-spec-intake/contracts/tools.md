# Contract: `pdlc` tools added and changed by feature 016

**Normative.** It extends [014's tool contract](../../014-pdlc-proposal-intake/contracts/tools.md), whose nine tools
keep their names and parameters. `mcp-servers/pdlc/src/tool-contract.mjs` is the single source. The contract test
reads `tools/list` over the protocol and compares it with this file's names, parameters and enums. The master skill
and `manifest.json` `tools` move in the same change (FR-030). The server version becomes **0.2.0**.

Every tool keeps 014's rules: an owner and repository allowlist first, one `audit` line per call, a refusal that
changes nothing, no token in a result, and `repo` matched case-insensitively.

## Spec Kit check

| Tool | Parameters | Result |
| --- | --- | --- |
| `check_spec_kit` | `repo` | `{initialised, version, supported, script: "ps"\|"sh", feature_numbering, hooks: [{point, command, optional, handling: "server"\|"not_run"\|"unsupported"}], ok, reason?}`. `ok` is false when not initialised, the version is unsupported, or a mandatory hook is `unsupported` (R3, R14). Reports only; changes nothing |

## Spec lifecycle

| Tool | Parameters | Does | Refusals (beyond 014's) |
| --- | --- | --- | --- |
| `start_spec` | `repo`, `number`, `short_name` (2 to 4 kebab words, `[a-z0-9-]`, at most 40 characters) | Requires stage `ready`. Fetches every head, runs the repository's branch script as a dry run, creates the worktree and branch, writes the resolved template to `spec.md` with the **Input** line already filled (`Proposal #<n>: <title>` plus the body), records state, and moves the stage to `spec-in-progress` with its trailer. Returns `{branch, feature_num, spec_dir, worktree_path, template_resolved: true, revision, hooks}` | `not_ready_proposal`, `spec_already_in_progress` (with the existing branch, so the skill offers resume), `spec_kit_unavailable`, `spec_hook_unsupported`, `branch_exists` |
| `get_spec` | `repo`, `number` | Reads the spec in progress: `{stage, locked, branch, spec_dir, files: [{path, content}], revision, remote: {changed: bool, commits?, diffstat?}, markers: [..], clarified: bool, pane_changes?: diff since the model's last read}` | `no_spec_for_proposal`, `spec_state_inconsistent` |
| `write_spec_file` | `repo`, `number`, `path` (relative to `spec_dir`), `content` (at most 256 KiB), `base_revision` | Writes one file in the worktree. Returns the new `revision`, and notifies an open pane | `path_outside_feature`, `document_locked`, `pane_edit_pending` (the revision moved), `stage_transition_refused` (the stage is not `spec-in-progress`) |
| `approve_spec` | `repo`, `number`, `base_revision` | Checks (R15), checks the remote (R8), commits the feature folder, publishes the feature branch, then moves the stage to `ready-to-plan` with its trailer. Returns `{commit, branch, spec_url, stage}` | `spec_has_markers`, `spec_not_clarified`, `branch_changed`, `git_identity_missing`, `publish_failed` (commit kept local; stage unchanged), `pane_edit_pending` |
| `reopen_spec` | `repo`, `number` | `ready-to-plan` → `spec-in-progress`, with its trailer; records the reopen date | `document_locked`, `stage_transition_refused` |
| `withdraw_spec` | `repo`, `number`, `to`: `ready`\|`draft` | → `to`, with a `withdrawn` trailer. Deletes nothing: the worktree, the branch (local and published) and the state file stay; the state file is marked withdrawn | `document_locked`, `stage_transition_refused` |
| `take_latest_spec` | `repo`, `number` | R8: back up, fast-forward to the published branch, re-apply the author's edits three-way. Returns `{merged: [path], conflicts: [path], backup_path, revision}`. Publishes nothing and changes no stage | `document_locked`, `nothing_to_take` (the remote has not moved) |

## Right-hand pane (MCP App)

| Tool | Visibility | Parameters | Does |
| --- | --- | --- | --- |
| `show_document` | model | `repo`, `kind`: `proposal`\|`spec`, `number?`, `draft_id?` | Opens `ui://pdlc/document-pane.html` on the document (`_meta.ui.resourceUri`). For a proposal not yet filed, it creates a draft and returns its `draft_id`. Returns `{revision, read_only}` |
| `get_proposal_draft` | model | `repo`, `draft_id` or `number` | Reads a proposal draft: sections, priority, `revision`, and `pane_changes` since the model's last read |
| `save_pane_edit` | **app only** (`_meta.ui.visibility: ["app"]`) | `repo`, `kind`, `ref`, `base_revision`, then `path` + `content` (spec) or `sections` + `priority?` (proposal) | Writes the edit (R9), returns the new `revision`. Refuses `document_locked` and `pane_edit_pending` |

## Changed 014 tools

| Tool | Change |
| --- | --- |
| `create_proposal`, `update_proposal` | Optional `draft_revision`. When a pane draft exists for the proposal, the call is refused `pane_edit_pending` unless `draft_revision` equals the draft's revision. On success the draft is deleted |
| `check_setup` | `missing_labels` covers the four stage labels too. New report-only field `default_branch_protected`: `true`\|`false`\|`unknown` (R6) |
| `get_proposal`, `list_proposals` | `status` in results also takes the four new stage ids. `list_proposals`'s `status` filter gains `spec-in-progress`, `ready-to-plan`, `in-engineering` and `merged` |

## Still absent

No close, delete, reopen-issue, arbitrary-relabel, bulk, force-push, branch-delete or default-branch write tool
(FR-027). Closing on merge happens in CI ([feature-merged.md](feature-merged.md)), never in the server.

## New refusal codes

`not_ready_proposal`, `spec_already_in_progress`, `spec_kit_unavailable`, `spec_hook_unsupported`, `branch_exists`,
`no_spec_for_proposal`, `spec_state_inconsistent`, `path_outside_feature`, `document_locked`, `pane_edit_pending`,
`stage_transition_refused`, `stage_ambiguous`, `spec_has_markers`, `spec_not_clarified`, `branch_changed`,
`git_identity_missing`, `publish_failed`, `nothing_to_take`, `push_target_refused`, `git_verb_refused` (exists).
Each has a test that observes it (FR-026).
