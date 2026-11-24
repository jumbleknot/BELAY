# Data model: The learnings ledger and its scripted measurement log

## MetricSnapshot

The output of one run. Its JSON form is exactly the object printed by `--json`.

| Field | Type | Rule |
| --- | --- | --- |
| `rev` | string | the full 40-hex commit id that was counted |
| `commitDate` | string | the committer date, `YYYY-MM-DD` (UTC) |
| `scriptCommit` | string | the short id of the last commit touching the script **in the script's own repository** (never the counted one), plus `+dirty` if it has local edits; `untracked` when the script has no commit there (research R5) |
| `metrics.features` | integer ≥ 0 | research R3 |
| `metrics.commits` | integer ≥ 1, or `null` | `null` only for a shallow history (R4) |
| `metrics.codeLines` · `testLines` · `docLines` | integer ≥ 0 | R2 |
| `metrics.testDeclarations` | integer ≥ 0 | R3 |
| `metrics.gateScripts` | integer ≥ 0 | R3; 0 when `scripts/project.json` is absent or has no lint target |
| `metrics.guardTests` | integer ≥ 0 | R3 |
| `metrics.taskLists` · `taskListsWithVerifyRed` | integer ≥ 0 | the second is ≤ the first |
| `metrics.allowlistEntries` | integer ≥ 0 | the sum of `allowlists` |
| `allowlists` | object `{ path: count }` | one key per tracked `security/*/allowlist.yaml` |

An allowlist file that is not valid YAML, or whose top level is neither a list nor empty, is an error (exit 1). A
count from a malformed file would be a guess.

## Log table (Part 3 of the document)

A markdown table between `<!-- metrics-log:start -->` and `<!-- metrics-log:end -->`.

- **Header row**: `| Metric |`, then one header cell per column: `` `<short rev>` <commitDate> ``.
- **Second row**: the separator.
- **Body**: the first body row is `| Script commit |` with each column's `scriptCommit`. Then comes one row per metric,
  in the order of the table in R3, labelled with the human label from [contracts/cli.md](contracts/cli.md).
- **Missing values**: a cell for a metric that column lacks is `—`. A shallow `commits` can never be written (R4).
- **Column order**: ascending `commitDate`; a tie keeps insertion order.

**Invariants**:
- A column, once written, is never edited.
- A rev appears in at most one column.
- Columns are added only by `--append-log`.

## Lesson (Part 2 of the document)

One `###` heading per lesson, numbered `L-NNN` in order of entry. A number is never reused.

| Field | Rule |
| --- | --- |
| `id` | `L-NNN`, in the heading |
| `learned` | `YYYY-MM-DD` |
| `status` | `current` · `superseded by L-NNN` · `reversed by L-NNN` |
| statement | one or two sentences |
| `evidence` | what was measured or what happened, with a link (PR, spec, page) |
| `home` | a link to the page that owns the rule now |

**State transitions**: `current` → `superseded by L-x`, when a later lesson refines it, or → `reversed by L-x`, when
a later lesson contradicts it. The original text is never edited or removed. The new lesson is appended with its own
number.
