# Contract: `/speckit-taskstoissues` (project-owned skill)

**File:** `.claude/skills/speckit-taskstoissues/SKILL.md`. It's project-owned: forked from spec-kit 0.16.5 by way of MovieCollectionManager, and registered in `scripts/check-speckit-overrides.mjs` `PROJECT_OWNED` with marker `scripts/backlog.mjs`.

## Flow

1. **Before hooks:** read `hooks.before_taskstoissues` from `.specify/extensions.yml`, and offer or run each one as every Spec Kit command does. In BELAY that's git's optional `speckit.git.commit`.
2. **Prerequisites:** run `.specify/scripts/powershell/check-prerequisites.ps1 -Json -RequireTasks -IncludeTasks`, and take `FEATURE_DIR` and the `tasks.md` path from its output.
3. **Milestone:** `node scripts/backlog.mjs setup-milestone <NNN-slug>`.
4. **Existing tasks:** `node scripts/backlog.mjs list --state all --milestone <NNN-slug> --limit 50 --json`, following `--page` until the total is reached. Collect task ids matching `\bT\d{3,}\b`.
5. **Create:** for each task line in `tasks.md` whose id isn't collected yet:
   - **Command:** `node scripts/backlog.mjs create --title "T0NN: <description>" --body-file <scratch> --label type/chore --label priority/p2 --milestone <NNN-slug>`.
   - **Title:** `[P]` and `[US#]` are removed.
   - **Body:** the task's full text and its `tasks.md` reference.
   - **Skipped:** a line without a task id is skipped and reported.
6. **Order:** for each created task with a dependency, `node scripts/backlog.mjs dep <n> --blocked-by <m>`.
7. **Report:** counts of created, skipped as already filed, and skipped as having no id.
8. **After hooks:** read `hooks.after_taskstoissues`, and offer or run them.

**Guarantees:**
- Rerunning creates nothing for tasks that already have an issue.
- `tasks.md` is never modified.
- Nothing is closed, relabelled or deleted.

## Gate registration

```js
{
  file: '.claude/skills/speckit-taskstoissues/SKILL.md',
  marker: 'scripts/backlog.mjs',
  why: 'fans tasks out to the Forgejo backlog through scripts/backlog.mjs; project-owned because Spec Kit 1.x has no core taskstoissues command',
}
```

`docs/runbooks/spec-kit.md` must name the file, or the gate fails with `inventory-stale`.
