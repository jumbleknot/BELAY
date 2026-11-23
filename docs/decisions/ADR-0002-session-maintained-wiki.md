# ADR-0002: The `openwiki/` bundle is maintained by the coding session, with no generator

- **Status:** Accepted
- **Date:** 2026-11-22 (decided, when the bundle was created) · 2026-11-23 (recorded, back-filled)
- **Approved by:** the maintainer, 2026-11-22, by merging the bundle and its hand-authored brief (`openwiki/INSTRUCTIONS.md`, commit `b6edf44`), and again with backlog item 28, which ported the OpenWiki gates
- **Related:** [OpenWiki bundle maintenance](../../openwiki/process/wiki-maintenance.md); MCM's ADR-0004, which this decision adopts

## Context

The `openwiki/` bundle consists of short, typed pages that a coding assistant reads just in time. Most
pages are derived summaries of one source file, so they go stale when that file changes.
MovieCollectionManager (MCM) first maintained its bundle with a paid model run in CI. Over nine rounds
of tuning between July and November 2026, it measured:

- **$167.80 over 106 runs in 30 days**, with 265 page attempts for 39 distinct pages;
- forced pages starving the requested ones: one run landed a single page for about $1.44;
- a cost floor that tuning could not remove, because about 20 sources a week changed.

MCM retired the generator on 2026-11-10 (its ADR-0004).

## Decision

**The session that changes a source refreshes its summary in the same PR.** Each derived page records
`resource-sha256`, the hash of its one source file. Rule V17 of the OKF gate, in the required
`guardrails` check, fails a PR whose page no longer matches its source. `scripts/wiki-refresh.mjs`
does the bookkeeping (`--stale`, `--diff`, `--record`). It is offline, keyless and free. BELAY has no
generator and no scheduled refresh.

Alternatives considered:
- A scheduled or on-merge generator, as MCM first ran. Rejected on MCM's measurements: it costs money
  on every run and drift accumulates on `main` between runs.
- No fingerprint: refresh by convention. Rejected: guidance on a page does not keep anything honest.
  Only a gate does.

## Consequences

- A derived page may cite only **one file that no bot rewrites**. A bot PR has no session present to
  refresh a page, so a lock file, workflow or manifest is never a `resource`. This matters once the
  dependency bot of [ADR-0004](ADR-0004-renovate-dependency-bot.md) is opening PRs.
- V17 proves a page was recorded after its source changed, not that the summary is right. Accuracy is
  kept by review, and by reading `--diff` before `--record`.
- Refreshing a page costs session time in the PR that caused the drift. It runs on the subscription,
  never on a per-token API key.
