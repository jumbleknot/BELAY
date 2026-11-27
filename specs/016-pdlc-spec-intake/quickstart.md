# Quickstart: validating PDLC spec intake end to end

A guide to running the checks, not a design. The contracts are in [contracts/](contracts/), and the entities in
[data-model.md](data-model.md).

## Prerequisites

- This feature merged on BELAY's `main`, and `node scripts/backlog.mjs setup-labels` run once, so the four stage
  labels exist.
- The `pdlc` token re-scoped to `write:issue` + `write:repository` (research M5), and pasted into the extension's
  setting.
- `pnpm nx run pdlc:pack`, then the new `.mcpb` and skill zip installed in Claude Desktop (`docs/runbooks/pdlc.md`).
- A session in a **plain chat** (014 R12).
- For the live-forge tier: `ci-smoke` has Spec Kit 1.4.x initialised, the proposal form, the labels, and a protected
  `main`.

## 1. Automated tiers (dev container and CI)

```bash
pnpm nx run pdlc:lint && pnpm nx run pdlc:test && pnpm nx run pdlc:integration
pnpm nx run scripts:lint && pnpm nx run scripts:test
node scripts/check-speckit-overrides.mjs
```

Expected:
- every guard refusal in [contracts/tools.md](contracts/tools.md) observed;
- the contract test matches the tool list;
- `pdlc:integration` runs a whole spec lifecycle against local bare repositories: start, write, approve (push to the
  bare remote), reopen, take-latest with one conflict, and withdraw. It also shows a direct push to the bare
  remote's default branch refused by the server;
- the override gate reports the new hooks and skill as registered.

Check the **skip count** is 0 (AGENTS.md).

Live forge, operator-run:

```bash
pnpm nx run pdlc:integration-forge
```

It runs the same lifecycle against `ci-smoke`. Missing credentials fail; they never skip.

## 2. SC-001: proposal to approved spec in Claude Desktop

1. In the chat, choose BELAY and a ready proposal, then choose **Start the spec**.
   - The pane opens on `spec.md`.
   - The issue shows `status/spec-in-progress` and a comment naming the branch.
2. Answer the clarify questions in the chat.
   - `spec.md` gains `## Clarifications` / `### Session <today>`.
3. Ask for one change in the chat, and type one change in the pane.
   - Both appear in the pane.
   - The session says it took in the pane change.
4. Stop. Start a new chat, choose the same proposal, and choose **Resume**.
   - The spec is as you left it.
5. Choose **Approve**.
   - The branch is on the forge, with one commit touching only `specs/NNN-slug/`.
   - The issue shows `status/ready-to-plan`, with a comment linking the folder.

## 3. SC-002 and SC-003: the Architect's side

```bash
node scripts/backlog.mjs ready
```

Expected: the item is listed with `branch:` and `spec:`, and specs in progress are counted, not listed.

```bash
git worktree add /home/coder/worktrees/<NNN-slug> origin/<branch>
cd /home/coder/worktrees/<NNN-slug>
```

Then run `/speckit-plan`.

Expected:
- the plan runs with no fix-up;
- the `after_plan` hook moves the issue to `status/in-engineering`;
- a Claude Desktop edit attempt is now refused `document_locked`.

## 4. SC-004 and SC-010: merge

Open and merge the feature's pull request with `forge-pr.mjs`.

Expected:
- `feature-merged` runs on `main`;
- the issue gets the closing comment with the created count, swaps to `status/merged`, and closes;
- `node scripts/count-repo-metrics.mjs --rev <merge sha> --json` and `--rev <merge sha>^1` differ by the created count;
- the `guardrails` run for the merge commit adds the outcomes comment; its numbers match that run's log;
- the run took no longer than an ordinary `guardrails` run on `main` (no second test run).

To check the comment before any write:

```bash
node scripts/feature-merged.mjs --sha <merge sha> --dry-run
```

## 5. SC-011: the branch changed on the forge

With a spec in progress and already published once, push a commit to its branch from the dev container. In Claude
Desktop, choose **Approve**.

Expected:
- `branch_changed` is refused, with the commit listed;
- the session offers to take the latest; choose **Take latest**;
- your unpublished edit is kept, or shown as a conflict;
- nothing is published until you approve again.

## 6. SC-005: no Spec Kit

Against a repository with proposals but no `.specify/`, save a ready proposal.

Expected:
- no **Start the spec** offer, and a plain message saying why;
- `git ls-remote` shows no new branch.

## 7. SC-008: server absent

With the extension disabled, take a ready BELAY proposal through `/speckit-specify` in VS Code, then `/speckit-plan`,
then merge.

Expected:
- the issue moves through `spec-in-progress`, `in-engineering` and `merged`;
- `scripts:lint` and `scripts:test` pass with no skip.

## 8. FR-040: the tasks template's count tasks

- In a feature from a proposal, `node scripts/backlog.mjs record-tests --spec specs/<NNN-slug> --point baseline`
  comments the baseline on the issue.
- In a feature with no `Proposal #<n>` in its Input line, the same command prints the count, says "not from a
  proposal; nothing posted", and exits 0.
- With the backlog credential unset, it exits 3; the task records the count and the exit code, and implementation
  continues.
