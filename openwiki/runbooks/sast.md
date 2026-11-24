---
type: Runbook
title: SAST and SCA — the static security gate
description: BELAY's keyless static security gate, stage 1 of backlog item #37 — the sast job in guardrails.yml running Semgrep over the whole tree and pnpm audit over the lockfile, how a finding is normalized and gated against the allowlist (High/Critical in code or a runtime dependency blocks, everything else warns), the PR-only dependency-downgrade check that blocks a package moved INTO an advisory in any scope, how to run it locally, how to tell an outage from a finding, the custom rules and their fixtures, the pins, and what stages 2 to 4 add.
tags: [security, sast, sca, ci, runbook]
resource: docs/runbooks/sast.md
resource-sha256: 6fedb64ace841cc6e95154cd51a335a7e89249d49e8be44fcc92e36e2667e2b7
timestamp: 2026-11-24T11:26:01.649Z
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
- **On a PR, moving a package INTO an advisory blocks in every scope, dev included.**
  `scripts/check-dependency-downgrade.mjs` runs after the gate. It fails when a package that was
  clean for an advisory at the base now resolves to a version inside its vulnerable range (a
  sideways move counts too). It does not flag a package that was already exposed, or one new to the
  lockfile. Fix it with a `pnpm-workspace.yaml` override floor, or with an allowlist entry: the main
  gate's entries apply to it unchanged. It fails closed on a missing report or an unreadable lockfile.
- **TRANSPORT/SERVICE ERROR is an outage, not a finding.** The scanners retry 3 times, then fail
  closed. Re-run the job.
- **SCA runs in full on every run**, so `main` can go red on a newly published advisory against an
  unchanged dependency. That is the gate working.
- **A scanner that is not enabled is never clean.** `security/sast/scan.yaml` lists the scanners
  that run (stage 1: `semgrep`, `pnpm-audit`). The others report `not enabled — NOT scanned`.
- **Stages 2 and 3 are one list entry each.** Their toolchain steps are already in the job, dormant
  until a `Cargo.lock` or a project `uv.lock` is tracked (`scripts/sast-prepare.mjs`; Rust from a
  sha256-verified `rustup-init`, cargo-audit prebuilt). A test fails while a tracked lockfile's
  scanner is not enabled, so add `cargo-audit` or `pip-audit` to `scan.yaml` in the same PR.
- **The rules read text**, so a comment that quotes a forbidden pattern matches. Reword the prose.
- **Write `<!--` in a JS regex as `<[!]--`.** Semgrep reads `<!--` as an HTML comment even in a
  regex and skips the statement, or the whole file. The run's `errors` list names what is still only
  partly parsed.
- **The orchestrator proves itself before it scans.** `node scripts/sast-scan.mjs --selftest` (offline,
  in the `sast` job and `scripts:lint`) feeds known Semgrep and `pnpm audit` output through the real
  normalize, summary and scrub path. Without it, a scan that ran but parsed nothing would read as
  0 findings and pass the gate.
- **Custom rules need fixtures.** `node scripts/sast-scan.mjs --test-rules` fails on a rule without
  one. Write the fixture first.
- **`p/secrets` stays off:** `secret-scan.mjs` owns credential detection.
- **`guardrails / sast (pull_request)` is a required context on `main`**, so a red `sast` blocks
  the merge.
- **The pins are bot-proposed.** Semgrep, rustup-init and cargo-audit arrive as dependency-bot PRs. A
  version-and-sha256 pair is moved together by `refresh-pin-checksum.mjs`, and `--verify-changed` in
  this job fails a PR whose pair disagrees ([dependency bot](renovate.md)).
