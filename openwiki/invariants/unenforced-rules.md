---
type: Reference
title: Rules stated but not mechanically enforced — where enforcement is soft
description: The register of BELAY rules that a document states but no gate checks — spec-before-code, the coverage minimum, RED-before-GREEN, summary accuracy, semantic doc drift, structural decisions, redaction beyond the scanners — with where each is stated, what backs it instead, and the backlog item that would close it; re-read at every quarterly drift audit.
tags: [governance, gates, enforcement, gaps]
timestamp: 2026-11-23
---

# Rules stated but not mechanically enforced

Guidance on a page does not keep anything honest; a gate does. MovieCollectionManager learned that
across about a hundred features, and BELAY's gates are mostly ported from it. Some rules still have
no gate, and a reader who believes every rule is checked will trust the wrong things.

This page lists every rule that is **stated but not mechanically enforced**. For each one it gives
where the rule is stated, what backs it instead, and the backlog item that would close it. A rule
listed here is not optional. Review is the only thing holding it, so it gets explicit attention in
review.

## The register

| Rule | Stated in | Backed instead by | Closes it |
| --- | --- | --- | --- |
| **A spec exists before implementation code** under the SDD-gated folders | constitution (No Vibe Coding), `AGENTS.md` gate | session gate, PR review, the `spec(N)` → `plan(N)` → `tasks(N)` commit trail | **decided not to build** (backlog item 54, maintainer, 2026-11-24): every Renovate PR and small chore under the gated folders would need an exemption, and MovieCollectionManager ran about a hundred features without one. Revisit only if a violation slips through review |
| **Coverage of at least 70% for new features** | constitution, the Backend, Frontend and AI Agent Quality Standards sections | nothing yet: no Nx target or workflow measures coverage | feature 009 (`specs/009-scripts-coverage-gate/`, backlog item 53) gates `scripts/` at 70% of lines per file and in total. Projects that do not exist yet gate their own when they arrive |
| **RED is observed before GREEN** | constitution (TDD), [test authoring conventions](../process/test-authoring-conventions.md) | the Verify RED / Verify GREEN commands and expected output recorded in `tasks.md`: *evidenced, not verified*, because nothing replays them | none planned |
| **A refreshed wiki summary is accurate** | [the brief](../INSTRUCTIONS.md), §1 and §9 | review. V17 proves only that the page was recorded after its source changed | none planned |
| **Docs keep up with changed *behaviour*** | constitution (Documentation) | the doc-impact sweep catches renamed and removed *identifiers*. Behaviour changes are left to the quarterly audit | layer 2 of [doc drift](../runbooks/doc-drift.md), built only if an audit shows it is needed |
| **A structural decision is asked, not taken, and recorded** | `AGENTS.md` gate, [decision records](../process/decision-records.md) | review, plus the ADR's recorded approval | none planned |
| **Redaction beyond what the scanners catch** (abstract host references, no host and port pairs) | [the brief](../INSTRUCTIONS.md), §3 | the secret scan and topology scrub catch the shapes they know; review catches the rest | none planned |

Spec Kit's own soft spots, such as which override the gate does not guard, are kept with their
subject in the [Spec Kit runbook's known gaps](../../docs/runbooks/spec-kit.md#known-gaps), not
repeated here.

## Gotchas

- **Remove an entry in the same PR as the gate that closes it.** A stale entry here makes a gated rule
  look soft, and a missing entry makes a soft rule look gated. Both errors mislead in the same way.
- **Add an entry when you write a rule without a gate.** It is the honest alternative to writing the
  gate, and it is the first question a later reader will ask.
- **Re-read the whole register at every quarterly drift audit** ([doc drift](../runbooks/doc-drift.md)).
  Remove each entry whose gate has landed, and add any rule the audit found stated but unchecked.
- **"Evidenced, not verified" is a real distinction.** A recorded Verify RED line is a claim a session
  made about its own terminal. It is far better than a ticked box, but nothing in CI re-runs it.
