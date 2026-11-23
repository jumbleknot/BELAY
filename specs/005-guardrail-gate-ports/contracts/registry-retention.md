# Contract: registry retention

```
node scripts/registry-retention.mjs                    # text report: one row per version, then totals
node scripts/registry-retention.mjs --json             # the same report as JSON
node scripts/registry-retention.mjs --package <name>   # one package only
node scripts/registry-retention.mjs --apply            # delete the `delete` rows; refused unless
                                                       # the committed config says `mode: apply`
```

Env: `FORGE_URL` (required; the workflow passes `github.server_url`), `REGISTRY_CLEANUP_TOKEN`
(`write:package`; a read-only `FORGE_TOKEN` is enough for a report), and `REGISTRY_USER` (optional;
defaults to the owner).

| Exit | Meaning |
|---|---|
| 0 | report printed (and, with apply, deletions done) |
| 1 | forge or API error |
| 2 | usage error, invalid config, or `--apply` against `mode: report` |
| 5 | a `protect` digest is not in the registry; nothing is deleted |

Workflow `.forgejo/workflows/registry-retention.yml`:
- runs on a weekly schedule and on `workflow_dispatch` with a boolean `apply` input;
- passes `--apply` only on a dispatch whose `apply` is true (the guard test asserts this);
- prints the report into the log and the step summary before any deletion;
- runs on `belay`, pins Node through setup-node, and ends with the failure digest.
