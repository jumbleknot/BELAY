# Contract: `node scripts/backlog.mjs`

```text
Reads (FORGE_ISSUE_TOKEN or FORGE_TOKEN):
  list [--state open|closed|all] [--label L]... [--milestone M] [--q TEXT] [--page N] [--limit N] [--json]
  ready [--limit N] [--json]
  show <n> [--json]
  validate-form

Writes (FORGE_ISSUE_TOKEN):
  create --title T (--body-file F | --body-file -) [--label L]... [--milestone M] [--allow-duplicate]
  update <n> [--state open|closed] [--title T] [--body-file F] [--add-label L]... [--remove-label L]... [--milestone M|none]
  comment <n> --body-file F
  dep <n> (--blocked-by <m> | --blocks <m>) [--remove]
  setup-labels [--dry-run]
  setup-milestone <name> [--description D]
```

| Exit | Meaning |
| --- | --- |
| 0 | ok |
| 1 | unexpected (an internal error, or a forge answer the tool can't interpret) |
| 2 | usage or validation: an unknown flag, an unknown label or milestone, a duplicate title, a cycle, a blocked close, or a write that targets another repository |
| 3 | missing credential (the variable is named) |
| 4 | authorization: a 401 or 403 (the scope is named) |
| 5 | transport: a timeout, or the forge is unreachable |

**Invariants:**
- `--limit` is capped at 50 per page. Totals come from `x-total-count`.
- List calls always send `type=issues`.
- Every non-GET path must be under `/repos/<origin owner>/<origin repo>/`, or it exits 2 before any request.
- Every printed line goes through `redactForPublication` and `stripControlChars`.
- No credential value appears in output.
- `--help` or a bare call prints usage and does nothing. An unknown flag exits 2, through `scripts/lib/argv-contract.mjs`.
