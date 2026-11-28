# Research: PDLC spec intake

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) · **Date**: 2026-11-27

Builds on [feature 014's research](../014-pdlc-proposal-intake/research.md) (R1 to R19). Its measurements still hold
and are not repeated here. **Read** means taken from this repository's code on 2026-11-27. **Unverified** means not yet
observed; each such item is measured by an early task before the design depends on it, and the runbook records what
was observed, not what was assumed.

## Decisions taken by the maintainer

| # | Question | Answer |
| --- | --- | --- |
| M5 | Publishing branches needs repository write. Widen the `pdlc` token, or add a second one? | **Widen the `pdlc` token** to `write:issue` + `write:repository`. A second token would sit in the same process and the same settings file, so splitting buys little. The server's push guard (R6) and the default branch's protection are the two bounds (2026-11-27) |
| M6 | Which credential moves the issue to merged in CI? | **The run token if it can comment on and close an issue in its own repository, otherwise `CI_DIGEST_TOKEN`** (already `write:issue`). Measured first (R11) (2026-11-27) |
| M7 | How is the pane editor built? | **One hand-written, self-contained HTML file, no new dependency and no build step** (R9) (2026-11-27) |
| M9 | `pdlc:integration` runs the real Spec Kit PowerShell scripts. The CI runner image (`node:26-bookworm`) is not known to have `pwsh`, and adding it is a new toolchain on the runner | **Open.** Options: (a) install a pinned, checksum-verified `pwsh` in the `guardrails` job (needs the maintainer's yes, per AGENTS.md); (b) run the script-executing integration tests only in a new operator-run tier, keeping the CI tier to real git without scripts. The plan assumes (a) until answered, and the first measuring task checks whether the runner already has it. **Measured 2026-11-27 (T008)**: `docker run --rm node:26-bookworm` from the dev container (image digest `sha256:893ea481…82255`, Node v26.13.1, Debian 12): `command -v pwsh` and `command -v powershell` both **absent**. This is the image the `belay` runner label maps to (`guardrails.yml` header), not a job on the live runner; the dev container itself has `pwsh` 7.6.5. **Answered 2026-11-27: (a).** `guardrails` installs a version-pinned, sha256-verified `pwsh` before `pdlc:integration`, through `scripts/install-pwsh.mjs` on the `install-trivy.mjs` pattern (the pin and its sha256 in one place, read once from the publisher; Renovate tracks it under `PowerShell/PowerShell` with the dev container's `POWERSHELL_VERSION`, so both move together; `refresh-pin-checksum.mjs` moves the sha256). Pin 7.7.0, the dev container Dockerfile's version (the running container reports 7.6.5: its image predates that bump). The maintainer judged the image measurement sufficient; no live-runner job was run |
| M10 | How are the feature's tests counted at merge without lengthening CI? (Raised at ADR-0006 review: MCM's suite alone takes 30+ minutes, so R12's second test run per merge is too expensive) | **No second test run** (2026-11-27). "Created" = `count-repo-metrics.mjs` test declarations at the merge commit minus its first parent, read from git objects in CI. Outcomes = the merged commit's own `guardrails` run, **whole suite** per target, posted by that run. The tasks template gains a baseline task (Phase 1) and a count task (just before the PR), each commenting on the proposal issue when there is one. With no proposal, nothing is posted and nothing fails. A failed issue update in a template task **warns and implementation continues** (R12) |
| M8 | Approve the amendments to feature 014's decisions (spec Context table) | **Approved** (2026-11-27): "ADR-0006 approved, proceed", with M10 included. Recorded in **ADR-0006**, which supersedes the affected parts of ADR-0005. FR-034 orders it before any server code |

## R1: How a Claude Desktop session runs the repository's own specify and clarify steps (spec FR-002, FR-006, FR-028)

**Read**: Spec Kit's specify and clarify steps are prompts (`.claude/skills/speckit-specify/SKILL.md`,
`.claude/skills/speckit-clarify/SKILL.md`) plus a few scripts. The specify prompt resolves the template with
`.specify/scripts/powershell/resolve-template.ps1 spec-template -Json`. Its `before_specify` hook
(`speckit.git.feature`) runs `.specify/extensions/git/scripts/powershell/create-new-feature-branch.ps1`, which
computes the number and branch name and then runs `git checkout -b`.

**Decision**: the Claude Desktop model **follows the target repository's own specify and clarify prompts**, read from
the local copy, as Claude Code does. Each step that has to be right every time is a server tool:

| Step in the prompt | Who does it |
| --- | --- |
| Number and branch name (`before_specify` hook) | The server runs the repository's own branch script **with `-DryRun -Json`**. That computes `BRANCH_NAME` and `FEATURE_NUM` and creates nothing (read: lines 483 to 492, 589 to 600). The server then creates the branch itself, through its git allowlist (R4) |
| Template | The server runs the repository's `resolve-template` script and returns `TEMPLATE_CONTENT`. The script only reads |
| Writing `spec.md` and `checklists/requirements.md` | The model writes them, through a path-guarded server tool (R5) |
| Clarification questions and the `## Clarifications` record | The model follows the clarify prompt; the author answers in the chat; the model writes through the same tool |
| `after_specify` hooks | R3 |

So the repository's numbering, naming template, template overrides, presets and prompt wording all apply, and a Spec
Kit upgrade in the target repository changes the Claude Desktop route with no change to BELAY.

**Scripts run only in a disposable scratch clone** (constitution, Operator-Tool MCP Servers: every write is checked
by an allowlist *before* it is attempted). A dry run is designed not to write, but that is the script's promise, not
a check. So the server never runs repository code in the local copy or a worktree. For each script call it:

1. fetches every remote head into the copy's `refs/remotes/origin/*` (blobless, so it is cheap), with the credential,
   through its own git runner;
2. makes a scratch clone at `<clone_root>/.pdlc-scratch/<Repo>-<random>/` with
   `clone --shared --no-checkout <copy path> <scratch>`. Its `origin` is the **local path**, so nothing in it can
   reach the forge, and it holds no credential;
3. copies the remote-tracking refs into it with `fetch <copy path> +refs/remotes/origin/*:refs/remotes/origin/*`,
   so the script's `git branch -a` scan sees every forge branch;
4. runs `checkout --detach origin/<default>` in the scratch clone;
5. runs the script there, with **no** `GIT_CONFIG_*` authentication in its environment. Its
   `git ls-remote --heads origin` reaches only the local copy. That is also what keeps numbering right for a spec
   branch that exists only on this workstation: the copy's local branches (created by `worktree add -b`) are its
   heads, so the dry run sees them (read from the script, 2026-11-27: `Get-HighestNumberFromRemoteRefs`);
6. reads the JSON output, then deletes the scratch folder.

The only place the script can write is the scratch folder, and the scratch folder is an allowlisted write target
(R5). Nothing it does can reach the copy, a worktree or the forge. The copy's objects are shared read-only through
`alternates`: git writes new objects into the scratch clone's own store, never into the copy's. This prevents the
number clash this feature itself hit: number 015 was taken on the forge by another session's branch.

**Script flavour**: `.specify/init-options.json` `script` chooses the interpreter. For `ps`, the server runs `pwsh` if
it is on `PATH`, otherwise Windows PowerShell (`powershell.exe`). For `sh`, it runs Git for Windows' `bash.exe`. Every
call is `execFile` with an argument array and a fixed script path inside the copy, never a shell string.

**Unverified, measured on the host first** (task "measure spec-kit scripts on the workstation"):
1. Whether `pwsh` is installed on the workstation, and whether both scripts run under Windows PowerShell 5.1 if it is
   not.
2. That the dry run gives the same `BRANCH_NAME` as a real run from Claude Code in the dev container, for the same
   copy and description.

**Measured in the dev container, 2026-11-27 (T004, dev-container half)**: a fresh blobless clone of BELAY from the
forge at `9350235`, whose `git ls-remote --heads origin` listed `main`, `015-self-healing-dependency-bot` and
`chore-92-own-runners`. With `pwsh` 7.6.5:
- `create-new-feature-branch.ps1 -Json -DryRun -ShortName pane-probe "Pane probe for feature 016"` →
  `{"BRANCH_NAME":"016-pane-probe","FEATURE_NUM":"016","DRY_RUN":true}`;
- the same without `-DryRun` (a real run, in that throwaway clone only, never pushed) →
  `{"BRANCH_NAME":"016-pane-probe","FEATURE_NUM":"016"}`, and the clone was left on branch `016-pane-probe`;
- `resolve-template.ps1 spec-template -Json` → keys `TEMPLATE_NAME`, `TEMPLATE_CONTENT` (4556 characters, starting
  `# Feature Specification: [FEATURE NAME]`).

The number is `016` because this feature's own branch had not been published: a branch only on a workstation or in a
dev-container worktree is invisible to every other session's numbering.

**Measured on the workstation, 2026-11-27 (T004, workstation half)**: fresh blobless clone of BELAY from the forge,
`git ls-remote --heads origin` → `015-self-healing-dependency-bot`, `016-pdlc-spec-intake` (`98d4d81`),
`chore-92-own-runners`, `main` (`9350235`).
- **Interpreter**: `pwsh` is **not installed**; only Windows PowerShell (`powershell.exe`, file version
  10.0.26100.9818, i.e. 5.1). So the server's `ps` path on this workstation is `powershell.exe`, as R1 planned.
- `powershell.exe -NoProfile -ExecutionPolicy Bypass -File create-new-feature-branch.ps1 -Json -DryRun -ShortName
  pane-probe "Pane probe for feature 016"` → `{"BRANCH_NAME":"017-pane-probe","FEATURE_NUM":"017","DRY_RUN":true}`.
- The same without `-ExecutionPolicy Bypass` → the same output: this workstation's default policy allows it. The server
  still passes `-ExecutionPolicy Bypass` (process scope only), so it does not depend on a machine policy that differs
  between workstations.
- `resolve-template.ps1 spec-template -Json` under 5.1 → `TEMPLATE_CONTENT` of **4556** characters, the same as
  `pwsh` 7.6.5 in the dev container.
- Afterwards `git status --porcelain` was empty and `git branch` showed only `main`: the dry run created nothing.

**Dry run against real run, same branch set**: a real run in a fresh dev-container clone at 2026-11-27T23:34Z, with the
same four forge heads, gave `{"BRANCH_NAME":"017-pane-probe","FEATURE_NUM":"017"}`. **Equal** to the workstation's dry
run. R1 holds on both interpreters.

**Alternatives rejected**:
- **Run Claude Code headless (`claude -p "/speckit-specify …"`) from the server.** Spec Kit itself would run, but a
  second model would sit behind the first. It needs Claude Code and a login on the workstation, and it must never use
  `ANTHROPIC_API_KEY` (AGENTS.md). It would also need edit permissions inside the copy that no allowlist can bound,
  and the clarify questions would have to be relayed through two conversations.
- **Reimplement numbering and templates in the server.** Ruled out by FR-002: it drifts on the next Spec Kit upgrade.
- **Run the branch script for real.** Its `git checkout -b` and `git fetch --all --prune` would be writes that the
  server's allowlist cannot see before they happen, which breaks the constitution's operator-tool write-allowlist
  rule. It would also need the token in the script's environment.
- **Run the dry run in the local copy and check `git status` afterwards.** That checks after the write, not before.
  Rejected at `/speckit-analyze` (finding C1).

## R2: Where a spec in progress lives: one worktree per feature

**Decision**: each spec in progress gets its own **git worktree** of the local copy, at
`<clone_root>/.pdlc-specs/<Repo>/<NNN-slug>/`. It is created with `git worktree add -b <branch> <path>
origin/<default>`.

- The copy at `<clone_root>/<Repo>` stays on its default branch, fast-forward only, exactly as feature 014 left it.
  `sync_repo` and `repo_status` are unchanged, and grounding keeps reading the default branch.
- Several specs can be in progress at once, one per proposal.
- The author's edits are **uncommitted files** in the worktree between sessions (spec Assumptions: published on
  approval). Resume is reading the worktree.
- Claude Desktop's folder access already covers the clone folder (014 R12, measured), so the session can read the
  worktree without a new approval. A folder name starting with `.` cannot be a repository name, so `list_repos`'s
  "local copy exists" check is not confused.

**Alternatives rejected**: switching the copy to the feature branch, which breaks `sync_repo` (it refuses an off-branch
copy) and allows only one spec at a time; a second full clone per feature, which is slower and larger for the same
result.

## R3: Specify and clarify hooks in the Claude Desktop route

**Decision**: the server reads the target repository's `.specify/extensions.yml` and classifies every hook on
`before_specify`, `after_specify`, `before_clarify` and `after_clarify`:

| Hook | In the Claude Desktop route |
| --- | --- |
| `speckit.git.feature` (mandatory) | Done by the server (R1 dry run, then R4) |
| `speckit.git.commit` (optional) | Not run. The server commits once, on approval |
| `speckit.agent-context.update` (optional) | Not run: it edits a Claude Code context file outside the spec folder. It runs at `after_plan` in VS Code as today |
| `speckit.belay.spec-stage` (mandatory, new; R7) | Done by the server natively: the stage change and comment |
| Any other **mandatory** hook | `check_spec_kit` reports it, and `start_spec` **refuses** with `spec_hook_unsupported`, naming it. No hook is skipped silently (spec Edge Cases) |
| Any other optional hook | Not run, and listed in `check_spec_kit`'s result |

## R4: The git allowlist, extended

**Read**: `mcp-servers/pdlc/src/git-runner.mjs` allows `clone`, `fetch`, `status`, `rev-parse`, `rev-list`,
`symbolic-ref`, `merge --ff-only <ref>` and `config --get <key>`. Every call passes `cwd` explicitly.

**Decision**: add exact argument shapes, checked by `isAllowedGitCall`. No other verb or option is accepted:

| Call | Shape | Why |
| --- | --- | --- |
| Fetch every head | `fetch origin +refs/heads/*:refs/remotes/origin/*` | Numbering sees every remote branch (R1) |
| Make the scratch clone | `clone --shared --no-checkout <copy path> <clone_root>/.pdlc-scratch/<Repo>-<random>` | R1. The source must be the copy's own path, and the destination must be under `.pdlc-scratch/` |
| Copy remote refs into scratch | `fetch <copy path> +refs/remotes/origin/*:refs/remotes/origin/*`, run in the scratch clone | R1 |
| Check out scratch | `checkout --detach origin/<default>`, run in the scratch clone only | R1 |
| Create the worktree | `worktree add -b <feature-branch> <path> origin/<default>` | R2 |
| List worktrees | `worktree list --porcelain` | Resume, and a foreign-folder check |
| Read a file at a commit | `show <sha>:<path>` | Three-way re-apply (R8) |
| Three-way merge of one file | `merge-file -p <ours> <base> <theirs>` | R8. Operates on temp files the server wrote |
| Stage the feature's files | `add -- specs/<NNN-slug>` | Exactly the feature folder (FR-020) |
| Commit | `commit --no-verify -m <message>` with a fixed message shape (implemented in this order, T016) | `--no-verify`: no repository hook runs on the workstation |
| Publish | `push origin refs/heads/<feature-branch>:refs/heads/<feature-branch>` | No `--force`, `+`, `--delete` or `--mirror`; source and destination are the same feature branch |
| Fast-forward the worktree | `merge --ff-only origin/<feature-branch>` | Already allowed in shape |
| Undo an unpublished commit | `reset --soft <sha>`, only where `<sha>` is the recorded remote tip and every commit after it is unpublished | Recovering from a publish that lost a race (R8) |
| Diff for "what changed" | `diff --stat <a> <b> -- specs/<NNN-slug>` and `log --format=%H%x09%an%x09%s <a>..<b>` | FR-022 report |

**Where each shape may run (implemented, T016)**: `add`, `commit`, `push` and `reset` only with the spec's own worktree
as the working directory, never the copy; `worktree add` only from the copy; the scratch `fetch` and `checkout` only
inside `<clone_root>/.pdlc-scratch/`. A `--shared` clone, or a fetch from any source but `origin`, must be the R1
scratch shape; 014's other `clone` and `fetch` calls are unchanged.

**Branch guard, checked before every commit, push and reset**: the branch is the one recorded for this proposal's spec
in progress (R7). It is **not** the default branch, and it matches the repository's branch shape as the dry run
produced it. A push whose destination is the default branch is refused even if the forge would also refuse it. The
default branch's protection is a second, server-side bound (M5).

**Commit identity**: `user.name` and `user.email` come from the workstation's own git configuration, the same identity
the operator commits with. When either is missing, `approve_spec` refuses with `git_identity_missing` before writing
anything. The message is `docs(<NNN>): approve spec for proposal item #<n>` followed by a body line
`Approved in Claude Desktop by the spec's author.`

## R5: The file-write allowlist (FR-020)

**Decision**: `write_spec_file` writes only:
- `specs/<NNN-slug>/spec.md`;
- `specs/<NNN-slug>/checklists/*.md`.

Anything else is refused with `path_outside_feature`. The path is resolved and compared after normalisation, and `..`,
absolute paths, symlinks and an alternate data stream (`:` on Windows) are refused. Other files the specify or clarify
prompts mention are not written: `.specify/feature.json` is gitignored. The plan assumed setup-plan resolves the
feature from the branch name when that file is missing; **measured false** (T042, below).

**Measured 2026-11-28 (T042)**, real `pwsh` 7.6.5 and BELAY's Spec Kit 1.4.2 scripts, in a fresh clone of a published
feature branch: `setup-plan.ps1 -Json` exits 1 with `ERROR: Feature directory not found. Set SPECIFY_FEATURE_DIRECTORY
or run the specify command to create .specify/feature.json.` Read from `common.ps1` `Get-FeaturePathsEnv`: the feature
folder comes ONLY from `SPECIFY_FEATURE_DIRECTORY` or `.specify/feature.json` (written by the specify step, and
gitignored by Spec Kit's own `.specify/.gitignore`); there is no branch fallback. This is not specific to the Claude
Desktop route: any fresh checkout or worktree of a feature branch (an Architect picking up someone else's spec) has no
`feature.json`, so `/speckit-plan` fails there today.

**Decision (T042)**: a mandatory, hand-added `before_plan` hook, `speckit.belay.feature-dir`, runs
`node scripts/feature-dir.mjs`: when neither `SPECIFY_FEATURE_DIRECTORY` nor a `feature.json` that names an existing
spec is present, it writes the gitignored `.specify/feature.json` from the branch (`specs/<branch>/`, only when that
folder's `spec.md` exists), and otherwise refuses with the reason. No Spec Kit core file is edited; the server still
writes nothing outside the spec folder; both routes plan with zero fix-ups (SC-002). Rejected: committing
`feature.json` (Spec Kit gitignores it, and a merged one would point every later checkout at an old feature); a
registered local edit to `common.ps1` adding a branch fallback (a core-script edit every Spec Kit upgrade must
re-merge); a documented manual step (a fix-up, against SC-002). If a target repository's
prompt needs another file, adding it is a change to this list and its test, as FR-020 requires.

Other server writes go only to these places:

| Write | Path |
| --- | --- |
| The pane's draft store (R9) | `<clone_root>/.pdlc-drafts/<Repo>/` |
| Backups before a take-latest (R8) | `<clone_root>/.pdlc-backups/<Repo>/<NNN-slug>/<timestamp>/` |
| The three-way merge's temporary `base`, `ours` and `theirs` files (R8) | `<clone_root>/.pdlc-backups/<Repo>/<NNN-slug>/<timestamp>/merge/`, kept with the backup |
| The scratch clones the Spec Kit scripts run in (R1) | `<clone_root>/.pdlc-scratch/<Repo>-<random>/`. Created and deleted by the server; the one folder repository code may write to |
| The state file (data-model.md) | `<clone_root>/.pdlc-specs/<Repo>/<NNN-slug>.state.json` |

Every path is resolved and checked against this table before the write. A scratch folder left behind by a crash is
deleted on the next `start_spec` for that repository.

## R6: The widened credential (M5)

**Decision**: the `pdlc` token's scope becomes `write:issue` + `write:repository`. `write:repository` includes read.
The manifest's `forge_token` description and the runbook change with it.

**What bounds it**:
1. the server's push guard (R4): the feature branch only, never the default branch, never force;
2. branch protection on each target's default branch.

`check_setup` gains a **report-only** field `default_branch_protected`. The forge answers 403 to a branch-protection
read without admin (014 measured this for the run token), so the field can be `unknown`. The runbook tells the
operator to confirm protection by hand once per target repository.

**Unverified, measured first**: that a `write:repository` token can push a new branch over HTTP with R2's
`GIT_CONFIG_*` header, and is refused a direct push to BELAY's protected `main`. This is tested against `ci-smoke`
after the operator protects its `main`.

**Measured from the dev container, 2026-11-27 (T005)**, git 2.39.5, with a dedicated test token scoped `write:issue`
+ `write:repository` (created by the operator for this measurement, to be revoked by them), attached exactly as the
server does: `http.extraHeader` through `GIT_CONFIG_COUNT/KEY/VALUE`, `credential.helper` emptied, nothing written to
any git config. `ci-smoke`'s `main` was protected by the operator first.

| Request | Observed |
| --- | --- |
| Blobless clone of `ci-smoke` | exit 0 |
| `push origin refs/heads/pdlc-it-t005:refs/heads/pdlc-it-t005` (a new branch, one empty commit) | **accepted**, exit 0, `* [new branch]` |
| `push origin refs/heads/pdlc-it-t005:refs/heads/main` | **refused by the forge**, exit 1: `Forgejo: Not allowed to push to protected branch main`, `! [remote rejected] … (pre-receive hook declined)` |
| `GET /repos/{owner}/ci-smoke/branch_protections` with this token | **HTTP 200**, one rule for `main` with `enable_push: false` and `enable_status_check: true` |
| `GET /repos/{owner}/ci-smoke/issues?limit=1` | HTTP 200 |

So the token both pushes and is bounded by branch protection, as M5 assumed. Unlike the run token (014: 403), an owner's
`write:repository` token **can** read branch protection, so `check_setup`'s `default_branch_protected` reports `true`
or `false` for it, and `unknown` stays for a 403 or 404. The test branch `pdlc-it-t005` is left on `ci-smoke` until the
operator agrees to its deletion.

## R7: Stages as labels, and the stage record

**Decision**: the stages are status labels, one per issue, in the shared label contract
(`mcp-servers/pdlc/contract/proposal-labels.json`) and in `scripts/backlog.mjs` `TAXONOMY`:

| Stage | Label | Issue state |
| --- | --- | --- |
| proposal, draft | `status/proposal-draft` (existing) | open |
| proposal, ready | `status/needs-spec` (existing) | open |
| spec in progress | `status/spec-in-progress` (new) | open |
| ready to plan | `status/ready-to-plan` (new) | open |
| in engineering | `status/in-engineering` (new) | open |
| merged | `status/merged` (new) | closed |

Changing stage removes the one old stage label and adds the new one, as 014 R8 does for draft and ready.

**The stage record**: every stage change posts a comment whose last line is a machine-readable trailer:

```text
<!-- pdlc-stage: stage=ready-to-plan branch=016-pdlc-spec-intake spec=specs/016-pdlc-spec-intake/ -->
```

The rendered comment says the same thing in words (FR-015). The **most recent** trailer is authoritative for the
branch and spec folder, which `ready` prints for `ready-to-plan` items (FR-016). A withdrawn spec's trailer has
`stage=withdrawn`. `start_spec` reads all trailers, so a withdrawn branch is never reused (FR-019). The exact format
is in [contracts/stages.md](contracts/stages.md).

**Alternatives rejected**: the issue's `ref` field, which is unmeasured on this forge, holds one value, and is
invisible to `backlog.mjs`'s existing reads; a milestone per feature, which is too heavy for one issue and conflicts
with "milestones map to feature directories" for in-repository work.

**The transition table** is the guard for FR-023, enforced in both the server and `backlog.mjs`:

| From | To | Who |
| --- | --- | --- |
| ready | spec in progress | `start_spec` (Claude Desktop); `after_specify` hook (VS Code) |
| spec in progress | ready to plan | `approve_spec` |
| ready to plan | spec in progress | `reopen_spec` |
| spec in progress, ready to plan | ready or draft | `withdraw_spec` |
| spec in progress, ready to plan | in engineering | `after_plan` hook (VS Code) |
| any open stage | merged (and closed) | the merge workflow (R10) |

The VS Code route goes from **spec in progress** straight to **in engineering**, because the same engineer specifies
and plans (spec FR-031). The merge workflow accepts any open stage, so a feature that skipped a stage still closes
(spec Edge Cases).

## R8: Taking the latest when the branch changed (FR-022, User Story 8 scenario 4)

**Decision**:
1. On resume and before every publish, `fetch origin +refs/heads/<feature-branch>:refs/remotes/origin/<feature-branch>`.
   Compare the result with the tip the server last recorded for this worktree, kept in the worktree's
   `.git`-adjacent state file `<clone_root>/.pdlc-specs/<Repo>/<NNN-slug>.state.json`.
2. If the remote moved, refuse with `branch_changed`. Return the commits (author, subject) and a per-file diff stat.
3. `take_latest_spec`:
   a. back up every working file in the feature folder (R5 backup path);
   b. if there is an unpublished local commit (a publish lost a race), `reset --soft` to the recorded remote tip, so
      its content becomes working changes;
   c. for each file the author changed, take `base` (recorded tip), `ours` (working file) and `theirs`
      (`origin/<branch>`), and run `git merge-file -p`;
   d. `merge --ff-only origin/<branch>`, then write each merged result back;
   e. return the files with conflict markers, which the session shows to the author (spec Edge Cases).

   Nothing is published. The stage does not move. The author approves again to publish.

No published commit is rewritten: the only `reset` is of an unpublished commit, onto the published tip.

## R9: The right-hand pane: an MCP App served by `pdlc` (FR-035 to FR-037; M7)

**Background**: MCP Apps (the MCP extension for interactive UI) let a server declare a `ui://` HTML resource and attach
it to a tool through `_meta.ui.resourceUri`. The host renders the HTML in a sandboxed frame. The page talks to the host
over `postMessage` JSON-RPC: it can call the server's tools (including tools visible to the app only), and can update
the model's context.

**Decision**:
- **Resource** `ui://pdlc/document-pane.html`: one self-contained HTML file in `mcp-servers/pdlc/ui/`, with inline CSS
  and JS, no dependency and no build step (M7). It shows either a proposal (nine labelled textareas in contract order)
  or a spec (an outline of its headings and one monospace textarea per file). It has a read-only mode.
- **Model-visible tool** `show_document` opens the pane on a document and returns its current revision.
- **App-only tool** `save_pane_edit`, with `_meta.ui.visibility: ["app"]`, is what the page calls when the author
  stops typing (debounced) or presses Save. It writes:
  - for a spec, the file in the worktree (through the same path guard, R5);
  - for a proposal, a draft file under `.pdlc-drafts/` (R5).
  Each write bumps the document's **revision**.
- **No pane edit is lost (FR-036)**: every model-side write (`write_spec_file`, `create_proposal`, `update_proposal`)
  takes `base_revision`, and the server refuses `pane_edit_pending` when the document has moved past it. The model then
  re-reads with `get_spec` or `get_proposal_draft`, which returns the diff of what the pane changed. The skill tells the
  author what it took in, and retries. This is the same stale-write pattern as 014 R9.
- **The pane polls; nothing is pushed** (T003). The page calls a second app-only tool, `read_pane_document`, every
  2 s and re-renders when the revision moved, so a chat edit appears within one poll (FR-035). The server cannot
  notify the page: the model's calls and the page's calls are served by **different server processes** (measured).
- **No state in memory between calls** (T003). Revisions are hashes of the files on disk; the "what the model last
  read" snapshot behind `pane_changes` is a file under `.pdlc-drafts/` (R5). Either process may serve any call.
- **Beside the chat**: on load the page asks `ui/request-display-mode {mode: "fullscreen"}`, which moves it to the
  right-hand pane (measured). If `availableDisplayModes` lacks `fullscreen` or the request fails, it stays inline and
  says so, and the skill tells the author edits go through the chat (FR-037 fallback).
- `ui/update-model-context` is not used: the model did not see it (measured).
- **Read-only (FR-037)**: `show_document` opens the pane read-only for a spec at **in engineering** or later and for a
  closed proposal. `save_pane_edit` refuses `document_locked` regardless of what the page sends.

**Unverified, measured on the host first** (task "measure MCP Apps in Claude Desktop"), with a throwaway extension as
014 T006 did:
1. Whether Claude Desktop renders an MCP App **beside** the chat (the right-hand pane) rather than only inline in the
   conversation, and how the page asks for that display mode.
2. Whether an app-only tool call from the page reaches the server, and whether a later model turn sees the change.
3. Whether a page can be told to re-render after a model-side write.

**Measured on the host, 2026-11-27 (T003, first pass)**: Claude Desktop on Windows (user agent `Claude/6.28899.6`,
Electron 45.3.3, MSIX), plain chat, throwaway extension `pdlc-pane-probe` 0.0.1. The client presents itself to the
server as `local-agent-mode-<extension display name>` 1.0.0 and advertises
`extensions: {"io.modelcontextprotocol/ui": {"mimeTypes": ["text/html;profile=mcp-app"]}}`.

| Item | Observed |
| --- | --- |
| Page renders | Yes, **inline in the conversation** first. `ui/initialize` (protocol `2026-01-26`) answered with host `Claude` 1.0.0 and `hostContext.availableDisplayModes: ["inline","fullscreen"]`, `displayMode` inline |
| (1) Beside the chat | **Yes, on request.** `ui/request-display-mode {mode:"fullscreen"}` moves the page to the **right-hand pane**; `{mode:"inline"}` brings it back. `pip` is not offered and changes nothing |
| Host capabilities | `openLinks`, `downloadFile`, `updateModelContext {text, image}`, `message {text}`, `serverTools {listChanged}`, `serverResources {listChanged}`, `logging`, `sandbox` |
| Tool result to the page | `ui/notifications/tool-input` then `ui/notifications/tool-result` (with `structuredContent`) arrive right after initialisation |
| App-only tools hidden from the model | **Yes**: the model listed only `probe_show`, `probe_set_text` and `probe_get_state`, and said the widget's own tools cannot be called from the chat |
| (2) App-only call reaches the server | **Yes, but not the model's server process.** Second pass (same day): every pane Save and every 2 s poll appears in `mcp-server-<display name>.log` as `tools/call` (ids 4 to 23) with a result, and the page got real answers (a stale Save refused `pane_edit_pending`, a current one saved). **None of the model's calls** (`probe_show`, `probe_set_text`, `probe_get_state`) appear in that log, and the two sides kept separate in-memory state: the app side reached revision 2 (`pane edit 1`, writer `pane`) while the model side reached revision 3 (`model edit 3`, writer `model`), and the model's `appCalls` stayed empty throughout. So the page's tool calls and the model's tool calls are served by **two different server processes** |
| (3) Re-render after a model write | A new `probe_show` call opens a **new** inline page (it does not update the existing one), which renders the new state from its tool result. An open page **polling an app-only tool every 2 s works** (each poll answered in about 1 ms). Nothing pushes to an open page. Whether a poll sees a model-side write depends on the state being shared through disk (below) |
| Display mode after the move | `ui/request-display-mode {mode:"fullscreen"}` answered `{mode:"fullscreen"}`, then `host-context-changed` with `displayMode: fullscreen` and `containerDimensions` about 953 × 1098; saves work from the pane |
| `ui/update-model-context` | Answered `ok`, but the model's next turn did not see the text |
| `ui/message` | **Works**: the page's message appeared in the chat as a user message, and the model acted on it |

**Third pass, measured on the host 2026-11-27** (probe 0.0.2, state in one file under the user's home folder):
the model's calls were served by pid **39296** and the page's by pid **33224**, both `win32`, Node **v24.22.3**, both
reporting the same state file `C:\Users\<user>\.pdlc-pane-probe-state.json`. The page saved `pane edit B` (pid
33224); the model's next `probe_get_state` (pid 39296) returned `pane edit B`, `lastWriter: pane`. So the two
processes **share the workstation's disk**, and state kept in files crosses between them. The model then wrote `model edit C` (pid 39296)
and the open, polling page showed `model edit C` (pid 33224's next poll): both directions cross.

**What this means for the design (measured, T003)**: the server must keep **no state
in memory between calls**. Every revision, draft and "what the model last read" snapshot lives in files under the
clone root, which both processes can read, if they share the workstation's disk. "The server notifies the pane"
is not possible: the page **polls** an app-only read tool instead, and moves itself beside the chat with
`ui/request-display-mode fullscreen`. `ui/update-model-context` cannot carry a pane edit to the model; the
`base_revision` refusal (`pane_edit_pending`) and a re-read are the only channel.

**If (1) fails**, the spec's assumption applies: FR-035 and FR-036 go back to the maintainer and are not quietly
dropped. The fallback already required by FR-037 (show the document in the chat) keeps the feature usable meanwhile.

**Alternatives rejected**:
- **Claude Desktop artifacts.** They are model-written, and the author cannot type into them, so FR-036 fails.
- **The ext-apps SDK plus a bundler.** Rejected by M7: it needs new dependencies and a build toolchain.

## R10: Merged: closing the issue on merge, in CI (FR-014, FR-038, FR-039)

**Read**: `guardrails.yml` already runs on `push` to `main`. A merge made by `forge-pr.mjs merge` leaves a merge
commit titled `Merge pull request '<title>' (#<pr>) from <branch> into main` (read: `git log` on `main`).

**Decision**: a new workflow, `.forgejo/workflows/feature-merged.yml`, runs on `push` to `main`. Its one job runs
`node scripts/feature-merged.mjs`, which:
1. finds the merged pull request for the pushed commit. It asks the forge for the commit's pull request and falls back
   to parsing the merge commit title (unverified: whether `GET /repos/{o}/{r}/commits/{sha}/pull` exists on this forge
   build; measured first);
2. finds the proposal: in the merged change's `specs/*/spec.md` files that the pull request added, exactly one
   `Proposal #<n>` in an **Input** line. None means "not from a proposal": the script says so and exits 0. Two or more
   means it refuses and comments nothing, exiting 0 with a warning, because a merge is never blocked;
3. checks the issue is open, carries `type/proposal` and is not `status/bot-managed`;
4. counts the created test declarations from git, with no test run (R12, M10);
5. posts the closing comment, whose format is in [contracts/feature-merged.md](contracts/feature-merged.md), swaps
   the stage label to `status/merged`, and closes the issue. The comment is posted before the close, so a re-run that
   finds the comment only completes the close. It is idempotent, like 014's `close-proposal`.

A pull request closed without merging never pushes to `main`, so it never triggers the workflow (FR-014).

**Why the close is a separate workflow and not a `guardrails` step**: `guardrails` has
`concurrency: cancel-in-progress` keyed on the ref, so two merges close together cancel the first push run (read:
`guardrails.yml`, 2026-11-27). A close inside it would then never happen. `feature-merged` takes seconds, has its own
concurrency group with no cancellation, and never runs a test. Only the outcomes comment lives in `guardrails`
(R12), because only that run has the outcomes.

**Measured from the dev container, 2026-11-27 (T006, first half)**, Forgejo `15.0.3+gitea-1.22.0` (`GET /version`):
`GET /repos/{owner}/BELAY/commits/{sha}/pull` **exists**. For merge commit `9350235` it answers HTTP 200 with pull
request #90, `merged: true`, `merge_commit_sha` equal to the commit. For `309a9e9` (the branch commit inside that
merge) it answers HTTP 404 `pull request does not exist`. So `feature-merged.mjs` asks the forge first, and parsing
the merge commit title is a fallback for a 404 only.

## R11: The CI credential for the merge workflow (M6)

**Unverified, measured first**: whether the run token (`github.token`) on this Forgejo build can comment on and close
an issue in the same repository on a `push` event. 014 measured that the run token gets 403 on branch protection, so
its issue permissions are not assumed.

**Decision**: the workflow passes both to the script, as the digest step does. The script uses `GITHUB_TOKEN` first,
and `CI_DIGEST_TOKEN` (already `write:issue`) only when the run token is refused. The runbook records which one the
measurement showed. Neither is printed: the existing redactor covers both.

**T006, second half, measured 2026-11-27 on BELAY's own runner** (`ci-belay`, label `belay`). It was first tried on
`ci-smoke`, whose jobs stayed `pending`: `ci-smoke` has **no runner** (`GET /repos/{owner}/ci-smoke/actions/runners`
→ `[]`; its own `smoke` job last succeeded 2026-11-25). The maintainer chose BELAY. A throwaway workflow on throwaway
branch `pdlc-probe-016` (`on: push` to that branch only; `concurrency` with `cancel-in-progress`) acted on a
throwaway issue with `${{ github.token }}` only:

| Measurement | Observed |
| --- | --- |
| Run token comments on an issue in its own repository (push event) | **Yes**: HTTP 2xx; the comment is authored by `forgejo-actions` |
| Run token closes that issue | **Yes**: job `close` success, issue `closed` |
| A job cancelled by `cancel-in-progress` (a second push while its 150 s step ran) | The job's commit status became **`failure`** (not a distinct `cancelled`) the moment the second run started |
| Does its `if: always()` step run? | **No**: the cancelled run posted no always-step comment. The second, uncancelled run's always-step did run and saw `job.status=success` |

**So**: M6 resolves to **the run token**; `CI_DIGEST_TOKEN` stays as the coded fallback for a 401/403 but is not
expected to be used, and the secrets page changes nothing for it (T078). For R12, a `guardrails` run on `main`
cancelled by a later merge posts **no** outcomes comment at all; the closing comment's line "If none follows, that
run was cancelled or did not report" is what keeps that absence from reading as a pass. The outcomes step's
`--job-status cancelled` path is therefore not reachable on this forge and is kept only as defence.

## R12: Counting the feature's tests (FR-038 to FR-040; decision M10)

**Revised 2026-11-27 at ADR-0006 review (M10).** The first design ran every CI test target twice per proposal merge
(merge and parent) to tell the feature's test cases apart. It was rejected: MCM's suite alone takes 30+ minutes,
and no merge should pay for a second run.

**Definitions**:
- **Created** = test declarations at the merge commit minus test declarations at its first parent, as counted by
  `scripts/count-repo-metrics.mjs` (`measureCommit(...).testDeclarations`). Read: it counts `test(`, `it(` and
  `t.test(` calls, with `.skip`/`.todo`/`.only`, in test files (a `__tests__` segment or a `*.test.*` basename), from
  git objects only. So the same commit always gives the same number, no test runs, and the parent's count needs only
  the parent's objects (`fetch-depth: 2`).
- **Outcomes** = the whole suite's executed test cases in the merged commit's own `guardrails` run, per target:
  passed, failed, skipped, todo. **Skipped** and **todo** are never counted as passed.
- The two are different units: a table-driven declaration runs many cases. The comments never say "N created, M of
  those passed".

**Decision**, in three places:
1. **`feature-merged.yml`** (R10) computes **created** from git and puts it in the closing comment. Seconds, no test
   run, never cancelled.
2. **`guardrails` on push to `main`** attaches a collecting reporter
   (`scripts/lib/collect-test-results.mjs`: one JSON line per test case with file, name path and outcome) to its
   existing `scripts:test`, `pdlc:test` and `pdlc:integration` steps. A final step,
   `if: always() && github.event_name == 'push'` with `continue-on-error: true` and an unconditional exit 0 (the
   failure-digest pattern), runs `node scripts/feature-merged.mjs --outcomes <dir> --job-status <status>`. For a merge
   that came from a proposal, it posts the **outcomes comment**; otherwise it logs "not from a proposal" and exits 0.
   It adds seconds to the run, never a test.
3. **The tasks-template override** gains two REQUIRED tasks (FR-040): **Record the test baseline** in Phase 1 and
   **Record the test count** immediately before **Open the PR**. Each runs
   `node scripts/backlog.mjs record-tests --spec <specs/NNN-slug> --point baseline|close-out`, which counts the
   committed `HEAD` (and, at close-out, the merge base with `origin/<default>` too, so the delta excludes tests other
   merges added to the default branch), prints the counts, and comments them on the proposal issue. It is a progress
   record, not an input to the closing comment, which CI computes exactly.

**No proposal, or not an open proposal**: `record-tests` prints the counts, says "not from a proposal; nothing
posted" (or names why the issue is not eligible) and exits 0. The task records the counts in `tasks.md`. CI's two
steps log the same and exit 0.

**A failed issue update in a template task** (exit 3 credential, 4 authorisation, 5 transport, unchanged meanings):
the verb keeps its honest non-zero exit. The task text tells the agent to record the counts and the exit code in the
task, report it, and **continue** implementation (M10).

**How the reporter is attached (unverified, measured first, T007)**: through
`NODE_OPTIONS=--test-reporter=<abs>/scripts/lib/collect-test-results.mjs --test-reporter-destination=<file>`
alongside the default reporter. This depends on `node --test` accepting reporter flags from `NODE_OPTIONS`, and on
`check-coverage.mjs --run` passing the environment through.

- **If it works**: no Nx target changes.
- **If it does not**: each test target gains an opt-in `--report <file>` argument, forwarded to `node --test` as
  `--test-reporter`/`--test-reporter-destination`, with the default output unchanged.

**Measured in the dev container, 2026-11-27 (T007)**, Node 26.13.1, with a probe reporter in the session scratchpad
(one JSON line per `test:pass`/`test:fail`, suites excluded):

| Case | Observed |
| --- | --- |
| `node --test <file>` with only `NODE_OPTIONS` reporter flags | Reporter file written (5 lines for `master-copies.test.mjs`), but the **default console output disappeared**: `NODE_OPTIONS` reporter flags replace the default reporter when the command line gives none |
| `node --test --test-reporter=spec --test-reporter-destination=stdout <file>` plus `NODE_OPTIONS` reporter flags | Both: spec output on stdout and 5 lines in the file. The two sets of flags combine |
| `pnpm nx run pdlc:test` plus `NODE_OPTIONS` | Exit 0; `ℹ tests 185`, pass 185; 185 JSON lines, all `pass`; default output identical to a run without `NODE_OPTIONS` (timings aside) |
| `pnpm nx run scripts:test` plus `NODE_OPTIONS` | **Exit 1**: `ℹ tests 1560`, pass 1558, **fail 2** (`check-coverage`'s two `--run` tests), and the report file **corrupted** (1407 lines, some not JSON). The same target without `NODE_OPTIONS`: exit 0, 1560 pass, 0 fail, 0 skipped |

**Why it fails**: `NODE_OPTIONS` is inherited by every `node` child a test spawns. `check-coverage`'s own tests run
`check-coverage.mjs --run` on fixture projects, whose nested `node --test` then also loads the probe and writes to
the same destination. That changes those tests' output and interleaves the file.

**Decision (T007)**: the **opt-in argument path, never the environment**. Each test target gains an explicit,
optional results-file argument that adds `--test-reporter=<collector> --test-reporter-destination=<file>` to its own
`node --test` command line only, keeping its existing reporters (`pdlc:integration`, which passes none today, also
gains an explicit `--test-reporter=spec --test-reporter-destination=stdout` so its console output stays the same).
`check-coverage.mjs` already uses `--report` for the lcov path, so its new flag is named `--results <file>`. Nothing
is read from an environment variable, so a test's own child processes never inherit it. With no argument, every
target's output and behaviour are unchanged.

**Seen in passing (pre-existing, not caused by this feature)**: in a fresh checkout, `pnpm nx run pdlc:test` fails
with `ENOENT: … open 'coverage/pdlc.lcov'` because `coverage/` does not exist and `node --test` does not create a
reporter destination's folder. In `guardrails` it passes only because `scripts:test` runs first and
`check-coverage.mjs --run` creates `coverage/`.

**When a count cannot be read**, the comment says which count is unknown and why, and never reports 0 (FR-039,
AGENTS.md: "a tool's no is about the tool"):
- the parent commit is not readable by the counter → created `unknown`;
- a target's reporter file is missing or unparsable → that target `unknown`;
- the run was cancelled (a later push to `main`) → **no outcomes comment at all**: measured (T006, R11), a Forgejo
  `always()` step does not run in a job cancelled by `cancel-in-progress`. The closing comment's last line ("Suite
  outcomes follow from this commit's guardrails run. If none follows, that run was cancelled or did not report")
  keeps the absence from reading as a pass.

The close never waits for, or depends on, the outcomes.

**MCM**: the counter recognises JavaScript `node:test` declarations only. MCM adopting the counts needs a counting
rule for its own test kinds, named in the hand-off guide (FR-033).

**Alternatives rejected**:
- **Run every test target twice (merge and parent) and diff test identities.** The original R12. Exact per-feature
  pass counts, but a second full suite run per proposal merge: 30+ minutes on MCM (M10).
- **Outcomes of the test files the merge added or changed only.** Offered at review; the maintainer chose whole-suite
  totals (M10). It would include older tests in changed files and still not be "the feature's" tests.
- **Take "created" from the tasks-template counts.** The baseline is taken when the branch starts; tests other merges
  add to the default branch in the meantime would be counted. The template counts stay as a progress record.
- **Reusing the `pull_request` run's output.** The forge exposes no artifact or log API (014 and `ci.md`), and the
  pull request run is of the head, not the merge.

## R13: In engineering: the `after_plan` hook (FR-013)

**Decision**: a new mandatory `after_plan` hook, `extension: belay`, `command: speckit.belay.spec-stage`, registered
in `scripts/check-speckit-overrides.mjs` `EXTENSION_HOOKS` (`local: true`) and the Spec Kit runbook inventory, as 014
did for `after_specify`.

The same project-owned skill, renamed `.claude/skills/speckit-belay-spec-stage/` and replacing
`speckit-belay-close-proposal`, serves both hook points. A skill cannot see which hook invoked it, so it decides from
the feature folder:
- with no `plan.md`, it is the `after_specify` point and sets **spec in progress**;
- with `plan.md`, it is the `after_plan` point and sets **in engineering**.

It finds the proposal number as 014 R14 does (one `Proposal #<n>` in the Input line) and runs
`node scripts/backlog.mjs stage <n> <stage> --spec <dir> --branch <branch>`. That new verb replaces `close-proposal`.
It enforces R7's transition table and writes R7's trailer.

**Locking (FR-018)**: the server checks the issue's stage label before every spec write, reopen, approve and
withdraw. The label is authoritative. A plan on an unpublished branch cannot lock anything, and the VS Code route
always plans on a checked-out branch whose hook moves the label.

**Independence (FR-031)**: the hook, the verb and the merge workflow use `backlog.mjs`, the forge and CI only. A guard
test (014's existing "nothing references the server" test) covers the new files.

**`close-proposal`**: removed. Its one caller (the `after_specify` hook) moves to `stage`. Proposals already closed by it
stay closed (spec Assumptions). The doc-impact sweep lists every page that names it.

## R14: Spec Kit presence and version (FR-005; User Story 7)

**Decision**: `check_spec_kit` reads from the copy's default branch:
- `.specify/init-options.json`: `speckit_version`, `script`, `feature_numbering`;
- the presence of the two scripts in R1, and of the specify and clarify prompts;
- `.specify/extensions.yml`, classified by R3.

The server is tested against Spec Kit **1.4.x**, the version BELAY and MCM run. Another major or minor version answers
`supported: false` with the version named. Widening the range is a contract change with its own test. When
`init-options.json` is missing, the result is `initialised: false` (User Story 7). The skill then offers proposal work
only, and says why in plain words.

## R15: Approval checks (FR-008, FR-009)

**Decision**: `approve_spec` refuses:
- `spec_has_markers`: any `[NEEDS CLARIFICATION` in `spec.md`, with the list of markers;
- `spec_not_clarified`: `spec.md`'s `## Clarifications` section does not have **more** `### Session` headings than it
  had at the last start or reopen. The count is kept in the state file as `sessions_at_start_or_reopen` (data-model.md).
  The clarify prompt writes exactly that section. When clarify finds nothing to ask, the skill still adds a session,
  with the line `- No questions: no critical ambiguity found.`

  A count, not a date, so a same-day reopen still needs a new session. Rejected: comparing session dates with the
  reopen date, because session headings carry only a date (`/speckit-analyze` finding A1).

Approval then runs: commit (R4) → push → stage **ready to plan** with trailer (R7). The stage moves only after the push
succeeds. A failed push leaves the commit local and the stage unchanged, and the next approve goes through R8.

## R16: Contract versioning

Adding tools and labels changes the fixed contract. Following 014's rule ("a contract change is breaking"):
- the server becomes **0.2.0**;
- the manifest, the master skill and the label contract move in the same change;
- the contract test is updated to the new tool list;
- `check_setup` reports a target with the old label set as `missing_labels` (the four new stage labels).

The existing nine tools are unchanged except that `create_proposal` and `update_proposal` gain an optional
`draft_revision` (R9). An old skill that does not send it still works, because the server checks the revision only
when a pane draft exists for that proposal.
