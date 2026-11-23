# SAST and SCA static security scanning

Config-as-code **static** application security testing (SAST) and **software composition analysis**
(SCA). Everything is **keyless**: no SaaS account, no login, no new CI secret. It scans the source
and the dependency graph at rest, so no running service is needed. Ported from
MovieCollectionManager's feature 033; BELAY feature 006 is stage 1 of item #37.

Runbook (local run, the CI job, triage, the pins, stages 2–4): `docs/runbooks/sast.md`.

## What runs

`scripts/sast-scan.mjs` implements four scanners. **[`scan.yaml`](./scan.yaml) decides which run.**

| Kind | Scanner | Surface | Stage | Invocation |
|---|---|---|---|---|
| SAST | **Semgrep** (OSS) | first-party TS/JS, Python, workflow YAML, Dockerfiles | 1 — enabled | `uvx semgrep@<pin> scan` |
| SCA | **pnpm audit** | every committed `pnpm-lock.yaml` | 1 — enabled | `pnpm [--dir <ws>] audit --json` |
| SCA | **cargo audit** | every committed `Cargo.lock` | 2 — not enabled | `cargo audit --json` |
| SCA | **pip-audit** | every committed `uv.lock` under a project directory | 3 — not enabled | `uv run --with pip-audit` |

A scanner that `scan.yaml` does not list never runs. It appears in `findings.json` with
`status: not-enabled` and in the summary as **not enabled — NOT scanned**, never as clean. `--only`
can narrow the list for a local run, but can never add a scanner the file does not list (exit 2,
naming the file). An unknown name, a repeated name, or an empty list is refused (exit 2): a scan of
nothing must not read as clean. Stages 2 and 3 are a list entry here and nothing else: their toolchain
steps are already in the `sast` job, dormant until a lockfile is tracked (`scripts/sast-prepare.mjs`).

`p/secrets` is **never** enabled. The secret-scan gate (`scripts/secret-scan.mjs`) stays the single
owner of credential detection (FR-006).

## Normalized severity

Every scanner's native severity maps onto one **Critical / High / Medium / Low** scale through
[`severity-map.yaml`](./severity-map.yaml), applied by the orchestrator. An unmapped native value
fails the scan rather than defaulting.

`blocking = severity ∈ {High, Critical} AND (kind == sast OR scope == runtime)`. A High/Critical
advisory in a **runtime** dependency blocks; the same advisory in a **dev/test/build-only** dependency
is a warning (FR-021). Scope comes from `pnpm audit --prod`, `cargo tree --edges no-dev` and
`uv export --no-dev`.

## Custom rules

BELAY invariants live under [`rules/`](./rules/), each with `semgrep --test` fixtures that
`node scripts/sast-scan.mjs --test-rules` runs before the scan. `--test-rules` also fails on a rule
with no fixture (`semgrep --test` skips those silently and still prints `N/N ✓`), and on an empty or
missing rules directory.

| Rule | Severity | Enforces |
|---|---|---|
| `belay-no-token-logging` | ERROR → High (block) | no logging of a raw token, JWT, `authorization`, session id, email or password (TS/JS) |
| `belay-no-jwt-payload-tracing` | ERROR → High (block) | no logging or tracing of a decoded JWT payload (TS/JS and Python) |
| `belay-ci-curl-pipe-shell` | ERROR → High (block) | no `curl … \| sh` in a workflow from a URL outside the rule's accepted, pinned list |

Semgrep reports a custom rule loaded from this directory under a path-prefixed id:
`security.sast.rules.<rule>`. Allowlist entries use that full id.

MCM's `no-console-in-bff` and `auth-before-authz` rules are **not** ported: they are bound to MCM's
BFF path and service-client API. Each returns when BELAY has that surface (research R3).

A YAML rule's fixture is named `<rule>.test.yml`: a bare `<rule>.yaml` would be loaded as a rule by
`--config security/sast/rules/`. The whole `security/` tree is excluded from the product scan
([`.semgrepignore`](./.semgrepignore)), so the intentionally insecure fixtures are never scanned as
code.

### A rule that goes blind reads exactly like a remediated one

`belay-ci-curl-pipe-shell` replaces the community rule
`yaml.github-actions.security.gha-curl-pipe-shell`, which re-parses a step's `run:` block as Bash.
BELAY wraps its run-steps in the ci-log-step heredoc, which that sub-parser cannot read, so it
abandons the block instead of matching inside it. MCM measured it: 36 errors attributed to that rule
and 0 findings, while six `curl … | sh` lines sat in its workflows.

- **The replacement is text-level** (`pattern-regex` / `pattern-not-regex`, never
  `metavariable-pattern`). `scripts/__tests__/ci-curl-pipe-shell-rule.test.mjs` fails if that changes.
  Being text-level, it also matches a `curl … | sh` written in a YAML **comment**.
- **The accepted installers are named in the rule**, not the allowlist, because an allowlist entry
  keys on `path:line`: a file wildcard would suppress a *new* `curl | sh` anywhere in that workflow.
  Today the list holds uv's version-pinned installer only.
- **The report carries the scanner's own errors.** `sast-scan.mjs` groups Semgrep's `errors[]` by rule
  into `scanners[].blindedRules`, so the gate can tell "found nothing" from "could not run".

## Reports

Each run writes to `security/sast/reports/` (gitignored):

| File | Purpose |
|---|---|
| `findings.json` | **gate input**: the normalized report `check-sast-findings.mjs` reads |
| `findings.sarif` | portable SARIF |
| `summary.txt` | human summary, by normalized severity and scanner |
| `<scanner>-native.json` | each scanner's raw output, secret-scrubbed, for triage |

`findings.json` lists **every** known scanner in `scanners[]`, each with a `status`:

| `status` | Meaning |
|---|---|
| `ran` | ran to completion; `findingCount: 0` is a clean result |
| `failed` | enabled and could not run; the scan exits 1 (FR-015) and `error` says why |
| `not-enabled` | not in `scan.yaml`; never invoked |
| `not-selected` | enabled, but narrowed out by `--only` |
| `not-run` | enabled, but an earlier scanner failed first |

Only `ran` is a result. `ran: true|false` is kept beside `status` for the MCM-shaped report contract.

## Triage and the allowlist

A blocking finding fails the gate. Fix it, or, if it is a false positive or an accepted risk, add an
entry to [`allowlist.yaml`](./allowlist.yaml); that file's header documents the fields, the expiry
and the warnings. An allowlisted finding stays visible in the reports.

To seed or re-baseline: `node scripts/sast-scan.mjs --scope full --emit-allowlist` writes
`reports/allowlist.proposed.yaml` with one TODO entry per current finding. Triage each one before
copying it into `allowlist.yaml`.

## Transient failures

Every scanner reaches a third party over the network (the Semgrep registry, the npm advisory
endpoint, the RustSec DB, OSV). A recognised transport failure is retried with backoff
(`scripts/lib/scanner-retry.mjs`). Exhausting the retries still fails the scan, with a message saying
it was a transport failure and not a finding. An unrecognised failure is never retried.
