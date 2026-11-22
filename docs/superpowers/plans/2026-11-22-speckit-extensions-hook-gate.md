# Spec Kit extensions and hook gate (Step 0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install Spec Kit's `git` and `agent-context` extensions in BELAY and extend `scripts/check-speckit-overrides.mjs` so that losing or altering their hooks, skills or config fails the gate.

**Architecture:**
- The gate gains a registry of the extensions it expects, plus a registry of the hooks it expects.
- It checks them against three things: `.specify/extensions.yml` (read by a small parser written for Spec Kit's generated layout, with no `yaml` dependency), `.specify/extensions/.registry` (JSON) and the installed files.
- Extension config edits are registered as project-owned files, using the existing `PROJECT_OWNED` mechanism.

**Tech Stack:** Node 24+ ESM, `node:test`, Spec Kit 1.4.2 CLI (`specify extension add`), PowerShell scripts integration.

**Spec:** [docs/superpowers/specs/2026-11-22-speckit-forgejo-parity-design.md](../specs/2026-11-22-speckit-forgejo-parity-design.md), section "Step 0". Features 001–003 in that design are **not** part of this plan. Each one goes through `/speckit-specify` → `/speckit-plan` → `/speckit-tasks` after this plan lands.

## Global Constraints

- Node built-ins only. No `package.json`, no `yaml` package.
- **Never edit a Spec Kit-owned file without registering it.** Spec Kit owns files listed in `.specify/integrations/*.manifest.json` and files written by `specify extension add`. Register each edit in `scripts/check-speckit-overrides.mjs` and in `docs/runbooks/spec-kit.md` in the same change.
- **The agent-context extension writes to `AGENTS.md`, never `CLAUDE.md`.** `CLAUDE.md` is a shim.
- **Bundled versions:** git **1.0.5**, agent-context **1.0.3**. Spec Kit 1.4.2's `core_pack` bundles these, and MCM has the same. Record whatever `.registry` actually shows.
- `.registry` `manifest_hash` is `sha256:` + the sha256 of the raw bytes of `.specify/extensions/<id>/extension.yml`. This was verified: git's bundled file hashes to `57082e8d…0aa`, the same value in MCM's `.registry`.
- **Restore files with `git checkout -- <path>`, never with a PowerShell 5.1 text round-trip.** `Get-Content -Raw` corrupts UTF-8.
- **Exit codes stay:** 0 clean, 1 drift, 2 bad arguments.
- **Existing failure codes and behaviour must not change.** Existing tests keep passing unchanged, apart from fixture defaults.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. This plan lands directly on `main`, the last change to do so before CI and branch protection. Push only after the user confirms.

## Review Focus

1. **Spec Kit rewrites `extensions.yml` in a different key or hook order on reinstall.** The check must match hooks regardless of order. → Task 2 test `hook check ignores ordering`.
2. **A hook entry with no `enabled` field.** Spec Kit treats a missing `enabled` as enabled, so the check must treat it as enabled too, not as lost. → Task 1 test `missing enabled defaults to true`.
3. **CRLF line endings in `extensions.yml`** after a Windows checkout or editor save. The parser must accept `\r\n`. → Task 1 test `parses CRLF input`.
4. **The real tree's own `PROJECT_OWNED` entries are now non-empty.** The fixture helper and selftest must create them, or every existing test breaks. → Task 2 step "run the existing suite unchanged".
5. **A `.registry` that is missing or holds invalid JSON** after an aborted install. It must be reported as `extension-lost` with a readable message, not a crash. → Task 2 test `unreadable .registry reports extension-lost`.

---

## File structure

| File | Change | Responsibility |
| --- | --- | --- |
| `scripts/lib/extensions-yml.mjs` | Create | `parseExtensionsYml(text)`: the parser for Spec Kit's generated `extensions.yml` |
| `scripts/__tests__/extensions-yml.test.mjs` | Create | Parser tests |
| `scripts/check-speckit-overrides.mjs` | Modify | `EXTENSIONS`, `EXTENSION_HOOKS`, `extensionFixtureFiles()`, the extension and hook checks, the selftest scenarios, the scan summary line |
| `scripts/__tests__/check-speckit-overrides.test.mjs` | Modify | The fixture writes the extension tree by default; new tests for the five new codes |
| `.gitattributes` | Modify | `.specify/extensions/**/*.ps1 text eol=lf` |
| `.specify/extensions/**`, `.specify/extensions.yml`, `.claude/skills/speckit-git-*`, `.claude/skills/speckit-agent-context-update` | Create (installer) | Vendor files |
| `.specify/extensions/agent-context/agent-context-config.yml` | Modify (project-owned) | `context_file: AGENTS.md` |
| `.specify/extensions.yml` | Modify (registered local edit) | Add the `before_converge` and `after_converge` `git.commit` hooks |
| `docs/runbooks/spec-kit.md` | Modify | Inventory rows, failure codes, upgrade procedure, known gaps |
| `AGENTS.md` | Modify | Extensions bullet |

---

### Task 1: `extensions.yml` parser

**Files:**
- Create: `scripts/lib/extensions-yml.mjs`
- Test: `scripts/__tests__/extensions-yml.test.mjs`

**Interfaces:**
- Produces: `parseExtensionsYml(text: string) => { installed: string[], hooks: Record<string, Array<{ extension: string, command: string, enabled: boolean, optional: boolean }>> }`. It throws `Error` with a message that starts `extensions.yml:` and gives the line number when a line doesn't fit the layout.

The layout it accepts is exactly what Spec Kit writes:
- Top-level keys: `installed:`, `settings:` and `hooks:`.
- `installed:` is a list of `- <id>` items.
- Under `hooks:`, each two-space-indented `<event>:` key holds a list of `- extension: …` maps whose fields are indented four spaces.
- Scalars may be quoted or bare. The values `true`, `false` and `null` are recognised.
- Unknown fields such as `priority`, `prompt`, `description` and `condition` are ignored.
- `settings:` is skipped.

- [ ] **Step 1: Write the failing tests** in `scripts/__tests__/extensions-yml.test.mjs`:
  - `parses installed list and hooks`: parse a sample with `installed: [agent-context, git]` and two events, `before_specify` with one mandatory hook and `after_plan` with two hooks. Assert:
    - `installed` deep-equals `['agent-context','git']`;
    - `hooks.before_specify` deep-equals `[{extension:'git',command:'speckit.git.feature',enabled:true,optional:false}]`;
    - `hooks.after_plan.length === 2`.
  - `missing enabled defaults to true`: a hook with no `enabled:` line parses as `enabled: true`.
  - `parses CRLF input`: the same sample with `\r\n` line endings gives deep-equal output.
  - `quoted scalars`: `command: "speckit.git.commit"` and `optional: 'true'` give the string unquoted and the boolean `true`.
  - `rejects a hook item outside hooks`: a `- extension: x` item placed under `settings:` makes the parser throw an error matching `/^extensions\.yml:\d+/`.
  - `empty hooks`: the input `installed: []\nhooks: {}\n` gives `{installed: [], hooks: {}}`.

- [ ] **Step 2: Run and confirm the tests fail.**
  Run: `node --test scripts/__tests__/extensions-yml.test.mjs`
  Expected: FAIL with `Cannot find module` for `../lib/extensions-yml.mjs`.

- [ ] **Step 3: Implement `parseExtensionsYml` in `scripts/lib/extensions-yml.mjs`.**
  - It's a line-by-line state machine keyed on indentation: 0 for top-level keys, 2 for event or list items, 4 for map fields.
  - Strip a trailing `\r` from each line. Skip blank lines and `#` comment lines.
  - Accept `[]` and `{}` as empty inline values.

- [ ] **Step 4: Run and confirm the tests pass.**
  Run: `node --test scripts/__tests__/extensions-yml.test.mjs`
  Expected: PASS (6 tests).

- [ ] **Step 5: Commit**
  ```bash
  git add scripts/lib/extensions-yml.mjs scripts/__tests__/extensions-yml.test.mjs
  git commit -m "Add a dependency-free parser for Spec Kit extensions.yml"
  ```

---

### Task 2: Extension and hook checks in the gate

**Files:**
- Modify: `scripts/check-speckit-overrides.mjs`
- Test: `scripts/__tests__/check-speckit-overrides.test.mjs`

**Interfaces:**
- Consumes: `parseExtensionsYml` from Task 1.
- Produces, all exported from `scripts/check-speckit-overrides.mjs`:
  - `EXTENSIONS: Array<{ id: string, version: string, commands: string[] }>`. Starts as `[]` in this task; Task 3 fills it.
  - `EXTENSION_HOOKS: Array<{ event: string, extension: string, command: string, optional: boolean, local?: true }>`. Starts as `[]`; Task 3 fills it. `local: true` marks a hook BELAY added by hand.
  - `EXTENSIONS_YML = '.specify/extensions.yml'` and `EXTENSIONS_REGISTRY = '.specify/extensions/.registry'`.
  - `skillFileFor(command: string) => string`, mapping `speckit.git.feature` to `.claude/skills/speckit-git-feature/SKILL.md`. It replaces `.` with `-`.
  - `extensionFixtureFiles({ extensions, hooks }) => Record<string, string>`. It returns a clean tree for the given registries: `extensions.yml`, `.registry` (with correct `manifest_hash` values and `enabled: true`), each `.specify/extensions/<id>/extension.yml`, and each command's `SKILL.md`. Both the selftest and the tests use it.
  - `checkSpeckitOverrides({ root, localEdits, projectOwned, extensions = EXTENSIONS, extensionHooks = EXTENSION_HOOKS })`, which gains the last two options.
- New failure codes, each with a message naming the file and the fix:

| Code | Raised when |
| --- | --- |
| `hook-lost` | A registered hook is absent from `extensions.yml`, has `enabled: false`, or its `optional` value differs. |
| `hook-unregistered` | An `extensions.yml` hook matches no registry entry. An entry matches on event, extension and command. |
| `extension-lost` | A registered extension is missing from `.registry`, has `enabled: false`, or lacks its `.specify/extensions/<id>/extension.yml`. Also raised when one of its commands has no `SKILL.md`, or when `.registry` or `extensions.yml` is missing or can't be parsed. |
| `extension-unregistered` | `.registry` lists an id that isn't in `EXTENSIONS`. |
| `extension-changed` | The sha256 of `extension.yml` doesn't match the `.registry` `manifest_hash`, or the `.registry` version doesn't match `EXTENSIONS[].version`. |

- All five checks are skipped when both registries are empty, so the gate behaves exactly as it does today.
- When `extensionHooks` is non-empty, the inventory check also requires `INVENTORY` to mention `.specify/extensions.yml`. A miss is reported as `inventory-stale`.

- [ ] **Step 1: Write the failing tests.**
  - Change the existing `fixture()` so that, by default, it writes `extensionFixtureFiles({ extensions: EXTENSIONS, hooks: EXTENSION_HOOKS })`, as it already does for `PROJECT_OWNED`. Add `extensions` and `hooks` parameters so a test can pass its own registries.
  - Add tests that use a two-extension test registry: `ext-a` with commands `speckit.ext-a.run` and `speckit.ext-a.go`, and `ext-b`. Its hooks are `before_specify` (`ext-a`, `speckit.ext-a.run`, mandatory) and `after_plan` (`ext-b`, optional, `local: true`). Each test asserts `codes(r)`:
    - `clean extension tree passes` → `[]`
    - `hook check ignores ordering` (`extensions.yml` written with events and installed ids reversed) → `[]`
    - `hook removed → hook-lost`
    - `hook disabled → hook-lost`
    - `hook optional flipped → hook-lost`
    - `extra hook → hook-unregistered`
    - `.registry missing ext-b → extension-lost`
    - `unreadable .registry reports extension-lost` (body `{not json`)
    - `command skill missing → extension-lost`
    - `extra installed id → extension-unregistered`
    - `extension.yml edited → extension-changed`
    - `version bumped in .registry → extension-changed`
    - `inventory lacks extensions.yml → inventory-stale`
    - `empty registries skip extension checks` (no extension files at all) → `[]`
  - Add `skillFileFor maps dots to dashes`.

- [ ] **Step 2: Run and confirm the new tests fail, while the existing ones still pass.**
  Run: `node --test scripts/__tests__/check-speckit-overrides.test.mjs`
  Expected: the new tests FAIL, because the exports are undefined. The original 44 PASS.

- [ ] **Step 3: Implement** the exports and checks listed above. Then extend `selftest()`:
  - `clean` includes `extensionFixtureFiles` for a selftest registry. Use the real one when it's non-empty, otherwise a one-extension, one-hook fallback, following the `SELFTEST_OWNED` pattern.
  - Add one scenario per new code.
  - Update the `--selftest` success line to list the new codes.
  - Update `scan()`'s success line to add `N extension(s) and M hook(s) registered and intact`.

- [ ] **Step 4: Run and confirm everything passes.**
  Run: `node --test scripts/__tests__/check-speckit-overrides.test.mjs scripts/__tests__/extensions-yml.test.mjs && node scripts/check-speckit-overrides.mjs --selftest && node scripts/check-speckit-overrides.mjs`
  Expected: all tests PASS. The selftest passes and lists the 5 new codes. The scan passes and reports 0 extensions, because the registries are still empty.

- [ ] **Step 5: Commit**
  ```bash
  git add scripts/check-speckit-overrides.mjs scripts/__tests__/check-speckit-overrides.test.mjs
  git commit -m "Gate: detect lost, unregistered or changed Spec Kit extension hooks"
  ```

---

### Task 3: Install the extensions and register them

**Files:**
- Modify: `.gitattributes`
- Create (installer): `.specify/extensions/{git,agent-context}/**`, `.specify/extensions/.registry`, `.specify/extensions.yml`, `.claude/skills/speckit-git-{feature,validate,remote,initialize,commit}/SKILL.md`, `.claude/skills/speckit-agent-context-update/SKILL.md`
- Modify: `.specify/extensions/agent-context/agent-context-config.yml`, `.specify/extensions.yml`, `scripts/check-speckit-overrides.mjs` (registries), `docs/runbooks/spec-kit.md`

**Interfaces:**
- Consumes: `EXTENSIONS` and `EXTENSION_HOOKS` (Task 2) and the existing `PROJECT_OWNED` and `LOCAL_EDITS`.
- Produces: the real registries, which Task 4's reinstall trial relies on.

- [ ] **Step 1: Write the failing check.**
  Add `.specify/extensions/**/*.ps1 text eol=lf` to `.gitattributes`, under the existing `.specify/scripts/**/*.ps1` rule. Use the same comment, so the installer's LF bytes are kept and match its hashes. Then fill the registries before installing, from the bundled manifests at `$(uv tool dir)/specify-cli/Lib/site-packages/specify_cli/core_pack/extensions/{git,agent-context}/extension.yml`:
  - `EXTENSIONS`:
    - `{ id: 'git', version: '1.0.5', commands: ['speckit.git.feature','speckit.git.validate','speckit.git.remote','speckit.git.initialize','speckit.git.commit'] }`
    - `{ id: 'agent-context', version: '1.0.3', commands: ['speckit.agent-context.update'] }`
  - `EXTENSION_HOOKS`: 21 vendor entries plus 2 local ones.
    - git, all with command `speckit.git.commit` and `optional: true` unless stated:
      - `before_constitution`: `speckit.git.initialize`, `optional: false`
      - `before_specify`: `speckit.git.feature`, `optional: false`
      - before: `clarify`, `plan`, `tasks`, `implement`, `checklist`, `analyze`, `taskstoissues`
      - after: `constitution`, `specify`, `clarify`, `plan`, `tasks`, `implement`, `checklist`, `analyze`, `taskstoissues`
    - agent-context: `after_specify` and `after_plan`, both `speckit.agent-context.update`, `optional: true`.
    - Local: `before_converge` and `after_converge`, both git, `speckit.git.commit`, `optional: true`, `local: true`.
  - `PROJECT_OWNED`: add `{ file: '.specify/extensions/agent-context/agent-context-config.yml', marker: 'context_file: AGENTS.md', why: 'agent-context must write to AGENTS.md; CLAUDE.md is a shim that imports it' }`.

- [ ] **Step 2: Run the gate and confirm it fails** because nothing is installed yet.
  Run: `node scripts/check-speckit-overrides.mjs`
  Expected: exit 1, with `extension-lost` for both extensions, `hook-lost` for the hooks, `project-file-lost` for the config, and `inventory-stale`.

- [ ] **Step 3: Install and configure.**
  1. Run `specify extension add git` and then `specify extension add agent-context`.
  2. Confirm `.specify/extensions/.registry` shows versions 1.0.5 and 1.0.3. If it shows something else, set `EXTENSIONS[].version` to what it shows and note it for the runbook.
  3. Compare the installed `extensions.yml` hooks with `EXTENSION_HOOKS`. Any difference means the bundled manifest differs from the list above, so fix the registry to match the installed file.
  4. In `agent-context-config.yml`, set `context_file: AGENTS.md` and change nothing else.
  5. Append the `before_converge` and `after_converge` entries to `extensions.yml` in the installer's own format:
     ```
     extension: git
     command: speckit.git.commit
     enabled: true
     optional: true
     priority: 10
     prompt: Commit converge changes?
     description: …
     condition: null
     ```
  6. Leave `git-config.yml` untouched. Its bundled `auto_commit.default` is already `false`.
  7. Update `docs/runbooks/spec-kit.md`:
     - Add customisation rows for the two extensions (with versions), the `extensions.yml` hook registry including the two local converge hooks, and the `agent-context-config.yml` project-owned file. Each row names its file path, so the inventory check passes.
     - Add the five new codes to the failure-codes table.
     - Remove the "no extensions installed" known gap.
  8. Run `git status` and review every changed path. Nothing under `.specify/integrations/` or `.specify/templates/` should have changed. If anything did, stop and report it.

- [ ] **Step 4: Run and confirm everything passes.**
  Run: `node scripts/check-speckit-overrides.mjs && node scripts/check-speckit-overrides.mjs --selftest && node --test scripts/__tests__/check-speckit-overrides.test.mjs scripts/__tests__/extensions-yml.test.mjs`
  Expected:
  - The scan passes with `2 extension(s) and 23 hook(s) registered and intact` and `1 project-owned file(s)`.
  - The selftest passes.
  - All tests pass.

  Also run `git ls-files --eol .specify/extensions | grep -v 'i/lf'` and expect no output: every file is stored as LF.

- [ ] **Step 5: Commit**
  ```bash
  git add .gitattributes .specify/extensions .specify/extensions.yml .claude/skills/speckit-git-* .claude/skills/speckit-agent-context-update scripts/check-speckit-overrides.mjs docs/runbooks/spec-kit.md
  git commit -m "Install Spec Kit git and agent-context extensions and register their hooks"
  ```

---

### Task 4: Reinstall trial, upgrade procedure and AGENTS.md

**Files:**
- Modify: `docs/runbooks/spec-kit.md` (upgrade procedure, known gaps), `AGENTS.md`

**Interfaces:**
- Consumes: the installed tree and the registries from Task 3.

- [ ] **Step 1: Run the trial** that proves the gate catches what an upgrade breaks.
  Run: `specify extension add git --force && specify extension add agent-context --force; node scripts/check-speckit-overrides.mjs; echo "exit=$?"`
  Expected: exit 1, with `hook-unregistered`/`hook-lost` for `before_converge` and `after_converge` at minimum. Record exactly which codes fire, and whether `agent-context-config.yml` and `git-config.yml` were overwritten (a `project-file-lost` means the config was reset).

- [ ] **Step 2: Restore and confirm the gate passes again.**
  Run: `git checkout -- .specify .claude/skills && git status --short && node scripts/check-speckit-overrides.mjs`
  Expected: a clean `git status` and the gate passes.

- [ ] **Step 3: Update the docs.**
  - **Runbook upgrade procedure:** add a step after the integration upgrade: `specify extension add git --force`, then `specify extension add agent-context --force`, then run the gate. Each code it raises shows what to redo. Using Step 1's recorded results, list what the reinstall overwrites: the converge hooks, and the config if Step 1 showed it.
  - **Runbook known gap:** the gate doesn't check `git-config.yml` because BELAY doesn't customise it. If a future edit customises it, register that edit.
  - **AGENTS.md** Spec Kit section: add one bullet saying the `git` and `agent-context` extensions are installed. `/speckit-specify` now creates the feature branch through the mandatory `before_specify` hook, and agent-context maintains the `<!-- SPECKIT START -->` section in AGENTS.md. Never edit inside that section by hand.

- [ ] **Step 4: Verify.**
  Run: `node scripts/check-speckit-overrides.mjs && node --test scripts/__tests__/check-speckit-overrides.test.mjs scripts/__tests__/extensions-yml.test.mjs`
  Expected: the gate passes and all tests pass. The inventory check still passes after the runbook edits.

- [ ] **Step 5: Commit, then ask the user before pushing to `main`.**
  ```bash
  git add docs/runbooks/spec-kit.md AGENTS.md
  git commit -m "Document Spec Kit extension upgrades and the hook gate"
  ```

---

## After this plan

Start feature 001 (guardrails CI) with `/speckit-specify`, which now runs `speckit.git.feature` to create its branch. Use the design's "Feature 001" section as the input.
