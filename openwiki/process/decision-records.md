---
type: Process
title: Decision records (ADRs) — when one is required and how it changes
description: Where a structural decision is recorded once the maintainer says yes — the docs/decisions/ ADR folder, the decisions that require an ADR (new toolchain, build plugin, top-level folder, install-script dependency, bot or long-lived credential), why an accepted ADR is superseded rather than rewritten, and the concept page every ADR needs.
tags: [decisions, adr, process, governance]
resource: docs/decisions/README.md
resource-sha256: 5451475e460d18eeec891a942d62537a176f725a9f240b7598cd260eca2dbb5f
timestamp: 2026-11-25T03:24:37.636Z
---

# Decision records (ADRs)

`AGENTS.md`'s gate "a structural decision is asked, not taken" says *when* to stop and ask. An ADR
under [`docs/decisions/`](../../docs/decisions/README.md) is *where the answer is kept*: one short,
dated document per decision, stating the context, the choice, the rejected alternatives and the cost.
A spec records what one feature decided at the time. An ADR records a choice that every later feature
has to work within.

The [decisions index](../decisions/index.md) lists every ADR's concept page.

## Gotchas

- **Ask first, then write the ADR**, in the same PR as the first change that depends on it or
  earlier. The ADR records the maintainer's approval: who approved, when, and how. A structural
  change with no ADR is a review finding.
- **Required for:** a new language toolchain, build plugin or top-level folder; a dependency with an
  install script; a new bot, service account or long-lived credential; reversing a recorded decision.
  **Not** for a choice one spec settles and nothing later depends on. That stays in `plan.md`.
- **An accepted decision is never rewritten.** A changed decision is a new ADR that supersedes the old
  one, and the old one's status line is its only edit. This is the opposite of a wiki page, which is
  rewritten in place ([the brief](../INSTRUCTIONS.md), §7). An ADR is a record, not current state.
- **Back-filled ADRs carry two dates**: when the decision was taken, and when it was written down.
  ADR-0001 to ADR-0003 are back-filled (2026-11-23).
- **Every ADR needs a concept page** under `openwiki/decisions/` that cites it as its `resource`, so
  "no page" keeps meaning "no such document" ([the brief](../INSTRUCTIONS.md), §4d).
