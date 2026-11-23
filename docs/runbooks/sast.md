# SAST and SCA runbook

BELAY's static security gate scans the source and the dependency graph at rest. It is
**keyless**: no SaaS account, no login and no new CI secret. Stage 1 (feature 006, backlog item #37)
runs two scanners:
- **Semgrep**, for code patterns (SAST) over the whole tree;
- **`pnpm audit`**, for the JavaScript dependencies (SCA).

It is ported from MovieCollectionManager's (MCM) feature 033. The scanners, the severity scale, the
allowlist format and the scanner status values are documented in
[security/sast/README.md](../../security/sast/README.md). This page covers running it, reading it
and keeping it green.

## Run it locally

In the dev container, which already has uv and the egress the scanners need (semgrep.dev, PyPI and
the npm registry):

```bash
pnpm nx run scripts:sast                              # full scan, then the gate
node scripts/sast-scan.mjs --scope changed --base origin/main   # Semgrep on changed files only; SCA still full
node scripts/sast-scan.mjs --test-rules               # prove the custom rules against their fixtures
node scripts/check-sast-findings.mjs                  # the gate alone (exit 0 pass / 1 blocking / 2 bad input)
```

Reports land in `security/sast/reports/` (gitignored):
- `findings.json`: the gate's input;
- `findings.sarif` and `summary.txt`;
- one native output per scanner.

A full scan takes about 6 s with a warm cache. The first `uvx semgrep@<pin>` install takes a few
seconds more and about 365 MB.

## The CI job

The `sast` job in [`guardrails.yml`](../../.forgejo/workflows/guardrails.yml) runs on every pull
request and every push to `main`, next to `guardrails`, on the `belay` runner. Its steps, in order:
1. install uv from its **pinned** installer;
2. install the workspace dependencies;
3. the gate's `--selftest`;
4. `--test-rules`;
5. the scan: changed files on a PR, full on push. **SCA always runs in full**, because a new advisory
   can hit an unchanged dependency;
6. the gate;
7. upload the `sast-report` artifact (always, kept 14 days);
8. the failure digest.

Read a failure with `node scripts/ci-status.mjs failure --pr <n> --job sast`. Every step runs
through `ci-log-step.sh`, so the digest names the failing step and carries its output.

**Making it required.** Branch protection lists required contexts by name. After the job's first
green run on a PR, add `guardrails / sast (pull_request)` next to `guardrails / guardrails
(pull_request)` (see [ci.md](ci.md#branch-protection-for-main)). Until then, a red `sast` shows on
the PR but does not block the merge.

## When the gate goes red

- **It lists a blocking finding:** a High/Critical code finding, or a High/Critical advisory in a
  **runtime** dependency. **Fix it**, or triage it into
  [`security/sast/allowlist.yaml`](../../security/sast/allowlist.yaml) with `scanner`, `id`,
  `locationPattern`, `justification` and `addedBy`, plus an optional `expiry`. An allowlisted finding
  stays in the report. Dev-scope advisories and Medium/Low findings are warnings and never block.
- **It says TRANSPORT/SERVICE ERROR:** a scanner could not reach the rule registry or the advisory
  service. It retried 3 times with backoff (`scripts/lib/scanner-retry.mjs`) and still fails closed,
  because a scanner that could not run must never report clean. This is an outage, not a finding:
  re-run the job.
- **It goes red on `main` with no change of yours:** SCA runs in full, so a newly published advisory
  can fail an unchanged dependency. That is the gate working. Raise the dependency (or add a
  `pnpm-workspace.yaml` override, keeping both halves in step; see `check-override-consistency.mjs`),
  or allowlist the advisory with an expiry while a fix is pending.
- **An allowlist entry expires:** the finding blocks again. The gate warns 14 days ahead
  (`EXPIRING SOON`). Remediate rather than re-dating.

## Custom rules

These live in `security/sast/rules/`, each with fixtures that show it firing on the insecure form and
staying silent on the safe one:

| Rule | Severity | Invariant |
|---|---|---|
| `belay-ci-curl-pipe-shell` | High | A workflow never pipes `curl` into a shell, except from the pinned uv installer URL |
| `belay-no-token-logging` | High | A logger is never passed a token, JWT, authorization header, session id, password or email |
| `belay-no-jwt-payload-tracing` | High | A trace never records a decoded token payload |

**Adding a rule:** write its fixture first (`ruleid:` and `ok:` lines), confirm `--test-rules` fails,
then add the rule. A rule without a fixture fails `--test-rules`. MCM's BFF-specific rules (no
console in the BFF; authentication before authorization) wait until BELAY has that surface.

## Pins

- **uv:** the version in the installer URL in the `sast` job (`astral.sh/uv/<x.y.z>/install.sh`).
  The custom curl rule accepts only that pinned form. The dev container's toolchain image pins uv
  separately; keep the two equal.
- **Semgrep:** `SEMGREP_PIN` in `scripts/sast-scan.mjs`.
- **Rule packs:** `security/sast/semgrep.yaml`. `p/secrets` is never enabled, because
  `secret-scan.mjs` owns credential detection.

## Stages 2 to 4

The enabled scanners are a list in `security/sast/scan.yaml`. Each later stage adds a list entry and
a toolchain step to the `sast` job, and nothing else:

| Stage | Trigger | Change |
|---|---|---|
| 2 | the first Rust crate | enable `cargo-audit`; install a **prebuilt, pinned** cargo-audit binary rather than compiling it in every run |
| 3 | the first Python project | enable `pip-audit`; `uv sync` each project before the scan. Projects are found from tracked `uv.lock` files, and a `pyproject.toml` without one fails the scan |
| 4 | installs dominate the job's time | bake uv, Semgrep and cargo-audit into a digest-pinned `belay-sast` image (like `devcontainer-image.yml`), and add it to `registry-retention.yaml` |

## Gotchas

- **The rules read text, so a comment can match.** This feature's first scan flagged its own
  workflow comment, which quoted the curl-pipe pattern. Reword the prose; don't allowlist it.
- **Check the finding count, not only the exit code.** "Scanned 0 files" and "found nothing" both
  exit 0. The summary prints the files scanned and each scanner's status: `not enabled`,
  `not selected` or `not run` is never clean.
- **Write `<!--` in a JS regex as `<[!]--`.** Semgrep's JS parser reads `<!--` as a legacy HTML
  comment even inside a regex literal (Node does not, in a module), and skips the rest of the
  statement; one test file went entirely unscanned that way. `<[!]--` matches the same text and
  parses. Two files still only partly parse, and the run's `errors` list names them: the Spec Kit
  branch script (`$((10#…))`, which Semgrep's bash parser lacks; Spec Kit owns the file) and an
  intentionally broken YAML fixture.
- **The changed-files scope fails closed.** If the diff against the PR base cannot be computed, the
  scan fails rather than scanning an empty set (stricter than MCM).
