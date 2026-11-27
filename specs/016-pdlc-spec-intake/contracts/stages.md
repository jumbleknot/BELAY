# Contract: stages, transitions and the stage trailer

**Normative.** It is shared by the `pdlc` server, `scripts/backlog.mjs` (`stage`, `ready`) and
`scripts/feature-merged.mjs`. A change here moves all three, and the master skill, in one change.

## Stages

| Stage id | Label | Issue state |
| --- | --- | --- |
| `draft` | `status/proposal-draft` | open |
| `ready` | `status/needs-spec` | open |
| `spec-in-progress` | `status/spec-in-progress` | open |
| `ready-to-plan` | `status/ready-to-plan` | open |
| `in-engineering` | `status/in-engineering` | open |
| `merged` | `status/merged` | closed |

An open proposal carries exactly one stage label. A change removes the old stage label's id and adds the new one
(014 R8), and touches no other label.

## Transitions (the only ones allowed)

| From | To | Made by | Refusal when not allowed |
| --- | --- | --- | --- |
| `ready` | `spec-in-progress` | `start_spec`; `backlog.mjs stage … spec-in-progress` (`after_specify`) | `stage_transition_refused` |
| `spec-in-progress` | `ready-to-plan` | `approve_spec` | same |
| `ready-to-plan` | `spec-in-progress` | `reopen_spec` | same |
| `spec-in-progress`, `ready-to-plan` | `ready`, `draft` | `withdraw_spec` | same |
| `spec-in-progress`, `ready-to-plan` | `in-engineering` | `backlog.mjs stage … in-engineering` (`after_plan`) | same |
| any open stage | `merged` | `feature-merged.mjs` only | n/a (CI; logs and exits 0) |
| `draft` ↔ `ready` | | `update_proposal` (014, unchanged) | 014's rules |

`stage` re-applied to an issue already at that stage, with the same branch, is a no-op that says so (idempotent).

## The stage trailer

Every stage change except `draft` ↔ `ready` posts one comment. Its body is human text, a blank line, then exactly one
trailer as its last line:

```text
<!-- pdlc-stage: stage=<stage id|withdrawn> branch=<branch> spec=<specs/NNN-slug/> -->
```

- `stage`: the new stage id, or `withdrawn` for a withdrawal (the label then shows `ready` or `draft`).
- `branch`: the feature branch. Characters `[A-Za-z0-9._/-]` only.
- `spec`: the spec folder, with a trailing `/`.

Readers take the **most recent** trailer for the current branch and folder, and every `withdrawn` trailer for the
withdrawn list. A trailer that does not match this grammar exactly is ignored, and reported as a warning.

Human text, per transition:

| Transition | Text |
| --- | --- |
| → `spec-in-progress` | ``Spec started on branch `<branch>` in `<spec>` (<via>).`` where `<via>` is `Claude Desktop` or `Claude Code` |
| → `ready-to-plan` | ``Spec approved by its author and published on branch `<branch>`: [<spec>](<forge link to the folder on the branch>). Ready to plan.`` or, after a reopen, ``Spec re-approved …`` |
| `ready-to-plan` → `spec-in-progress` | ``Spec reopened by its author for editing; hidden from ready work until approved again.`` |
| withdrawal | ``Spec withdrawn by its author. Branch `<branch>` is kept and will not be reused.`` |
| → `in-engineering` | ``Planning started on branch `<branch>`. The spec is locked from Claude Desktop.`` |
| → `merged` | see [feature-merged.md](feature-merged.md) |

## Ready listing (`backlog.mjs ready`)

- Lists `status/ready-to-plan` items in priority order, each with `branch:` and `spec:` from its trailer.
- Hides `status/spec-in-progress` and `status/in-engineering`, printing `(n spec(s) in progress not listed)` and
  `(n item(s) in engineering not listed)`.
- Leaves `draft`, `ready` and `bot-managed` handling as 014 left it.
