---
type: Runbook
title: "Doc drift: the doc-impact sweep and the quarterly audit"
description: How BELAY keeps its procedure documents in step with the code — the doc-impact sweep every SDD feature runs at task generation and close-out, carried by a Spec Kit tasks-template override and required by the constitution; the three layers and which are live; and the quarterly drift audit that measures the result and files its own successor.
tags: [documentation, drift, spec-kit, sdd, audit, runbook]
resource: docs/runbooks/doc-drift.md
resource-sha256: bfe1092fe36a81974f4de5005abe5e699d473b92fcc26022badf0a449c5a7018
timestamp: 2026-11-23T23:53:09.107Z
---

# Doc drift: the doc-impact sweep and the quarterly audit

The [wiki maintenance](../process/wiki-maintenance.md) duty keeps each summary in step with its
source document. This runbook covers the other direction: keeping a source document in step with
**the code it describes**. The procedures are in
[docs/runbooks/doc-drift.md](../../docs/runbooks/doc-drift.md).

## Three layers, two of them live

1. **The doc-impact sweep** (live). Every SDD feature lists the identifiers it renames, removes or
   changes the meaning of. It searches every doc that states current procedure for each one with
   `git grep -n -F` over `*.md`, excluding `specs/`, `docs/proposals/` and `docs/decisions/`. Each
   hit becomes a named doc task or a one-line justification. The search runs when tasks are
   generated, and again for the old names at close-out. MovieCollectionManager measured that the
   weak point is **discovery**, not follow-through: features did 94% of the doc tasks they wrote.
2. **A mechanical per-PR check** (not built). It is built only if an audit finds drift that a
   `describes:` link would have caught on a feature whose sweep ran.
3. **The quarterly drift audit** (live). One session reads the procedure docs against a named commit
   and verifies only checkable claims. It makes the smallest true edit for each proven drift and
   lists what it cannot prove. It records the drift rate per 1,000 lines and re-reads the
   [register of unenforced rules](../invariants/unenforced-rules.md). Its last step files the next
   audit as a backlog item about three months on, so the cadence needs no scheduler.

## Gotchas

- **The sweep lives in a fork of Spec Kit's tasks template.** An upgrade can leave the fork stale or
  stop resolving it. The Spec Kit gate catches both (`sweep-missing`, `core-changed`,
  `resolution-broken`; see [Spec Kit](./spec-kit.md)).
- **The sweep is required even without the template.** The constitution's **Documentation**
  principle requires it on its own, so a change made without `/speckit-tasks` still runs the search
  before its PR.
- **Include the bundle.** The sweep's search covers `openwiki/` and `AGENTS.md`. The OKF gate (V15)
  fails a dead relative *link*, but a renamed path named in prose or in a code span is caught only by
  the sweep.
- **History is never rewritten.** Decision records, specs, proposals, design records and dated
  measurements describe the past and stay as written, even when the audit finds them out of date.
