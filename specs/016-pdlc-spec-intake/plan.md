# Implementation Plan: PDLC spec intake (write, clarify and approve a spec from Claude Desktop)

**Branch**: `016-pdlc-spec-intake` | **Date**: 2026-11-27 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/016-pdlc-spec-intake/spec.md`

## Summary

The `pdlc` server from feature 014 gains a spec lifecycle and a pane editor. BELAY gains a stage model that follows a
proposal from idea to merge.

**Spec lifecycle.** The Claude Desktop model follows the **target repository's own** Spec Kit specify and clarify
prompts, read from the local copy. The server does every step that must be right every time:
- It runs the repository's branch script as a **dry run**, so the repository's own numbering and naming apply, but
  the script creates nothing and never sees the token (research R1).
- It creates the feature branch in a **dedicated git worktree** per spec, so the copy stays on its default branch
  (R2).
- It writes only inside the feature's spec folder (R5).
- On the author's approval, it commits and publishes **only the feature branch**, under an extended git allowlist
  (R4) and a widened `pdlc` token (M5).

Each step moves the proposal issue through status labels with a machine-readable trailer comment (R7).

**Pane.** A hand-written, self-contained MCP App page shows the in-progress proposal or spec in Claude Desktop's
right-hand pane (M7). Edits typed there reach the server through an app-only tool. A revision check on every
model-side write means a pane edit is never lost (R9). Whether Claude Desktop renders an app beside the chat is
**measured first**.

**BELAY's own tooling.**
- The `after_specify` close-proposal hook becomes a **stage** hook, and a new `after_plan` hook moves the issue to
  **in engineering** (R13).
- `backlog.mjs` gains a `stage` verb (replacing `close-proposal`), and `ready` lists ready-to-plan specs with their
  branches.
- A new `feature-merged` workflow on `main` moves the issue to **merged** and closes it, with a comment counting the
  feature's tests: created, passed, failed, skipped and todo (R10, R12).

None of this calls the server (FR-031).

ADR-0006 records the amendments to 014's decisions and is ordered first (FR-034, M8).

## Technical Context

**Language/Version**:
- Node ESM (`.mjs`) with JSDoc, as in feature 014 and `scripts/`.
- Development and CI use Node 26.13.1 (constitution pin). The host runs Claude Desktop's bundled Node, v24 (014 R12),
  so the server keeps to Node 20 syntax.
- The pane page is plain HTML, CSS and ES2022 JavaScript in one file.

**Primary Dependencies**:
- **No new dependency.** The server keeps `@modelcontextprotocol/sdk` and `zod`. MCP App metadata (`_meta.ui.*`) and
  the `ui://` resource are plain protocol fields the SDK already passes through. To confirm: if the pinned SDK cannot
  register a resource with an `_meta` field, the fix is an SDK minor bump through Renovate, not a new package.
- **External tools invoked**: `git` (2.31 or later, already required), and the target repository's own Spec Kit
  scripts through `pwsh`, `powershell.exe` or Git for Windows' `bash.exe` (R1).

**Storage**: no database. The work lives in four places:
- the forge (issues, labels, comments, branches);
- per-spec worktrees under `<clone_root>/.pdlc-specs/`;
- pane drafts under `<clone_root>/.pdlc-drafts/`;
- backups under `<clone_root>/.pdlc-backups/`;
- short-lived scratch clones for the Spec Kit scripts under `<clone_root>/.pdlc-scratch/` (R1).

The server writes JSON state files next to the worktrees (data-model.md).

**Testing**: 014's three tiers, extended.

| Target | Adds |
| --- | --- |
| `pdlc:test` (gating) | Contract test for the new tool list; the allowlist shapes (R4) and path guard (R5), positive and negative; the transition table; trailer render and parse; the revision and pane-pending logic; the hook classification; `approve_spec` checks |
| `pdlc:integration` (gating) | Real git and real Spec Kit scripts against local bare repositories: the full lifecycle, take-latest with a conflict, push-to-default refused, and the dry run's number matching a real run. Needs `pwsh`: measured 7.6.5 in the dev container. On the CI runner (`node:26-bookworm`) it is not assumed; see research M9 |
| `pdlc:integration-forge` (operator) | The same against `ci-smoke`, plus a push to its protected `main` refused by the forge |
| `scripts:test` (gating) | `backlog.mjs stage` and `ready`; `feature-merged.mjs` with a fake forge and fixture reporter output, including every `unknown` path; the config-to-guardrails guard; the hooks and override gate |

**Target Platform**: Claude Desktop on Windows, as in 014. The new CI workflow runs on the `belay` runner.

**Project Type**: a local MCP tool server (stdio) with one MCP App resource, plus repository tooling (CLI verb, Spec
Kit hooks, a CI workflow, docs).

**Performance Goals**:
- each tool answers in a few seconds;
- `start_spec` (fetch of every head plus the dry run plus `worktree add`) in under 30 s on BELAY;
- the pane reflects a chat edit within one turn;
- `feature-merged` finishes in under 30 minutes (two test runs).

**Constraints**:
- No push except the feature branch onto itself, and no force.
- No write outside the feature folder, drafts and backups.
- The token is never in a child process that runs repository code.
- A merge is never blocked or marked red by counting.
- Stdout stays the protocol.

**Scale/Scope**: one operator, three repositories. About 11 new tools, about 8 new or changed server modules, one UI
file, one workflow, one CLI verb and two hooks.

## Constitution Check

*GATE: must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Verdict | Notes |
| --- | --- | --- |
| AI Assistant Constraints: technology-agnostic spec | ✅ | The spec names workflow terms (labels, stages, branches) as 014's did. HOW is here and in research |
| AI Assistant Constraints: doc-impact sweep | ✅ planned | Candidate terms below. `/speckit-tasks` runs the sweep |
| Behaviour-descriptive identifiers | ✅ | Modules are named for behaviour (`spec-worktree.mjs`, `stage-trailer.mjs`, `spec-kit-runner.mjs`, `count-feature-tests`…). Requirement IDs appear only in provenance comments. Tool names, labels and the trailer are external contracts, annotated as such |
| Security: narrowest-scope credential | ✅ with M5 | `write:repository` is the narrowest forge scope that can push. It is bounded by the push guard and branch protection. The CI job uses the run token first (M6). The token is never in a child that runs repository code (R1) |
| Security: write allowlist (Operator-Tool MCP Servers) | ✅ | Every git shape (R4) and file path (R5) is enumerated and checked before the write. The Spec Kit scripts run only in a disposable scratch clone under `<clone_root>/.pdlc-scratch/`: its origin is the local copy, it holds no credential, and it is deleted afterwards. The scratch folder is the one allowlisted write target for repository code, so nothing a script does can reach the copy, a worktree or the forge (R1; `/speckit-analyze` C1) |
| Security: input validation, safe errors | ✅ | zod on every tool, including the app-only one. Size caps. Refusals carry no stack, path outside the clone root, or payload |
| Security: execution of repository code | ✅ justified | The two Spec Kit scripts come from the operator's own repository, at a commit on its protected default branch. They run with `execFile`, a fixed path, no shell and no credential in the environment. This is recorded in ADR-0006 and in Complexity Tracking |
| Security: dependency security | ✅ | No new package |
| Security: transport | ✅ | Unchanged (tailnet rule, 1.1.0) |
| TDD | ✅ planned | Verify RED / Verify GREEN for every task |
| Test Type Integrity | ✅ | Doubles only in the unit tier. `pdlc:integration` uses real git and real scripts. `-forge` uses the real forge. No skips: a missing `pwsh` **fails** the integration tier |
| Logging and audit (operator-tool rule) | ✅ | One `audit` line per call, including app-only calls, with `decision`, `code`, `branch` and `number`, and no spec text. Pushes and stage changes are also in the forge's history |
| Common stack: pnpm, Nx | ✅ | New operations are Nx targets: `scripts:feature-merged` wraps the script for local runs, and CI calls the Nx target |
| Monorepo layout | ✅ | No new top-level folder. The UI sits at `mcp-servers/pdlc/ui/` |

**Gate result**: passes, conditional on ADR-0006 (M8) landing before any server code, in the same pull request.
Re-checked after Phase 1 with no new violations.

## Project Structure

### Documentation (this feature)

```text
specs/016-pdlc-spec-intake/
├── spec.md
├── plan.md                     # this file
├── research.md                 # R1–R16, maintainer decisions M5–M9
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── tools.md                # new and changed pdlc tools: normative
│   ├── stages.md               # stages, transitions, trailer, ready listing: normative
│   ├── backlog-stage-cli.md    # backlog.mjs stage + speckit.belay.spec-stage hook
│   └── feature-merged.md       # the merge workflow, script and closing comment
├── checklists/requirements.md
└── tasks.md                    # /speckit-tasks
```

### Source Code (repository root)

```text
mcp-servers/pdlc/
├── manifest.json                         # 0.2.0; tools list; forge_token description (write:repository)
├── contract/proposal-labels.json         # + four stage labels
├── skill/proposal-intake/SKILL.md        # + spec stage (start, clarify, review, approve, reopen, withdraw, take latest), pane use, Spec Kit check
├── ui/document-pane.html                 # NEW: the MCP App page (M7)
├── src/
│   ├── tool-contract.mjs                 # + new tools, draft_revision, new enums
│   ├── tools.mjs                         # + handlers
│   ├── git-runner.mjs                    # + exact shapes (R4), push target guard
│   ├── spec-kit-runner.mjs               # NEW: init-options, hook classification, dry run, resolve-template (R1, R3, R14)
│   ├── spec-worktree.mjs                 # NEW: create, resume, state file, revision, take-latest (R2, R8)
│   ├── spec-files.mjs                    # NEW: path guard and writes (R5)
│   ├── spec-approval.mjs                 # NEW: markers, clarified, commit, publish (R15)
│   ├── stages.mjs                        # NEW: transition table, label swap, trailer render/parse (R7)
│   ├── document-pane.mjs                 # NEW: ui:// resource, show_document, save_pane_edit, drafts (R9)
│   ├── setup-check.mjs                   # + stage labels, default_branch_protected
│   └── proposals.mjs                     # + draft_revision check; stage-aware status
└── tests/{unit,integration,integration-forge}/   # per Testing above

scripts/
├── backlog.mjs                           # TAXONOMY + 4 labels; stage verb (replaces close-proposal); ready
├── feature-merged.mjs                    # NEW (R10)
├── feature-merged.config.json            # NEW: the test targets counted (R12)
├── lib/collect-test-results.mjs          # NEW: node:test reporter → JSON lines (R12)
├── lib/stage-trailer.mjs                 # NEW: shared trailer grammar (also imported by the server's tests as the cross-check)
├── check-speckit-overrides.mjs           # hooks: spec-stage ×2 replace close-proposal; PROJECT_OWNED skill rename
├── project.json                          # + feature-merged target
└── __tests__/…                           # backlog stage/ready, feature-merged, collector, config guard, hooks

.forgejo/workflows/feature-merged.yml     # NEW (R10, R11)
.specify/extensions.yml                   # after_specify: spec-stage (replaces close-proposal); after_plan: spec-stage
.claude/skills/speckit-belay-spec-stage/SKILL.md      # NEW, replaces speckit-belay-close-proposal/
.claude/skills/forgejo-issues/SKILL.md    # stages, ready-to-plan pick-up, close-on-merge
docs/decisions/ADR-0006-pdlc-spec-intake.md           # NEW (M8): amends 014/ADR-0005 decisions
docs/runbooks/pdlc.md                     # spec stage, token scope, pane, refusal codes, MCM hand-off additions
docs/runbooks/backlog.md                  # stage labels, stage verb, ready, close-on-merge
docs/runbooks/spec-kit.md                 # inventory: hooks and skill
docs/runbooks/ci.md                       # feature-merged workflow
openwiki/…                                # refresh pages citing changed sources (V17), lifecycle page, AGENTS.md index line for ADR-0006
```

**Structure Decision**: everything stays in the folders 014 established. The server grows modules under
`mcp-servers/pdlc/src/`, and the UI gets a sibling `ui/`, because the bundle must carry it. `scripts/lib/` holds code
shared by `backlog.mjs`, `feature-merged.mjs` and the server's cross-check test. The trailer grammar is defined once in
`contracts/stages.md`, implemented in `scripts/lib/stage-trailer.mjs`, and mirrored in `mcp-servers/pdlc/src/stages.mjs`
(the bundle cannot import from `scripts/`). A guard test feeds both implementations the same fixtures.

### Documentation impact (input to the doc-impact sweep in `/speckit-tasks`)

Identifiers this feature renames, removes or changes the meaning of:

- `close-proposal` (verb, removed), `speckit.belay.close-proposal` and `speckit-belay-close-proposal` (hook and skill,
  replaced by `spec-stage`), and "close-on-spec" or "closes once its spec exists" (now close-on-merge). A search
  finds them in `.claude/skills/forgejo-issues/SKILL.md`, `.claude/skills/speckit-belay-close-proposal/SKILL.md`,
  `.specify/extensions.yml`, `docs/runbooks/{backlog,pdlc,spec-kit}.md`, `mcp-servers/pdlc/README.md`,
  `mcp-servers/pdlc/skill/proposal-intake/SKILL.md`, `openwiki/projects/repository.md`,
  `openwiki/runbooks/{backlog,index,pdlc,spec-kit}.md`, `openwiki/process/spec-driven-development.md`, and `scripts/`
  code and tests. `docs/proposals/**` is history and stays unchanged.
- `status/needs-spec` (ready proposal, now followed by four further stages).
- `ready` (now lists ready-to-plan with branch; hides two more stages).
- "read-only local copy" and "never commits, branches or pushes" (in the manifest `long_description`, the pdlc
  runbook and the openwiki pdlc page): now "default branch read-only; feature branch committed and published on
  approval".
- The `pdlc` token scope `write:issue` + `read:repository` (in the manifest, the runbook and
  `openwiki/invariants/secrets-management.md`): now `write:issue` + `write:repository`.
- `CI_DIGEST_TOKEN` usage (secrets page), if R11's measurement shows the fallback is needed.

## Complexity Tracking

| Violation or risk | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| The server executes the target repository's Spec Kit scripts | FR-002: the repository's own numbering, naming and template must apply | Reimplementing drifts on upgrade (FR-002). Headless Claude Code adds a second model, a login on the workstation, and unbounded edit rights (R1) |
| Repository write scope on the `pdlc` token | Publishing the approved branch (FR-009) | A second token sits in the same process and the same settings file (M5) |
| A second full test run per proposal merge | "Created" needs the parent's test identities (FR-038) | Diff-counting `test(` misses table-driven tests and cannot report outcomes (R12) |
