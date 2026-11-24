# Contract: the new and changed scripts

Exit codes follow the repository convention: `0` pass, `1` a finding or failure, and `2` bad arguments or unreadable
input. Every script exports its functions so that tests can inject `fetch` and the file system.

## `scripts/check-renovate-config.mjs` (new)

| Invocation | Behaviour |
| --- | --- |
| *(no args)* | Runs rules C1–C11 ([renovate-config.md](renovate-config.md)) against the tree. It prints `✅ renovate config: N pins managed, M excluded, K holds justified`, or one line per violation with its rule ID. |
| `--selftest` | Proves that each rule fails on a built-in bad fixture. It runs in `scripts:lint`. |
| `--print-renovate-version` | Prints `RENOVATE_VERSION`, the one source of truth for both workflows. |
| `--run-verdict <log.ndjson>` | Reads Renovate's JSON log and applies the RunVerdict rules ([data-model.md](../data-model.md#run-verdict)). It prints `✅ renovate run: <result>, N branches, M PRs` or `❌ renovate run: <reason>`, and exits `0` or `1`. An unreadable or empty log exits `1` with "the run produced no log", never `0`. |
| `--root <dir>` | Scans another root (tests). |

Exports:
- `RENOVATE_VERSION`
- `detectPins(root)`
- `classifyPins(pins, config, exclusions)`
- `checkRules({ config, workflow, root })`
- `judgeRun(records)`
- `cronIntersects(windowCron, triggerCron)`

## `scripts/refresh-pin-checksum.mjs` (new)

| Invocation | Behaviour |
| --- | --- |
| `<trivy\|rustup-init\|cargo-audit>` | Reads the pair's **version** from its file and downloads the asset for that version. It requires the publisher's checksum to equal the downloaded bytes' sha256, then rewrites the pair's sha256 in place. On any failure it changes nothing and exits `1`, naming the pair, the URL and both digests. This is the Renovate `postUpgradeTasks` command. |
| `--verify-changed [--base <ref>]` | For each pair whose file differs from `<ref>` (default `origin/main`), it re-derives the checksum as above, compares it with the file, and changes nothing. It exits `0` when nothing changed or every pair agrees, and `1` on any disagreement. This is the guardrails step. |
| `--selftest` | Uses injected fetch fixtures only (no network). It proves a mismatch exits 1 and leaves the file unchanged. |

The pair table (file, version source, asset URL template, publisher checksum source) is one exported constant,
`CHECKSUM_PAIRS`. The installers' own constants stay their single source, and this script reads them by regex, never by
importing a second copy.

## `scripts/backlog.mjs` (changed)

- `ready` excludes every item labelled `status/bot-managed`. When it excludes one, it prints one line: `(n bot-managed
  item(s) not listed)`. With `--json`, it adds `excluded: [{ number, reason: 'status/bot-managed' }]`.
- `labels` (the taxonomy) gains `status/bot-managed`, `dependencies` and `security`.

## `scripts/registry-retention.mjs` / `infrastructure-as-code/forgejo/registry-retention.yaml` (changed)

- `belay-ci-failures` `keepNewest` goes from 125 to 150. The guard computes the floor from the bundle-publishing jobs, so
  the new job raises it.
