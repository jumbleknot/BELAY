# Data model: SAST and SCA gate, stage 1

As MCM `specs/033-sast-semgrep/data-model.md` (Finding, Severity Mapping, Allowlist Entry, Scan
Report), unchanged. BELAY adds:

## Enabled-scanner list (`security/sast/scan.yaml`)

```yaml
scanners: [semgrep, pnpm-audit]   # subset of: semgrep, cargo-audit, pnpm-audit, pip-audit
```

- Unknown names are refused (exit 2). An empty list is refused, because a scan of nothing must not
  read as clean.
- `findings.json` `scanners[]` lists every known scanner, each with a `status`:
  - `ran`: it completed;
  - `failed`: it could not run (the scan fails, FR-015);
  - `not-enabled`: `scan.yaml` does not list it;
  - `not-selected`: `--only` narrowed it out;
  - `not-run`: an earlier scanner failed, so it was not attempted.

  Only `ran` contributes findings, and no other status ever reads as clean in the summary.
