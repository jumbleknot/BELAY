---
type: Reference
title: The learnings ledger — BELAY's story, its lessons and its measurement log
description: What docs/BELAY-Learnings.md is and is not — a narrative of the repository's state, an append-only ledger of paid-for lessons that each link to the page owning the rule, and a log of the repository's size and shape written only by count-repo-metrics.mjs — plus who refreshes it and the traps in reading or updating it.
tags: [learnings, ledger, metrics, documentation, history]
resource: docs/BELAY-Learnings.md
resource-sha256: 319cf8bf4e2e5a0bb197886a9d2861955fe47452cbe6dae63e997e272d373431
timestamp: 2026-11-24T14:02:08.065Z
---

# The learnings ledger

[docs/BELAY-Learnings.md](../../docs/BELAY-Learnings.md) is where a newcomer reads BELAY's story in one sitting. It
has three parts:

1. **The story so far**, rewritten in place at each refresh.
2. **The ledger**, append-only. Each lesson has a number, the date it was learned, a status, the evidence that paid
   for it, and a link to the page that owns the rule now. A lesson that turns out wrong keeps its text and gains a
   `reversed by` status, because the reversal is the useful half.
3. **The measurement log**, one column per refresh, with features, commits, lines of code, tests and docs, test
   declarations, gate scripts, guard tests, task lists and allowlist entries.

The [quarterly drift audit](../runbooks/doc-drift.md) refreshes all three.

## Gotchas

- **It is a narrative, not a source of truth.** The ledger indexes lessons; it is never their home. A new learning
  goes to its home page first, under the rules in [the brief](../INSTRUCTIONS.md), and enters the ledger at the
  next refresh. Where the ledger and a linked page disagree, the page wins.
- **Never type a number into the log.** Columns are written by
  `node scripts/count-repo-metrics.mjs --rev <sha> --append-log docs/BELAY-Learnings.md`. The script counts only
  committed git objects, so the working copy cannot change a number, and it refuses a commit already logged.
  MovieCollectionManager measured hand counts as wrong by about a month's growth.
- **Run it from a full clone.** A shallow clone cannot count commits. The script then reports the count as
  unavailable and refuses to write a column.
- **Columns are comparable only under one definition.** Each column's `Script commit` row names the version of the
  script that counted it. `--help` states what each metric counts and what is excluded, such as Spec Kit's
  vendored files and test fixtures.
