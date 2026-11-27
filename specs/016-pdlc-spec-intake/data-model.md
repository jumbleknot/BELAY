# Data model: PDLC spec intake

Extends [feature 014's data model](../014-pdlc-proposal-intake/data-model.md). Only new and changed entities are
listed.

## Proposal issue (changed)

| Field | Source | Notes |
| --- | --- | --- |
| `stage` | the one stage label (R7) | Exactly one of the six. Two stage labels, or none on an open proposal, is reported as `stage_ambiguous` and every stage-changing tool refuses it |
| `feature_branch`, `spec_dir` | the most recent stage trailer (contracts/stages.md) | Present from **spec in progress** onwards |
| `withdrawn_branches` | every trailer with `stage=withdrawn` | Never reused by `start_spec` |
| `state` | forge | `closed` only at **merged** for proposals created after this feature (014's closed proposals stay closed) |

Validation: the transition table in [contracts/stages.md](contracts/stages.md) is the only way `stage` changes.

## Spec in progress (new)

One per proposal at a time (FR-004).

| Field | Notes |
| --- | --- |
| `repo` | canonical name (014 R1) |
| `number` | the proposal's issue number |
| `feature_num`, `branch` | from the repository's branch script dry run (R1) |
| `spec_dir` | `specs/<NNN-slug>/` |
| `worktree_path` | `<clone_root>/.pdlc-specs/<Repo>/<NNN-slug>/` (R2) |
| `recorded_remote_tip` | the feature branch's tip on the forge when last seen, or `null` before the first publish (R8) |
| `revision` | a hash over the feature folder's working files; changes on every write by the model or the pane |
| `last_start_or_reopen` | date, shown to the author |
| `sessions_at_start_or_reopen` | integer ≥ 0: how many `### Session` headings `spec.md` had at the last start or reopen. Approval needs more (R15) |
| `proposal_updated_at_start` | the proposal's `updated_at` when the spec started. `get_spec` reports `proposal_updated_since_start` when the proposal has changed since (spec Edge Cases) |
| `locked` | derived: the issue's stage is **in engineering** or later |

Persisted in `<clone_root>/.pdlc-specs/<Repo>/<NNN-slug>.state.json`, written by the server only:

```json
{ "repo": "BELAY", "number": 91, "branch": "016-pdlc-spec-intake", "spec_dir": "specs/016-pdlc-spec-intake/",
  "recorded_remote_tip": null, "last_start_or_reopen": "2026-11-27", "sessions_at_start_or_reopen": 0,
  "proposal_updated_at_start": "2026-11-26T12:27:07Z", "state_version": 1 }
```

The worktree's files are the content. The state file holds only what git cannot answer. If it is missing or does not
match `git worktree list`, the server reports `spec_state_inconsistent` and writes nothing.

## Pane document (new)

| Field | Notes |
| --- | --- |
| `kind` | `proposal` or `spec` |
| `ref` | for a proposal, its number or a `draft_id` before creation; for a spec, the proposal number |
| `revision` | as above. For a proposal draft, a hash of the draft file |
| `read_only` | true for a spec at **in engineering** or later, or a closed proposal (FR-037) |
| `model_read_snapshot` | the document as the model last read it, a file under `<clone_root>/.pdlc-drafts/<Repo>/` written by `get_spec` and `get_proposal_draft`; `pane_changes` is the diff from it. On disk, never in memory: two server processes serve one session (research R9) |

Proposal drafts live at `<clone_root>/.pdlc-drafts/<Repo>/<draft_id or number>.json`. They hold the nine sections and
the priority, and are deleted by the server after a successful `create_proposal` or `update_proposal` that included
them.

## Merge record (new, CI only)

Built by `scripts/feature-merged.mjs` for one push to the default branch:

| Field | Notes |
| --- | --- |
| `merge_sha`, `parent_sha` | the pushed commit and its first parent |
| `pr` | number, from the forge or the merge commit title |
| `proposal` | the one `Proposal #<n>` in the spec added by the pull request, or none |
| `created` | test declarations at `merge_sha` minus at `parent_sha` (`count-repo-metrics.mjs`), or `unknown` with a reason (R12, M10) |
| `outcomes` | from the `guardrails` run of `merge_sha`, per target: `passed`, `failed`, `skipped`, `todo` over the whole suite, or `unknown` with a reason. Not computed by the close |

## Label contract (changed)

`mcp-servers/pdlc/contract/proposal-labels.json` gains four labels. `backlog.mjs` `TAXONOMY` copies them, and 014's
copy-guard test covers them:

| Name | Colour | Description |
| --- | --- | --- |
| `status/spec-in-progress` | `#fbca04` | Spec being written and clarified by its author; not ready to plan |
| `status/ready-to-plan` | `#0e8a16` | Spec approved and published on its feature branch; pick up with /speckit-plan |
| `status/in-engineering` | `#5319e7` | Planning has started; the spec is locked from Claude Desktop |
| `status/merged` | `#6f42c1` | Feature branch merged into the default branch; the issue is closed |
