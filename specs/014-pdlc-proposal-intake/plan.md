# Implementation Plan: Claude Desktop proposal intake (the `pdlc` tool server and its shared contracts)

**Branch**: `014-pdlc-proposal-intake` | **Date**: 2026-11-25 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/014-pdlc-proposal-intake/spec.md`

## Summary

A new Node MCP server, **`pdlc`**, lives in `mcp-servers/pdlc/`. It is built on the official MCP SDK over stdio and
shipped to the Windows workstation as a **Claude Desktop Extension (`.mcpb`)** (maintainer decisions M1 and M2). It
offers exactly the nine tools of the fixed contract.

- **Proposals**: they are read and written as forge issues. Every write passes the guards in order: the owner allowlist
  (built from `/repos/search` filtered to the owner; research R1), proposals only, labels resolved by name, a
  stale-write check, and a duplicate-title check.
- **Local copies**: a dedicated folder holds one copy per repository. Each is a **blobless, single-branch clone**
  (R3), authenticated per git invocation through `GIT_CONFIG_*` environment variables. The token is never in argv,
  the remote URL or `.git/config`. That approach was measured to work (R2).
- **Fast-forward only**: the server may only fast-forward the default branch, and it refuses a copy that is dirty,
  off-branch, diverged or not a copy of the repository.

The shared contracts sit in `mcp-servers/pdlc/contract/`: the master form, the label definitions, and the headings
taken from the form. The master skill sits in `mcp-servers/pdlc/skill/`.

**BELAY becomes the first target repository.** It gets:
- its own byte-identical form copy;
- the two new labels in `backlog.mjs`;
- a `ready` listing that excludes drafts;
- a new `close-proposal` verb;
- a hand-added `after_specify` hook and a project skill that close a proposal once its spec exists (R14).

None of that touches the server (FR-035).

The constitution is amended (MINOR, 1.0.1 → 1.1.0) to admit **operator-tool MCP servers**: local, stdio, launched by
a desktop assistant, Node permitted. ADR-0005 records the amendment, the bundle packaging, the two new dependencies
and the `mcp-servers/*` workspace entry. A runbook covers installation and the MCM hand-off.

## Technical Context

**Language/Version**:
- Node ESM (`.mjs`) with JSDoc, no TypeScript build, matching `scripts/`.
- Development and CI use Node 26 (constitution). The runtime on the host is the Node that ships with Claude Desktop.
  Its version is measured (R12), and the server uses only syntax available from Node 20.

**Primary Dependencies**:
- `@modelcontextprotocol/sdk` (exact pin, about 1.32): `McpServer`, `StdioServerTransport`, and `InMemoryTransport`
  for tests.
- `zod`, the SDK's schema library, declared directly because the server imports it.
- Dev only: `@anthropic-ai/mcpb` (exact pin, about 2.1) for `pack` and `validate`.
- Neither package has install scripts (checked; R11). `yaml` (already in the workspace) is used only in tests, to read
  the form's labels.
- Node's built-in `fetch` and `child_process.execFile` (with an argument array, never a shell).

**Storage**: none of the server's own. The forge holds proposals, and `PDLC_CLONE_ROOT/<Repo>` holds the read-only
local copies.

**Testing**: `node:test` and `node:assert`, with Node's built-in coverage. There are three tiers (R16):

| Target | What | Gating? |
| --- | --- | --- |
| `pdlc:test` | Unit, plus the contract test over the real protocol | Gating |
| `pdlc:integration` | Real git against local bare repositories | Gating |
| `pdlc:integration-forge` | Real forge, `ci-smoke` | Operator-run, not CI; no skips |

Coverage uses a 70% line floor through `scripts/check-coverage.mjs --policy`.

**Target Platform**: Claude Desktop on Windows (`compatibility.platforms: ["win32"]`), with git 2.31 or later on the
host `PATH`. Development and CI run in the Linux dev container and the Forgejo runner.

**Project Type**: a local MCP tool server (stdio) packaged as a desktop extension, plus repository tooling changes
(a CLI verb, a Spec Kit hook, a skill, docs).

**Performance Goals**: interactive, so each tool answers in a few seconds on the tailnet. `list_proposals` pages
through at most a few hundred issues. The first clone of a repository the size of MCM is under a minute, which is why
it is blobless.

**Constraints**:
- No commit, branch, push or stash, ever (a git verb allowlist).
- The token never appears in argv, results, logs or `.git/config`.
- Stdout is reserved for the protocol, so logs go to stderr.
- Body and comment size is at most 64 KiB.
- Only the configured owner is addressed.
- The server is stateless across restarts, apart from the clones.

**Scale/Scope**: one operator, one workstation, three repositories today (BELAY, mcm, ci-smoke). There are nine
tools, about ten source modules and one bundle.

## Constitution Check

*GATE: must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Verdict | Notes |
| --- | --- | --- |
| AI Assistant Constraints: technology-agnostic spec | ✅ | The spec names only external contracts (tool names, labels, headings). The HOW lives here |
| AI Assistant Constraints: doc-impact sweep | ✅ planned | `/speckit-tasks` runs it. The candidate terms are listed under Project Structure → Documentation impact |
| Behaviour-descriptive identifiers | ✅ | Modules are named for their behaviour (`proposal-body.mjs`, `local-copy.mjs`…). Requirement IDs appear only in JSDoc provenance comments. Tool names, label names and environment variables are external contracts, annotated as such |
| Security: secrets and credentials | ✅ | A dedicated token with the narrowest measured scope (R1). It is a `sensitive` user setting, and its storage location is measured (R12). It never reaches argv, logs, results or `.git/config` (R2), and a test asserts this for each sink |
| Security: authorisation (least privilege) | ✅ | The owner allowlist, proposals-only writes, no close, delete, label or bulk tools, and a git verb allowlist |
| Security: input validation and error handling | ✅ | zod schemas on every tool, size caps, and refusals that state the reason without stack traces or payloads |
| Security: dependency security | ✅ | Exact pins and a lockfile. SAST/SCA (`pnpm audit`) and Renovate cover the new packages automatically. No install scripts, so no `allowBuilds` change |
| Security: rate limiting, sessions, IdP | N/A | One local stdio client, no network listener |
| Security: transport (TLS 1.3) | ❌ → **amend** | The forge is reached over the tailnet, as with every BELAY forge tool, and `PDLC_FORGE_URL` takes the scheme as written. Maintainer decision (2026-11-25): for operator-tool MCP servers, **tailnet (WireGuard) transport meets the transport-security requirement**. This is written into the 1.1.0 amendment (T002) and ADR-0005 |
| TDD (non-negotiable) | ✅ planned | Every task uses Verify RED / Verify GREEN (`docs/templates/feature-test-tasks-template.md`) |
| Test Type Integrity | ✅ | The unit tier injects fetch and git doubles. `pdlc:integration` uses real git with no doubles. `pdlc:integration-forge` uses the real forge with no doubles. No mocking library is used anywhere under `tests/integration*/` |
| Logging and monitoring | ❌ → **amend** | JSON lines on stderr with timestamp, level, service, correlation id (the MCP request id) and message, redacted at the point of logging. Every tool call, allowed or refused, emits one `audit` line before its result is returned (research R17). Maintainer decision (2026-11-25), written into the 1.1.0 amendment (T002): for operator-tool MCP servers, the audit log is **the host's capture of the server's stderr** (Claude Desktop's per-server log, which the server never opens) together with **the forge's issue timeline** for writes. Retention is the host's, as measured (T006), not 90 days |
| Common stack: pnpm, Nx, `.gitignore` | ✅ | `mcp-servers/*` joins `pnpm-workspace.yaml`. Every operation is an Nx target on project `pdlc`. `target/` is already ignored |
| Monorepo layout: `/mcp-servers/{name}/` | ✅ | `mcp-servers/pdlc/`. No new top-level folder (R13) |
| **AI Agent stack: "each MCP server is a dedicated Python Docker container", Dockerfile, pytest, ruff** | ❌ → **amend** | `pdlc` is not part of the agent runtime: no gateway, no JWT propagation, no container. M1: amend the constitution (MINOR → **1.1.0**). Add an **Operator-tool MCP servers** subsection: local stdio servers that a desktop or IDE assistant launches for one operator. Node (pnpm and Nx) or Python is permitted, and no Dockerfile is required. They must still meet the Core Principles, a narrowest-scope credential, a git/forge write allowlist, and the testing tiers. Scope the existing MCP Tool Layer and AI Agent stack text to servers the Agent Gateway serves. Recorded in **ADR-0005**. The amendment and its page refresh land in this feature's PR, before any server code is merged |

**Gate result**: passes, conditional on the amendment task in Phase 2 being ordered **first**. Re-checked after Phase 1
with no new violations. The design added only the stderr logging shape and the coverage `--policy` flag.

## Project Structure

### Documentation (this feature)

```text
specs/014-pdlc-proposal-intake/
├── spec.md
├── plan.md                       # this file
├── research.md                   # R1–R18, maintainer decisions M1–M4
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── tools.md                  # the nine tools: normative
│   ├── proposal-body.md          # body, headings, labels, form copies: normative
│   └── close-proposal-cli.md     # backlog.mjs verb + after_specify hook
├── checklists/requirements.md
└── tasks.md                      # /speckit-tasks
```

### Source Code (repository root)

```text
mcp-servers/pdlc/                         # NEW: Nx project "pdlc", package @belay/pdlc
├── package.json                          # private, type: module; SDK + zod; devDep @anthropic-ai/mcpb
├── project.json                          # targets: lint, test, integration, integration-forge, pack
├── manifest.json                         # mcpb manifest 0.3: server, user_config ×4, tools ×9, compatibility
├── coverage-policy.yaml                  # 70% floor over src/*.mjs
├── README.md
├── contract/
│   ├── proposal.yaml                     # MASTER issue form (from docs/proposals/…/proposal.yaml)
│   └── proposal-labels.json              # MASTER label definitions
├── skill/proposal-intake/SKILL.md        # MASTER Claude Desktop skill (R18 edits)
├── src/
│   ├── server.mjs                        # entry: config → McpServer → register tools → stdio
│   ├── config.mjs                        # the four settings; startup failure names the variable
│   ├── tool-contract.mjs                 # names + zod input schemas: the single source for registration
│   ├── tools.mjs                         # handlers: compose the modules below, map errors to refusals
│   ├── forge-client.mjs                  # fetch, auth header, paging by x-total-count, type=issues, error mapping
│   ├── repo-allowlist.mjs                # /repos/search filtered to the owner; canonical names
│   ├── labels.mjs                        # name→id resolution, state/priority swap planning
│   ├── proposal-body.mjs                 # render + parse (contracts/proposal-body.md)
│   ├── proposals.mjs                     # list/get/create/update/comment, write guards, stale + duplicate checks
│   ├── setup-check.mjs                   # labels, form present / in effect / in step
│   ├── git-runner.mjs                    # execFile with the verb allowlist + GIT_CONFIG_* auth env
│   ├── local-copy.mjs                    # status, clone, fast-forward, refusals
│   ├── redact.mjs                        # token and Authorization scrubbing for every sink
│   └── log.mjs                           # JSON-lines stderr logger
├── tests/
│   ├── unit/*.test.mjs                   # includes tool-contract (InMemoryTransport), master-copies guards
│   ├── integration/*.test.mjs            # real git, local bare repos
│   └── integration-forge/*.test.mjs      # real forge, ci-smoke
└── scripts/pack.mjs                      # pnpm deploy (hoisted) → stage → mcpb pack; zip the skill

.forgejo/issue_template/proposal.yaml     # NEW: BELAY's copy (byte-identical to the master)
.forgejo/workflows/guardrails.yml         # + pdlc:lint, pdlc:test, pdlc:integration
pnpm-workspace.yaml                       # + 'mcp-servers/*'
pnpm-lock.yaml                            # gains the SDK tree
scripts/backlog.mjs                       # TAXONOMY + 2 labels; ready excludes drafts; close-proposal verb
scripts/check-coverage.mjs                # + --policy <file>
scripts/check-speckit-overrides.mjs       # + EXTENSION_HOOKS entry (local) + PROJECT_OWNED skill
scripts/__tests__/backlog.test.mjs        # + labels, ready, close-proposal; label-copy guard
scripts/__tests__/…                       # coverage --policy; speckit gate fixtures; guardrails workflow test
.specify/extensions.yml                   # + after_specify → belay speckit.belay.close-proposal
.specify/memory/constitution.md           # 1.1.0: operator-tool MCP servers
.claude/skills/speckit-belay-close-proposal/SKILL.md   # NEW (project-owned)
.claude/skills/forgejo-issues/SKILL.md    # proposals: states, pick-up, close-on-spec
docs/decisions/ADR-0005-operator-tool-mcp-servers.md   # NEW
docs/runbooks/pdlc.md                     # NEW: install, configure, update skill, measurements, hand-off (MCM)
docs/runbooks/backlog.md                  # labels, form, states, close-proposal
docs/runbooks/spec-kit.md                 # inventory: the hook + skill
openwiki/…                                # refresh pages citing changed sources (V17), new runbook page, index
AGENTS.md                                 # index entries: pdlc runbook, ADR-0005
```

**Structure Decision**: a single new Nx project at `mcp-servers/pdlc/`, the folder the constitution reserves for MCP
servers. The shared contracts and the master skill live **inside** it, because the bundle must carry them and because
"contract change ⇒ skill change in the same PR" is easiest to enforce when both sit next to the contract test. PRD §8's
top-level `skills/` and `forgejo/` folders are not created (R13). The BELAY-adoption changes stay in the folders that
already own those concerns (`scripts/`, `.specify/`, `.claude/skills/`, `.forgejo/`).

### Documentation impact (input to the doc-impact sweep in `/speckit-tasks`)

Terms the feature changes the meaning of, or adds:

- `type/proposal` and `status/proposal-draft` (new labels);
- `status/needs-spec` (now also "ready proposal");
- "no close verb" (`backlog.mjs`, which gains `close-proposal`);
- `ready` (now excludes drafts);
- "Proposal" stage (`docs/proposals/` → the backlog);
- "each MCP server is a dedicated Python Docker container" (amended);
- `mcp-servers/` ("placeholder" → has a project);
- `after_specify` hooks (one more);
- "no integration tier exists yet" (testing tiers).

Sources known to mention them:

- `docs/runbooks/backlog.md`
- `docs/runbooks/spec-kit.md`
- `openwiki/process/spec-driven-development.md` [canonical]
- `openwiki/invariants/testing-tiers.md` [canonical]
- `openwiki/projects/repository.md` [canonical]
- `openwiki/invariants/secrets-management.md` [canonical]
- `openwiki/process/constitution.md`
- `.claude/skills/forgejo-issues/SKILL.md`
- `AGENTS.md`

## Phase ordering (input to `/speckit-tasks`)

1. **Governance first**: amend the constitution to 1.1.0, write ADR-0005, add `mcp-servers/*` to the workspace, and
   refresh the constitution wiki page. Nothing else merges without this.
2. **Host measurements** (R12): build a throwaway "hello" extension that spawns `git --version` and logs
   `process.version`, then record the four observations. If `git` is not reachable, add the `git_path` setting before
   building `local-copy.mjs`.
3. **Contracts and pure modules (TDD)**: `contract/` files, then `proposal-body`, `labels`, `redact`, `config`,
   `tool-contract` (with the contract test), and the master-copy guards.
4. **Forge-facing modules (TDD with injected fetch)**: `forge-client`, `repo-allowlist`, `proposals`, `setup-check`.
5. **Git-facing modules (TDD, then real git)**: `git-runner`, `local-copy`, and the `pdlc:integration` tests.
6. **Server wiring and packaging**: `server.mjs`, `tools.mjs`, the manifest, `pack`, and `mcpb validate`.
7. **BELAY adoption (TDD in `scripts/`)**: labels, `ready`, `close-proposal`, the hook and skill, the form copy,
   the `forgejo-issues` skill, and the coverage `--policy` flag.
8. **CI**: the `guardrails.yml` steps, the digest-coverage gate, and the guardrails workflow test.
9. **Docs**: the `pdlc` runbook (install, skill update, measurements, MCM hand-off from the spec), the backlog and
   Spec Kit runbooks, wiki refreshes (V17), and AGENTS.md index entries.
10. **Validation**: quickstart sections 1, 2, 4, then sections 5 and 6 after merge and `setup-labels`. Section 7 waits
    for MCM.

## Complexity Tracking

| Violation | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| The MCP server is Node and local stdio, not a Python Docker container (AI Agent stack) | Claude Desktop launches a local process. A bundle runs on the Node that ships with Claude Desktop, so the host needs nothing installed (M2). Node reuses BELAY's only chosen toolchain and the patterns already proven in `backlog.mjs` | A Python container needs Docker Desktop on the host, a bind-mounted clone folder, and a new language toolchain in BELAY, all for a one-operator tool. Resolved by the constitution amendment, not left as a standing violation |
| A second "close" path in `backlog.mjs` (`close-proposal`) despite "there is no close verb" | Closing a proposal must be right every time: the right issue, a proposal, the spec existing, a comment before closing, idempotent. That belongs in a script, not in skill prose | Using `comment` plus `update --state closed` from the skill puts four checks into prose, which is the failure mode `forge-credential.mjs` was written to stop |
