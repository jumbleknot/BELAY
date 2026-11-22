# Spec Kit: this repository's customisations, and upgrading it

Spec-Driven Development (SDD) here runs on GitHub Spec Kit (the `specify` CLI and the
`/speckit-*` skills). This runbook is the **one list of every way the repository changes or adds
to Spec Kit**, and the procedure for upgrading Spec Kit without losing any of them.

- The rule that implementation needs a spec first, and the order of the `/speckit-*` commands,
  are in [AGENTS.md](../../AGENTS.md) and the constitution.
- The test task format the customisations enforce is in
  [docs/templates/feature-test-tasks-template.md](../templates/feature-test-tasks-template.md).

`scripts/check-speckit-overrides.mjs` enforces this list: it fails if a customisation below is
lost, or if one of Spec Kit's own files is edited without being added here.

## Running the gate

```bash
node scripts/check-speckit-overrides.mjs                            # scan: exit 0 clean, 1 drift, 2 bad arguments
node scripts/check-speckit-overrides.mjs --selftest                 # prove every failure code is detected
node --test scripts/__tests__/check-speckit-overrides.test.mjs      # the gate's own tests
pnpm nx run scripts:lint                                            # the gate and selftest, plus every other gate (what CI runs)
pnpm nx run scripts:test                                            # every script test, including the gate's
```

It needs only Node.js, with no dependencies to install and no network access. It reads the
PowerShell scripts as text and never runs them. The guardrails workflow runs the gate and its
selftest on every PR and every push to `main`, and branch protection requires that check (see
[ci.md](ci.md)). Still run it locally before any commit that touches `.specify/`,
`.claude/skills/speckit-*` or this runbook, so the PR doesn't go red on something you could have
caught.

## Who owns which file

Spec Kit **owns** every file listed in `.specify/integrations/*.manifest.json`: the `/speckit-*`
skills under `.claude/skills/`, the PowerShell scripts under `.specify/scripts/powershell/`, and
the core templates under `.specify/templates/`. An upgrade
(`specify integration upgrade claude --force`) rewrites each one with no warning that a local edit
is being lost.

Spec Kit also **owns** what `specify extension add <id>` installs: everything under
`.specify/extensions/<id>/`, `.specify/extensions/.registry`, `.specify/extensions.yml` and each
extension command's skill (`.claude/skills/speckit-<id>-<command>/`). None of these is in an
integration manifest. Reinstalling an extension (`--force`) rewrites `extensions.yml` from the
extension manifests, dropping any hook added by hand; it preserves existing extension config files.

The **project** owns everything else under `.specify/`: `templates/overrides/` and
`memory/constitution.md`. An upgrade leaves these alone.

So a change to Spec Kit's behaviour takes one of three forms, in order of preference:

1. **A project-owned file Spec Kit reads**: a template override or the constitution. It survives
   every upgrade.
2. **A registered local edit to a Spec Kit-owned file**: used only when nothing Spec Kit reads can
   carry the change. The upgrade overwrites it, and the gate fails until it is put back.
3. **Never** an edit to a core template. Use an override instead.

## The customisations

| # | What it changes | Where it lives | Form | How Spec Kit picks it up | Guard (failure codes) |
| --- | --- | --- | --- | --- | --- |
| 1 | Every `tasks.md` carries a **Doc-impact sweep** task in Phase 1 and a **Close-out re-search** task in Polish, and ends with an **Open the PR** task. That task runs the PR tools (`forge-pr.mjs open`, `ci-status.mjs watch`, `forge-pr.mjs merge --expect-head`; see [ci.md](ci.md)) and is ticked before CI runs: CI evidence goes in the PR's closing comment, never in `tasks.md`, so recording it costs no extra CI run | `.specify/templates/overrides/tasks-template.md` | Override (a fork of the core tasks template) | `Resolve-Template` / `Resolve-TemplateContent` in `common.ps1` check `overrides/` first | `override-missing`, `header-invalid`, `sweep-missing`, `core-changed`, `resolution-broken` |
| 2 | Tests are **required**, and every test task uses the **TDD checkpoint format**: scenarios covered, a **Verify RED** with the expected failure, and a paired implementation task with a **Verify GREEN** | Format and rules: `docs/templates/feature-test-tasks-template.md`. Mandated by the constitution ("Test-Driven Development", "TDD Checkpoint Format"). Shown in the User Story 1 sample of the override in row 1 | Override (in row 1's fork) plus the constitution | Same as row 1. The core template says tests are optional; the override replaces that | `tdd-format-missing` |
| 2a | The `/speckit-tasks` skill's own "Tests are OPTIONAL" rule is replaced with "Tests are REQUIRED" in the row 2 format. Without this edit the skill's instruction contradicts the override, and the agent reads both | `.claude/skills/speckit-tasks/SKILL.md` (Task Generation Rules) | Registered local edit to a Spec Kit-owned file | It is the skill itself | `local-edit-reverted`, `unregistered-edit`, `registry-stale` |
| 2b | `/speckit-converge` appends its **Convergence** tasks in the row 2 format: a test + implementation pair with **Verify RED** / **Verify GREEN** for any code gap, "Done when" for docs/config, and a **Doc-impact sweep** task for a gap that renames, moves or removes an identifier. Upstream writes one-line tasks that never see the override | `.claude/skills/speckit-converge/SKILL.md` (step 7, the append contract) | Registered local edit to a Spec Kit-owned file | It is the skill itself | `local-edit-reverted`, `unregistered-edit`, `registry-stale` |
| 3 | The governing principles every spec, plan and task list is checked against | `.specify/memory/constitution.md` | Project-owned | Every `/speckit-*` command reads it | none needed: upgrades do not touch it |
| 5 | Spec Kit extensions **git 1.0.5** (feature branch before `/speckit-specify`, optional commit offers around every command) and **agent-context 1.0.3** (refreshes the Spec Kit section of the agent context file after specify and plan) | `.specify/extensions/git/`, `.specify/extensions/agent-context/`, `.specify/extensions/.registry`, and the skills `.claude/skills/speckit-git-{feature,validate,remote,initialize,commit}/` and `.claude/skills/speckit-agent-context-update/` | Vendor files installed by `specify extension add` | Each `/speckit-*` skill reads `.specify/extensions.yml` and runs the registered hooks | `extension-lost`, `extension-unregistered`, `extension-changed` |
| 5a | The hooks the extensions register (20, two of them mandatory: `before_constitution` → `speckit.git.initialize` and `before_specify` → `speckit.git.feature`), **plus two hand-added hooks**: `before_converge` and `after_converge` → `speckit.git.commit` (optional), so `/speckit-converge` offers the same commits as every other command | `.specify/extensions.yml`; the expected list is `EXTENSION_HOOKS` in `scripts/check-speckit-overrides.mjs` (hand-added entries carry `local: true`) | Vendor file plus a registered local edit (the two converge hooks) | Read by every `/speckit-*` skill's hook checks | `hook-lost`, `hook-unregistered` |
| 5b | agent-context writes to **AGENTS.md**, never the `CLAUDE.md` shim | `.specify/extensions/agent-context/agent-context-config.yml` (`context_file: AGENTS.md`) | Project-owned (extension config: installed once, preserved on reinstall, in no manifest) | Read by `speckit.agent-context.update` | `project-file-lost` |
| 6 | `/speckit-taskstoissues` fans a feature's `tasks.md` out to the Forgejo backlog through `scripts/taskstoissues.mjs`, which drives `scripts/backlog.mjs`: a milestone per feature, one issue per task (deduplicated by task id), dependencies for ordering. Spec Kit 1.x has no core `taskstoissues` command, so the skill is the project's own | `.claude/skills/speckit-taskstoissues/SKILL.md` (forked from spec-kit 0.16.5 by way of MovieCollectionManager); runbook: [backlog.md](backlog.md) | Project-owned (in no manifest) | It is the skill itself | `project-file-lost`, `project-file-managed` |
| 4 | The CLI version this repository was initialised with | `speckit_version` in `.specify/init-options.json`; the version named in the Spec Kit section of [AGENTS.md](../../AGENTS.md) | Pins | n/a | none: keep the two equal by hand in the upgrade PR |

Rows 1, 2, 2a, 2b, 5, 5a and 5b are the ones an upgrade can break. The gate checks that this
table names `.specify/templates/overrides/tasks-template.md`,
`docs/templates/feature-test-tasks-template.md`, `.specify/extensions.yml`, every file in its
`LOCAL_EDITS` registry and every file in its `PROJECT_OWNED` list (`inventory-stale`).
`PROJECT_OWNED` holds files this repository keeps as its own that no manifest lists: today, the
agent-context config (row 5b) and `/speckit-taskstoissues` (row 6).

### Known gaps

- **`/speckit-constitution` checks the core tasks template**, not the override, when it checks
  dependent templates after an amendment. When amending the constitution, check the override too.
- **The scripts are PowerShell only.** The repository was initialised with `--script ps`. An
  environment without `pwsh` falls back to resolving the feature directory from
  `.specify/feature.json` by hand.
- **The gate does not check `git-config.yml`.** BELAY uses the git extension's shipped config
  unchanged (`auto_commit.default: false`, sequential branch numbers). If you customise it, add it
  to `PROJECT_OWNED` and add a row to the table above in the same PR.
- **The gate does not police hand edits to the agent-context config beyond its marker.** It checks
  that `context_file: AGENTS.md` is present, not that `context_files` (which takes precedence) is
  empty. Leave `context_files: []`.
- **Extension skills are checked for presence, not content.** Spec Kit records a hash only of each
  extension's `extension.yml`, so an edit to an extension's command skill is not detected.

## Adding a customisation

1. **Prefer a project-owned file.** To change a template, copy it to
   `.specify/templates/overrides/<name>.md` and edit the copy. A new override is a new fork, and
   only the tasks template's fork is guarded today, so extend the gate in the same PR.
2. **If you must edit a Spec Kit-owned file**, make the edit, then in the same PR:
   - add an entry to `LOCAL_EDITS` in `scripts/check-speckit-overrides.mjs`, with a `marker` (a
     string the local version carries and upstream does not) and a `why`;
   - add a row to the table above.

   A file Spec Kit has stopped managing goes in `PROJECT_OWNED` instead. The gate checks that it
   still exists, still carries its marker, and is not listed in a manifest again.

   Until both are done the gate fails `unregistered-edit` or `inventory-stale`.
3. Run the gate and its tests (see [Running the gate](#running-the-gate)).

## Upgrading Spec Kit

The override in row 1 is a **fork** of the core tasks template. After an upgrade, the core template
may have improved while `/speckit-tasks` keeps using the old copy without saying so. The registered
local edits in rows 2a and 2b are simply overwritten. The gate turns both into a red check. The
override's first line records the fork point:

```text
<!-- forked-from: .specify/templates/tasks-template.md sha256=<hash> spec-kit=<version> -->
```

The procedure, all in one PR:

1. **Run the upgrade.** Install the new CLI release (`uv tool install specify-cli --force` with the
   new version), then run `specify integration upgrade claude --force`. It rewrites the files
   listed in `.specify/integrations/*.manifest.json`, but not `overrides/` or the constitution. It
   also **deletes** any file a previous manifest listed that the new one does not. Bump the two
   version pins in row 4 to the same release.
2. **Run the gate**: `node scripts/check-speckit-overrides.mjs`. Expect:
   - `local-edit-reverted` for each row 2a or 2b file the upgrade overwrote. Re-apply the edit from
     git (`git diff HEAD -- <file>` shows what was lost), merging in anything upstream added. Row
     2a is one paragraph: put the "Tests are REQUIRED" text back in place of upstream's "Tests are
     OPTIONAL". Row 2b is the "Convergence tasks follow the project's task format" block in step 7.
   - `core-changed` if the upgrade touched the core tasks template. The failure prints the core
     template's diff since the fork base, found by hash in git history. In a shallow clone it says
     history is unavailable and still fails; compare the two files by hand.
   - `project-file-lost` if the upgrade deleted a project-owned file. Restore it with
     `git checkout HEAD -- <file>`, then carry over any upstream wording worth keeping by hand.
   - `registry-stale` if Spec Kit stopped managing a `LOCAL_EDITS` file. Restore it as above and
     move its entry from `LOCAL_EDITS` to `PROJECT_OWNED`.

   You do not need to hunt for local edits before `--force`: the gate compares every managed file
   against its manifest hash, accepting both LF and CRLF, so a Windows checkout's line endings are
   not counted as edits.
2a. **Reinstall the extensions** (rows 5, 5a, 5b): `specify extension add git --force`, then
   `specify extension add agent-context --force`, then run the gate again. A reinstall rewrites
   `.specify/extensions.yml` and `.specify/extensions/.registry` from the extension manifests and
   **preserves** existing config files such as `agent-context-config.yml` (checked 2026-11-22 with
   git 1.0.5 and agent-context 1.0.3). Expect:
   - `hook-lost` for `before_converge` and `after_converge`, which the reinstall drops. Re-add the
     two entries at the end of `hooks:`, as in row 5a (`git diff HEAD -- .specify/extensions.yml`
     shows them).
   - `extension-changed` if the new CLI bundles a newer extension. Update its `version` in
     `EXTENSIONS` and row 5, and check its hooks.
   - `hook-unregistered` or `hook-lost` if the new version adds, drops or changes a hook. Update
     `EXTENSION_HOOKS` and row 5a to match the installed file, after reading why upstream changed it.
   - `project-file-lost` for `agent-context-config.yml` if a future version stops preserving
     config. Restore it with `git checkout HEAD -- <file>`.
3. **Merge the upstream change into the override.** Keep the **Doc-impact sweep**,
   **Close-out re-search** and **Open the PR** tasks, the User Story 1 test pair with its
   **Verify RED** / **Verify GREEN** fields and the pointer to
   `docs/templates/feature-test-tasks-template.md`, and the `EXCEPTION` note in the sample-task
   comment.
4. **Record**: `node scripts/check-speckit-overrides.mjs --record`. Never hand-type the hash. The
   gate refuses to record an override that has lost the sweep task or the TDD sample.
5. **Re-run the gate** (expect ✓) and its tests.
6. **Re-read the known gaps above.** An upgrade can close one, or open a new one.

### Failure codes

| Code | Meaning | Fix |
| --- | --- | --- |
| `core-changed` | The core tasks template no longer matches the override's fork point | Merge the change into the override, then `--record` |
| `override-missing` | The override file is gone | Restore it from git, then `--record` |
| `header-invalid` | Line 1 is not a fork point | `--record` rewrites it |
| `sweep-missing` | No task line carries `**Doc-impact sweep**` | Restore the task. `--record` refuses until you do |
| `tdd-format-missing` | The override lost `**Verify RED**`, `**Verify GREEN**` or its pointer to `docs/templates/feature-test-tasks-template.md` | Restore the User Story 1 test pair. `--record` refuses until you do |
| `resolution-broken` | `setup-tasks.ps1` no longer calls `Resolve-Template` (the path, `TASKS_TEMPLATE`) and `Resolve-TemplateContent` (the content, `TASKS_TEMPLATE_CONTENT`, which `/speckit-tasks` prefers) for `tasks-template`, or either no longer checks `overrides/` first. A bare `return $null` before the check (template-name validation) is allowed | Spec Kit changed how it resolves templates. Re-evaluate where the override must live (a preset, or composition), then update the guard at the cause. **Never delete the guard** to make it pass |
| `local-edit-reverted` | A registered local edit is gone: the file matches its upstream manifest hash again, or lost its marker | Re-apply the edit from git history |
| `unregistered-edit` | A Spec Kit-owned file differs from its manifest hash and is not in `LOCAL_EDITS` | Register it (see "Adding a customisation"), or restore the upstream file |
| `registry-stale` | A `LOCAL_EDITS` file is no longer listed in any manifest, so Spec Kit no longer manages it | To keep the file, move the entry to `PROJECT_OWNED` and update its row. If it is no longer needed, drop the entry and the row |
| `project-file-lost` | A `PROJECT_OWNED` file is missing or lost its marker. An upgrade deletes files that drop out of its manifest | Restore it from git history |
| `project-file-managed` | A `PROJECT_OWNED` file is listed in a manifest again, so the next `--force` upgrade overwrites it | Move the entry back to `LOCAL_EDITS`, or rename the project file so the paths no longer collide |
| `hook-lost` | A hook in `EXTENSION_HOOKS` is missing from `.specify/extensions.yml`, is disabled, or has its `optional` flag changed. After an extension reinstall this is expected for the hand-added `converge` hooks (row 5a) | Re-add the hook in the installer's format, as listed in row 5a. If upstream changed a hook on purpose, update `EXTENSION_HOOKS` and row 5a |
| `hook-unregistered` | `.specify/extensions.yml` has a hook that `EXTENSION_HOOKS` does not list, usually a new hook from an extension upgrade | Register it in `EXTENSION_HOOKS` and row 5a, or remove it |
| `extension-lost` | A registered extension is missing from `.specify/extensions/.registry` or disabled there, its `extension.yml` or one of its command skills is gone, or `.registry` / `extensions.yml` is missing or unreadable | `specify extension add <id> --force`, re-add the hand-added hooks (row 5a), then re-run the gate |
| `extension-unregistered` | `.registry` lists an extension that `EXTENSIONS` does not | Register it in `EXTENSIONS`, `EXTENSION_HOOKS` and the table, or `specify extension remove <id>` |
| `extension-changed` | An extension's `extension.yml` no longer matches the `manifest_hash` recorded at install, or its version differs from `EXTENSIONS` | After an upgrade, update `EXTENSIONS` / `EXTENSION_HOOKS` and row 5. Otherwise restore the vendor file from git |
| `inventory-stale` | This runbook is missing, or does not name a guarded customisation | Add the row to the table above |
