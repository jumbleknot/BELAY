# AGENTS.md — the instruction file for every coding assistant

BELAY is a polyglot monorepo of tooling that other repositories share, so every change here is a change to its consumers — [the repository](openwiki/projects/repository.md)

## Gates that run before you act

- **Never set `ANTHROPIC_API_KEY` where AI coding runs — it runs on the subscription** — Claude Code silently prefers that variable over a subscription login and bills per token; a tool that needs a model key takes it under another name, mapped only at the point of use — [secrets posture](openwiki/invariants/secrets-management.md)
- **SDD is not optional for implementation** — code under `backend/`, `frontend/`, `agents/`, `mcp-servers/`, `packages/`, `tools/` or `infrastructure-as-code/` needs an existing `specs/NNN-*/` spec → plan → tasks set; write it first, or stop and ask. Docs, proposals and knowledge/index edits are exempt — [the lifecycle](openwiki/process/spec-driven-development.md)
- **Other agents share this dev container — commit from a WORKTREE, never from `/workspaces/belay`** — a `git checkout -b`, `git add -A` or `git stash` there rewrites another session's work. `git worktree add -b <branch> /home/coder/worktrees/<slug> origin/main` (`/workspaces` is not writable); a symlinked `node_modules` serves `node --test` and gate scripts only, while any `pnpm nx` target needs a real `CI=true pnpm install --frozen-lockfile` in the worktree. It does not survive a rebuild — push first. Forge-API work needs no worktree — [procedure, traps, cleanup](docs/runbooks/devcontainer.md#shared-dev-container-commit-from-a-worktree)
- **A structural decision is asked, not taken** — a new language toolchain, build plugin, top-level folder or dependency with an install script needs the maintainer's yes first; only pnpm + Nx is chosen — [the repository](openwiki/projects/repository.md)
- **A PR's head MUST be a real branch — never an AGit push** — `git push origin HEAD:<branch>`, then `node scripts/forge-pr.mjs open`, `ci-status.mjs watch --pr <n>`, `forge-pr.mjs merge <n> --expect-head <sha>`; never hand-type a `git credential fill` recipe. An AGit (`refs/for/main`) head runs with NO Actions secrets — [the PR loop](openwiki/runbooks/ci.md)
- **Commit or push only when asked; on `main`, branch first** — `main` is protected (no direct push, `guardrails` required) — [git](openwiki/projects/repository.md)
- **Branch on `ci-status` exit codes: 3 is "still waiting", never a failure** — 0 mergeable, 1 required check failed, 2 bad arguments or missing token scope — [the PR loop](openwiki/runbooks/ci.md)
- **A tool's "no" is about the tool, not your question — check before claiming anything verified OR impossible** — a skipped test exits 0 and reads as a pass (watch the SKIP COUNT); a forge empty list or 404 often means the wrong token or id — [testing tiers](openwiki/invariants/testing-tiers.md), [instrument traps](openwiki/gotchas/instrument-traps.md)
- **"It can't run in this environment" needs the same proof as "it passes"** — a credential- or tool-driven skip is almost always a missing *file* or setting; name the missing input before retiring a tier to CI — [testing tiers](openwiki/invariants/testing-tiers.md)
- **Before believing a result, check the INSTRUMENT** — `node --test <file> --test-name-pattern x` runs EVERYTHING (node's flags go before the path); RTK can rewrite an answer into its opposite (re-run under `rtk proxy`); confirm a script supports `--dry-run` before trusting one — [instrument traps](openwiki/gotchas/instrument-traps.md)
- **Run the checks your DIFF touches — and CI's two targets before every push** — `pnpm nx run scripts:lint` and `pnpm nx run scripts:test` are exactly what CI runs; a change under `.specify/` or `.claude/skills/speckit-*` also needs `node scripts/check-speckit-overrides.mjs` first — [validation checklist](openwiki/invariants/feature-validation-checklist.md)
- **A guard that fails because you changed what it protects gets UPDATED at the cause, never deleted** — make it assert the new premise so it still fails if that regresses — [testing tiers](openwiki/invariants/testing-tiers.md)
- **Never edit a Spec Kit-owned file without registering it; never edit a core template** — `specify integration upgrade --force` overwrites them; use an override, or register the local edit in `scripts/check-speckit-overrides.mjs` and the runbook in the same change — [Spec Kit](openwiki/runbooks/spec-kit.md)
- **Changing a file that an `openwiki/` page cites as its `resource` means refreshing that page IN THE SAME PR** — not yet gated (no V17 here; item #28), so it is on you and on review: `git grep -n "^resource: <path>" openwiki/` — [wiki maintenance](openwiki/process/wiki-maintenance.md)
- **pnpm only, through Nx** — `pnpm install --frozen-lockfile`; npm and yarn are refused by `preinstall`; every package with an install script needs an `allowBuilds` entry — [pnpm](openwiki/invariants/package-manager-enforcement.md), [Nx](openwiki/invariants/nx-task-runner.md)
- **Never commit secrets, `.env` files, keys or Terraform state; never print a credential** — templates are `*.example`; docs and wiki pages never name the forge host or a tailnet address — [secrets posture](openwiki/invariants/secrets-management.md)

## Start here

- **This is the ONE instruction file** — tools that read `AGENTS.md` read it directly; Claude Code reads it through the [CLAUDE.md](CLAUDE.md) shim's `@AGENTS.md` import
- [openwiki/quickstart.md](openwiki/quickstart.md) — how the knowledge bundle is organized, and where to start by task
- [openwiki/INSTRUCTIONS.md](openwiki/INSTRUCTIONS.md) — the brief: scope, exclusions, redaction, front matter, **where a new learning goes**
- [openwiki/process/wiki-maintenance.md](openwiki/process/wiki-maintenance.md) — the same-PR refresh duty, and the gates not yet ported
- [openwiki/protected.yaml](openwiki/protected.yaml) — which concepts are authoritative

## Where a new learning goes

- A concept citing a `resource` is a **derived summary** → write the learning into the cited source **and refresh the concept in the same PR** — [the rule](openwiki/INSTRUCTIONS.md)
- A concept marked **[canonical]** below has no upstream document → write the learning **into the concept** — [the canonical list](openwiki/protected.yaml)
- No concept covers the subject → **add one**, writing detail into the subject's canonical document where it has one — [how to](openwiki/INSTRUCTIONS.md)
- **Never** into this file: it is an index — an entry keeps its rule, its trap and a link; the story goes in the linked page
- **Never** into [CLAUDE.md](CLAUDE.md) either: it is a shim, so content there reaches Claude alone

## Knowledge index

### Projects

- [BELAY repository — layout and working conventions](openwiki/projects/repository.md) **[canonical]** — folders, line endings, ignored paths, lock files, license, git

### Invariants

- [Final validation checklist](openwiki/invariants/feature-validation-checklist.md) **[canonical]** — what runs before a feature is complete
- [Nx as the universal task runner](openwiki/invariants/nx-task-runner.md) **[canonical]** — `scripts:lint` / `scripts:test`, and the operator-CLI exception
- [Package-manager enforcement (pnpm only)](openwiki/invariants/package-manager-enforcement.md) **[canonical]** — `preinstall`, `packageManager`, `allowBuilds`
- [RTK (Rust Token Killer) token compression](openwiki/invariants/rtk-token-compression.md) **[canonical]**
- [Secrets management posture](openwiki/invariants/secrets-management.md) **[canonical]** — the three forge credentials and their scopes
- [Testing tiers and what gates a merge](openwiki/invariants/testing-tiers.md) **[canonical]**

### Gotchas

- [.env files — no inline comments on value lines](openwiki/gotchas/env-file-inline-comments.md) **[canonical]**
- [Instrument traps — a tool's answer is about the tool](openwiki/gotchas/instrument-traps.md) **[canonical]**

### Runbooks

- [The agent-driven backlog (Forgejo Issues)](openwiki/runbooks/backlog.md) — `scripts/backlog.mjs`, `/speckit-taskstoissues`
- [CI guardrails, the failure digest, and the PR loop](openwiki/runbooks/ci.md) — `guardrails.yml`, `ci-status.mjs`, `forge-pr.mjs`
- [The dev container — Docker Sandbox, credentials, egress and the worktree rule](openwiki/runbooks/devcontainer.md) — `open-sandbox.ps1`, recreate, re-pin, the worktree rule
- [Doc drift: the doc-impact sweep and the quarterly audit](openwiki/runbooks/doc-drift.md)
- [Spec Kit: this repository's customisations, and upgrading it](openwiki/runbooks/spec-kit.md) — the override gate and its failure codes

### Process

- [The governing constitution](openwiki/process/constitution.md)
- [PR batching — split only when a failure would be ambiguous](openwiki/process/pull-request-batching.md) **[canonical]**
- [Proposal → spec → plan → tasks → implementation lifecycle](openwiki/process/spec-driven-development.md) **[canonical]** — Spec Kit 1.4.2, the `/speckit-*` order
- [Test authoring conventions — the RED/GREEN format](openwiki/process/test-authoring-conventions.md) **[canonical]**
- [OpenWiki bundle maintenance](openwiki/process/wiki-maintenance.md) **[canonical]**
