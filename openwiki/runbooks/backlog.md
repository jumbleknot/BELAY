---
type: Runbook
title: The agent-driven backlog (Forgejo Issues)
description: How the BELAY backlog lives in the repository's own Forgejo tracker and is worked by the assistant through scripts/backlog.mjs and the tasks-to-issues fan-out — the write credential bounded server-side by its scope and client-side by a same-repository guard, the label and milestone conventions, proposals and their stages (draft, ready, spec in progress, ready to plan, in engineering, merged; the stage verb, both pick-ups, and close on merge), the test-count comments, why closure is an explicit act, and the API traps that make a filter fail open.
tags: [backlog, forgejo, issues, runbook]
resource: docs/runbooks/backlog.md
resource-sha256: 8b16a320630e4094665e6810a77063a9fb1d9cf3c273fbaf2554774916852b4f
timestamp: 2026-11-28T02:14:56.635Z
---

# The agent-driven backlog (Forgejo Issues)

The BELAY backlog is this repository's Forgejo issue tracker. The maintainer works it in the web UI.
The assistant works it through `scripts/backlog.mjs` (`ready`, `list`, `show`, `create`, `update`,
`comment`, `dep`, `stage`, `record-tests`, and idempotent label and milestone setup), with decision rules in
`.claude/skills/forgejo-issues/SKILL.md`. **No backlog operation creates a commit, branch, PR or CI
run.** Issue changes are HTTP calls, so a one-line backlog edit costs no CI cycle.
`/speckit-taskstoissues` mirrors a feature's `tasks.md` into its milestone through
`scripts/taskstoissues.mjs`. Full detail is in
[docs/runbooks/backlog.md](../../docs/runbooks/backlog.md).

## Gotchas

- **Inside a feature, `tasks.md` is authoritative.** The issues are a mirror for coordination. The
  tracker is the source of truth only for work that crosses features.
- **Two tokens, kept separate on purpose.** `FORGE_ISSUE_TOKEN` (`write:issue`) does every write.
  Reads fall back to the read-only `FORGE_TOKEN`. The tokens are account-wide, so the client-side
  same-repository write guard in `backlog.mjs` is what keeps writes in this repository. Any other
  client holding the token could write issues anywhere on the account.
- **Don't check a token's scope through the repository API's `permissions`.** That reports what the
  account may do. The scope split is proven by behaviour: the four write verbs return 403 under
  `FORGE_TOKEN`.
- **Closure is an explicit, verified act.** Merge-time auto-closing (`closes #N`) is not used. Issue
  and PR numbers share one sequence, so a mistyped `#N` could close an unrelated item.
- **No bulk operations without an explicit instruction.** Item history lives in the forge's database,
  not git, so there is no `git revert` for a mass close.
- **A stale `status/blocked` label silently hides an item from `ready`.** `ready` trusts the label
  over the dependency graph. It only warns about an unlabelled item that has an open blocker.
- **Unknown labels and milestones are refused locally**, because the API would silently ignore them
  and return the unfiltered set. A listing that shows PRs has lost `type=issues`.
- **The issue forms only take effect from the default branch.** There are two, `backlog-item.yaml` and
  `proposal.yaml`. `validate-form` says so rather than reporting a form as broken, and marks one that is only in
  the working tree as not yet on the default branch.
- **A proposal moves through stages and closes only on merge** (features 014 and 016). A draft
  (`status/proposal-draft`) is hidden from `ready` with its own note; a ready one (`status/needs-spec`) is listed
  like any item. Pick one up with `show <n>` and `/speckit-specify` started with `Proposal #<n>: <title>`; the
  mandatory `after_specify` hook runs `stage <n> spec-in-progress`. A spec approved in Claude Desktop is
  `status/ready-to-plan`, listed with its `branch:` and `spec:`: check that branch out and run `/speckit-plan`, whose
  `after_plan` hook moves it to `status/in-engineering`. Specs in progress and in engineering are hidden and counted.
  Each move comments first, with a `pdlc-stage` trailer as its last line, and swaps the label second; `stage` is
  idempotent and refuses a move outside the stage table. **Only the merge closes the issue**, in CI
  (`feature-merged`), with `status/merged`. Never close a proposal with `update` or the web UI.
- **`record-tests` posts the test count at the tasks template's first and second-to-last tasks.** With no open
  proposal it prints the counts and why nothing was posted, and exits 0, so a feature not from a proposal never
  fails.
- **The proposal labels are copied from the pdlc contract**, `mcp-servers/pdlc/contract/proposal-labels.json`,
  and a test holds `TAXONOMY` equal to it. Run `setup-labels` once after a change adds labels (feature 016 added
  the four stage labels).
- **Exit codes:** 0 ok, 1 unexpected, 2 usage or validation, 3 missing credential (often a token set
  after the terminal started), 4 authorisation, 5 transport.
- **`ready` never lists the dependency bot's dashboard.** An item labelled `status/bot-managed` is
  skipped, and `ready` says so: `(n bot-managed item(s) not listed)`. The bot owns that issue; never
  edit or close it ([dependency bot](renovate.md)).
