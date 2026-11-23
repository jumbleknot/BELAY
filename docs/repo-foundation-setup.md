# Setting up a new repository's foundation: the BELAY playbook

This guide replays, in order, everything done to set BELAY up between 2026-11-21 and 2026-11-23,
before any product code existed. Follow it when you start a new repository that should work the same
way: spec-driven, gated by CI, with the backlog in Forgejo issues and development in a sandboxed dev
container.

Each step says **what** to do, **why** it exists, which **BELAY files** to copy or adapt, and how to
**check** it worked. The detailed procedures stay in the runbooks under [docs/runbooks/](runbooks/).
This guide gives the order and links to them, and doesn't repeat them.

> **Reuse, don't rewrite.** BELAY copied most of its tooling from MovieCollectionManager (MCM) and
> changed only what tied it to MCM. Do the same with BELAY: copy the files, then work through
> [Renaming checklist](#renaming-checklist-what-to-change-when-copying) so no `belay` or `BELAY`
> name is left in the new repository.

## The order at a glance

| # | Step | How BELAY landed it | Time to allow |
| --- | --- | --- | --- |
| 0 | Workstation prerequisites | n/a | once per machine |
| 1 | Create the forge repository and the skeleton | direct commits to `main` | 30 min |
| 2 | Install GitHub Spec Kit | direct commit | 15 min |
| 3 | Constitution, tasks override and the Spec Kit gate | direct commit | 1–2 h |
| 4 | Spec Kit extensions and the hook gate | direct commit, from a design record | 1 h |
| 5 | pnpm + Nx workspace | feature 001 | 30 min |
| 6 | CI runner and the `guardrails` workflow | feature 001 | 2–3 h |
| 7 | Branch protection on `main` | manual, after the first green PR | 10 min |
| 8 | Forge credentials | manual | 20 min |
| 9 | PR and CI-status tooling | feature 002 | 1–2 h |
| 10 | Backlog in Forgejo issues and `/speckit-taskstoissues` | feature 003 | 1–2 h |
| 11 | `AGENTS.md` as an index, the `openwiki/` bundle, doc drift | PR | 1–2 h |
| 12 | Dev container on Docker Sandbox | feature 004 | half a day |
| 13 | The remaining guardrail gates, the wiki gates and registry retention | feature 005 | half a day |
| 14 | Final checks | n/a | 15 min |

Steps 1 to 4 go straight to `main`, because there is no CI or protection yet. From step 5 on, every
change goes through a Spec Kit feature and a pull request. That way the process you are building is
tested on real work while you build it.

---

## Step 0: Workstation prerequisites

Install these on the Windows workstation:

- **Git**, with a credential helper that holds your forge login.
- **Node.js 24 or later.** CI pins an exact version itself.
- **pnpm.** The repository pins the exact version in `package.json` `packageManager`.
- **uv**, then the Spec Kit CLI at a pinned version:
  `uv tool install --from git+https://github.com/github/spec-kit.git@v1.4.2 specify-cli`.
- **PowerShell.** Spec Kit is initialised with PowerShell scripts.
- **VS Code**, with the Remote-SSH and Dev Containers extensions.
- **Claude Code**, logged in with the **subscription**.
- **RTK** (Rust Token Killer) with its Claude Code hook (see
  [RTK token compression](../openwiki/invariants/rtk-token-compression.md)).
- **Docker Sandboxes (`sbx`)** at the version in [the dev-container runbook](runbooks/devcontainer.md),
  needed only for step 12.

> 🔴 **Never set `ANTHROPIC_API_KEY`** on the workstation, in the sandbox VM or in the container.
> Claude Code silently prefers it over a subscription login and bills per token. See
> [the secrets posture](../openwiki/invariants/secrets-management.md).

---

## Step 1: Create the forge repository and the skeleton

1. **Create the repository on Forgejo.** Make it private, with `main` as the default branch. Clone it.
2. **Commit these files one at a time**, so the history explains each one:

   | File | What it holds | Copy from BELAY? |
   | --- | --- | --- |
   | `README.md` | What the repo is, a Development section and a license line | Adapt |
   | `.gitattributes` | Stores text as LF. CRLF for `.ps1`, `.psm1`, `.psd1`, `.bat`, `.cmd`, `.sln`. LF for `.sh`. Lock files marked generated. Binary types listed. `scripts/__tests__/fixtures/** -text`, so a fixture keeps its exact bytes (step 13) | Copy as is |
   | `.gitignore` | Polyglot ignores: OS files, editors, `node_modules`, `bin/`, `build/`, `out/`, `dist/`, `target/`, `.env*` (keeping `.env.example`), key material, `.claude/settings.local.json` | Copy as is |
   | `LICENSE` | MIT | Adapt the holder and year |
   | `AGENTS.md` | The one instruction file for every coding assistant | Start small. It becomes an index in step 11 |
   | `CLAUDE.md` | A shim whose only content is `@AGENTS.md` | Copy as is |

3. **Lay out the top-level folders** with a `.gitkeep` in each, so the layout is decided before any
   code arrives: `agents/`, `api-specs/`, `assets/`, `backend/`, `docs/`, `frontend/`,
   `infrastructure-as-code/`, `mcp-servers/`, `packages/`, `scripts/`, `secrets/`, `security/`,
   `specs/` and `tools/`. In `secrets/`, track only `.gitkeep`, `README.md` and `*.example`.

**Traps:**

- **Write `node_modules` in `.gitignore` with no trailing slash.** With a slash, a symlinked
  `node_modules` (which worktrees use) is not ignored, gets committed, and breaks every CI install
  with `ENOTDIR`.
- `bin/`, `build/` and the other output names are ignored anywhere in the tree. If you need a tracked
  directory with one of those names, add a `!` exception rather than renaming around it.

**Check:** `git ls-files --eol` shows `i/lf` for every text file.

---

## Step 2: Install GitHub Spec Kit

From the repository root:

```powershell
specify init --here --ai claude --script ps
```

The exact command BELAY ran wasn't recorded. These flags reproduce what `.specify/init-options.json`
records. The command writes `.specify/` (scripts, core templates, a constitution stub, the integration manifests) and
the `/speckit-*` skills under `.claude/skills/`. Afterwards, `.specify/init-options.json` should read
`"integration": "claude"`, `"script": "ps"`, `"feature_numbering": "sequential"` and the pinned
`speckit_version`.

**Add the Spec Kit line-ending rules to `.gitattributes` in the same commit:**

```gitattributes
.specify/scripts/**/*.ps1 text eol=lf
.specify/extensions/**/*.ps1 text eol=lf
```

Spec Kit writes its `.ps1` files with LF and records their hashes in
`.specify/integrations/*.manifest.json`. The repository-wide `*.ps1 eol=crlf` rule would rewrite them
on checkout, so every hash would stop matching. The gate in step 3 would then report each one as an
edited Spec Kit file.

**Check:** `git status` is clean straight after a fresh clone.

---

## Step 3: Constitution, tasks override and the Spec Kit gate

This step makes Spec Kit enforce **your** process: TDD, the doc-impact sweep, and an Open the PR task.
It also makes sure a Spec Kit upgrade can't quietly undo those changes.

1. **The constitution** (`.specify/memory/constitution.md`). BELAY's was derived from MCM's v2.11.0
   and ratified as v1.0.0. Copy BELAY's, then rewrite the opening and anything specific to this
   repository. Keep the version-history comment at the top. Every amendment bumps the version:
   MAJOR for a principle, MINOR for guidance, PATCH for a clarification. BELAY's v1.0.1 added the
   dependency-pinning policy. See [the constitution page](../openwiki/process/constitution.md).
2. **The TDD task format**: copy `docs/templates/feature-test-tasks-template.md`. Every test task
   names the scenarios it covers and a **Verify RED** with the expected failure. Each one is paired
   with an implementation task that has a **Verify GREEN**.
3. **The tasks-template override**: copy `.specify/templates/overrides/tasks-template.md`. Spec Kit
   reads `overrides/` before its core templates. The override adds a **Doc-impact sweep** task in
   Phase 1, a **Close-out re-search** in Polish and an **Open the PR** task at the end, and it makes
   tests required. Its first line records the fork point:
   `<!-- forked-from: .specify/templates/tasks-template.md sha256=<hash> spec-kit=<version> -->`.
4. **Two registered local edits to Spec Kit-owned skills:**
   - `.claude/skills/speckit-tasks/SKILL.md`: replace "Tests are OPTIONAL" with "Tests are REQUIRED".
   - `.claude/skills/speckit-converge/SKILL.md`: step 7 appends convergence tasks in the TDD format.
5. **The gate**: copy `scripts/check-speckit-overrides.mjs` and its helpers under `scripts/lib/`,
   with their tests in `scripts/__tests__/`. It checks every Spec Kit-owned file against its manifest
   hash, and checks every override, local edit and project-owned file against its registry. Record
   the override's fork point with `--record`. Never type the hash by hand.
6. **The runbook**: copy `docs/runbooks/spec-kit.md`. Its customisation table is what the gate
   checks against (`inventory-stale`), so update the table whenever you add a customisation.

**Ownership rule.** Make every change to Spec Kit's behaviour in the first of these forms that works:

1. a project-owned file (an override or the constitution);
2. a local edit to a Spec Kit-owned file, registered in the gate and the runbook in the same change;
3. **never** an edit to a core template.

**Check:**

```bash
node scripts/check-speckit-overrides.mjs --selftest   # every failure code is detected
node scripts/check-speckit-overrides.mjs              # exit 0
node --test scripts/__tests__/check-speckit-overrides.test.mjs
```

---

## Step 4: Spec Kit extensions and the hook gate

BELAY wrote this step up as a design record first,
[docs/superpowers/specs/2026-11-22-speckit-forgejo-parity-design.md](superpowers/specs/2026-11-22-speckit-forgejo-parity-design.md).
That record also planned steps 5 to 10.

1. **Install the extensions:**

   ```powershell
   specify extension add git
   specify extension add agent-context
   ```

   The `git` extension's mandatory `before_specify` hook creates the feature branch, so
   `/speckit-specify` starts every feature on its own branch. `agent-context` keeps a pointer to the
   current plan in the agent context file.
2. **Point agent-context at `AGENTS.md`**, never the `CLAUDE.md` shim. In
   `.specify/extensions/agent-context/agent-context-config.yml`, set `context_file: AGENTS.md` and
   leave `context_files: []`.
3. **Keep `auto_commit` off** in the git extension's config. Sessions commit by convention instead:
   `spec(NNN)`, `plan(NNN)`, `tasks(NNN)`, `feat(NNN)`, `docs(NNN)`.
4. **Add the two hooks the installer doesn't**: `before_converge` and `after_converge` →
   `speckit.git.commit` (optional), at the end of `hooks:` in `.specify/extensions.yml`.
5. **Extend the gate** with the extension registry (`EXTENSIONS`) and the expected hooks
   (`EXTENSION_HOOKS`, where hand-added hooks carry `local: true`). A reinstall that drops the two
   converge hooks then fails `hook-lost`.

**Check:** run a trial reinstall (`specify extension add git --force`) and confirm the gate fails
`hook-lost`. Then restore the file with `git checkout`, **not** with a PowerShell 5.1 text round-trip,
which changes the bytes.

---

## Step 5: pnpm + Nx workspace (feature 001 begins)

From here on, use the full Spec Kit loop for every feature: `/speckit-specify`, `/speckit-plan`,
`/speckit-tasks`, (`/speckit-analyze`), then `/speckit-implement`. See
[spec-driven development](../openwiki/process/spec-driven-development.md).

Asking the maintainer which JavaScript toolchain to use is a structural decision. BELAY chose pnpm +
Nx, like MCM. Copy and adapt:

| File | Key settings |
| --- | --- |
| `package.json` | `"private": true`; `packageManager` pinned to an exact pnpm; `engines.node`; `"preinstall": "npx --yes only-allow pnpm"`; `nx` pinned exactly (a lockstep group) |
| `pnpm-workspace.yaml` | `packages:` globs; `allowBuilds:` with an explicit `true` or `false` for **every** package that has an install script; `overrides` go here, never in `package.json` |
| `nx.json` | `defaultBase: main`, cached `test` |
| `scripts/project.json` | Nx project `scripts` with a `lint` target (every gate and its `--selftest`) and a `test` target (`node --test "scripts/__tests__/*.test.mjs"`) |
| `pnpm-lock.yaml` | Committed. CI installs with `--frozen-lockfile` |

**Traps:**

- **pnpm 11+ fails an install** (`ERR_PNPM_IGNORED_BUILDS`) when a package with an install script has
  no `allowBuilds` decision. Treat each entry as a supply-chain decision. Never blanket-`true` them.
- **Don't set `minimumReleaseAge`.** On an empty store it makes a frozen install reject a pinned,
  freshly published dependency, which turns CI red.
- **Pass `node --test` a quoted glob, not a directory.** Node 24 treats a directory argument as a
  single file.

**Check:** `pnpm install --frozen-lockfile`, then `pnpm nx run scripts:lint` and
`pnpm nx run scripts:test` both exit 0. Also check that `npm install` is refused.

---

## Step 6: CI runner and the `guardrails` workflow (feature 001)

### 6a. Register a repository runner

Use a runner registered **for this repository only**, with its own label. BELAY's first run waited
36 minutes behind MCM's jobs on the shared runner. See [the CI runbook's Runner section](runbooks/ci.md#runner).

1. Go to Forgejo **Settings → Actions → Runners → Create new runner** (BELAY's is named `ci-belay`).
   Note its uuid and secret.
2. On the CI host, as the `ci` user, save the secret to a file with mode 600, and run
   `forgejo-runner daemon … --label <repo-label>:docker://node:26-bookworm` as a systemd user unit.
3. **Lock it down.** Register only a `docker://` label, so every job runs in a throwaway container.
   Then generate `config.yaml` and set `container.docker_host: "-"`, so pull-request code never gets
   the host's Docker.

### 6b. The workflow and its scripts

Copy and adapt:

| File | Purpose |
| --- | --- |
| `.forgejo/workflows/guardrails.yml` | One job: checkout, `setup-node` (exact version), install pnpm, frozen install, `scripts:lint`, `scripts:test`, then the failure digest. Triggers are `pull_request`, `push` to `main` only, and `workflow_dispatch`. Concurrency is keyed on the ref |
| `scripts/install-pnpm.sh` | Installs pnpm at exactly `packageManager` (Node 26 has no corepack) |
| `scripts/ci-log-step.sh` | Wraps every `run:` step: keeps its exit code and mirrors its output for the digest |
| `scripts/ci-failure-digest.mjs`, `scripts/ci-digest-redact.mjs` | On failure, publishes a redacted digest: a PR comment on pull requests, a commit status on `main`, and a full bundle in the generic package `<repo>-ci-failures` |
| `scripts/check-ci-digest-coverage.mjs` | A gate: every job must end with the digest step |
| `scripts/secret-scan.mjs` | Secret-scan rules. Its selftest runs in `scripts:lint`; the tree scan joins in step 13 |
| `scripts/__tests__/guardrails-workflow.test.mjs` | Pins the workflow's shape, including `runs-on` |

Keep `uses:` to actions the Forgejo instance mirrors (`actions/checkout`, `actions/setup-node`), and
pin each one by commit SHA.

**Why `push` is limited to `main`:** with a bare `push:`, a push to a branch with an open PR runs
guardrails twice, and the two runs don't cancel each other.

### 6c. Add the digest secret

Add `CI_DIGEST_TOKEN` (`write:issue`, `write:package`, `read:repository`) under **Settings → Actions →
Secrets**. When it is missing, the digest falls back to the run token, then to the job log. CI never
goes red because of it.

**Check:**

- The first PR shows a green `guardrails` run on your runner label.
- **Prove the digest works.** BELAY pushed a commit that failed on purpose, confirmed the PR comment
  named the failing step with its output, then removed the commit. Do the same.

---

## Step 7: Branch protection on `main`

Do this once, **after** the first green guardrails run on a PR. The status check isn't offered in the
list until it has reported.

1. Go to **Settings → Branches → Add new rule**, with pattern `main`.
2. **Push:** select **Disable push**.
3. **Status checks:** enable them, and add the context **exactly** as the PR shows it. For BELAY that
   is `guardrails / guardrails (pull_request)`.
4. Optional: block a merge when the branch is out of date.

You don't need a repository setting to delete merged branches: `forge-pr.mjs merge` (step 9) asks the
forge to delete the branch as part of the merge.

**Check:** `git push origin HEAD:main` is refused, and a PR with a red guardrails run shows the merge
as blocked.

From now on, `main` changes only through PRs.

---

## Step 8: Forge credentials

Create separate tokens with the smallest scope each one needs. Forgejo tokens are account-wide, so
scope is the only server-side limit.

| Name | Where | Scope | Used by |
| --- | --- | --- | --- |
| `FORGE_TOKEN` | user environment variable | read-only: `read:repository`, `read:issue`, `read:package` | `ci-status.mjs`; read fallback for the backlog |
| `FORGE_ISSUE_TOKEN` | user environment variable | `write:issue`, `read:repository` | `backlog.mjs`, `taskstoissues.mjs` |
| the git credential for `origin` | the git credential helper | your push access | `forge-pr.mjs` (open, merge, dispatch) |
| `CI_DIGEST_TOKEN` | repository Actions secret | `write:issue`, `write:package`, `read:repository` | the CI failure digest only |
| `REGISTRY_TOKEN` | repository Actions secret | `write:package` | the dev-container image push only (step 12) |
| `REGISTRY_CLEANUP_TOKEN` | repository Actions secret | `write:package` | the registry-retention report (step 13). Without it the job fails loudly |

On Windows, set the user variables with `setx` or System Properties, then **restart the editor and
terminal**. A running process keeps its old environment.

**Rules:** never print a token; never put one in argv; never widen `FORGE_TOKEN` (`ci-status` relies
on it being read-only); never type a `git credential fill` recipe into a command whose output is
captured.

---

## Step 9: PR and CI-status tooling (feature 002)

This makes the whole PR loop scriptable, so an assistant can open, watch and merge without the web UI.
Copy and adapt:

- `scripts/lib/forge-credential.mjs`: derives the API base, owner and repo from `git remote get-url origin`.
- `scripts/lib/argv-contract.mjs`: strict argument parsing.
- `scripts/ci-status.mjs`: `status`, `watch`, `failure` and `durations`. Exit codes: 0 mergeable,
  1 a required check failed, 2 bad arguments or a missing scope, **3 still waiting (never a failure)**.
- `scripts/forge-pr.mjs`: `open` (refuses AGit `refs/` heads, whose runs get no secrets),
  `merge <n> --expect-head <sha>` (merges only if the head matches, CI is green and the forge says
  the PR is mergeable), and `dispatch`.

Then update the override's **Open the PR** task to name the loop:

```bash
git push origin HEAD:<branch>
node scripts/forge-pr.mjs open --head <branch> --title "<title>" --body-file <file>
node scripts/ci-status.mjs watch --pr <n> --timeout 900
node scripts/forge-pr.mjs merge <n> --expect-head "$(git rev-parse HEAD)"
```

Re-record the override with `--record`.

**Check:** merge feature 002's own PR with `forge-pr.mjs merge`. Details are in
[the CI runbook](runbooks/ci.md#pull-requests-and-ci-status).

---

## Step 10: Backlog in Forgejo issues (feature 003)

Copy and adapt:

- `scripts/backlog.mjs`: `list`, `ready`, `show`, `create`, `update`, `comment`, `dep`,
  `setup-labels`, `setup-milestone` and `validate-form`. Every write checks it is going to the
  `origin` repository, and it refuses unknown labels or milestones locally, because Forgejo silently
  ignores them. It sets `process.exitCode` rather than calling `process.exit()`, which aborts with
  exit 127 on Windows.
- `.forgejo/issue_template/backlog-item.yaml`: four fixed sections (context, acceptance criteria,
  affected components, discovered during). It takes effect only from the default branch.
- `.claude/skills/forgejo-issues/SKILL.md`: when work belongs in the backlog, and how to file and
  close an item.
- `.claude/skills/speckit-taskstoissues/SKILL.md` with `scripts/taskstoissues.mjs`: mirrors a
  feature's `tasks.md` into a milestone, one issue per task, deduplicated by task id and chained with
  `dep`. Register the skill in the gate's `PROJECT_OWNED` list and in row 6 of the Spec Kit runbook.

Then run, once:

```bash
node scripts/backlog.mjs setup-labels --dry-run
node scripts/backlog.mjs setup-labels        # type/*, priority/p1..p3, status/blocked, status/needs-spec
```

**Conventions:** close an issue with a comment and then `update --state closed`. Never use
`closes #N`, because issues and PRs share one number sequence. Run no bulk operation without an
explicit instruction. Details are in [the backlog runbook](runbooks/backlog.md).

**Check:** `node scripts/taskstoissues.mjs <NNN-slug> --dry-run`, then a real run on the feature's own
`tasks.md`. Running it a second time creates nothing.

---

## Step 11: `AGENTS.md` as an index, the `openwiki/` bundle and doc drift

Once there is enough to know, turn `AGENTS.md` from prose into an **index**. Copy the structure, then
rewrite the content for the new repository:

- **`AGENTS.md`**: a one-line description of the repository; **Gates that run before you act** (each
  a rule, its trap and a link); **Start here**; **Where a new learning goes**; and a **Knowledge
  index**. It holds no long explanations.
- **`openwiki/`**: concept pages under `projects/`, `invariants/`, `gotchas/`, `runbooks/` and
  `process/`, with an `index.md` in each, plus `quickstart.md`. Each page carries a short summary and
  its gotchas. A page either cites a `resource` it summarises, or is the canonical home of its
  subject. If it is canonical, list it in `openwiki/protected.yaml`.
- **`openwiki/INSTRUCTIONS.md`**: the hand-authored brief, covering scope, exclusions, redaction (no
  forge host, tailnet address or host-and-port pair in any page), front matter, and where a new
  learning goes.
- **`docs/runbooks/doc-drift.md`**: the doc-impact sweep (live, through the tasks override) and the
  quarterly drift audit, a backlog item that files its own successor.

**The same-PR rule:** a change to a file that an `openwiki/` page cites as its `resource` refreshes
that page in the same PR. BELAY first kept this by review; step 13 adds the gate that enforces it.

---

## Step 12: Dev container on Docker Sandbox (feature 004)

This gives the maintainer and several concurrent assistant sessions an isolated, reproducible
environment with default-deny egress. Follow [the dev-container runbook](runbooks/devcontainer.md)
**Bring-up from nothing** section step by step. In outline:

1. **Committed config** (copy and adapt everything under `.devcontainer/`):
   - `devcontainer.json`, the only config.
   - A slim `toolchain.Dockerfile`: Node pinned by digest, `coder` at uid 1000, Claude Code, gh, uv
     and the Spec Kit CLI at its pin, pwsh, pnpm at `packageManager`, and minimal Rust for building
     RTK.
   - A thin `Dockerfile` that is `FROM` the digest-pinned image.
   - `egress-allowlist.json`: every destination with a group and a reason. The forge host is supplied
     at run time and never committed.
   - The lifecycle scripts: image-pin check, secrets env-file generation, workspace ownership repair,
     Claude config persistence, RTK hook wiring, and the egress self-check.
   - `devcontainer-lock.json`: tracked on purpose, because it is the supply-chain signal.
2. **CI publishes the image.** `.forgejo/workflows/devcontainer-image.yml` builds on a push to `main`
   that touches an image input, on dispatch, and weekly. It **never** runs on pull requests, because
   its runner has the host's Docker. It needs the repository variables `REGISTRY`, `NS` and
   `REGISTRY_USER`, and the secret `REGISTRY_TOKEN`.
3. **The gates.** `scripts/gen-egress-policy.mjs --check` joins `scripts:lint`, and guard tests pin
   `devcontainer.json`, the toolchain Dockerfile and the workflow's triggers.
4. **On the host:** create the sandbox (8 GiB, with an **empty** scratch workspace), apply the egress
   policy before anything pulls, provision Node and the devcontainer CLI in the VM, write
   `~/.belay-sandbox-env` (mode 600), log in to the registry, clone, and run `devcontainer up` with
   the dotfiles repository.
5. **Log in once** inside the container: `claude` → `/login` (subscription), and `gh auth login`.
   Both persist on the `belay-claude` volume.
6. **The launcher:** `.\scripts\open-sandbox.ps1` starts the sandbox if it has idle-stopped and opens
   VS Code in the container.

**Rules that cost the most to learn:**

- **No credential in `containerEnv`**, which is baked into image layers, and none on a
  `docker run -e` line, which shows in `ps`. Tokens travel by `--env-file`.
- **Approve nothing from the sandbox's approval queue**; dismiss the entries instead. Change
  `egress-allowlist.json` and apply the change.
- **Commit from a worktree, never from the shared checkout**, when other sessions may be active (see
  [the worktree rule](runbooks/devcontainer.md#shared-dev-container-commit-from-a-worktree)).

**Check:** inside the container, `pnpm nx run scripts:lint && pnpm nx run scripts:test` pass with
0 skips, and the container start logged `[assert-egress-governed] PASS`.

---

## Step 13: The remaining guardrail gates, the wiki gates and registry retention (feature 005)

Steps 6 and 11 left rules that were written down but kept only by review. This step ports the gates
that enforce them, and the retention job the weekly image build needs. BELAY landed it as one feature
(four backlog items, one spec, one PR), because every port has the same shape and touches the same
files: `scripts/project.json`, the CI runbook and `AGENTS.md`. Each gate is still its own `scripts:lint`
command, so a red build names the gate.

**How to port a gate:** clone the source repository read-only, and port its script **and** its tests.
Change only what ties them to the source repository. Write the test first and watch it fail, then port
the script. Where the source has no test file, write one. Every gate follows one contract: `--selftest`,
`--help`, `--dir <root>` for tests, exit 0 clean / 1 finding / 2 bad input, and findings printed as
`<file>:<line>: <rule>: <message>`. A finding never prints a secret's value.

| Gate or tool | What it enforces |
| --- | --- |
| `scripts/secret-scan.mjs` (tree scan) | No credential-shaped string in a tracked file |
| `scripts/check-topology-scrub.mjs` | No real tailnet host (`*.ts.net`) in a tracked file. A host containing `tailnet` or `example` is a placeholder. Add this gate **before** a host can leak: BELAY needed a history rewrite to undo one |
| `scripts/check-toolchain-consistency.mjs` | One Node major across every pin, each at or above `engines.node`; every Node-running workflow job pins Node with `setup-node`; pnpm named only by root `packageManager`; `nx`, `@nx/*` and `@playwright/test` exact |
| `scripts/check-no-inline-secrets.mjs` | No literal credential, password-bearing URL or inline `${VAR:-default}` in a compose file |
| `scripts/check-no-argv-secrets.mjs` | No secret-named `--env`/`-e` argument on a Maestro command line |
| `scripts/check-override-consistency.mjs` | Each keyed `pnpm-workspace.yaml` override has its key bound equal to its value floor, and its cap does not widen past the declared major |
| `scripts/check-resource-naming.mjs` | Compose volume, network and container names follow `<context>-<role>-<engine>`, `container_name` equals the service key, and every named network is in `APPROVED_NETWORKS`. A context is a project directory under `backend/`, `frontend/`, `agents/` or `mcp-servers/` |
| `scripts/check-openwiki-okf.mjs` | The `openwiki/` bundle: front matter, links, an `index.md` per directory, no orphans, and **V17**: a derived page's `resource-sha256` matches its source |
| `scripts/check-openwiki-governance.mjs` | `AGENTS.md` is an index within its size budget, `CLAUDE.md` is only the shim, and every concept is derived or listed in `protected.yaml` |
| `scripts/wiki-refresh.mjs` + `.claude/skills/wiki-refresh/` | `--stale`, `--diff <page>`, `--record <page>`. The only way a fingerprint is written |
| `scripts/registry-retention.mjs`, `.forgejo/workflows/registry-retention.yml`, `infrastructure-as-code/forgejo/registry-retention.yaml` | Weekly, **report-only**. Keeps the newest 4 dev-container images or any under 21 days, plus the digests under `protect:`. Deleting needs `mode: apply` in the config **and** a dispatch with `apply: true` |

**Port gates ahead of the surfaces they guard.** The compose, Maestro, override and naming gates
have nothing to scan in a new repository, but the constitution requires those surfaces. A gate that
lands with the first compose file catches only what comes after it, so port them now. Each prints how
many files it examined, so "0 files" shows instead of a silent pass. Keep the source's rules and
replace its names: BELAY's naming gate takes its contexts from the project directories, and keeps its
vendor-bundle, retired-key and approved-network lists empty until they are needed. Keep an allowlist
enforced even while it is empty: BELAY's approved-networks list makes the first named network fail
until someone approves it, as MCM's did.

**Defer what needs a structural decision, then stage it.** SAST needs Semgrep, uv and Rust on the
runner, which is the maintainer's call. BELAY filed it as a staged backlog item (item #37). Stage 1
landed as feature 006, after the maintainer approved uv: a separate `sast` job in `guardrails.yml`
runs Semgrep and `pnpm audit`, ported from MCM's feature 033. The enabled scanners are a list in
`security/sast/scan.yaml`, so cargo-audit (the first Rust code) and pip-audit (the first Python
project) are a list entry plus a toolchain step. Copy `scripts/sast-scan.mjs`,
`scripts/check-sast-findings.mjs`, `scripts/allowlist-expiry.mjs`, `scripts/lib/scanner-retry.mjs`
and `security/sast/`, seed the allowlist from a full scan (BELAY's was empty), and add
`guardrails / sast (pull_request)` to branch protection after its first green run. See
[the SAST runbook](runbooks/sast.md).

**Then:**

1. Run both wiki gates on the real bundle and fix every finding in the pages, never with an allowlist.
2. Record every derived page with `node scripts/wiki-refresh.mjs --record <page>`.
3. Say the rules are enforced, naming the gates, in `openwiki/INSTRUCTIONS.md`,
   `openwiki/process/wiki-maintenance.md`, the `protected.yaml` header, `AGENTS.md` and `CLAUDE.md`.
4. Add `REGISTRY_CLEANUP_TOKEN` (step 8), and record the sandbox's image pin under `protect:` after
   every re-pin (see [the dev-container runbook](runbooks/devcontainer.md#re-pin-the-image)).

**Traps:**

- **A fixture whose line endings are the subject of a test needs `-text`.** `* text=auto eol=lf`
  rewrites a CRLF fixture to LF on commit. The test still passes, but it no longer tests CRLF.
- **A new gate flags your own docs.** The argv gate failed on the runbook line that described it,
  because the example matched the rule. Reword the prose; don't exempt the file.
- **Retention cannot read a pin that lives outside git.** The sandbox's pin is in the VM's env file,
  so it must be recorded in `protect:`. The window covers a pin nobody recorded.
- **Editing a file a wiki page cites turns V17 red.** Run `wiki-refresh.mjs --stale` after every docs
  change, and record each page it lists.

**Check:**

- `pnpm nx run scripts:lint` runs every gate after its selftest, and they add about a second.
- Plant one violation per gate (a real-shaped host built from fragments, a `^` on `nx`, an edited wiki
  source, prose in `AGENTS.md`, a compose literal, a misnamed container, a Maestro `--env` secret, a
  split override) and confirm each fails. Then revert.
- `node scripts/registry-retention.mjs --package <repo>-devcontainer` with `FORGE_TOKEN` prints a
  keep/delete row per version and deletes nothing. `--apply` exits 2.

---

## Step 14: Final checks

Run all of these on the finished foundation:

- [ ] `pnpm install --frozen-lockfile` works, and `npm install` is refused.
- [ ] `pnpm nx run scripts:lint` and `pnpm nx run scripts:test` exit 0. Check the **skip count**,
  because a skipped test exits 0 too.
- [ ] `node scripts/check-speckit-overrides.mjs` exits 0.
- [ ] A direct push to `main` is refused.
- [ ] A throwaway PR goes green, is merged by `forge-pr.mjs merge --expect-head`, and its branch is
  deleted.
- [ ] `node scripts/backlog.mjs ready` lists issues, and a write without `FORGE_ISSUE_TOKEN` exits 3.
- [ ] `/speckit-specify` creates a numbered feature branch.
- [ ] `ANTHROPIC_API_KEY` is unset everywhere (`echo $env:ANTHROPIC_API_KEY` on the host prints
  nothing).
- [ ] `node scripts/wiki-refresh.mjs --stale` prints nothing.
- [ ] The `registry-retention` workflow's first report lists every image version and deletes nothing.
- [ ] `git grep -n -i belay` returns only places where the name is intended.

---

## Renaming checklist: what to change when copying

BELAY's name is built into these places. Rename each one, and the guard test that pins it:

| What | In BELAY |
| --- | --- |
| Workspace package name | `@belay/workspace` in `package.json` |
| Runner label and runner name | `belay`, `ci-belay` (`guardrails.yml`, `guardrails-workflow.test.mjs`, the CI runbook) |
| Failure-digest package | `belay-ci-failures` |
| Dev-container image | `belay-devcontainer` (workflow, `scripts/build-devcontainer-image.mjs`, `devcontainer.json`, `registry-retention.yaml`) |
| Retention config | `owner:` and the package names in `infrastructure-as-code/forgejo/registry-retention.yaml`. Start `protect:` empty and `mode: report` |
| Sandbox name, checkout path and volumes | `belay`, `/workspaces/belay`, `belay-claude`, `belay-pnpm-store`, `belay-commandhistory` |
| Environment-variable prefix | `BELAY_DEVCONTAINER*`, `~/.belay-sandbox-env`, `~/.belay-devcontainer-secrets.env` |
| Status context for branch protection | `guardrails / guardrails (pull_request)` and `guardrails / sast (pull_request)`. Record it from the first green run; don't assume it |
| The constitution's name and opening | `.specify/memory/constitution.md` |
| The `AGENTS.md` description line and `openwiki/projects/repository.md` | the description of the repository |

**Also start these fresh:** `specs/` (start feature numbering at 001), the backlog, the derived
wiki pages' `resource-sha256` (re-record them, because the sources differ), the audit log in
`doc-drift.md`, and dated measurements in the runbooks. Those measurements are history from BELAY and
aren't true of the new repository until you measure them there.

## Where BELAY's history is recorded

- The design record behind steps 4 to 10:
  [docs/superpowers/specs/2026-11-22-speckit-forgejo-parity-design.md](superpowers/specs/2026-11-22-speckit-forgejo-parity-design.md).
- Each feature's spec, plan, research and tasks: [specs/001-guardrails-ci](../specs/001-guardrails-ci/spec.md),
  [002-pr-ci-tooling](../specs/002-pr-ci-tooling/spec.md),
  [003-backlog-taskstoissues](../specs/003-backlog-taskstoissues/spec.md),
  [004-devcontainer-sandbox](../specs/004-devcontainer-sandbox/spec.md),
  [005-guardrail-gate-ports](../specs/005-guardrail-gate-ports/spec.md),
  [006-sast-stage1](../specs/006-sast-stage1/spec.md).
- Gaps that are known and not built yet live in the backlog: `node scripts/backlog.mjs list`. For
  example, item #37 holds SAST stages 2 to 4.
