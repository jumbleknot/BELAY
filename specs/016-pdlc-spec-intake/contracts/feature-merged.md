# Contract: closing on merge (`feature-merged.yml`, `scripts/feature-merged.mjs`, the `guardrails` outcomes step)

**Normative** for the workflow triggers, the script's exit behaviour and the comments. Revised 2026-11-27 for decision
M10 (research R12): **no test target runs a second time**.

## Triggers

- `.forgejo/workflows/feature-merged.yml`: `on: push: branches: [main]`, with `workflow_dispatch` taking a `sha` for
  a re-run. Runner `belay`, timeout 5 minutes, checkout `fetch-depth: 2` (the counter reads the parent's objects). Its
  own concurrency group, **without** `cancel-in-progress`. It runs no test. It is not a required check.
- `.forgejo/workflows/guardrails.yml`, job `guardrails`, gains one final step, after the failure digest:
  `if: always() && github.event_name == 'push'`, `continue-on-error: true`, running
  `node scripts/feature-merged.mjs --outcomes <reports dir> --job-status ${{ job.status }}`. The three test steps
  write their collector reports into `<reports dir>` by the path T007 chose. The job's 10-minute timeout is
  unchanged.

## Script

```text
node scripts/feature-merged.mjs [--sha <commit>] [--dry-run]
node scripts/feature-merged.mjs --outcomes <dir> --job-status <success|failure|cancelled> [--sha <commit>] [--dry-run]
```

- The first form is the **close**: created count, closing comment, label swap, close.
- The second form posts the **outcomes** comment only. It never changes a label or closes.
- `--dry-run` prints the comment it would post and the label change, and writes nothing.
- Both forms find the proposal the same way (research R10 step 2). Not from a proposal, an ambiguous marker, or an
  issue that is not an open proposal (for the close) or not a proposal at all (for outcomes) is one log line and exit
  **0**, with nothing written.
- The close exits **1** only when a write it attempted failed (credential refused by both tokens, transport). The
  digest step then reports it. A re-run is safe (idempotent).
- The outcomes form **always exits 0** (failure-digest pattern). A failed write is one warning line.

## Closing comment (posted by the close)

```text
Merged into `main` in <merge sha, short> by pull request #<pr> from branch `<branch>`.

Tests created by this feature: <created> test declarations (<parent count> at <parent sha, short> → <merge count> at <merge sha, short>; counted by `scripts/count-repo-metrics.mjs`).

Suite outcomes follow from this commit's `guardrails` run. If none follows, that run was cancelled or did not report.

<!-- pdlc-stage: stage=merged branch=<branch> spec=<specs/NNN-slug/> -->
```

- `<created>` may be negative (a feature that removed tests) and is printed as is.
- When the parent cannot be counted: ``Tests created by this feature: unknown (<reason>).`` Never 0.
- **Idempotence**: if a comment with this merge sha's trailer already exists, the script does not post another. It
  only completes the label swap and the close.

## Outcomes comment (posted by `guardrails`)

```text
Suite outcomes for `main` at <merge sha, short> (whole suite, executed test cases, from this commit's `guardrails` run):

| Target | Passed | Failed | Skipped | Todo |
| --- | ---: | ---: | ---: | ---: |
| scripts:test | … | … | … | … |
| pdlc:test | … | … | … | … |
| pdlc:integration | … | … | … | … |

<!-- pdlc-outcomes: sha=<merge sha> -->
```

- A target whose report is missing or unparsable is a row of `unknown`, with a line under the table giving the reason,
  such as ``pdlc:integration: unknown (no report: the step did not run)``. A cancelled job adds
  ``Run cancelled by a later push; counts may be partial.``
- **Skipped** and **todo** are never added to **passed**.
- The targets are listed in `scripts/feature-merged.config.json`, and a guard test fails when that list and
  `guardrails.yml`'s test steps disagree.
- **Idempotence**: a comment with this sha's `pdlc-outcomes` trailer already present means nothing is posted.

## Template count comments (`backlog.mjs record-tests`, FR-040)

```text
node scripts/backlog.mjs record-tests --spec <specs/NNN-slug> --point <baseline|close-out>
```

- Counts test declarations at the committed `HEAD` with `count-repo-metrics.mjs`. At `close-out` it also counts at
  `git merge-base HEAD origin/<default>` and prints the delta.
- Prints the counts on stdout in every case.
- Proposal: exactly one `Proposal #<n>` in `<spec>/spec.md`'s **Input** line. None, more than one, or an issue that
  is not an open `type/proposal` → prints why, posts nothing, exit **0**.
- Otherwise comments on the issue. No label or stage change.
- Comment text:
  - baseline: ``Test baseline at <sha, short> on branch `<branch>`: <n> test declarations.``
  - close-out: ``Test count at <sha, short> on branch `<branch>`: <n> test declarations (<delta> since the merge base <sha, short>).``
- Exit codes 2 (bad arguments), 3 (credential), 4 (authorisation) and 5 (transport) keep their existing meanings.
  The template task records the counts and the exit code, reports it, and **continues** (M10).
