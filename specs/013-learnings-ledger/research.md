# Research: The learnings ledger and its scripted measurement log

## R1 — Read the committed tree, never the working copy

**Decision**: resolve the rev with `git rev-parse --verify <rev>^{commit}`. Then list blobs with
`git ls-tree -r -z --full-tree <sha>` and read all their contents in **one** `git cat-file --batch` call, feeding it the
object ids on stdin. Skip symlinks (mode `120000`) and submodules (`160000`).

**Rationale**: these commands see only the object database, so uncommitted, ignored and other sessions' files
cannot change a number (FR-001, SC-001). One batch call keeps the run to about a second, where `git show` per file
would take minutes.

**Alternatives considered**:
- `git ls-files` plus reading files from disk: that reads the working copy, the exact failure the feature exists to
  avoid.
- `git archive` to a temporary directory: correct, but slower and leaves files behind.

## R2 — One classifier, one category per file

**Decision**: a pure `classifyPath(path)` returns `code`, `test`, `docs` or `null` (not counted), applying these rules
in order:

1. **Not counted**:
   - vendored scaffolding: `.specify/**` and `.claude/skills/speckit-*/**`;
   - test fixtures: any path segment `fixtures`;
   - Semgrep rule samples: `security/sast/rules/**`, deliberately bad code in `.py` and `.ts`;
   - generated output: `security/sast/reports/**`;
   - lock files: `pnpm-lock.yaml`.
2. **test**: any path segment `__tests__`, or a basename matching `*.test.*`.
3. **docs**: extension `.md`.
4. **code**: extension `.mjs`, `.js`, `.cjs`, `.ts`, `.sh`, `.ps1` or `.py`; a basename `Dockerfile` or `*.Dockerfile`;
   or a workflow, `.forgejo/workflows/*.yml` or `*.yaml`.
5. Everything else, such as configuration JSON and YAML, `.gitkeep` and the license: not counted.

Lines are **non-blank** lines, those that match `\S`. A blob containing a NUL byte in its first 8 KiB is binary and
counts nothing.

**Rationale**: an ordered rule list makes "a markdown file in a test fixture" unambiguous (excluded by rule 1) and
gives the help text one table to print (FR-005).

**Measurement caveat**: `.claude/skills/speckit-taskstoissues` is project-owned but excluded by the `speckit-*`
prefix. It is 1 file, and the help says so. Distinguishing it would mean importing the override registry for one
file.

**Alternatives considered**:
- Counting configuration YAML as code: it inflates "code" with allowlists and policies that change for reasons
  unrelated to code growth.
- Counting blank lines: MCM's counts were non-blank, and comparability matters more than the choice.

## R3 — The metric definitions

| Metric | Definition at the counted commit |
| --- | --- |
| `features` | directories `specs/NNN-*/` that contain `spec.md` |
| `commits` | `git rev-list --count <sha>` (merges included) |
| `codeLines` / `testLines` / `docLines` | non-blank lines per category (R2) |
| `testDeclarations` | in `test` files: lines matching `^\s*(test\|it\|t\.test)(\.(skip\|todo\|only))?\(` |
| `gateScripts` | distinct `scripts/<name>.(mjs\|sh\|ps1)` paths named in `scripts/project.json` → `targets.lint.options.commands` (or `.command`) |
| `guardTests` | files `scripts/__tests__/*.guard.test.mjs` |
| `taskLists` / `taskListsWithVerifyRed` | `specs/NNN-*/tasks.md`; of those, how many contain the literal `Verify RED` |
| `allowlistEntries` | the sum, over tracked `security/*/allowlist.yaml`, of each file's YAML list length; the JSON form also gives each file's count |

**Rationale**:
- "Gate scripts" is read from the lint target at that commit, because that is what CI actually ran then. A
  `check-*` filename glob would count scripts that were never wired. A script with both `--selftest` and a real run
  counts once.
- The declaration regex matches the repository's only style: 1,439 top-level `test(` calls today, no `it(`.
- The dev container's egress list is a different concept, network destinations rather than suppressed findings, so
  it is not counted (spec Assumptions).

**Alternatives considered**:
- Counting declarations by running the suite with a reporter: it needs the tree checked out and runnable at that
  commit, so it fails on old revs.

## R4 — Shallow history

**Decision**: if `git rev-parse --is-shallow-repository` prints `true`, `commits` is `null`, the text form prints
`unavailable (shallow history)`, and `--append-log` refuses with exit 1. The other metrics are still reported.

**Rationale**: FR-007. CI's checkout is shallow, so a short count there is the likely failure.

## R5 — `--append-log` writes the column itself

**Decision**: the log table lives between `<!-- metrics-log:start -->` and `<!-- metrics-log:end -->`.

- **Shape.** Rows are metrics, and the first column is the metric label. Each further column is one snapshot,
  headed `` `<short sha>` <commit date> ``, which names the counted commit. The first body row, `Script commit`,
  names the script commit (data-model.md "Log table").
- **Order.** `mergeLogColumn(table, snapshot)` (pure) inserts the new column in commit-date order, so a back-fill
  lands in the right place.
- **Refusals.** It refuses a commit already present (exit 1).
- **New metrics.** A metric missing from older columns gets `—` there.
- **Writes.** Nothing outside the markers is touched. A file without both markers exits 1.

The **script commit** is `git log -1 --format=%h HEAD -- scripts/count-repo-metrics.mjs`, run in the script's own
repository (not the counted one; `untracked` when that log is empty), with `+dirty` appended when
that file has uncommitted changes, so every column records which definition produced it (spec edge case).

**Rationale**: MCM's gap was hand transcription as much as hand counting. If the operator pastes numbers, SC-003
("every number reproducible") depends on care, which is the thing MCM measured failing.

**Alternatives considered**:
- Printing a markdown column for the operator to paste: simpler, but it leaves the transcription step in place.
- Storing snapshots as JSON beside the document: the document would then need a generator to render them, and
  ADR-0002 chose a session-maintained wiki with no generator.

## R6 — Seeding the ledger

**Decision**: Part 2 starts with lessons that already exist as recorded, evidenced statements in the repository:
- the instrument traps;
- the `.env` inline-comment gotcha;
- the testing-tier "a skip reads as a pass";
- AGit pushes running with no secrets;
- the worktree rule;
- the doc-drift measurement;
- the protections token 403 (PR #68);
- the stale `status/blocked` label;
- the unknown-label filter that returns everything.

Each entry links to the page that now owns the rule. None is invented, and none restates more than a line.

**Rationale**: FR-010 and FR-011. The ledger is an index of paid-for lessons, not a second home for their detail.

## R7 — The first columns

**Decision**:
- The first column is the script run against `origin/main` at the branch point, `cf9b694`, from this branch.
- A second column back-fills the merge of feature 001, `c74bc25`.
- Both are written by `--append-log`.

**Rationale**:
- "The script's output on `main`" cannot mean this feature's own merge commit, which does not exist when the
  document is written.
- Merges here are merge commits, so the script commit recorded in the column survives the merge.
- The back-fill costs one command and gives the log a slope from day one.
