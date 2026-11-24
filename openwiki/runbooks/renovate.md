---
type: Runbook
title: The dependency bot (Renovate) — what it proposes, when, and how it fails loudly
description: BELAY's self-hosted Renovate on the belay runner, as the restricted belay-renovate account — it proposes and never merges; a security channel four times a day and a Wednesday window in UTC; every pin managed or excluded, held to rules C1–C11 by check-renovate-config.mjs; version-and-sha256 pairs moved together and verified on every PR; the dashboard kept out of backlog ready; and a run judged from its own log, never its exit code.
tags: [renovate, dependencies, supply-chain, ci, runbook]
resource: docs/runbooks/renovate.md
resource-sha256: 6b2cef4542e6e7bc6f13f67376c23dff02e9082a9261fa121f0340295d0557a3
timestamp: 2026-11-24T12:34:46.728Z
---

# The dependency bot (Renovate)

`.forgejo/workflows/renovate.yml` runs Renovate against this repository only, as the restricted
`belay-renovate` account ([ADR-0004](../decisions/adr-0004-renovate-dependency-bot.md)). It **proposes**
pull requests; CI judges them like any other, and a human merges. Automerge is off everywhere.

- **When**: a security channel at 01:17, 07:17, 13:17 and 19:17 UTC (advisory fixes only, within about
  18 hours) and a routine window on Wednesday at 05:00 UTC (at most 4 PRs, lock files first). Everything is
  in UTC, so daylight saving cannot move the window off its cron.
- **Every pin is managed or excluded.** `node scripts/check-renovate-config.mjs` detects every pinned version
  and digest in the tree, and fails on one that `renovate.json` does not manage and
  `security/dependencies/unmanaged-pins.yaml` does not exclude. It also holds the window, limits, groups,
  holds and automerge (rules C1–C11), in `scripts:test` and `scripts:lint`.
- **Majors wait for a tick** on the Dependency Dashboard. Spec Kit waits on every update. Ticking a box is the
  only allowed interaction with the dashboard, which `backlog.mjs ready` never lists.
- **Version-and-sha256 pairs move together** (Trivy, rustup-init, cargo-audit): a post-upgrade task
  re-derives the sha256, and the publisher's checksum must agree. The `sast` job verifies every pair that
  moved on every PR.
- **A run that did nothing is not green.** A preflight fails on a missing or refused token, and the verdict
  judges Renovate's own log. A dispatch defaults to a dry run. The record is the commit statuses
  `renovate/verdict` and `renovate/mode`.

- **The health loop watches the bot, and the bot watches it back.**
  - A weekly job (Wednesday 08:30 UTC) checks the lock-file window and posts one comment on `Dependency-bot health
    reports`: one line when healthy.
  - The bot's own run fails its verdict when that report is more than 8 days old.
  - A daily reaper deletes merged, unused branches, so the bot never reuses one.

## Gotchas

- **Never hand-close a bot PR**: the bot reads it as rejected and never proposes that version again. Add a
  hold instead, with `Why:`, `item #N` and `Re-check:`.
- **A base re-pin that discharges an image-scan allowlist entry** must also delete the entry in the same PR.
- **A failed post-upgrade task still opens the PR**; the required check stops it merging
  ([register](../invariants/unenforced-rules.md)).
- **Validating locally installs Renovate's whole dependency tree**, which was killed for memory (exit 137) in
  the dev container. Let the `sast` job validate.
