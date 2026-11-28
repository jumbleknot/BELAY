---
name: "speckit-belay-feature-dir"
description: "Before /speckit-plan, make sure Spec Kit knows which spec to plan: on a fresh checkout of a feature branch, write the gitignored .specify/feature.json from the branch. Runs as the mandatory before_plan hook."
compatibility: "Requires spec-kit project structure with .specify/ directory"
metadata:
  author: "project"
  source: "project-owned (feature 016, research R5 as measured in T042); registered in scripts/check-speckit-overrides.mjs PROJECT_OWNED and as the before_plan hook in EXTENSION_HOOKS; see docs/runbooks/spec-kit.md row 7a"
user-invocable: true
disable-model-invocation: false
---

# Find the spec to plan

Spec Kit's plan step finds the feature folder only from `SPECIFY_FEATURE_DIRECTORY` or `.specify/feature.json`, a
local, gitignored file the specify step writes. A fresh clone or worktree of a feature branch (an Architect picking up a
spec someone else wrote, in Claude Desktop or in VS Code) has no such file, so planning would stop with "Feature
directory not found". This skill fixes that before planning starts, and does nothing else.

## Steps

1. Run, from the repository root:

   ```bash
   node scripts/feature-dir.mjs
   ```

2. Relay its output and its exit code exactly:
   - **0**: the feature folder is known: from `SPECIFY_FEATURE_DIRECTORY`, from an existing `.specify/feature.json`, or
     from the branch, in which case it wrote `.specify/feature.json` (gitignored; nothing tracked changes). Continue
     with the plan.
   - **2**: it cannot tell which spec to plan (not on a feature branch, or the branch has no `specs/<branch>/spec.md`).
     Stop and say so: check out the feature branch named in `node scripts/backlog.mjs ready`, or set
     `SPECIFY_FEATURE_DIRECTORY=specs/<NNN-slug>`.

Never edit `.specify/feature.json` by hand as part of this flow, and never commit it.
