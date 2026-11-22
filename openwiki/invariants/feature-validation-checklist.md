---
type: Convention
title: Final validation checklist
description: The sequence of checks every feature or change must pass before it is marked complete and its PR opened — the test-task format, the doc-impact close-out, both scripts Nx targets, the Spec Kit gate when its files changed, the same-PR wiki refresh, and rtk gain last.
tags: [testing, validation, process, checklist]
timestamp: 2026-11-22
---

# Final validation checklist

Run all of the following before marking a feature complete or opening its PR. Each item applies
whenever its trigger is in the diff, even outside a Spec Kit feature.

- [ ] **Test tasks follow `docs/templates/feature-test-tasks-template.md`**: every test task has a
      Verify RED that was observed failing, and its paired implementation task a Verify GREEN.
- [ ] **Doc-impact close-out.** Re-run the doc-impact sweep's searches, recorded in `tasks.md`, for
      the OLD identifiers. Every remaining hit in a document that states current procedure is fixed,
      or justified in `tasks.md` (constitution, **Documentation**; see
      [doc drift](../runbooks/doc-drift.md)).
- [ ] `pnpm nx run scripts:lint`: every gate and selftest passes.
- [ ] `pnpm nx run scripts:test`: every script test passes, **with a skip count you can explain**.
- [ ] **If the diff touches `.specify/`, `.claude/skills/speckit-*` or `docs/runbooks/spec-kit.md`:**
      `node scripts/check-speckit-overrides.mjs` passes. It also runs inside `scripts:lint`. Run it
      on its own first, because its failure codes name the fix.
- [ ] **Wiki refresh.** For every file this PR changed that an `openwiki/` page cites as its
      `resource`, that page is brought up to date in this PR (see
      [wiki maintenance](../process/wiki-maintenance.md)). An empty list is valid.
- [ ] **New repository-wide convention?** It has a canonical page and a one-line `AGENTS.md` index
      entry.
- [ ] `rtk gain`: compression is active. Run it last, because it measures the commands above.

## Gotchas

- **The checklist is about the diff, not the feature's label.** A docs-only PR still runs both
  targets. They are cheap, and the Spec Kit gate reads Markdown (its runbook must name every
  customisation, `inventory-stale`).
- **CI runs the same two targets, so a local pass predicts the required check.** Running them before
  the push costs seconds. A red push for an offline-knowable reason costs a runner slot and a
  round trip.
- **`tasks.md` is ticked before CI runs, and CI evidence goes in the PR, never in `tasks.md`.** The
  tasks template's **Open the PR** task runs the PR tools. Recording a CI result in `tasks.md` would
  need another commit and another CI run (see [Spec Kit](../runbooks/spec-kit.md), row 1).
- **Until the wiki gates are ported, the wiki-refresh item is checked by review only.** Nothing fails
  the build when a summary goes stale, so this item is what keeps it fresh.

See [testing tiers](./testing-tiers.md) for what each target contains, and
[RTK token compression](./rtk-token-compression.md) for why `rtk gain` runs last.
