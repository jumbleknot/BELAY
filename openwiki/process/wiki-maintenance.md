---
type: Process
title: OpenWiki bundle maintenance
description: How this hand-authored openwiki/ bundle is kept current — the coding session refreshes a derived page in the same PR as its source and records its fingerprint with wiki-refresh.mjs, adds a concept for a new runbook, keeps every directory's index.md and the AGENTS.md index in step, and lists authoritative pages in protected.yaml — and the OKF and governance gates that enforce it in scripts:lint.
tags: [openwiki, documentation, process, maintenance]
timestamp: 2026-11-22
---

# OpenWiki bundle maintenance

This bundle is **hand-authored and maintained by the coding session**. There is no generator and no
scheduled refresh. The arrangement follows MovieCollectionManager's ADR-0004, under which the session
that changes a source refreshes its summary in the same PR. MovieCollectionManager adopted that after
measuring a scheduled generator at $167.80 over 106 runs for 39 distinct pages in one month. The
session that edits a source has already read it and runs on the subscription, so keeping the summary
fresh costs nothing extra.

## The duties, per PR

1. **Changed a file that a page cites as its `resource`?** Refresh that page in the same PR.
   `node scripts/wiki-refresh.mjs --stale` lists the pages, and `--diff <page>` shows the source's
   change since the page was recorded. Edit only what the change makes untrue, as a summary in the
   page's own words, then run `--record <page>`. The `wiki-refresh` skill walks through it.
2. **Added a runbook, decision record or architecture document?** Add a concept that cites it, so a
   missing concept keeps meaning a missing document ([the brief](../INSTRUCTIONS.md), §4d).
3. **Added, renamed or removed a page?** Update its directory's `index.md` and the knowledge index in
   `AGENTS.md`. A new authoritative page (no `resource`) goes under `authoritative:` in
   `openwiki/protected.yaml`.
4. **Learned something durable?** Write it where [the canonical-home rule](../INSTRUCTIONS.md)
   sends it: into the cited source for a derived page, or into the page itself for an authoritative
   one. Never into `AGENTS.md` prose or `CLAUDE.md`.

## Gotchas

- **Two gates enforce the duties, in `scripts:lint`** (the required `guardrails` check).
  `scripts/check-openwiki-okf.mjs` checks front matter, links, an index per directory, and **V17**,
  which fails a derived page whose recorded fingerprint no longer matches its source.
  `scripts/check-openwiki-governance.mjs` keeps `AGENTS.md` an index within its size budget,
  `CLAUDE.md` a shim, and every page derived or authoritative. Both were ported from
  MovieCollectionManager ([the brief](../INSTRUCTIONS.md), §9). Neither has an allowlist: fix the
  page or the brief.
- **V17 proves a page was recorded, not that it is right.** `--record` on an unread page passes the
  gate. Read the `--diff` first; a fingerprint-only record is correct only when the change touches
  nothing the page says.
- **Do not add `resource-sha256` by hand.** `wiki-refresh.mjs --record` hashes the source's bytes,
  with CRLF normalised to LF. A hand-typed hash is a guess that the gate would later have to unlearn.
  The same goes for a passage fingerprint in `protected.yaml`: compute it with
  `node scripts/check-openwiki-governance.mjs --fingerprint <page> "<heading>"`.
- **A renamed file fails the gates, but only where it is linked.** A dead relative link fails V15,
  and a page whose `resource` moved fails V17 (`resource missing`). A path named in prose or a code
  span is caught only by the doc-impact sweep's `git grep` for the old path, which covers
  `openwiki/` too.
- **A `resource` is one file.** Never cite a directory or a bot-rewritten file
  ([the brief](../INSTRUCTIONS.md), §5).
- **The gates' first run (2026-11-23) found what review had missed**: an `AGENTS.md` index line with
  no link (G8), no derived page with a fingerprint, and three summaries behind their sources. Each was
  fixed in the page or the index, never with an allowlist.
