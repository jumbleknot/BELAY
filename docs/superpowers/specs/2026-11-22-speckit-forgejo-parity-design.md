# Spec Kit and Forgejo parity with MovieCollectionManager: design

**Date:** 2026-11-22
**Status:** Approved 2026-11-22
**Tracking:** deferred guardrail checks are [issue #1](http://<tailnet-host>:3000/jumbleknot/BELAY/issues/1)

## Intent

BELAY already has MovieCollectionManager's (MCM's) tasks-template override, the `check-speckit-overrides.mjs` gate and the TDD task format. It is missing four things that MCM's workflow relies on:

1. The Spec Kit `git` and `agent-context` extensions and their hooks.
2. CI that runs the gate on every PR.
3. The Forgejo tooling behind the override's "Open the PR" task: open a PR, wait for CI, merge only on green.
4. `/speckit-taskstoissues` filing tasks into BELAY's Forgejo issues.

The goal is the same disciplined spec-to-merge loop MCM has, in BELAY. Using it here also tests the override and gate on real features.

## Goals

- Install the `git` and `agent-context` extensions. Extend the gate so a Spec Kit upgrade that silently drops or rewrites a registered hook fails it.
- Add a `guardrails` Forgejo Actions workflow that runs the gate (selftest and scan), the `scripts/__tests__` tests, a failure-digest step in every job, and a check that every job has that digest step.
- Add `scripts/forge-pr.mjs` and `scripts/ci-status.mjs` so the "Open the PR" task can open a PR, read CI status and merge only when CI is green and the head commit matches.
- Add `scripts/backlog.mjs` and a project-owned `/speckit-taskstoissues` skill that files tasks as Forgejo issues, without duplicates and with dependencies.

## Non-goals

- **Sharing these scripts with other repos.** They are BELAY's own setup and live in `scripts/`, like the gate. Promoting them to `tools/` or `packages/` is a later decision.
- **MCM's other guardrail checks** (secret scan, SAST, naming gates, OKF): tracked in issue #1.
- **MCM's app CI, deploys and image scans.**
- **Copilot integration**, including MCM's Copilot tasks-agent edit. BELAY is set up for Claude Code only.

## Anti-goals (would count as failure even if it works)

- **Any MCM name left behind**, in token names, labels, comments or feature numbers.
- **A Spec Kit-owned file edited without registering it** in the gate and the runbook.
- **CI evidence (run ids, verdicts, merge sha) written into the repo.** It goes only in PR and issue closing comments.
- **A token in argv, logs or committed files.**

## Constraints

- **Runtime:** Node 24+ ESM, using only built-ins (`fetch`, `node:test`). There is no `package.json`. One exception may come up: MCM's digest-coverage check imports `yaml`. If BELAY ports it, it must either parse the workflow without `yaml` or the plan must ask the user before adding a `package.json` with a lock file (see AGENTS.md on structural decisions).
- **Forge:** Forgejo at `http://<tailnet-host>:3000`, repo `jumbleknot/BELAY`, API `/api/v1`. Derive owner, repo and API base from the `origin` URL, as MCM's `scripts/lib/forge-credential.mjs` does. Don't hard-code them.
- **Runner:** `ci-homelab` is registered and active. Its labels have not been confirmed. Jobs should target the label MCM's guardrails use (`ubuntu-latest`), and the first CI run has to confirm the runner picks them up.
- **Tokens:** reuse the user's existing Forgejo tokens under new names, with no repo prefix:
  - **`FORGE_TOKEN`:** read-only; CI status and reads.
  - **`FORGE_ISSUE_TOKEN`:** `write:issue`; issue, comment and PR writes.
  - **`CI_DIGEST_TOKEN`:** `write:issue` plus `write:package`; used only by CI's failure digest, as in MCM. MCM's name has no repo prefix, so it is kept as is.

  The user's machine currently has only `MCM_FORGE_TOKEN` and `MCM_FORGE_ISSUE_TOKEN` set. BELAY's scripts read only the new names, with no fallback to the `MCM_` ones. The runbook tells the user to:
  - set `FORGE_TOKEN` and `FORGE_ISSUE_TOKEN` locally (for example with `setx`);
  - add `CI_DIGEST_TOKEN` (and any other token CI needs) as a BELAY repo secret.

  The repo has no secrets or variables yet.
- **Ownership:**
  - Vendor files listed in `.specify/integrations/*.manifest.json` or installed by `specify extension add` are Spec Kit's.
  - Prefer a project-owned file, then a registered local edit, and never edit a core file.
  - Every customisation goes in `docs/runbooks/spec-kit.md` in the same change.
- **Line endings:** per `.gitattributes`. The extension scripts under `.specify/` must keep the bytes the installer wrote.

## Approaches considered

- **A. One design, built directly.** The fastest route, but BELAY's own Spec Kit process, override and gate never get used on real work.
- **B. Four Spec Kit features.** This dogfoods everything four times. But the `git` extension's `before_specify` hook is what creates feature branches, so building it as a feature means running Spec Kit without it while building it.
- **C. Chosen by the user: extensions first as one reviewed commit, then three Spec Kit features.**
  - Installing the extensions is mostly vendor work plus a gate extension, so it doesn't need the full spec, plan and tasks cycle.
  - CI, the PR tooling and the backlog become features `001`, `002` and `003`, built with the extensions active and ending in real PRs.

## The work, in order

### Step 0: Extensions and the hook gate (direct, one commit)

1. **Install the extensions.**
   - Run `specify extension add git` and `specify extension add agent-context` (1.4.2's bundled versions; MCM has git 1.0.5 and agent-context 1.0.3).
   - Record the installed versions in the runbook.
2. **Configure them, mirroring MCM:**
   - `agent-context`'s `context_file` is `AGENTS.md`, never the `CLAUDE.md` shim.
   - `git-config.yml` keeps `auto_commit` off everywhere. The session commits by convention: `spec(NNN)`, `plan(NNN)`, `tasks(NNN)`.
   - Add `before_converge` and `after_converge` `git.commit` hooks to `.specify/extensions.yml` as a registered local edit. MCM added these by hand and nothing protected them.
   - Each config edit is either a project-owned file or a registered local edit, whichever fits where the file sits.
3. **Extend the gate** (`scripts/check-speckit-overrides.mjs`):
   - Add a registry of expected hooks. Each entry is the hook key, extension, command and `optional` flag (for example `before_specify`, git, `speckit.git.feature`, mandatory).
   - Add new failure codes: one for a registered hook that is missing, disabled or has its `optional` flag flipped; one for an installed extension missing from the registry, or a registry entry whose extension isn't installed; and one for a hook that isn't registered. The plan sets the exact names and scope.
   - Extend `--selftest`, the `node:test` tests and the runbook's failure-code table to match.
4. **Update the docs:**
   - Runbook: add rows for the extensions and the hook registry, update the upgrade procedure, and remove the "no extensions installed" known gap.
   - AGENTS.md: note that the extensions exist and that `/speckit-specify` now creates the feature branch.
5. **Verify:**
   - The gate passes and its selftest catches every code, including the new ones.
   - The tests pass.
   - A trial reinstall (`specify extension add … --force`) shows whether the gate catches the lost converge hooks. Restore with git afterwards, never with a PowerShell 5.1 text round-trip.

### Feature 001: `guardrails` CI

- `.forgejo/workflows/guardrails.yml`:
  - Triggers: `pull_request`, `push` to `main`, and `workflow_dispatch`. Concurrency is keyed on the ref with cancel-in-progress.
  - One job runs `node scripts/check-speckit-overrides.mjs --selftest`, then the scan, then `node --test` over every `scripts/__tests__/*.test.mjs` file.

    > **Note:** on Node 24, `node --test` given a directory treats it as a single file and fails. The plan needs an explicit glob or file list.
- Port MCM's `ci-log-step.sh` if the digest needs it, plus `ci-failure-digest.mjs`, `ci-digest-redact.mjs` and `check-ci-digest-coverage.mjs`, with all MCM coupling stripped. Every job ends with the digest step (`if: always()`, `continue-on-error: true`).
  - The digest publishes to Forgejo issues the way MCM's does, with the `CI_DIGEST_TOKEN` secret.
  - When that secret is empty, it falls back to the run's built-in `github.token`, as MCM's does.
  - Because the step is `continue-on-error`, a missing secret never turns CI red. The 001 PR can go green before the secret is added, but the PR must show the digest publishing once the secret is in place.
- The gate, tests and digest coverage are also checked in CI.
- Docs: a CI runbook, plus updates to AGENTS.md and the spec-kit runbook to say the gate now runs in CI rather than by hand.
- This feature's own "Open the PR" step is done by hand, because `forge-pr.mjs` doesn't exist yet. The PR must show a green `guardrails` run on `ci-homelab`.
- **Branch protection.** After that first green run, the user enables protection on `main` in BELAY's repo settings: no direct pushes, and the `guardrails` status check required before merging. The CI runbook gives the exact settings and the status context name to require. This is a one-time manual step, so no script holds an admin-scoped token. Feature 001 is not done until protection is on.

### Feature 002: PR and CI-status tooling

- **`scripts/ci-status.mjs`:**
  - Commands: `status`, `watch`, `failure` and `durations`, each selected by `--sha`, `--pr`, `--branch` or `--run`.
  - `status` exits 0 only when the commit is mergeable. It uses `FORGE_TOKEN`.
- **`scripts/forge-pr.mjs`:**
  - `open --head <branch> --title --body-file [--base main]` refuses AGit `refs/` heads.
  - `merge <n> --expect-head <sha>` merges only if the head matches, `ci-status status` is green and the forge says the PR is mergeable. It then deletes the branch.
  - `dispatch <workflow> --ref [--input k=v]` triggers a workflow.
  - Writes use `FORGE_ISSUE_TOKEN`, read from the environment only.
- `scripts/lib/forge-credential.mjs` derives the API base and owner/repo from `origin`. Arguments go through the existing `scripts/lib/argv-contract.mjs`.
- **Update the override's "Open the PR" task** to name these commands. The override is project-owned, so this is a normal edit.
  - Keep the fork-point header unchanged, since the core template hasn't moved.
  - The gate's override checks must still pass.
- Tests use `node:test` with a stubbed `fetch`, so no network is needed.
- Runbook: CI diagnostics and PRs.
- Merge this feature through its own `forge-pr.mjs` once CI is green.

### Feature 003: Backlog and `/speckit-taskstoissues`

- **`scripts/backlog.mjs`:**
  - Reads: `list`, `ready`, `show`, `validate-form`.
  - Writes: `create` (refuses a duplicate open title unless `--allow-duplicate`), `update`, `comment`, `dep` (with a cycle check), `setup-labels [--dry-run]`, `setup-milestone`.
  - Every write is checked against the `origin` owner/repo.
  - Unknown label or milestone names are refused locally, because Forgejo silently ignores them.
  - Pages are capped at 50, with totals from `x-total-count`.
  - Exit codes: 0 ok, 1 unexpected, 2 usage, 3 credential, 4 authorization, 5 transport.
- **Label set:** `type/{bug,feature,tech-debt,chore}`, `priority/p1..p3`, `status/{blocked,needs-spec}`.
  - Drop MCM's `status/bot-managed`, which belongs to MCM's Renovate setup.
  - Run `setup-labels` once against BELAY, then apply labels to issue #1.
- **Project-owned `.claude/skills/speckit-taskstoissues/SKILL.md`:**
  - Forked from the current Spec Kit version's skill and listed in the gate's `PROJECT_OWNED` with marker `scripts/backlog.mjs`.
  - Its flow:
    - Run the before hooks.
    - Run the prerequisites check.
    - `setup-milestone <NNN-slug>`.
    - Dedupe by `T\d{3,}` in titles, paging past 50.
    - `create` per task, with the `[P]`/`[US#]` markers stripped.
    - `dep` for task ordering.
    - Run the after hooks.
  - `tasks.md` stays the authoritative task list.
- Closing an issue is `comment` followed by `update --state closed`. A blocked item can't be closed.
- Tests use `node:test` with a stubbed `fetch`.
- Runbook: backlog.
- Run `/speckit-taskstoissues` on this feature's own `tasks.md` as its end-to-end check.

## Decided by the user

- Approach C: the extensions go in directly, then features 001 to 003.
- The scripts are BELAY's own, in `scripts/`, not shared tooling.
- Token names are `FORGE_TOKEN` and `FORGE_ISSUE_TOKEN`, with no repo prefix, using the same underlying tokens as MCM.
- Extend the gate to catch lost extension hooks.
- MCM's deferred guardrail checks are filed as issue #1 (done).
- CI failure digests publish to issues as MCM's do, using a third token, `CI_DIGEST_TOKEN`.
- `main` gets branch protection with `guardrails` required, enabled by the user after feature 001's first green run.

## Calls made in the design (not yet confirmed by the user)

- **Step 0 lands as a direct push to `main`,** like every commit so far, because CI doesn't exist yet. From feature 001 onwards, work lands through PRs. Once branch protection is on, PRs are the only way in.
- **Extension versions:** install whatever `specify extension add` resolves from the catalog for Spec Kit 1.4.2 (git may be 1.0.8, newer than MCM's 1.0.5). Record the exact versions in the runbook. The gate's hook registry is built from the installed versions' hooks, including git's `before/after_taskstoissues` hooks.
- **Extension-installed skills** (`speckit-git-*`, `speckit-agent-context-update`) are vendor files that aren't in any integration manifest. The gate checks that every command listed in `.specify/extensions/.registry` has its skill file. It also uses the registry's recorded hashes to detect edits, if the registry stores them; otherwise it checks file presence only.
- **`/speckit-taskstoissues` source:**
  - Spec Kit 1.4.2 has no core `taskstoissues` command; it moved to the separate `github` extension.
  - BELAY forks MCM's existing Forgejo-adapted fork (originally from spec-kit 0.16.5), not the GitHub-MCP extension command.
  - The skill and the runbook record that provenance. Because the skill is project-owned, an upgrade has nothing upstream to diff it against.
- **Node in CI:** follow MCM's working pattern on the same homelab infrastructure. Every job runs `actions/setup-node` to get Node 24+, through the same action source MCM's workflows use. The first CI run confirms that both the runner label and setup-node work.

## Left to the builder

- Exact new gate failure-code names, and the shape of the hook registry.
- Whether `ci-log-step.sh` is worth porting, or the digest can work without it.
- Whether to split the script modules (for example shared forge-client code) differently from MCM, as long as the CLIs above hold.
- Test layout inside `scripts/__tests__/`.
