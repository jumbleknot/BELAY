---
type: Reference
title: BELAY repository — layout and working conventions
description: What the BELAY monorepo is for and why every change here is a change to its consumers, the top-level folder layout, the repository-wide file conventions (line endings, ignored paths, lock files, secrets, license), the structural decisions that need asking first, and the working practices for shared tooling.
tags: [repository, layout, conventions, monorepo]
timestamp: 2026-11-22
---

# BELAY repository — layout and working conventions

BELAY (**B**uild, **E**ngineering, **L**ifecycle & **A**utomation **Y**ard) is a polyglot monorepo
of common tooling that other repositories share: SDLC, PDLC, DevSecOps and general engineering
utilities. **Treat everything here as a dependency of other projects.** A change here can affect
every repository that uses BELAY, so shared tooling stays small, documented and backward compatible
where practical.

The repository is in early setup. The JavaScript toolchain is chosen (pnpm and Nx; see
[Nx as the task runner](../invariants/nx-task-runner.md)). **No other language toolchain has been
chosen yet, so don't assume one.** A task that needs a structural decision, such as a new language,
a new build plugin or a new top-level folder, stops and asks before introducing it.

## Layout

Most top-level folders are still empty placeholders.

| Folder | Purpose |
| --- | --- |
| `docs/` | Documentation: `runbooks/` (live operator procedures), `templates/`, `proposals/` and `superpowers/` (pre-spec design records, excluded from this wiki) |
| `openwiki/` | This knowledge bundle (see [the quickstart](../quickstart.md)) |
| `specs/` | Spec Kit feature specifications, `specs/<NNN>-<feature-name>/` (see [spec-driven development](../process/spec-driven-development.md)) |
| `scripts/` | Repository scripts, as the Nx project `scripts` (`scripts/project.json`): the gates, the CI scripts, the PR, CI-status and backlog tools, and their tests in `scripts/__tests__/` |
| `.forgejo/` | CI workflows (`workflows/guardrails.yml`) and the backlog issue form (see [CI guardrails](../runbooks/ci.md)) |
| `.specify/` | Spec Kit: templates, overrides, extensions and the constitution (see [Spec Kit](../runbooks/spec-kit.md)) |
| `.claude/skills/` | Assistant skills: the `/speckit-*` commands and `forgejo-issues`. `.claude/settings.local.json` stays local |
| `api-specs/` | API specifications |
| `secrets/` | Local secrets. Only `.gitkeep`, `README.md` and `*.example` files are tracked |
| `agents/` | AI agents |
| `mcp-servers/` | MCP servers |
| `backend/` | Backend code |
| `frontend/` | Frontend code |
| `packages/` | Shared packages and libraries |
| `infrastructure-as-code/` | Infrastructure as code |
| `assets/` | Static assets |
| `security/` | Security tooling and policy |
| `tools/` | Developer tools |
| `target/` | Build output. Ignored by Git and never committed |

## File conventions

- **Line endings:** `.gitattributes` stores text as LF. Windows script types (`.ps1`, `.psm1`,
  `.psd1`, `.bat`, `.cmd`, `.sln`) use CRLF, and shell scripts must stay LF. Don't override these
  per file.
- **Ignored paths:** `.gitignore` ignores `bin/`, `build/`, `out/`, `dist/` and `target/` anywhere in
  the tree. If you need a tracked directory with one of those names, such as a scripts `bin/`, add an
  explicit `!` exception rather than renaming around it.
- **Lock files are committed** (`pnpm-lock.yaml`, and `Cargo.lock` or `package-lock.json` if those
  ecosystems arrive). This repository builds runnable tools, so reproducible builds matter.
- **Secrets:** never commit secrets, `.env` files, keys or Terraform state. Use `*.example` files
  for templates (see [the secrets posture](../invariants/secrets-management.md)).
- **License:** MIT (see `LICENSE`). Don't add code or dependencies whose licenses are incompatible
  with MIT redistribution.

## Working practices

- **Keep changes focused.** Downstream repositories depend on this one.
- **Document what you add.** A new tool or package gets its own README or a section in the root
  `README.md` saying what it is for and how to use it.
- **A new repository-wide convention gets a home in this bundle and an index entry in `AGENTS.md`.**
  This covers a layout, a build command, a test command or a release process. Write the convention
  into its canonical page by [the canonical-home rule](../INSTRUCTIONS.md), and add a one-line entry
  to the `AGENTS.md` index.

## Git

- The default branch is `main`, on the self-hosted remote `origin`. `main` is protected: no direct
  push, the guardrails check is required, and Forgejo deletes a PR's branch when it merges.
- **Commit or push only when asked to.** If you are on `main`, branch first.
- PRs are opened, watched and merged from the terminal with `scripts/forge-pr.mjs` and
  `scripts/ci-status.mjs` (see [CI guardrails](../runbooks/ci.md)).

## Gotchas

- **"Early setup" does not mean "anything goes".** The empty placeholder folders exist so that the
  layout is decided before code lands in them, not as an invitation to pick a toolchain. The
  constitution names the stacks a future backend, frontend or agent project would use. Introducing
  one is still a structural decision that needs asking first.
- **Much of BELAY's tooling is ported from MovieCollectionManager, deliberately.** The preference is to
  reuse MovieCollectionManager's scripts as much as possible, changing only what removes their
  MovieCollectionManager-specific coupling. When porting, carry the measured fixes in both directions.
  BELAY's `backlog.mjs`, for example, sets `process.exitCode` instead of calling `process.exit()`,
  which aborts with exit 127 on Windows.
