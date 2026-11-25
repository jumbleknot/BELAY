---
type: Convention
title: Secrets management posture
description: No clear-text secrets in git, what secrets/ may hold, the forge credentials and the dependency bot's tokens with their deliberately separate scopes, why ANTHROPIC_API_KEY is never set where AI coding runs, and the scan, redactor and never-print rules that keep a credential out of output, digests and wiki pages.
tags: [secrets, security, credentials, forge]
timestamp: 2026-11-22
---

# Secrets management posture

**No clear-text secret is ever committed.** `.gitignore` ignores `.env` and `.env.*` (keeping
`.env.example`) and key material (`*.pem`, `*.key`, `*.pfx`, `*.p12`). `secrets/` is tracked only for
`.gitkeep`, `README.md` and `*.example` templates. A secret a tool needs lives in an environment
variable or a gitignored file, and its template is an `*.example` file.

## The credentials

| Name | Where it lives | Scope | Used by |
| --- | --- | --- | --- |
| `FORGE_TOKEN` | user environment variable | read-only (`read:repository`, `read:issue`, `read:package`) | `ci-status.mjs`; read fallback for `backlog.mjs` |
| `FORGE_ISSUE_TOKEN` | user environment variable | `write:issue` + `read:repository` | `backlog.mjs` and `taskstoissues.mjs` writes; `pdlc:integration-forge`, which maps it to `PDLC_FORGE_TOKEN` for its own child process only, at the point of use (it has exactly the `pdlc` scope) |
| the `pdlc` token | **the workstation only**: a `sensitive` setting of the `pdlc` Claude Desktop Extension (measured on the workstation: encrypted at rest in the extension's settings file under `%LOCALAPPDATA%\Claude-Data`, with Electron `safeStorage`, a key Windows DPAPI protects for the logged-in user, so any process running as that user can read it; detail in [the pdlc runbook](../runbooks/pdlc.md)). Never in the dev container, CI or the tree | `write:issue` + `read:repository` | the `pdlc` server only. Dedicated: revoked and re-minted on its own, which breaks nothing else. Reaches git only through `GIT_CONFIG_*` in each child's environment, never argv or `.git/config` |
| the git credential for `origin` | the git credential helper | the account's push access | `forge-pr.mjs` (open, merge, dispatch), through `git credential fill` |
| `CI_DIGEST_TOKEN` | repository Actions secret | `write:issue`, `write:package`, `read:repository` | the CI failure-digest step, the weekly dependency-bot health report, and (read-only) the branch-protection read for that report and the branch reaper, where the run token gets 403 |
| `RENOVATE_TOKEN` | repository Actions secret, never the dev container | `read:user`, `read:organization`, `write:repository`, `write:issue`, on the dedicated restricted `belay-renovate` account | the dependency bot's `renovate` workflow only ([runbook](../../docs/runbooks/renovate.md#the-token)) |
| `RENOVATE_GITHUB_COM_TOKEN` | repository Actions secret (optional) | a github.com fine-grained token: public-repository read, no permissions | release lookups in the `renovate` run, past github.com's anonymous rate limit |

Full detail is in the [CI runbook](../../docs/runbooks/ci.md#secrets) and the
[backlog runbook](../../docs/runbooks/backlog.md#the-credential).

## Gotchas

- **Never set `ANTHROPIC_API_KEY` on a machine or container where AI coding runs.** AI coding runs on
  the subscription. Claude Code silently prefers that variable over a subscription login and bills
  per token. MovieCollectionManager measured about $15 in one unnoticed day. A tool that needs a
  model key gets it under a different name, mapped to `ANTHROPIC_API_KEY` only in the process that
  uses it.
- **The tokens stay separate on purpose.** `FORGE_TOKEN`'s read-only scope is what `ci-status.mjs`
  relies on. Widening it would quietly give the CI-status path write access and tie two tools to one
  revocation. Forgejo tokens are account-wide, so scope is the server-side limit, and
  `backlog.mjs`'s same-repository write guard is the client-side one.
- **A credential is never printed.** No tool echoes a token, and `forge-pr.mjs` never logs what
  `git credential fill` returns. Never type a `git credential fill` recipe by hand into a command
  whose output is captured.
- **Everything CI publishes goes through the fail-closed redactor** (`scripts/ci-digest-redact.mjs`).
  It rewrites credentials and the forge host, and withholds an excerpt entirely if anything
  credential-shaped survives. "Excerpt withheld" in a digest means exactly that.
- **`scripts/secret-scan.mjs` scans every tracked file in `scripts:lint`, after its selftest.** A
  finding names the file, line and rule, never the value. Keep test fixtures
  that look like credentials obviously fake, so they never train anyone to ignore a real hit.
- **Wiki pages and docs never name the forge host, a tailnet address or a host-and-port pair** (see
  [the brief](../INSTRUCTIONS.md), §3). Refer to them abstractly. `scripts/check-topology-scrub.mjs`
  fails any real `*.ts.net` host in a tracked file; a host containing `tailnet` or `example` is a
  placeholder, and `<tailnet-host>` is the one to use in prose.
- **A running process keeps its old environment.** A token set after the editor or terminal started
  is invisible to it, and a tool reports the variable as missing. Restart the process before
  concluding the token is wrong.

See [the .env inline-comment trap](../gotchas/env-file-inline-comments.md) for a way a correct secret
gets corrupted on its way in.
