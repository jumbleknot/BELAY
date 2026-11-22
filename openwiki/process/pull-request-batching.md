---
type: Process
title: PR batching — split only when a failure would be ambiguous
description: The rule for how many pull requests to open for a set of changes — batch by default and split only when a red build could not be attributed to one change — and why, once a feature ships in several PRs, main stops being a valid baseline for "was this already broken?".
tags: [ci, process, pull-requests]
timestamp: 2026-11-22
---

# PR batching — split only when a failure would be ambiguous

BELAY's CI runs on one repository runner, and each merge to `main` runs guardrails again. Every
extra pull request costs a runner slot, a review and a merge. So batching is the default. The test is
not "are these changes related?" but:

> **If CI goes red, could I tell WHICH change caused it?** If yes, batch them. If no, split them.

The rule comes from MovieCollectionManager, where a ~35-minute E2E job made the cost obvious. There,
four small fixes opened as four PRs cost six or more full runs, about four hours of runner time. The
same session showed both directions. Splitting **earned** its cost once: a pnpm bump and a test-flow
race were separated, and the flow fix passing while the pnpm PR failed on the *same flow* proved the
race was not caused by pnpm. Splitting **wasted** it elsewhere: two changes that could never have
been confused for each other each paid for a full suite.

BELAY's guardrails job is far cheaper today, so the cost of a split is small. The attribution test
is what decides, and it will matter more as projects with slower suites arrive.

## Gotchas

- **Run `pnpm nx run scripts:lint` and `pnpm nx run scripts:test` before pushing, either way.** They
  catch the offline-knowable failures without spending a runner slot.
- **A merge to `main` occupies the runner ahead of every open PR.** The push to `main` runs
  guardrails, and the single runner takes jobs in order. When a `ci-status watch` times out with exit
  3 just after a merge, it ran out of time in a queue. Nothing stalled.
- **Re-running a sibling PR after a merge is a choice, unless branch protection forces it.**
  "Block merge on outdated branch" is optional in BELAY's protection rule (see
  [CI guardrails](../runbooks/ci.md)). Check the rule's current setting rather than assuming. Even
  when nothing forces it, an outdated branch's run never tested the two changes together. Decide
  deliberately whether that matters.

## Splitting a feature moves the baseline: `main` stops being the control

When a feature ships as PR A and then PR B, **`main` already contains half the feature** while you
work on PR B. So the reflex question when a test fails, "does it fail on `main` too? then it isn't
mine", is no longer sound. It puts part of the suspect in the control group.

**The baseline is the commit before the feature's FIRST pull request:**

```bash
git log --oneline --merges main | grep '<feature-number>'   # find PR A's merge commit
git rev-parse <prA-merge>^1                                 # its first parent is the true baseline
git diff --stat <baseline> main -- <the code the test exercises>
```

MovieCollectionManager measured this on 2026-08-05. Two failing specs were recorded as pre-existing
because they also failed on `main`. Against the real baseline, the diff showed that PR A had
rewritten the code they exercised. One of the failures was the feature's own regression, and it was
found only because the reviewer refused the `main` comparison.

**The cheap version costs nothing.** Before any bisect, run `git diff --stat <baseline> main --
<paths the failing test exercises>`. If the feature's earlier PR touched that code, "it fails on
main" tells you nothing.
