# AGENTS.md

Guidance for AI coding agents working in this repository.

## About this repo

BELAY (**B**uild, **E**ngineering, **L**ifecycle & **A**utomation **Y**ard) is a polyglot monorepo. It holds common tooling that other repositories share: SDLC, PDLC, DevSecOps, and general engineering utilities. Treat everything here as a dependency of other projects. A change here can affect every repo that uses BELAY.

The repo is in early setup. No language toolchains or build system have been chosen yet. Don't assume one. If a task needs a structural decision, such as a build tool, a language for a new tool or a new top-level folder, ask before introducing it.

## Layout

Top-level folders (most are still empty placeholders):

| Folder | Purpose |
| --- | --- |
| `docs/` | Documentation |
| `openwiki/` | Wiki content |
| `specs/` | Spec Kit feature specifications (see below) |
| `scripts/` | Repo scripts, including the Spec Kit override gate (`check-speckit-overrides.mjs`) and its tests in `scripts/__tests__/` |
| `api-specs/` | API specifications |
| `secrets/` | Local secrets. Only `.gitkeep`, `README.md` and `*.example` files are tracked. Never commit real secrets. |
| `agents/` | AI agents |
| `mcp-servers/` | MCP servers |
| `backend/` | Backend code |
| `frontend/` | Frontend code |
| `packages/` | Shared packages and libraries |
| `infrastructure-as-code/` | Infrastructure as code |
| `assets/` | Static assets |
| `security/` | Security tooling and policy |
| `target/` | Build output. It's ignored by Git and never committed. |
| `tools/` | Developer tools |

## Conventions

- **Line endings:** [.gitattributes](.gitattributes) stores text as LF. Windows script types (`.ps1`, `.psm1`, `.psd1`, `.bat`, `.cmd`, `.sln`) use CRLF, and shell scripts must stay LF. Don't override these per file.
- **Ignored paths:** [.gitignore](.gitignore) ignores `bin/`, `build/`, `out/`, `dist/` and `target/` anywhere in the tree. If you need a tracked directory with one of those names, such as a scripts `bin/`, add an explicit `!` exception rather than renaming around it.
- **Lock files:** commit lock files such as `Cargo.lock`, `package-lock.json` and `pnpm-lock.yaml`. This repo builds runnable tools, so reproducible builds matter.
- **Secrets:** never commit secrets, `.env` files, keys or Terraform state. Use `*.example` files for templates.
- **License:** MIT (see [LICENSE](LICENSE)). Don't add code or dependencies with licenses that are incompatible with MIT redistribution.

## Spec-driven development (Spec Kit)

This repo uses [GitHub Spec Kit](https://github.com/github/spec-kit) 1.4.2, set up for Claude Code with PowerShell scripts.

- **Feature specs** go in `specs/<NNN>-<feature-name>/`, numbered sequentially. Each one holds `spec.md`, `plan.md`, `tasks.md` and any checklists.
- **Project principles** are in [.specify/memory/constitution.md](.specify/memory/constitution.md). Every `/speckit-*` command reads it.
- **Customisations:** `/speckit-tasks` builds from the project override [.specify/templates/overrides/tasks-template.md](.specify/templates/overrides/tasks-template.md). The override requires a doc-impact sweep, test tasks in the Verify RED / Verify GREEN format of [docs/templates/feature-test-tasks-template.md](docs/templates/feature-test-tasks-template.md), and a close-out re-search. Two Spec Kit skills carry registered local edits. [docs/runbooks/spec-kit.md](docs/runbooks/spec-kit.md) lists every customisation and the upgrade procedure.
- **Spec Kit owns** every file listed in `.specify/integrations/*.manifest.json`, and `specify integration upgrade --force` overwrites them. Never edit a core template; use an override. Register any edit to a Spec Kit-owned file in `scripts/check-speckit-overrides.mjs` and the runbook in the same change.
- **Extensions:** Spec Kit's `git` and `agent-context` extensions are installed. `/speckit-specify` creates the feature branch through the mandatory `before_specify` hook, and every command offers an optional commit. agent-context maintains the section between `<!-- SPECKIT START -->` and `<!-- SPECKIT END -->` in this file; never edit inside it by hand. The gate checks the extensions and their hooks, including two hand-added `converge` hooks that a reinstall drops (see the runbook).
- **Run the gate** before committing changes under `.specify/` or `.claude/skills/speckit-*`: `node scripts/check-speckit-overrides.mjs`. When it fails because you changed something it protects, fix the cause. Never delete or weaken the gate.
- **Skills** are in `.claude/skills/speckit-*`. The workflow runs in this order:
  1. `/speckit-constitution`
  2. `/speckit-specify`
  3. `/speckit-clarify` (optional)
  4. `/speckit-plan`
  5. `/speckit-checklist` (optional)
  6. `/speckit-tasks`
  7. `/speckit-analyze` (optional)
  8. `/speckit-implement`

  `/speckit-converge` adds tasks for any work that's still missing from the codebase.

## Working practices

- Keep changes focused. Shared tooling should stay small, documented and backward compatible where practical, because downstream repos depend on it.
- When you add a tool or package, document what it's for and how to use it, either in its own README or in the root [README.md](README.md).
- Update this file when you establish a new repo-wide convention: a layout, a build command, a test command or a release process.

## Git

- The default branch is `main`, on the self-hosted remote `origin`.
- Commit or push only when asked to.
