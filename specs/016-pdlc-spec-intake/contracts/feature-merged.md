# Contract: closing on merge (`feature-merged.yml`, `scripts/feature-merged.mjs`)

**Normative** for the workflow trigger, the script's exit behaviour and the closing comment.

## Trigger

`.forgejo/workflows/feature-merged.yml`: `on: push: branches: [main]`, with `workflow_dispatch` taking a `sha` for a
re-run. Runner `belay`, timeout 30 minutes. The workflow is not a required check.

## Script

```text
node scripts/feature-merged.mjs [--sha <commit>] [--dry-run]
```

- `--dry-run` prints the comment it would post and the label change, and writes nothing.
- Exit **0** in every case where the merge itself is fine, including "not from a proposal", an ambiguous proposal
  marker, an issue that is not an open proposal, and unknown test counts. Each case is a single log line saying so.
- Exit **1** only when a write it attempted failed (credential refused by both tokens, transport). The digest step
  then reports it. A re-run is safe (idempotent).

## Closing comment

```text
Merged into `main` in <merge sha, short> by pull request #<pr> from branch `<branch>`.

Tests created by this feature: <created> · passed: <passed> · failed: <failed> · skipped: <skipped> · todo: <todo>

| Target | Created | Passed | Failed | Skipped | Todo |
| --- | ---: | ---: | ---: | ---: | ---: |
| scripts:test | … | … | … | … | … |
| pdlc:test | … | … | … | … | … |
| pdlc:integration | … | … | … | … | … |

<!-- pdlc-stage: stage=merged branch=<branch> spec=<specs/NNN-slug/> -->
```

- A count that could not be read is written `unknown`, and a line under the table gives the reason per target, such as
  ``pdlc:integration: unknown (the parent commit's run did not produce a report)``. A total over targets with any
  `unknown` is also `unknown`, never a partial sum presented as complete.
- **Skipped** and **todo** are never added to **passed**.
- **Idempotence**: if a comment with this merge sha's trailer already exists, the script does not post another. It
  only completes the label swap and the close.
