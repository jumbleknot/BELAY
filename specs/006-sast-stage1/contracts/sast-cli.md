# Contract: SAST CLI

As MCM `specs/033-sast-semgrep/contracts/sast-scan.cli.md` and `check-sast-findings.cli.md`, with
these BELAY changes:

- `node scripts/sast-scan.mjs [--scope full|changed] [--base <ref>] [--only <list>] [--out <dir>] [--test-rules]`
  - It reads `security/sast/scan.yaml`. `--only` may only narrow the enabled list. `--only cargo-audit`
    while it is not enabled exits 2, naming the config.
- `node scripts/check-sast-findings.mjs [--report <findings.json>] [--allowlist <yaml>] | --selftest`:
  unchanged. Exit 0 pass, 1 an un-allowlisted blocking finding, 2 bad args or an invalid report or
  allowlist.
- Nx: `pnpm nx run scripts:sast` runs the full scan, then the gate.
