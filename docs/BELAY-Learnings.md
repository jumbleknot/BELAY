# BELAY learnings: the story, the ledger and the measurement log

**This document is a narrative, not a source of truth.** It tells the story of what BELAY has built and learned, and
links every rule it mentions to the page that owns that rule. Where this document and a linked page disagree, the
linked page wins, and this document is the one to correct. To act on a rule, follow the link; never act on the
summary here.

It has three parts and one set of instructions:

- **Part 1, the story so far**, is rewritten in place at each refresh.
- **Part 2, the ledger**, is append-only. A lesson's status may change, but a lesson is never deleted or reworded.
- **Part 3, the measurement log**, is written only by a script. One column is added per refresh, and earlier
  columns are never edited.
- **[How to update](#how-to-update)** says who refreshes what, and when.

The shape comes from MovieCollectionManager (MCM), whose own learnings document keeps the same three parts. MCM
found that its hand-counted log differed from a script's count by about a month's growth, so here the log's numbers
are never typed by hand.

## Part 1 — The story so far

*Refreshed 2026-11-24, against `cf9b694`.*

BELAY is tooling that other repositories share: CI gates, PR and backlog tools, a dev container, and the
conventions that hold them together ([the repository](../openwiki/projects/repository.md)). Most of it was ported
from MCM, and the port was the occasion to write down why each piece exists. Every change since the first goes
through a spec, then a plan, then tasks ([the lifecycle](../openwiki/process/spec-driven-development.md)).

**Making `main` safe to merge into (features 001–003, 2026-11-22).** Feature 001 built the `guardrails` CI check
and the `scripts` Nx project that every later gate lives in ([CI runbook](runbooks/ci.md)). Feature 002 gave
assistants a way to open, watch and merge pull requests without hand-typed credentials. Feature 003 moved the
backlog into the forge's issue tracker, so work found in one session outlives it
([backlog runbook](runbooks/backlog.md)). Several sessions share one dev container, and the worktree rule came
from that within the first day ([dev container](runbooks/devcontainer.md#shared-dev-container-commit-from-a-worktree)).

**A real environment, and the rest of MCM's gates (features 004–005, 2026-11-23).** Feature 004 moved the dev
container into a Docker Sandbox microVM with governed egress
([ADR-0003](../openwiki/decisions/adr-0003-docker-sandbox-devcontainer.md)). Feature 005 ported MCM's remaining
guardrail gates and the registry's retention policy.

**Security gates (features 006–010, 2026-11-23 to 2026-11-24).** Static analysis and dependency audit came in
stages: Semgrep and pnpm audit first, then a gate against dependency downgrades, then the toolchain for later stages
([SAST runbook](runbooks/sast.md)). Feature 009 put a 70% line-coverage floor on the scripts project
([testing tiers](../openwiki/invariants/testing-tiers.md)). Feature 010 scans container images before they are
pushed, and on a schedule after ([image scanning](runbooks/image-scanning.md)).

**Keeping dependencies moving (features 011–012, 2026-11-24).** A self-hosted Renovate bot proposes updates
([ADR-0004](../openwiki/decisions/adr-0004-renovate-dependency-bot.md)). The health loop then watches the bot over
time, because a bot that silently stops is worse than none ([dependency bot](runbooks/renovate.md#the-health-loop)).
Its first runs found that the workflow's own token is refused on branch protection: lesson L-009 below.

**Where it stands.** Twelve features in three days, each through the full lifecycle, with tests first. The
knowledge is held in `openwiki/` and indexed by [AGENTS.md](../AGENTS.md). What is not yet built is listed honestly
in [the register of unenforced rules](../openwiki/invariants/unenforced-rules.md).

## Part 2 — The ledger

Each lesson is something BELAY, or MCM before it, paid for with a failure or a measurement. The lesson's home is
the page that owns the rule now. The ledger only indexes it. Lessons are numbered in the order they were entered,
and a number is never reused.

### L-001 — A test runner's flags go before the path

- **Learned**: 2026-11-22 · **Status**: current
- **Lesson**: `node --test <file> --test-name-pattern x` runs every test in the file, because a flag after the path
  is passed to the script and ignored. A "focused" run that passes may have run something else entirely.
- **Evidence**: measured in MCM and recorded with BELAY's first wiki (`b6edf44`).
- **Home**: [instrument traps](../openwiki/gotchas/instrument-traps.md)

### L-002 — A skipped test exits 0 and reads as a pass

- **Learned**: 2026-11-22 · **Status**: current
- **Lesson**: a test that skips because something is missing reports success. Read the skip count, and treat "it
  cannot run here" as a claim that needs the same proof as "it passes".
- **Evidence**: recorded with BELAY's first wiki (`b6edf44`); `scripts/__tests__/shell-probe.mjs` turns a missing
  script into a failure, not a skip.
- **Home**: [testing tiers](../openwiki/invariants/testing-tiers.md)

### L-003 — A forge's empty answer is often about the request, not the data

- **Learned**: 2026-11-22 · **Status**: current
- **Lesson**: an unknown label in an issue filter is silently ignored and returns the unfiltered set; a listing
  without `type=issues` returns pull requests too; a 404 can mean a missing field, not a missing thing. So the
  backlog tool refuses an unknown label locally.
- **Evidence**: measured on a Forgejo tracker on 2026-08-08, before BELAY existed, and carried in with the backlog
  tool when feature 003 ported it (`4050f9b`); one listing returned 143 rows where 1 was right.
- **Home**: [backlog runbook](runbooks/backlog.md), [instrument traps](../openwiki/gotchas/instrument-traps.md)

### L-004 — A `.env` value line takes no inline comment

- **Learned**: 2026-11-22 · **Status**: current
- **Lesson**: dotenv-style loaders read everything after `=` as the value, so `KEY=val # note` yields `val # note`.
- **Evidence**: an identity provider rejected a credential in MCM; recorded with BELAY's first wiki (`b6edf44`).
- **Home**: [.env inline comments](../openwiki/gotchas/env-file-inline-comments.md)

### L-005 — A PR from an AGit push runs with no secrets

- **Learned**: 2026-11-22 · **Status**: current
- **Lesson**: a `refs/for/main` head gets no Actions secrets, so every job that needs one fails or skips. A PR's head
  must be a real branch, and `forge-pr.mjs open` refuses anything else.
- **Evidence**: learned in MCM, and built into the PR tools when feature 002 ported them (`251e738`).
- **Home**: [CI runbook](runbooks/ci.md#forge-prmjs-writes-the-git-credential)

### L-006 — In a shared dev container, commit from a worktree

- **Learned**: 2026-11-22 · **Status**: current
- **Lesson**: sessions sharing a checkout share its index and its branch, so one session's `git checkout -b` or
  `git stash` rewrites another's work. Each session commits from its own worktree, and pushes before anything
  risky, because a worktree does not survive a rebuild.
- **Evidence**: recorded on the first day of shared use (`c213fe1`).
- **Home**: [dev container runbook](runbooks/devcontainer.md#shared-dev-container-commit-from-a-worktree)

### L-007 — A stale `status/blocked` label hides an item silently

- **Learned**: 2026-11-22 · **Status**: current
- **Lesson**: the backlog's `ready` command trusts a present label over the dependency graph, so a leftover label
  makes an item vanish with no warning.
- **Evidence**: recorded with the backlog tooling (`4050f9b`).
- **Home**: [backlog runbook](runbooks/backlog.md#conventions)

### L-008 — Docs drift through discovery, not follow-through

- **Learned**: 2026-11-22 · **Status**: current
- **Lesson**: features do the documentation tasks they write (94% in MCM's audit). What they miss is the other
  documents that name what they changed, so every feature runs a literal search for its changed identifiers.
- **Evidence**: MCM's 2026-11-14 audit found 76 drifts in about 16,800 lines; adopted here in `b6edf44`.
- **Home**: [doc drift runbook](runbooks/doc-drift.md)

### L-009 — A workflow's own token cannot read branch protection

- **Learned**: 2026-11-24 · **Status**: current
- **Lesson**: the run's own token gets HTTP 403 on `/branch_protections`. A job that needs that read must use a
  token that has it, and must fail closed (delete nothing, report "unreadable") when the read is refused.
- **Evidence**: the first runs of feature 012's health report and branch reaper; fixed in PR #68 (`d36a9c5`).
- **Home**: [dependency bot runbook](runbooks/renovate.md#the-health-loop), [CI secrets](runbooks/ci.md#secrets)

### L-010 — Numbers in a log come from a script, never from a hand

- **Learned**: 2026-11-24 · **Status**: current
- **Lesson**: hand counts drift, and so do hand-copied numbers. The measurement log below is written only by
  `scripts/count-repo-metrics.mjs --append-log`, which counts committed objects and names the commit it counted.
- **Evidence**: MCM's hand counts differed from its script by 4.5% of production code (about a month's growth).
  Feature 013 (backlog item #51) built the script.
- **Home**: [How to update](#how-to-update), and the script's `--help`

## Part 3 — The measurement log

Each column is one commit, counted by `scripts/count-repo-metrics.mjs`. The `Script commit` row names the version
of the script that counted it. A column is only comparable with others counted under the same definitions.
`node scripts/count-repo-metrics.mjs --help` states what each metric counts and which files are excluded. Every
column can be reproduced with `node scripts/count-repo-metrics.mjs --rev <sha>` from a full clone.

<!-- metrics-log:start -->
| Metric | `c74bc25` 2026-11-22 | `cf9b694` 2026-11-24 |
| --- | --- | --- |
| Script commit | 48af689 | 48af689 |
| Features | 1 | 12 |
| Commits | 36 | 168 |
| Code lines (non-blank) | 3438 | 17991 |
| Test lines (non-blank) | 3565 | 14999 |
| Documentation lines (non-blank) | 1976 | 14398 |
| Test declarations | 294 | 1439 |
| Gate scripts (scripts:lint) | 5 | 25 |
| Guard tests | 0 | 11 |
| Task lists | 1 | 12 |
| Task lists with Verify RED | 1 | 12 |
| Allowlist entries | 0 | 1 |
<!-- metrics-log:end -->

## How to update

The [quarterly drift audit](runbooks/doc-drift.md#the-quarterly-drift-audit-layer-3) refreshes this document. The
session running it does all three steps, against the commit it read:

1. **Rewrite Part 1** in place, to describe the repository as it is now. Change its "Refreshed" line.
2. **Append to Part 2.** A new lesson takes the next number and all six fields: id, learned date, status, lesson,
   evidence, home. A lesson needs evidence (a measurement, an incident, a PR), not an opinion. When a later lesson
   refines or contradicts an earlier one, change only the earlier one's status, to `superseded by L-NNN` or
   `reversed by L-NNN`. Never delete or reword the original: the reversal is the useful half.
3. **Append a column to Part 3**, from a full clone (a shallow clone cannot count commits):

   ```bash
   node scripts/count-repo-metrics.mjs --rev <the commit you read against> --append-log docs/BELAY-Learnings.md
   ```

   Never type a number into the table. Never edit an earlier column. A missing earlier column may be back-filled
   with the same command and an earlier `--rev`; the script inserts it in date order and refuses a commit already
   logged.

A new lesson found between audits goes to its home page first, under the rules in
[where a new learning goes](../openwiki/INSTRUCTIONS.md). It enters this ledger at the next refresh.
