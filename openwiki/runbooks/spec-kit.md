---
type: Runbook
title: "Spec Kit: this repository's customisations, and upgrading it"
description: The one inventory of every way BELAY changes or adds to GitHub Spec Kit — the tasks-template override (doc-impact sweep, required RED/GREEN tests, the Open the PR task), the registered local edits to /speckit-tasks and /speckit-converge, the git and agent-context extensions and their hooks, the project-owned /speckit-taskstoissues and the after_specify and after_plan spec-stage hooks and skill — with who owns which file, the gate and its failure codes, and the upgrade procedure.
tags: [spec-kit, sdd, gates, upgrade, runbook]
resource: docs/runbooks/spec-kit.md
resource-sha256: a6142702d019f4d1b8f24e5737a6aa3a979ade392432f93ab94c3803228cf1de
timestamp: 2026-11-28T01:17:41.859Z
---

# Spec Kit: this repository's customisations, and upgrading it

[docs/runbooks/spec-kit.md](../../docs/runbooks/spec-kit.md) is the **single list of every way BELAY
changes or adds to Spec Kit**, and the procedure for upgrading without losing any of them.
`scripts/check-speckit-overrides.mjs` enforces it. The gate fails if a listed customisation is lost,
or if a Spec Kit-owned file is edited without being registered. It needs only Node, reads the
PowerShell scripts as text, and runs with its selftest in `scripts:lint` on every PR.

**Ownership decides the form of a change.** Spec Kit owns every file in
`.specify/integrations/*.manifest.json` and everything `specify extension add` installs. The project
owns `.specify/templates/overrides/` and the constitution. In order of preference, a change is:

1. a project-owned file Spec Kit reads (an override);
2. a *registered* local edit to a Spec Kit-owned file, used only when nothing project-owned can carry
   the change;
3. **never** an edit to a core template.

## Gotchas

- **Run the gate before committing anything under `.specify/` or `.claude/skills/speckit-*`:**
  `node scripts/check-speckit-overrides.mjs`. When it fails because you changed something it
  protects, fix the cause. Never delete or weaken the gate. `resolution-broken` in particular means
  Spec Kit changed how it resolves templates, so re-evaluate where the override lives.
- **`specify integration upgrade --force` overwrites every Spec Kit-owned file without warning**,
  and deletes any file that dropped out of the manifest. The gate turns each loss into a named code
  (`local-edit-reverted`, `core-changed`, `project-file-lost`), and the runbook says how to restore
  each one.
- **The override is a fork.** Its first line records the fork point's hash and Spec Kit version.
  After an upgrade, merge the core template's change into it, then run `--record`. Never hand-type
  the hash, and `--record` refuses an override that lost the sweep or the TDD sample.
- **An extension reinstall drops the four hand-added hooks.** Expect `hook-lost` for
  `before_converge`, `after_converge` and the two mandatory `belay` `speckit.belay.spec-stage` hooks
  (`after_specify` and `after_plan`), and re-add them.
- **The spec-stage hooks move the proposal a spec came from through its stages** (feature 016, replacing
  014's close-proposal hook). Its skill, `.claude/skills/speckit-belay-spec-stage/`, is project-owned. It
  finds one `Proposal #<n>` in the spec's Input line, picks `in-engineering` when `plan.md` exists and
  `spec-in-progress` otherwise, and runs `backlog.mjs stage`. It never closes the proposal (CI does, on
  merge); no marker means nothing to record, and that is not a failure.
- **agent-context writes to `AGENTS.md`, never `CLAUDE.md`** (`context_file: AGENTS.md`). Leave
  `context_files: []`, because it takes precedence and the gate checks only the marker.
- **The CLI version is pinned in two places:** `speckit_version` in `.specify/init-options.json` and
  the version named on [the SDD page](../process/spec-driven-development.md). Keep them equal by hand
  in the upgrade PR.
- **`/speckit-constitution` checks the core tasks template, not the override.** After an amendment,
  check the override by hand.
- **A Spec Kit bump from the dependency bot is never a raw merge.** It opens only after approval on
  the dashboard, and the upgrade procedure runs on its branch before it merges ([dependency bot](renovate.md)).
