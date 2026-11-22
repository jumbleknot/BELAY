---
type: Process
title: OpenWiki bundle maintenance
description: How this hand-authored openwiki/ bundle is kept current — the coding session refreshes a derived page in the same PR as its source, adds a concept for a new runbook, keeps every directory's index.md and the AGENTS.md index in step, and lists authoritative pages in protected.yaml — and the MovieCollectionManager gates (OKF conformance, V17 fingerprints, governance) not yet ported.
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

1. **Changed a file that a page cites as its `resource`?** Refresh that page in the same PR. Find the
   pages with `git grep -n "^resource: <path>" openwiki/`. Read the source's diff, then edit only
   what the change makes untrue, as a summary in the page's own words. Update `timestamp`.
2. **Added a runbook, decision record or architecture document?** Add a concept that cites it, so a
   missing concept keeps meaning a missing document ([the brief](../INSTRUCTIONS.md), §4d).
3. **Added, renamed or removed a page?** Update its directory's `index.md` and the knowledge index in
   `AGENTS.md`. A new authoritative page (no `resource`) goes under `authoritative:` in
   `openwiki/protected.yaml`.
4. **Learned something durable?** Write it where [the canonical-home rule](../INSTRUCTIONS.md)
   sends it: into the cited source for a derived page, or into the page itself for an authoritative
   one. Never into `AGENTS.md` prose or `CLAUDE.md`.

## Gotchas

- **Nothing fails the build yet.** MovieCollectionManager's required `okf` check (front matter,
  links, an index per directory, and V17's source fingerprints) and its governance gate (AGENTS.md
  index-only, the CLAUDE.md shim, the derived-or-authoritative split) are not ported. Porting them,
  with `wiki-refresh.mjs` and its skill, is backlog item #28. Until then, the duties above are kept by
  the session and by review, which is why they are on the
  [validation checklist](../invariants/feature-validation-checklist.md).
- **Do not add `resource-sha256` by hand.** The ported refresh tool will record each derived page's
  fingerprint from the source's bytes, with CRLF normalised to LF. A hand-typed hash is a guess that
  the gate would later have to unlearn.
- **A link to a moved file breaks silently.** With no link gate, a renamed runbook leaves dead links
  in the pages that cite it. The doc-impact sweep's `git grep` for the old path covers `openwiki/`
  too, so include the bundle when you sweep.
- **A `resource` is one file.** Never cite a directory or a bot-rewritten file
  ([the brief](../INSTRUCTIONS.md), §5).
- **When the gates are ported, the first run will find drift.** Expect the first OKF and governance
  runs to flag pages that review missed. Fix them in the pages or the brief, never with an allowlist.
