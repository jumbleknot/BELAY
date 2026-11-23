---
type: Runbook
title: SAST and SCA — the static security gate
description: BELAY's keyless static security gate, stage 1 of backlog item #37 — the sast job in guardrails.yml running Semgrep over the whole tree and pnpm audit over the lockfile, how a finding is normalized and gated against the allowlist (High/Critical in code or a runtime dependency blocks, everything else warns), how to run it locally, how to tell an outage from a finding, the custom rules and their fixtures, the pins, and what stages 2 to 4 add.
tags: [security, sast, sca, ci, runbook]
resource: docs/runbooks/sast.md
resource-sha256: 8a840011098356b3db3c4bfe8890a1a593db3b16327cd79e4958d1eab923d03a
timestamp: 2026-11-23T18:10:50.434Z
---

# SAST and SCA — the static security gate

The `sast` job in `.forgejo/workflows/guardrails.yml` runs on every pull request and every push to
`main`, beside `guardrails`. It scans with **Semgrep** (code patterns, whole tree) and **`pnpm audit`**
(JavaScript dependencies), then `scripts/check-sast-findings.mjs` gates the report against
`security/sast/allowlist.yaml`. It is keyless: no account and no secret. Run it locally with
`pnpm nx run scripts:sast`. Full detail is in [docs/runbooks/sast.md](../../docs/runbooks/sast.md).

## Gotchas

- **What blocks:** a High/Critical code finding, or a High/Critical advisory in a **runtime**
  dependency. Medium/Low findings and dev-scope advisories are warnings. Fix a blocking finding, or
  allowlist it with a justification, an author and ideally an expiry. An allowlisted finding stays in
  the report.
- **TRANSPORT/SERVICE ERROR is an outage, not a finding.** The scanners retry 3 times, then fail
  closed. Re-run the job.
- **SCA runs in full on every run**, so `main` can go red on a newly published advisory against an
  unchanged dependency. That is the gate working.
- **A scanner that is not enabled is never clean.** `security/sast/scan.yaml` lists the scanners
  that run (stage 1: `semgrep`, `pnpm-audit`). The others report `not enabled — NOT scanned`.
- **The rules read text**, so a comment that quotes a forbidden pattern matches. Reword the prose.
- **Write `<!--` in a JS regex as `<[!]--`.** Semgrep reads `<!--` as an HTML comment even in a
  regex and skips the statement, or the whole file. The run's `errors` list names what is still only
  partly parsed.
- **Custom rules need fixtures.** `node scripts/sast-scan.mjs --test-rules` fails on a rule without
  one. Write the fixture first.
- **`p/secrets` stays off:** `secret-scan.mjs` owns credential detection.
- **`guardrails / sast (pull_request)` must be added to branch protection** after its first green run,
  or a red `sast` won't block a merge.
