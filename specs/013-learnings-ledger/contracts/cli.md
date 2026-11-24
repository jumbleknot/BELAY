# Contract: `scripts/count-repo-metrics.mjs`

```text
node scripts/count-repo-metrics.mjs [--rev <commit>] [--json]
node scripts/count-repo-metrics.mjs [--rev <commit>] --append-log <file>
node scripts/count-repo-metrics.mjs --help
```

| Flag | Meaning |
| --- | --- |
| `--rev <commit>` | any commit-ish git resolves; the default is `HEAD` |
| `--json` | print the [MetricSnapshot](../data-model.md#metricsnapshot) as JSON instead of the text table |
| `--append-log <file>` | merge the snapshot as a new column into the log table in `<file>` (research R5), then print the text table |
| `--help` / `-h` | print usage, the metric definitions and the classification rules; do nothing else; exit 0 |

`--json` and `--append-log` are mutually exclusive (exit 2). An unknown flag, a positional argument, or a value-taking
flag without its value exits 2 with usage, and nothing is counted (`lib/argv-contract.mjs`).

## Text output

```text
count-repo-metrics: <full sha> (<commitDate>), script <scriptCommit>
  Features                         12
  Commits                          168
  Code lines (non-blank)           …
  Test lines (non-blank)           …
  Documentation lines (non-blank)  …
  Test declarations                …
  Gate scripts (scripts:lint)      …
  Guard tests                      …
  Task lists                       …
  Task lists with Verify RED       …
  Allowlist entries                …
```

The labels above are also the log table's row labels (data-model.md).

## Exit codes

| Code | When |
| --- | --- |
| 0 | counted (and, with `--append-log`, written) |
| 1 | the rev does not resolve; not a git repository; a malformed allowlist; `--append-log` refused (missing markers, a duplicate rev, a shallow history, an unreadable file) |
| 2 | bad arguments |

On exit 1 or 2, nothing is printed to stdout, and the log file is unchanged.
