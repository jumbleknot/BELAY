# Quickstart: validating feature 006

In the dev container, from the worktree root:

1. `pnpm nx run scripts:lint && pnpm nx run scripts:test`: green, 0 skipped. Lint includes
   `check-sast-findings.mjs --selftest`.
2. `node scripts/sast-scan.mjs --test-rules`: every `belay-*` rule passes its fixtures.
3. `pnpm nx run scripts:sast`: writes `security/sast/reports/findings.json` and the summary. Semgrep
   and pnpm-audit show `ran`; cargo-audit and pip-audit show `not-enabled`. The gate exits 0 on the
   seeded allowlist.
4. Plant a High pattern (a `belay-no-token-logging` hit) in a scratch file: the gate exits 1, naming
   it. Allowlist it: exit 0. Expire the entry: exit 1. Revert.
5. CI: the PR shows `guardrails / sast` green, with the report artifact attached.
