---
type: Runbook
title: The agent-driven backlog (Forgejo Issues)
description: How the BELAY backlog lives in the repository's own Forgejo tracker and is worked by the assistant through scripts/backlog.mjs and the tasks-to-issues fan-out — the write credential bounded server-side by its scope and client-side by a same-repository guard, the label and milestone conventions, why closure is an explicit act, and the API traps that make a filter fail open.
tags: [backlog, forgejo, issues, runbook]
resource: docs/runbooks/backlog.md
timestamp: 2026-11-22
---

# The agent-driven backlog (Forgejo Issues)

The BELAY backlog is this repository's Forgejo issue tracker. The maintainer works it in the web UI.
The assistant works it through `scripts/backlog.mjs` (`ready`, `list`, `show`, `create`, `update`,
`comment`, `dep`, and idempotent label and milestone setup), with decision rules in
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
- **The issue form only takes effect from the default branch.** `validate-form` says so rather than
  reporting the form as broken.
- **Exit codes:** 0 ok, 1 unexpected, 2 usage or validation, 3 missing credential (often a token set
  after the terminal started), 4 authorisation, 5 transport.
