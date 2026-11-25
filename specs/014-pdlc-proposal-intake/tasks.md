---

description: "Task list for feature 014: Claude Desktop proposal intake"
---

# Tasks: Claude Desktop proposal intake (the `pdlc` tool server and its shared contracts)

**Input**: Design documents from `specs/014-pdlc-proposal-intake/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md),
[contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: REQUIRED (constitution "Test-Driven Development", NON-NEGOTIABLE). Every test task names the acceptance
scenarios it covers and a **Verify RED** command with the expected failure. Its paired implementation task carries a
**Verify GREEN** command. Documentation and config tasks use the "Done when" form
(`docs/templates/feature-test-tasks-template.md`).

**Instrument rules for every command below**:
- Node's flags go **before** the path: `node --test --test-name-pattern "x" <file>`.
- Read the summary's **skip count**. It must be 0, because a skipped test exits 0.
- A new test file's RED is usually `ERR_MODULE_NOT_FOUND` for the module it imports. That counts as 1 failing file.
  The paired GREEN must then show the named tests passing, not just "no module error".
- Where the behaviour already exists, use a **mutation RED**: apply the named source edit, watch the test fail, then
  revert.

**Test-case approval** (constitution TDD: "Test cases written → User approval → Tests fail"): the maintainer's
approval of this `tasks.md`, which names each test task's scenarios and expected RED, is that approval. A test task
whose scenarios change during implementation goes back to the maintainer before its RED is taken.

**Working copy**: all work happens in the worktree `/home/coder/worktrees/014-pdlc-proposal-intake` (AGENTS.md
worktree rule), which has a real `CI=true pnpm install --frozen-lockfile`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (a different file, and no dependency on an incomplete task)
- **[Story]**: the user story from spec.md (US1–US7)

---

## Phase 1: Setup (governance, workspace, host measurements)

**Purpose**: the constitution amendment that the plan's gate makes a precondition, the new Nx project, and the four
host facts the packaging depends on.

- [x] T001 **Doc-impact sweep** (constitution "Documentation"). The terms this feature adds or changes the meaning of
  were searched in every `*.md` outside `specs/`, `docs/proposals/` and `docs/decisions/`.
  - **Command, run per term** (2026-11-25, in the worktree at `a066a4e`):
    `git grep --untracked -n -F "<term>" -- '*.md' ':!specs/' ':!docs/proposals/' ':!docs/decisions/'`
  - **Terms**:
    - `type/proposal`, `status/proposal-draft`, `status/needs-spec`
    - `no close verb`, `close verb`, `--state closed`
    - `backlog.mjs ready`, `setup-labels`, `validate-form`, `issue_template`
    - `docs/proposals/`, `Docker container`, `MCP Tool Servers`, `mcp-servers/`
    - `after_specify`, `integration tier`
  - **Results**:
    - `type/proposal`, `status/proposal-draft`, `no close verb`, `close verb`: **0 hits** in `*.md`. The "no close
      verb" wording is in `scripts/backlog.mjs`'s `--help`, which T060 handles.
    - `status/needs-spec`:
      - `.claude/skills/forgejo-issues/SKILL.md:52,63` → T063
      - `docs/runbooks/backlog.md:82` → T068
      - `docs/repo-foundation-setup.md:384` (the `setup-labels` comment lists the labels) → T075
      - `docs/runbooks/doc-drift.md:78`: no change. It uses the label in its existing meaning.
    - `backlog.mjs ready`:
      - `.claude/skills/forgejo-issues/SKILL.md:14` → T063
      - `docs/runbooks/backlog.md:18` → T068
      - `docs/repo-foundation-setup.md:722,821,831`, `docs/runbooks/renovate.md:34,183`,
        `openwiki/runbooks/renovate.md:25`: no change. They are about the bot-managed dashboard, which `ready` still
        hides.
    - `--state closed`:
      - `.claude/skills/forgejo-issues/SKILL.md:19` → T063, which adds `close-proposal` for proposals
      - `docs/runbooks/backlog.md:22` → T068
      - `docs/repo-foundation-setup.md:387`: no change. A general issue still closes this way.
    - `setup-labels`:
      - `docs/runbooks/backlog.md:25,76` ("nine of them") → T068
      - `docs/repo-foundation-setup.md:368,383,704`, `openwiki/gotchas/instrument-traps.md:28`: no change. The
        command and its `--dry-run` are unchanged.
    - `validate-form`: `.claude/skills/forgejo-issues/SKILL.md:83`, `docs/runbooks/backlog.md:91` and
      `openwiki/runbooks/backlog.md:41` are still true for both forms. T068 adds only the second form.
    - `issue_template`:
      - `docs/runbooks/backlog.md:88` → T068, which adds the proposal form
      - `docs/repo-foundation-setup.md:372`: no change. It is the playbook step for the backlog form.
    - `docs/proposals/`:
      - `openwiki/process/spec-driven-development.md:18,26` → T071 (a proposal may now live in the backlog)
      - `.specify/templates/overrides/tasks-template.md:67,74`, `docs/runbooks/doc-drift.md:31,57`,
        `openwiki/INSTRUCTIONS.md:54`, `openwiki/quickstart.md:67`, `openwiki/runbooks/doc-drift.md:22`,
        `openwiki/process/spec-driven-development.md:67`: no change. `docs/proposals/` stays as history, and the
        exclusions are unchanged (spec Assumptions).
    - `Docker container` and `MCP Tool Servers`:
      - `.specify/memory/constitution.md:391,436,460,541,821` → T002 (scoped to Agent Gateway servers; the new class
        is added)
      - `.specify/memory/constitution.md:164,336,337,456`: no change. They are about Backend Services, the BFF and
        the gateway runtime.
    - `mcp-servers/`:
      - `.specify/memory/constitution.md:471,478` → T002
      - `openwiki/projects/repository.md:40` → T073
      - `AGENTS.md:8`, `openwiki/INSTRUCTIONS.md:98`, `openwiki/invariants/nx-task-runner.md:45`,
        `openwiki/process/spec-driven-development.md:40`, `docs/repo-foundation-setup.md:88`: no change. The SDD gate
        and the folder list still hold, and `pdlc` has its spec.
    - `after_specify`: `.claude/skills/speckit-git-commit/SKILL.md`, `.claude/skills/speckit-specify/SKILL.md` and
      `.specify/extensions/{agent-context,git}/**`: no change. These are generic, Spec Kit-owned files that must not
      be edited. The new hook is recorded in the Spec Kit runbook instead (T069).
    - `integration tier`: `openwiki/invariants/testing-tiers.md:26` → T072

- [X] T002 Amend the constitution to **1.1.0** in `.specify/memory/constitution.md`. Use `/speckit-constitution` so the
  Sync Impact Report and the version history are written.
  - Add an **Operator-tool MCP servers** subsection: local stdio servers that a desktop or IDE assistant launches for
    one operator. Node (pnpm and Nx) or Python is permitted, and no Dockerfile is required. They must still meet the
    Core Principles, a narrowest-scope credential, a git/forge write allowlist, and the testing tiers.
  - In the same subsection, state the transport rule (maintainer decision, 2026-11-25): for operator-tool MCP
    servers, tailnet (WireGuard) transport meets Transport Security's TLS requirement.
  - In the same subsection, state the audit rule (maintainer decision, 2026-11-25; research R17): for operator-tool
    MCP servers, the audit log is the launching host's capture of the server's stderr, together with the forge's own
    history for writes. The server emits one `audit` line per call, allowed or refused, before returning, and never
    opens the log itself. The OS user can edit the host's log; that is accepted for a one-operator workstation.
    Retention is the host's, as measured, rather than 90 days.
  - Scope the existing text to servers the Agent Gateway serves: lines 460 and 478, the line 541 tree comment, and
    the line 821 diagram.
  - **Done when**:
    - the version line reads 1.1.0, and the Sync Impact Report names the amended sections;
    - `git grep -n "dedicated Python Docker container"` finds only text scoped to Agent Gateway servers;
    - `node scripts/check-speckit-overrides.mjs` exits 0.
- [X] T003 [P] Write `docs/decisions/ADR-0005-operator-tool-mcp-servers.md`, covering:
  - the M1 amendment, including the tailnet transport rule and the host-log audit rule;
  - the M2 `.mcpb` bundle packaging and the hoisted `pnpm deploy`;
  - the two runtime dependencies (`@modelcontextprotocol/sdk`, `zod`) and the dev dependency (`@anthropic-ai/mcpb`),
    all exact pins with no install scripts;
  - the `mcp-servers/*` workspace entry;
  - the rejected alternatives, from the plan's Complexity Tracking and research R19 (a remote connector; a
    tailnet server with a local bridge).

  Add its row to `docs/decisions/README.md`.
  - **Done when**: the ADR follows the existing ADR shape (Status, Context, Decision, Consequences), and the README
    index lists it.
- [X] T004 Refresh `openwiki/process/constitution.md` for 1.1.0 with `/wiki-refresh`:
  `node scripts/wiki-refresh.mjs --diff`, then `--record`, never a hand-typed hash. Add
  `openwiki/decisions/adr-0005-operator-tool-mcp-servers.md` with `resource` pointing at the ADR, and list it in
  `openwiki/decisions/index.md`. Depends on T002 and T003.
  - **Done when**: `node scripts/wiki-refresh.mjs --stale` reports neither page, and `pnpm nx run scripts:lint` passes
    the OKF gate.
- [X] T005 Scaffold the Nx project `pdlc`:
  - `mcp-servers/pdlc/package.json`: `@belay/pdlc`, private, `type: module`, `engines.node >=20`,
    `"packageManager"` equal to the root's (constitution: each project declares it). Exact pins for
    `@modelcontextprotocol/sdk` and `zod`; dev dependency `@anthropic-ai/mcpb`.
  - `mcp-servers/pdlc/project.json`, with targets:
    - `lint`: `node --check` over `src/` and `scripts/`, plus `mcpb validate manifest.json` once T049 lands;
    - `test`: unit tests under coverage, then `check-coverage.mjs --policy`;
    - `integration`;
    - `integration-forge`;
    - `pack`.
  - `mcp-servers/pdlc/coverage-policy.yaml`: a 70% floor over `mcp-servers/pdlc/src/*.mjs`.
  - `mcp-servers/pdlc/README.md`.
  - Add `'mcp-servers/*'` to `pnpm-workspace.yaml`.
  - Run `pnpm install` to update `pnpm-lock.yaml`. Keep `mcp-servers/.gitkeep`.
  - **Done when**:
    - `CI=true pnpm install --frozen-lockfile` passes with no `ERR_PNPM_IGNORED_BUILDS` and no `allowBuilds` change;
    - `mcp-servers/pdlc/package.json`'s `packageManager` equals the root `package.json`'s;
      **Deviation (2026-11-25, awaiting maintainer approval)**: the field is NOT declared in the nested
      manifest. `scripts/check-toolchain-consistency.mjs` (rule `package-manager-once`, run by
      `scripts:lint`) and `openwiki/invariants/package-manager-enforcement.md` require `packageManager`
      exactly once, in the root, because an agreeing copy drifts (MCM measured it). That conflicts with
      constitution line 148 ("each project's `package.json` must declare"), a pre-existing
      inconsistency this feature did not introduce. The guard wins here, so the project inherits the
      root's pin;
    - `pnpm nx show project pdlc` lists the five targets;
    - `pnpm nx run scripts:sast` passes (the SCA check over the new packages).
- [ ] T006 **Host measurements** (research R12; plan phase 2). These must be done before T031 and T047 depend on
  them.
  - Build a throwaway "hello" extension in the scratchpad, never committed. It needs a one-tool server whose tool runs
    `git --version` through `execFile` and returns `process.version`, `process.env.PATH`'s git entry and
    `process.execPath`.
  - Pack it with `mcpb pack` and install it on the Windows host. Then record four observations in a **"Measured on
    the host (date)"** block appended to R12 in `specs/014-pdlc-proposal-intake/research.md`:
    1. whether `git` was found, and from which `PATH`;
    2. the bundled Node version;
    3. where server stderr lands: the exact log file (expected `mcp-server-pdlc.log` under `%APPDATA%\Claude\logs`,
       or an MSIX-virtualised `%LOCALAPPDATA%\Packages\Claude_…` path), confirmed by finding the throwaway server's
       own stderr line in it; and the observed **retention and rotation** of that log (size cap, number of files
       kept). This file is the audit log (research R17);
    4. where a `sensitive` setting is stored.
  - Uninstall the throwaway afterwards.
  - **Done when**: all four observations are recorded as observed facts, not assumptions. If `git` was **not**
    reachable, T053 is in scope; otherwise T053 is marked "not needed" with the observation quoted.

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: the coverage policy flag, the shared contract files, and the server modules that every tool uses:
config, logging and redaction, the forge client, the owner allowlist, label resolution, the git runner, and the tool
contract with its server factory.

**⚠️ CRITICAL**: no user-story work begins until this phase is complete.

- [X] T007 [P] Add tests for `--policy <file>` to `scripts/__tests__/check-coverage.test.mjs`:
  - a policy file outside `scripts/` sets the floor and the module glob;
  - without the flag, the default `scripts/coverage-policy.yaml` behaviour is unchanged;
  - an unreadable policy file exits non-zero and names the file.
  - **Scenarios covered**: plan "Testing" (the 70% floor for `pdlc:test`); research R16
  - **Verify RED**: `node --test --test-name-pattern "policy" scripts/__tests__/check-coverage.test.mjs` → expected:
    the 3 new tests fail, because `--policy` is an unknown argument
- [X] T008 Implement `--policy <file>` in `scripts/check-coverage.mjs`, and document it in its `--help`
  (prerequisite: T007 verified RED).
  - **Verify GREEN**: the T007 command → expected: 0 failures, 3 new tests passing. Then
    `node --test scripts/__tests__/check-coverage.test.mjs` still passes in full.
- [X] T009 [P] Create the master contract files:
  - `mcp-servers/pdlc/contract/proposal.yaml`: a byte copy of
    `docs/proposals/claude-desktop-proposal-intake/proposal.yaml`, unchanged (spec FR-021; contracts/proposal-body.md);
  - `mcp-servers/pdlc/contract/proposal-labels.json`, from `data-model.md` Proposal labels.Name, Proposal
    labels.Colour and Proposal labels.Description, including `status/needs-spec`, `priority/p1`–`p3` and
    `status/bot-managed`. The existing labels' colours and descriptions are copied from `TAXONOMY` in
    `scripts/backlog.mjs`.
  - **Done when**: `cmp` of the two form files exits 0, and the JSON parses with exactly the rows of the data-model
    table.
- [X] T010 [P] Write tests for the redactor and the JSON-lines logger in `mcp-servers/pdlc/tests/unit/redact.test.mjs`
  and `mcp-servers/pdlc/tests/unit/log.test.mjs`.
  - The redactor removes the configured token, `Authorization: token …` and `Bearer …` values, and URL userinfo from
    strings and nested objects.
  - The logger writes one JSON object per line to an injected stderr stream, with
    `{ts, level, service:"pdlc", correlation_id, tool, repo?, number?, msg}`, and nothing to stdout.
  - `audit(record)` writes exactly one `event: "audit"` line with the fields in research R17, and rejects a record
    carrying a body or section text. An audit line is emitted even when a lower log level is configured.
  - **Scenarios covered**: FR-018 (log sink), SC-008, research R17
  - **Verify RED**: `node --test mcp-servers/pdlc/tests/unit/redact.test.mjs mcp-servers/pdlc/tests/unit/log.test.mjs`
    → expected: 2 failing files, `ERR_MODULE_NOT_FOUND` for `src/redact.mjs` and `src/log.mjs`
- [X] T011 Implement `mcp-servers/pdlc/src/redact.mjs` and `mcp-servers/pdlc/src/log.mjs`. Every log call passes
  through the redactor (prerequisite: T010 verified RED).
  - **Verify GREEN**: the T010 command → expected: 0 failures, and every named test passes
- [X] T012 [P] Write tests for configuration loading in `mcp-servers/pdlc/tests/unit/config.test.mjs`. Each field
  follows its validation and failure rule from `data-model.md`: Configuration.forgeUrl, Configuration.owner,
  Configuration.token, Configuration.cloneRoot. Also cover the derived `apiBase`.
  - A missing or invalid value throws an error naming the variable (`PDLC_FORGE_URL`, `PDLC_FORGE_OWNER`,
    `PDLC_FORGE_TOKEN`, `PDLC_CLONE_ROOT`).
  - A canary token never appears in any error message.
  - A URL with userinfo is not echoed.
  - **Scenarios covered**: US5-AC2, FR-004, FR-018
  - **Verify RED**: `node --test mcp-servers/pdlc/tests/unit/config.test.mjs` → expected: 1 failing file,
    `ERR_MODULE_NOT_FOUND` for `src/config.mjs`
- [X] T013 Implement `mcp-servers/pdlc/src/config.mjs` as `loadConfig(env)`, a pure function returning a frozen
  config, or throwing `ConfigError(variable, reason)` (prerequisite: T012 verified RED).
  - **Verify GREEN**: the T012 command → expected: 0 failures
- [X] T014 [P] Write tests for the forge client in `mcp-servers/pdlc/tests/unit/forge-client.test.mjs`, using an
  injected `fetch` double. Cover:
  - the `Authorization: token` header is sent and appears in no returned value;
  - paging follows `x-total-count`, with `limit` at most 50, and a page cap sets `truncated: true`;
  - 401 and 403 map to `forge_auth`, naming the capability (for example "list repositories"), never the token;
  - a network error maps to `forge_unreachable`;
  - 404 maps to `not_found`;
  - an error body is never echoed verbatim.
  - **Scenarios covered**: edge cases (forge unreachable, missing scope, more than one page), FR-015 (paging), FR-018
  - **Verify RED**: `node --test mcp-servers/pdlc/tests/unit/forge-client.test.mjs` → expected: 1 failing file,
    `ERR_MODULE_NOT_FOUND`
- [X] T015 Implement `mcp-servers/pdlc/src/forge-client.mjs`: `createForgeClient({config, fetch, log})` with `get`,
  `getAll` (paging), `post`, `patch`, `delete` and `raw`. Each failure throws a `Refusal(code, reason)`
  (prerequisite: T014 verified RED).
  - **Verify GREEN**: the T014 command → expected: 0 failures
- [X] T016 [P] Write tests for the owner allowlist in `mcp-servers/pdlc/tests/unit/repo-allowlist.test.mjs`. Cover:
  - `GET /repos/search` rows are filtered to `owner.login` equal to the configured owner, compared case-insensitively
    (`data-model.md` Repository.name, Repository.default_branch);
  - the canonical name is returned for a case-different request;
  - the list is cached, and refreshed once on a miss;
  - another owner (`owner/repo` form) or an unknown name refuses with `unknown_repo`, and the fetch double records
    **no** further request;
  - `has_clone` follows `data-model.md` Repository.has_clone, using an injected `fs.existsSync`.
  - **Scenarios covered**: US1-AC1, US3-AC1, FR-012, research R1
  - **Verify RED**: `node --test mcp-servers/pdlc/tests/unit/repo-allowlist.test.mjs` → expected: 1 failing file,
    `ERR_MODULE_NOT_FOUND`
- [X] T017 Implement `mcp-servers/pdlc/src/repo-allowlist.mjs` (prerequisite: T016 verified RED).
  - **Verify GREEN**: the T016 command → expected: 0 failures
- [X] T018 [P] Write tests for label resolution in `mcp-servers/pdlc/tests/unit/labels.test.mjs`. Cover:
  - every label page is loaded, and names resolve to ids;
  - an unknown name refuses with `unknown_label`, naming it, before any filtered or write request;
  - `planStatusSwap(current, target)` and `planPrioritySwap(current, target)` return exactly one id to remove and one
    to add, and no change when already in the target state. This follows the transitions table under
    `data-model.md` Proposal.status and Proposal.priority;
  - several `priority/*` labels produce a single target priority and remove the rest.
  - **Scenarios covered**: US3-AC3, FR-006, FR-007, FR-014, research R8
  - **Verify RED**: `node --test mcp-servers/pdlc/tests/unit/labels.test.mjs` → expected: 1 failing file,
    `ERR_MODULE_NOT_FOUND`
- [X] T019 Implement `mcp-servers/pdlc/src/labels.mjs` (prerequisite: T018 verified RED).
  - **Verify GREEN**: the T018 command → expected: 0 failures
- [X] T020 [P] Write tests for the git runner in `mcp-servers/pdlc/tests/unit/git-runner.test.mjs`, with an injected
  `execFile` double. Cover:
  - only the verbs listed under `data-model.md` Local proposal copy (git verbs) run;
  - `commit`, `push`, `branch`, `checkout`, `stash`, `reset`, `rebase`, `pull`, `tag`, `config` without `--get`, and
    `merge` without `--ff-only` are refused **before** `execFile` is called;
  - authentication goes through `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_0` and `GIT_CONFIG_VALUE_0` (an `http.extraHeader`)
    in the child environment, never in argv;
  - `execFile` always receives an argument array, with no `shell` option;
  - `GIT_TERMINAL_PROMPT=0` is set.
  - **Scenarios covered**: US3-AC5 (no history), FR-017, FR-018, research R2
  - **Verify RED**: `node --test mcp-servers/pdlc/tests/unit/git-runner.test.mjs` → expected: 1 failing file,
    `ERR_MODULE_NOT_FOUND`
- [X] T021 Implement `mcp-servers/pdlc/src/git-runner.mjs`, with the git binary taken from `PATH` (or from the
  `git_path` setting if T053 applies) (prerequisite: T020 verified RED).
  - **Verify GREEN**: the T020 command → expected: 0 failures
- [X] T022 [P] Write the tool contract test in `mcp-servers/pdlc/tests/unit/tool-contract.test.mjs`. It connects an
  MCP `Client` to `createServer(deps)` over the SDK's `InMemoryTransport` and calls `tools/list`.
  - The names are exactly the nine in [contracts/tools.md](contracts/tools.md).
  - Each input schema's property names, required set and enum values match the contract.
  - No tool name matches `/close|reopen|delete|label|milestone|assign|bulk|write_file/`.
  - A handler that throws a `Refusal` yields `isError: true`, with `{refused, code, reason}` text.
  - A success yields both `content[0].text` and `structuredContent` holding the same object.
  - Every call, success or refusal, writes exactly one `audit` line to the injected stderr **before** the result
    reaches the client, with `decision`, `code` (on refusal) and the request id as `correlation_id` (research R17).
  - **Scenarios covered**: US3-AC7, FR-001, FR-002, FR-003, SC-006, constitution Logging (audit, as amended in T002)
  - **Verify RED**: `node --test mcp-servers/pdlc/tests/unit/tool-contract.test.mjs` → expected: 1 failing file,
    `ERR_MODULE_NOT_FOUND` for `src/server.mjs`
- [X] T023 Implement the tool contract, server and handlers (prerequisite: T022 verified RED):
  - `mcp-servers/pdlc/src/tool-contract.mjs`: names, descriptions and zod input schemas, the single source for
    registration;
  - `mcp-servers/pdlc/src/server.mjs`: `createServer(deps)` registers every tool from the contract, and the stdio entry
    is guarded by `import.meta.main` or an equivalent;
  - `mcp-servers/pdlc/src/tools.mjs`: the handler map. Until its story lands, each handler is a temporary stub that
    throws `Refusal('invalid_input', 'not implemented')`; the stubs are gone by the end of US4. Every handler maps
    `Refusal` to the result convention, and one wrapper emits the `audit` line for every call before returning.
  - **Verify GREEN**: the T022 command → expected: 0 failures. Then `pnpm nx run pdlc:test` passes, with the coverage
    floor applied through `--policy`.

**Checkpoint**: `pnpm nx run pdlc:test` is green. User stories can start.

---

## Phase 3: User Story 1 — capture a new proposal entirely in Claude Desktop (Priority: P1) 🎯 MVP

**Goal**: list repositories, create and sync a local copy, report its status, file a draft proposal whose body matches
the form, refuse a duplicate title, and read back a web-form proposal.

**Independent Test**: on the gated tiers, `tools.test.mjs` drives `list_repos → sync_repo → repo_status →
create_proposal → get_proposal` over the protocol, and `local-copy.integration.test.mjs` clones and fast-forwards a
real bare repository. Live, quickstart §2 (create, duplicate, read back) against `ci-smoke`.

### Tests for User Story 1 (TDD) ⚠️

- [X] T024 [P] [US1] Write tests for the body format in `mcp-servers/pdlc/tests/unit/proposal-body.test.mjs`:
  - `renderBody(sections)` emits the nine `### <Heading>` blocks in the order of `data-model.md` Proposal section.id
    and Proposal section.Heading, with `_No response_` for an empty optional section;
  - `parseBody(text)` follows rules 1–4 of [contracts/proposal-body.md](contracts/proposal-body.md): an
    out-of-order or user-typed `### …` line stays content; `text before first section` and `missing section: <H>` are
    warnings;
  - the round trip holds for generated inputs, with empties normalised to `""`;
  - a fixture captured from a real web-form submission,
    `mcp-servers/pdlc/tests/unit/fixtures/web-form-proposal.md`, parses into the same section set as a rendered one.
  - **Scenarios covered**: US1-AC4 (body), US1-AC6, SC-002, FR-010
  - **Verify RED**: `node --test mcp-servers/pdlc/tests/unit/proposal-body.test.mjs` → expected: 1 failing file,
    `ERR_MODULE_NOT_FOUND`
- [X] T025 [P] [US1] Write the master-copy guards in `mcp-servers/pdlc/tests/unit/master-copies.test.mjs`, reading the
  form with `yaml`:
  - the master form's field labels equal the heading list exported by `src/proposal-body.mjs`, in order (FR-011);
  - the form's `labels:` are exactly `type/proposal` and `status/proposal-draft` (FR-021);
  - each row of `proposal-labels.json` has a `name`, a six-hex `color` and a non-empty `description` (FR-022).
  - **Scenarios covered**: FR-011, FR-021, FR-022
  - **Verify RED**: `node --test mcp-servers/pdlc/tests/unit/master-copies.test.mjs` → expected: 1 failing file,
    `ERR_MODULE_NOT_FOUND` for `src/proposal-body.mjs`
- [X] T026 [P] [US1] Write unit tests for the local copy in `mcp-servers/pdlc/tests/unit/local-copy.test.mjs`, with
  a git-runner double. Cover:
  - `status(repo)` computes each field from `data-model.md`: Local proposal copy.path, .exists, .branch, .dirty,
    .behind, .ahead;
  - an absent copy yields `exists: false` and `null` for the rest;
  - `sync(repo)` on an absent copy runs `clone --filter=blob:none --single-branch --branch <default>` with an origin
    URL without userinfo (research R3);
  - a clean copy that is behind runs `fetch` and then `merge --ff-only` and reports `fast_forwarded` with `from` and
    `to`;
  - a copy that is behind by 0 reports `up_to_date`;
  - the branch used is always the repository's `default_branch`, never a literal `main`;
  - the expected origin comes from an injected `originUrlFor(repo)` dependency, whose production value builds
    `<forgeUrl>/<owner>/<name>.git`. No module but `config.mjs` reads `forgeUrl`'s scheme rule, so tests can supply a
    `file://` root.
  - **Scenarios covered**: US1-AC2, US1-AC3, edge case (default branch not `main`)
  - **Verify RED**: `node --test mcp-servers/pdlc/tests/unit/local-copy.test.mjs` → expected: 1 failing file,
    `ERR_MODULE_NOT_FOUND`
- [X] T027 [P] [US1] Write a real-git integration test in
  `mcp-servers/pdlc/tests/integration/local-copy.integration.test.mjs`. In a temp directory:
  - create a bare "forge" repository with a `main` and a non-`main` default variant, with
    `uploadpack.allowFilter=true` set on it. It is addressed as a `file://` URL through `originUrlFor`, because a
    plain path makes git ignore `--filter` and hardlink instead, so the blobless clone would go untested;
  - assert the clone is blobless (`git config remote.origin.promisor` is `true`, and
    `remote.origin.partialclonefilter` is `blob:none`);
  - clone it through `sync`, and assert a file is readable;
  - push a new commit to the bare repository, then `status` reports `behind: 1` with no working-tree change;
  - `sync` fast-forwards to the new commit;
  - `.git/config` holds no credential and no userinfo.

  No test doubles are used.
  - **Scenarios covered**: US1-AC2, US1-AC3, FR-017 (credential not stored)
  - **Verify RED**: `node --test mcp-servers/pdlc/tests/integration/local-copy.integration.test.mjs` → expected: 1
    failing file, `ERR_MODULE_NOT_FOUND` for `src/local-copy.mjs`
- [X] T028 [P] [US1] Write tests for creating and reading proposals in
  `mcp-servers/pdlc/tests/unit/proposals.test.mjs`, with forge, labels and allowlist doubles.
  - `create`:
    - the title is `Proposal: <feature_name>` (`data-model.md` Proposal.title);
    - the labels are `type/proposal` + `status/proposal-draft` or `status/needs-spec` + one `priority/pN`, sent as
      ids;
    - the body comes from `renderBody`;
    - an empty `feature_name` or an unknown section key refuses with `invalid_input`;
    - a body over 64 KiB or a title over 255 characters refuses with `invalid_input`, in schema validation, before
      any forge call (`data-model.md` Proposal, write guard 0);
    - an open proposal with the same `trim().toLowerCase()` title refuses with `duplicate_title`, naming its number,
      and the double records no POST (write guard 5);
    - the result carries the new `updated_at` (`data-model.md` Proposal.updated_at).
  - `get`:
    - returns the parsed sections, labels, comments and `url`;
    - when the `priority/*` label and the Priority section disagree, the label wins and a warning is added
      (`data-model.md` Proposal.priority);
    - status `unknown` with a warning when neither or both status labels are present (`data-model.md`
      Proposal.status);
    - `not_a_proposal` when `type/proposal` is absent.
  - **Scenarios covered**: US1-AC4, US1-AC5, FR-005, FR-009, research R9, R10
  - **Verify RED**: `node --test mcp-servers/pdlc/tests/unit/proposals.test.mjs` → expected: 1 failing file,
    `ERR_MODULE_NOT_FOUND`
- [X] T029 [P] [US1] Write tool-level tests for US1 in `mcp-servers/pdlc/tests/unit/tools.test.mjs`, over
  `InMemoryTransport` with doubles behind `deps`. `list_repos`, `repo_status`, `sync_repo`, `create_proposal` and
  `get_proposal` each return the output shape in [contracts/tools.md](contracts/tools.md), with `structuredContent`.
  `repo` is matched case-insensitively and returned canonically.
  - **Scenarios covered**: US1-AC1 to US1-AC6
  - **Verify RED**: `node --test --test-name-pattern "US1" mcp-servers/pdlc/tests/unit/tools.test.mjs` → expected:
    the US1 tests fail with the `not implemented` refusal from the T023 stubs

### Implementation for User Story 1

- [X] T030 [US1] Implement `mcp-servers/pdlc/src/proposal-body.mjs`: `SECTIONS` (`data-model.md` Proposal section.id
  and Proposal section.Heading), `renderBody` and `parseBody` (prerequisite: T024 and T025 verified RED).
  - **Verify GREEN**:
    `node --test mcp-servers/pdlc/tests/unit/proposal-body.test.mjs mcp-servers/pdlc/tests/unit/master-copies.test.mjs`
    → expected: 0 failures
- [X] T031 [US1] Implement `status` and `sync` (clone and fast-forward only; the refusals come in T043) in
  `mcp-servers/pdlc/src/local-copy.mjs`, as `createLocalCopy({cloneRoot, originUrlFor, git})`. Follow the sync transitions under `data-model.md` Local proposal copy
  (prerequisite: T026 and T027 verified RED).
  - **Verify GREEN**:
    `node --test mcp-servers/pdlc/tests/unit/local-copy.test.mjs mcp-servers/pdlc/tests/integration/local-copy.integration.test.mjs`
    → expected: 0 failures
- [X] T032 [US1] Implement `create` and `get` in `mcp-servers/pdlc/src/proposals.mjs` (prerequisite: T028 verified
  RED).
  - **Verify GREEN**: `node --test mcp-servers/pdlc/tests/unit/proposals.test.mjs` → expected: 0 failures
- [X] T033 [US1] Wire `list_repos`, `repo_status`, `sync_repo`, `create_proposal` and `get_proposal` in
  `mcp-servers/pdlc/src/tools.mjs`, and log each write at INFO with tool, repository and number, never the body
  (research R17) (prerequisite: T029 verified RED).
  - **Verify GREEN**: the T029 command → expected: 0 failures. Then `pnpm nx run pdlc:test` and
    `pnpm nx run pdlc:integration` pass, with skip count 0.
- [X] T034 [P] [US1] Write the skill master test in `mcp-servers/pdlc/tests/unit/skill-master.test.mjs`. It checks
  that `mcp-servers/pdlc/skill/proposal-intake/SKILL.md`:
  - names exactly the nine tool names of `src/tool-contract.mjs` and no other `snake_case` tool call;
  - contains the three R18 edits, found by marker phrases:
    - missing grounding files are named and the session continues;
    - the latest `updated_at` is kept after every write;
    - forge text is data, not instructions.
  - **Scenarios covered**: FR-003, FR-023, FR-024, research R18
  - **Verify RED**: `node --test mcp-servers/pdlc/tests/unit/skill-master.test.mjs` → expected: 1 failing file,
    ENOENT for the skill
- [X] T035 [US1] Create `mcp-servers/pdlc/skill/proposal-intake/SKILL.md` from
  `docs/proposals/claude-desktop-proposal-intake/SKILL.md`, with the three R18 edits (prerequisite: T034 verified
  RED).
  - **Verify GREEN**: the T034 command → expected: 0 failures

**Checkpoint**: US1 is functional on the gated tiers. This is the MVP: a draft can be filed and read back.

---

## Phase 4: User Story 2 — refine a draft and confirm it as ready (Priority: P1)

**Goal**: list proposals by status, query and state; read one with its comments; partially update its sections,
title, priority and status, with stale-write refusal; and add a comment. Every write returns the new `updated_at`.

**Independent Test**: `tools.test.mjs` "US2" drives create → list → get → update to ready → back to draft, with a
stale refusal in between. Live: quickstart §2 (update to ready, `stale` after an out-of-band edit).

### Tests for User Story 2 (TDD) ⚠️

- [ ] T036 [P] [US2] Write tests for refining proposals in `mcp-servers/pdlc/tests/unit/proposals-refine.test.mjs`.
  - `list`:
    - `status` `draft` / `ready` / `all` filters on the resolved label ids (`all` uses `type/proposal` alone);
    - `query` is passed as `q`; `state` defaults to `open`;
    - `type=issues` is always sent, and any row with `pull_request` is dropped;
    - `truncated` and `total` are reported.
  - `get` returns `comments` as `{author, created_at, body}`.
  - `update`:
    - only the given sections are replaced, and the rest are kept as parsed;
    - a status change swaps exactly one label (DELETE the old id, POST the new one), and the other labels are
      untouched;
    - a priority change replaces the single `priority/*`;
    - `changed[]` lists what changed, and a title change is allowed;
    - when `updated_at` ≠ `expected_updated_at`, it refuses with `stale` and the current value, and the double records
      no PATCH, DELETE or POST (`data-model.md` Proposal.updated_at, write guard 4).
  - `comment`: a body of 1 to 65,536 bytes; it returns `comment_url` and the issue's new `updated_at`.
  - **Scenarios covered**: US2-AC1 to US2-AC6, FR-006, FR-007, FR-015, FR-016, research R8, R9
  - **Verify RED**: `node --test mcp-servers/pdlc/tests/unit/proposals-refine.test.mjs` → expected: the tests fail
    with `TypeError: … list is not a function` (and likewise `update` and `comment`)
- [ ] T037 [P] [US2] Add tool-level tests for US2 to `mcp-servers/pdlc/tests/unit/tools.test.mjs`, covering
  `list_proposals`, `update_proposal` and `add_comment`, with the output shapes from contracts/tools.md.
  - **Scenarios covered**: US2-AC1 to US2-AC6
  - **Verify RED**: `node --test --test-name-pattern "US2" mcp-servers/pdlc/tests/unit/tools.test.mjs` → expected:
    the US2 tests fail with `not implemented`

### Implementation for User Story 2

- [ ] T038 [US2] Implement `list`, `update` and `comment` in `mcp-servers/pdlc/src/proposals.mjs`, using
  `planStatusSwap` and `planPrioritySwap` from `src/labels.mjs`, and re-reading `updated_at` after each write
  (prerequisite: T036 verified RED).
  - **Verify GREEN**: the T036 command → expected: 0 failures. Then `proposals.test.mjs` still passes.
- [ ] T039 [US2] Wire `list_proposals`, `update_proposal` and `add_comment` in `mcp-servers/pdlc/src/tools.mjs`
  (prerequisite: T037 verified RED).
  - **Verify GREEN**: the T037 command → expected: 0 failures. Then `pnpm nx run pdlc:test` passes.

**Checkpoint**: US1 and US2 together give the whole Claude Desktop flow on the gated tiers (SC-001's tool half).

---

## Phase 5: User Story 3 — the server refuses anything outside proposals (Priority: P1)

**Goal**: every guard in FR-012 to FR-018 has a test that observes a refusal and an unchanged forge and copy (FR-020,
SC-003). Depends on US1 and US2, whose operations the guards protect.

**Independent Test**: `pnpm nx run pdlc:test` (write-guards, secret-sinks) and `pnpm nx run pdlc:integration`
(copy refusals) are green, with skip count 0.

### Tests for User Story 3 (TDD) ⚠️

- [ ] T040 [P] [US3] Write the write-guard matrix in `mcp-servers/pdlc/tests/unit/write-guards.test.mjs`. For each of
  `create_proposal`, `update_proposal`, `add_comment`, `list_proposals` and `get_proposal`, send the request each
  guard refuses:
  - another owner, or an unknown repository (no forge request at all);
  - a target that is a PR;
  - a target without `type/proposal`;
  - a target carrying `status/bot-managed` (on update **and** comment, even when `type/proposal` is present);
  - an unknown label in a filter or a write;
  - a stale `expected_updated_at`;
  - an over-size body.

  Assert the refusal `code`, a non-empty `reason`, and **zero** non-GET requests recorded by the fetch double. Assert
  the guards apply in the order under `data-model.md` Proposal (write guards 0–5): a request that breaks two guards is
  refused by the earlier one. For example, an over-size body for an unknown repository gets `invalid_input`, with no
  forge request.
  - **Scenarios covered**: US3-AC1, US3-AC2, US3-AC3, US3-AC6, FR-012 to FR-016, FR-019, FR-020, SC-003
  - **Verify RED**: `node --test mcp-servers/pdlc/tests/unit/write-guards.test.mjs` → expected: the order tests and
    the `bot_managed` comment test fail. If the US1 and US2 code already refuses a case, take a **mutation RED** for it
    instead: delete that guard's check in `src/proposals.mjs`, watch its row fail, then revert.
- [ ] T041 [P] [US3] Write a real-git refusal test in
  `mcp-servers/pdlc/tests/integration/local-copy-refusals.integration.test.mjs`. Build each copy state against a bare
  repository addressed through `originUrlFor` as a `file://` URL, set up as in T027:
  - dirty (a modified tracked file, and separately one untracked file): `copy_dirty`;
  - on another branch, and detached HEAD: `copy_off_branch`;
  - a local commit ahead of `origin`: `copy_diverged`;
  - a folder that is not a repository, or has a different `origin`: `copy_foreign`.

  Each is checked by `data-model.md` Local proposal copy.dirty, .branch, .diverged and .is_copy_of_repo. For each,
  assert the refusal code, and that `git status --porcelain`, `HEAD`, `git for-each-ref` and `git stash list` are
  byte-identical before and after. After **every** operation in both integration files, no new ref, stash or commit
  exists.
  - **Scenarios covered**: US3-AC4, US3-AC5 (no history), FR-017, SC-004, SC-005
  - **Verify RED**: `node --test mcp-servers/pdlc/tests/integration/local-copy-refusals.integration.test.mjs` →
    expected: the refusal tests fail, because `sync` fast-forwards or errors instead of refusing
- [ ] T042 [P] [US3] Write the secret-sink sweep in `mcp-servers/pdlc/tests/unit/secret-sinks.test.mjs`. Run every
  tool, including the failing paths (401, 403, network error, a refusal), with a canary token. Assert the canary does
  not appear in:
  - any tool result text or `structuredContent`;
  - any captured stderr line;
  - any argv given to the git double;
  - any fetch URL.

  Assert it appears **only** in the `Authorization` header and the `GIT_CONFIG_VALUE_*` environment. Also assert that
  no proposal body text appears in any git argv.
  - **Scenarios covered**: US3-AC5 (credential), FR-018, SC-008
  - **Verify RED**: `node --test mcp-servers/pdlc/tests/unit/secret-sinks.test.mjs` → expected: a mutation RED.
    Change `src/log.mjs` to skip the redactor, and the stderr assertion fails; then revert. Repeat with the
    forge-client error path echoing the request headers.

### Implementation for User Story 3

- [ ] T043 [US3] Implement the four copy refusals in `mcp-servers/pdlc/src/local-copy.mjs`, checking `is_copy_of_repo`
  first (prerequisite: T041 verified RED).
  - **Verify GREEN**: the T041 command and the T027 command → expected: 0 failures
- [ ] T044 [US3] Close any gap T040 or T042 found in `mcp-servers/pdlc/src/proposals.mjs`, `src/tools.mjs`,
  `src/log.mjs` and `src/forge-client.mjs`. Apply the guards in the data-model order, and redact at every sink
  (prerequisite: T040 and T042 verified RED).
  - **Verify GREEN**:
    `node --test mcp-servers/pdlc/tests/unit/write-guards.test.mjs mcp-servers/pdlc/tests/unit/secret-sinks.test.mjs`
    → expected: 0 failures. Then `pnpm nx run pdlc:test` and `pnpm nx run pdlc:integration` pass.

**Checkpoint**: all three P1 stories are done. This is the safe-to-give-write-access line.

---

## Phase 6: User Story 4 — tell the operator when a repository is not set up (Priority: P2)

**Goal**: `check_setup` reports missing labels and the form's state against the master. It creates nothing.

**Independent Test**: `setup-check.test.mjs` has four fixtures (nothing set up, labels only, form out of step, all
set up). Live: quickstart §2, where `check_setup` returns `ok` for `ci-smoke`.

- [ ] T045 [P] [US4] Write tests for the setup check in `mcp-servers/pdlc/tests/unit/setup-check.test.mjs`, with
  forge doubles. Check each result field of `data-model.md`: Setup check result.missing_labels, .form,
  .default_branch, .fix_hint, .ok.
  - Every label in `proposal-labels.json` except `status/bot-managed` is required; each missing one is listed, and no
    POST is recorded.
  - A raw 404 on the default branch gives `form: "missing"`.
  - A file present but absent from `GET …/issue_templates` gives `not_in_effect` (research R7).
  - Bytes that differ from the bundled master after CRLF→LF normalisation give `out_of_step`; CRLF-only differences
    give `ok`.
  - All present gives `ok: true`.
  - `ok: false` is a normal result, not `isError`.
  - **Scenarios covered**: US4-AC1 to US4-AC4, FR-028
  - **Verify RED**: `node --test mcp-servers/pdlc/tests/unit/setup-check.test.mjs` → expected: 1 failing file,
    `ERR_MODULE_NOT_FOUND`
- [ ] T046 [US4] Implement `mcp-servers/pdlc/src/setup-check.mjs`, reading the master form and labels from
  `../contract/` relative to the module so the bundle carries them. Wire `check_setup` in `src/tools.mjs`
  (prerequisite: T045 verified RED).
  - **Verify GREEN**: the T045 command → expected: 0 failures. Then `pnpm nx run pdlc:test` passes.

---

## Phase 7: User Story 5 — install and connect the server on the workstation (Priority: P2)

**Goal**: a packed, validated `.mcpb` with four settings; a startup refusal that names the missing setting; and the
install runbook.

**Independent Test**: `pnpm nx run pdlc:pack` produces both files, and `mcpb validate` passes. Then quickstart §3
(install) and §4 (startup refusal) on the host.

- [ ] T047 [P] [US5] Write the manifest test in `mcp-servers/pdlc/tests/unit/manifest.test.mjs`, checking against
  research R12:
  - `manifest_version` is `"0.3"`, and every required field is present;
  - `server.type` is `node`, with `entry_point` set to `src/server.mjs`;
  - there are four `user_config` entries: `forge_token` has `sensitive: true`, `clone_root` is of type `directory`,
    and all are required;
  - `mcp_config.env` maps each entry to the `PDLC_*` variable of `data-model.md` Configuration;
  - the `tools[].name` set equals `src/tool-contract.mjs`;
  - `compatibility.platforms` is `["win32"]`, and `runtimes.node` is consistent with T006's observation;
  - `version` equals `package.json`'s version.
  - **Scenarios covered**: US5-AC1, FR-001, FR-004
  - **Verify RED**: `node --test mcp-servers/pdlc/tests/unit/manifest.test.mjs` → expected: 1 failing file, ENOENT for
    `manifest.json`
- [ ] T048 [P] [US5] Write the startup test in `mcp-servers/pdlc/tests/unit/server-startup.test.mjs`. Spawn
  `node mcp-servers/pdlc/src/server.mjs` four times, each with one `PDLC_*` variable removed and a canary token set.
  Each run must exit non-zero within 5 s, stderr must name the removed variable, and the canary must appear in neither
  stdout nor stderr.
  - **Scenarios covered**: US5-AC2, FR-004, FR-018
  - **Verify RED**: `node --test mcp-servers/pdlc/tests/unit/server-startup.test.mjs` → expected: 4 failing, because
    the entry does not yet catch `ConfigError` into an exit naming the variable
- [ ] T049 [US5] Write `mcp-servers/pdlc/manifest.json`, and add `mcpb validate` to the `pdlc:lint` target in
  `mcp-servers/pdlc/project.json` (prerequisite: T047 verified RED).
  - **Verify GREEN**: the T047 command → expected: 0 failures. Then `pnpm nx run pdlc:lint` passes.
- [ ] T050 [US5] Implement the stdio entry's startup path in `mcp-servers/pdlc/src/server.mjs`:
  - load the config, and on `ConfigError` write one redacted stderr line naming the variable, then exit 1;
  - otherwise connect `StdioServerTransport`.

  Prerequisite: T048 verified RED.
  - **Verify GREEN**: the T048 command → expected: 0 failures
- [ ] T051 [US5] Write `mcp-servers/pdlc/scripts/pack.mjs` and the `pdlc:pack` target, following research R12's build
  steps:
  1. `pnpm --filter @belay/pdlc deploy --prod --config.node-linker=hoisted` into a stage under `target/pdlc/`;
  2. copy `contract/`, `skill/` and `manifest.json` into the stage;
  3. run `pnpm exec mcpb pack` to produce `target/pdlc/pdlc-<version>.mcpb`;
  4. zip `skill/proposal-intake/` to `target/pdlc/proposal-intake.zip`.
  - **Done when**:
    - `pnpm nx run pdlc:pack` produces both files;
    - `pnpm exec mcpb validate mcp-servers/pdlc/manifest.json` exits 0;
    - `unzip -l` on the `.mcpb` shows `node_modules/@modelcontextprotocol/sdk/…` as real files (no symlinks),
      together with `contract/proposal.yaml` and `src/server.mjs`.
- [ ] T052 [US5] Write `docs/runbooks/pdlc.md`, the install part. It covers:
  - prerequisites (Git for Windows 2.31 or later);
  - creating a **new** forge token named `pdlc` with exactly `write:issue` + `read:repository`, used by nothing else,
    and how to revoke it;
  - building with `pdlc:pack` and downloading both files;
  - installing the `.mcpb` and filling in the four settings;
  - creating the clone folder and connecting it to the Claude Desktop project;
  - updating the skill from `proposal-intake.zip`, whenever the master changes;
  - T006's four observations (log location, token storage, Node version, git);
  - troubleshooting by refusal code;
  - **the audit trail**: where the host's log for `pdlc` is (T006), how to find a call by `correlation_id` and read
    its `audit` line, how to match a write to the forge's issue history, and the observed retention (research R17).

  The runbook names no forge host or tailnet address.
  - **Scenarios covered**: US5-AC1, US5-AC3, FR-025
  - **Done when**: the runbook covers every item in quickstart §3, and `node scripts/check-topology-scrub.mjs` passes.
- [ ] T053 [US5] **Conditional on T006**: if `git` was not reachable from the extension, add a `git_path` `user_config`
  entry (type `file`), mapped to `PDLC_GIT_PATH`. That means changing `mcp-servers/pdlc/src/config.mjs` (optional
  setting), `src/git-runner.mjs` and `manifest.json`, together with tests in `tests/unit/config.test.mjs` and
  `tests/unit/manifest.test.mjs`, written RED first. Otherwise mark this task "not needed: <T006 observation>".
  - **Verify RED**: `node --test --test-name-pattern "git_path" mcp-servers/pdlc/tests/unit/config.test.mjs` →
    expected: the new tests fail
  - **Verify GREEN**: the same command → expected: 0 failures

---

## Phase 8: User Story 7 — BELAY accepts proposals and closes the loop itself (Priority: P2)

**Goal**: BELAY's form copy, the two labels in `backlog.mjs`, a `ready` that excludes drafts, the `close-proposal`
verb, the `after_specify` hook and its skill, and the backlog skill's pick-up rules. None of it involves the server
(FR-035). This phase comes before US6, because the MCM guide describes steps proven here.

**Independent Test**: `pnpm nx run scripts:test` and `scripts:lint` pass, with the new tests. After merge, run
`setup-labels`, then quickstart §5 and §6.

### Tests for User Story 7 (TDD) ⚠️

- [ ] T054 [P] [US7] Add label tests to `scripts/__tests__/backlog.test.mjs`:
  - `TAXONOMY` contains `type/proposal` and `status/proposal-draft`;
  - a guard asserts their `name`, `color` and `description` equal the rows of
    `mcp-servers/pdlc/contract/proposal-labels.json` (`data-model.md` Proposal labels.Name and Proposal labels.Colour).
    It reads the contract file only, never the server's code;
  - `type/proposal` counts as an item's single `type/*`;
  - a filter naming `type/proposal` while the forge fake lacks it is refused locally, before any listing request.
  - **Scenarios covered**: US7-AC3, FR-030, research R15
  - **Verify RED**: `node --test --test-name-pattern "proposal label" scripts/__tests__/backlog.test.mjs` → expected:
    the `TAXONOMY`, guard and type-count tests fail, because `type/proposal` is not in `TAXONOMY`. The local-refusal
    test already passes, because `backlog.mjs` resolves names against the repository's own labels
    (`scripts/backlog.mjs:262`). For it, take a **mutation RED**: make the resolver pass unknown names through, watch
    the test fail, then revert.
- [ ] T055 [P] [US7] Add `ready` tests to `scripts/__tests__/backlog.test.mjs`:
  - an open `type/proposal` + `status/proposal-draft` item is not listed, and `(n draft proposal(s) not listed)` is
    printed;
  - a `type/proposal` + `status/needs-spec` item is listed in priority order like any other;
  - the `--json` output carries the excluded count.
  - **Scenarios covered**: US7-AC2, FR-031
  - **Verify RED**: `node --test --test-name-pattern "ready.*draft" scripts/__tests__/backlog.test.mjs` → expected: the
    new tests fail, because the draft is listed
- [ ] T056 [P] [US7] Add `close-proposal` tests to `scripts/__tests__/backlog.test.mjs`, covering every row of
  [contracts/close-proposal-cli.md](contracts/close-proposal-cli.md) and the preconditions, effect and idempotence
  under `data-model.md` close-proposal:
  - an open proposal with `spec.md` present gets one comment, then a close, in that order, and exits 0. No label
    request is recorded, so the labels are unchanged (FR-008);
  - the comment text is exactly
    ``Superseded by spec `specs/NNN-slug/` (branch `<branch from git>`).``;
  - a re-run after a simulated close failure sees the comment and completes the close;
  - already closed with the comment exits 0 with "already closed";
  - closed without the comment exits 2;
  - a missing `spec.md`, no `type/proposal`, or `status/bot-managed` exits 2 with nothing written;
  - credential, authorisation and transport errors exit 3, 4 and 5;
  - the same-repository write guard is enforced;
  - `--help` documents the named exception to "no close verb".
  - **Scenarios covered**: US7-AC4, FR-008, FR-033, research R14
  - **Verify RED**: `node --test --test-name-pattern "close-proposal" scripts/__tests__/backlog.test.mjs` → expected:
    the new tests fail with an unknown verb
- [ ] T057 [P] [US7] Add form-copy tests:
  - in `mcp-servers/pdlc/tests/unit/master-copies.test.mjs`, assert `.forgejo/issue_template/proposal.yaml` equals the
    master byte for byte (FR-029);
  - in `scripts/__tests__/backlog.test.mjs`, assert that `describeFormValidation` passes for both
    `backlog-item.yaml` and `proposal.yaml` (FR-034), and that the proposal form files issues with `type/proposal` and
    `status/proposal-draft` (US7-AC5).
  - **Scenarios covered**: US7-AC1 (form half), US7-AC5, FR-029, FR-034
  - **Verify RED**:
    `node --test --test-name-pattern "copy|form" mcp-servers/pdlc/tests/unit/master-copies.test.mjs scripts/__tests__/backlog.test.mjs`
    → expected: the copy test fails with ENOENT for `.forgejo/issue_template/proposal.yaml`
- [ ] T058 [P] [US7] Add Spec Kit gate tests to `scripts/__tests__/check-speckit-overrides.test.mjs` and
  `scripts/__tests__/extensions-yml.test.mjs`:
  - the `after_specify` entry `belay` / `speckit.belay.close-proposal` / `optional: false` is in `EXTENSION_HOOKS` with
    `local: true`;
  - `.claude/skills/speckit-belay-close-proposal/SKILL.md` is in `PROJECT_OWNED`;
  - a fixture with the hook removed reports `hook-lost`;
  - a fixture with the skill missing fails.
  - **Scenarios covered**: FR-033 (survives a Spec Kit upgrade)
  - **Verify RED**:
    `node --test --test-name-pattern "close-proposal" scripts/__tests__/check-speckit-overrides.test.mjs scripts/__tests__/extensions-yml.test.mjs`
    → expected: the new tests fail, because the entries are absent
- [ ] T059 [P] [US7] Write the independence guard in `scripts/__tests__/pdlc-independence.guard.test.mjs`. It scans
  `scripts/*.mjs`, `scripts/lib/`, `.specify/`, `.claude/skills/` and `.forgejo/issue_template/` for any import from,
  or invocation of, `mcp-servers/pdlc/src`, any `mcp__pdlc__` tool reference, or a check for the server's presence,
  and fails on a hit. It does not scan `scripts/__tests__/` or `mcp-servers/`. Its matcher is a function, also run
  against a fixture tree that contains a planted reference.
  - **Scenarios covered**: FR-035, SC-010, edge case (server not installed)
  - **Verify RED**: a mutation RED. Plant `import '../mcp-servers/pdlc/src/tools.mjs'` in a temp copy of
    `scripts/backlog.mjs` inside the fixture tree, then run
    `node --test scripts/__tests__/pdlc-independence.guard.test.mjs` → expected: 1 failing, naming the file. Remove
    the planted line.
  - **Verify GREEN**: the same command on the real tree → expected: 0 failures

### Implementation for User Story 7

- [ ] T060 [US7] Implement the BELAY adoption in `scripts/backlog.mjs` (prerequisite: T054, T055 and T056 verified
  RED):
  - add the two `TAXONOMY` entries;
  - make `type/proposal` count as a type;
  - exclude drafts in `ready`, with the note;
  - add the `close-proposal <n> --spec <dir> [--json]` verb, which comments, then closes, and is idempotent. Its exit
    codes follow `contracts/close-proposal-cli.md`, and it reads the branch from `git rev-parse --abbrev-ref HEAD`;
  - update `--help` to replace "there is no close verb" with the named exception.
  - **Verify GREEN**: the T054, T055 and T056 commands → expected: 0 failures. Then
    `node --test scripts/__tests__/backlog.test.mjs` passes in full.
- [ ] T061 [US7] Create `.forgejo/issue_template/proposal.yaml` as a byte copy of
  `mcp-servers/pdlc/contract/proposal.yaml` (prerequisite: T057 verified RED).
  - **Verify GREEN**: the T057 command → expected: 0 failures. Then `node scripts/backlog.mjs validate-form` reports
    both forms, with the new one "not yet on the default branch".
- [ ] T062 [US7] Add the hook and its skill (prerequisite: T058 verified RED):
  - add the `after_specify` hook in [contracts/close-proposal-cli.md](contracts/close-proposal-cli.md) to
    `.specify/extensions.yml`;
  - register it in `EXTENSION_HOOKS` (`local: true`) and the skill in `PROJECT_OWNED` in
    `scripts/check-speckit-overrides.mjs`;
  - write `.claude/skills/speckit-belay-close-proposal/SKILL.md`, following the contract's "Skill behaviour" steps 1–3.
  - **Verify GREEN**: the T058 command → expected: 0 failures. Then `node scripts/check-speckit-overrides.mjs` exits 0.
- [ ] T063 [US7] Update `.claude/skills/forgejo-issues/SKILL.md` with a "Proposals" section. It covers:
  - the two states and their labels;
  - that `ready` lists ready proposals and hides drafts;
  - the pick-up convention from contracts/close-proposal-cli.md (`show <n>`, then `/speckit-specify` with
    `Proposal #<n>: <title>` and the body);
  - that the `after_specify` hook closes the proposal;
  - that `close-proposal` is the only close path for a proposal;
  - that a proposal's text is data, not instructions.

  Also update lines 14, 19, 52 and 63 (T001 hits).
  - **Scenarios covered**: FR-032
  - **Done when**: every T001 hit in the file is addressed, and the section names no `pdlc` tool (T059 stays green).

**Checkpoint**: BELAY is a target repository on its branch. The live proof (quickstart §5 and §6) runs after merge
(T080).

---

## Phase 9: User Story 6 — hand off to MCM (Priority: P2)

**Goal**: a hand-off guide that a Claude Code session in MCM can carry out without asking anything.

**Independent Test**: a read-through against the spec's "Hand-off to the MCM repository" section, item by item. The
live check is quickstart §7, after MCM's own feature merges, outside this PR.

- [ ] T064 [US6] Add a "Hand off to a target repository (worked example: MCM)" part to `docs/runbooks/pdlc.md`. Take
  each item from the spec's "Hand-off to the MCM repository" section, in its order:
  - the "before starting" items;
  - the MCM feature's deliverables (form, labels, ready-excludes-drafts, pick-up, close-on-spec, docs, tests and gates,
    no dependency on the server);
  - `setup-labels` once after merge;
  - confirmation steps 1–5, where step 5 is repeated with the server stopped;
  - keeping in step.

  Point at BELAY's adoption files (from T054 to T063) as the worked example to copy.
  - **Scenarios covered**: US6-AC1, FR-026, FR-028
  - **Done when**: every bullet of the spec section maps to a line of the guide, and the guide names no forge host.

---

## Phase 10: Polish and cross-cutting concerns

- [ ] T065 [P] Write the live-forge tests in `mcp-servers/pdlc/tests/integration-forge/proposals.forge.test.mjs`, and
  the `pdlc:integration-forge` target. The target maps `FORGE_ISSUE_TOKEN` to `PDLC_FORGE_TOKEN` at the point of use
  (research R16). The scenarios are those of quickstart §2 against `ci-smoke`:
  - create a draft, refuse a duplicate, read it back;
  - update to ready; `stale` after a helper edit;
  - refuse a non-proposal; refuse another owner and an unknown repository;
  - `check_setup` returns `ok`;
  - `sync_repo` on `ci-smoke` returns `cloned` into a temp clone root, then `up_to_date`. `repo_status` reports
    `behind: 0` and `clean: true`. The clone's `.git/config` holds no token and no userinfo, which proves the
    `GIT_CONFIG_*` authentication against the real, private forge (research R2).

  The helper creates the labels idempotently, titles every issue `Proposal: pdlc-it-<run id>-…`, and closes its own
  issues at the end. With the variable unset, the target **fails**, naming it.
  - **Prerequisite (operator)**: `proposal.yaml` is committed to `ci-smoke`'s default branch. Ask the maintainer and
    do not commit it yourself.
  - **Verify RED**: `env -u FORGE_ISSUE_TOKEN pnpm nx run pdlc:integration-forge` → expected: the run fails, naming
    `FORGE_ISSUE_TOKEN`, with skip count 0
  - **Verify GREEN**: `pnpm nx run pdlc:integration-forge` → expected: 0 failures, skip count 0, and no
    `pdlc-it-<run id>` issue left open
- [ ] T066 [P] Add assertions to `scripts/__tests__/guardrails-workflow.test.mjs`. `.forgejo/workflows/guardrails.yml`
  must run `pdlc:lint`, `pdlc:test` and `pdlc:integration` after `scripts:lint` and `scripts:test`, each wrapped like
  the existing steps, so the failure digest covers it.
  - **Verify RED**: `node --test --test-name-pattern "pdlc" scripts/__tests__/guardrails-workflow.test.mjs` →
    expected: the new tests fail, because the steps are absent
- [ ] T067 Add the three steps to `.forgejo/workflows/guardrails.yml` (prerequisite: T066 verified RED).
  - **Verify GREEN**: the T066 command → expected: 0 failures. Then `node scripts/check-ci-digest-coverage.mjs` exits
    0, and `pnpm nx run scripts:lint` passes.
- [ ] T068 [P] Update `docs/runbooks/backlog.md` at the T001 hits (lines 18, 22, 25, 76, 82 and 88):
  - eleven labels, with the proposal family;
  - the proposal form beside the backlog form;
  - `ready` hides draft proposals;
  - the `close-proposal` verb as the named exception;
  - proposal states (FR-034).

  Then refresh `openwiki/runbooks/backlog.md` with `/wiki-refresh`.
  - **Done when**: `node scripts/wiki-refresh.mjs --stale` does not list `openwiki/runbooks/backlog.md`.
- [ ] T069 [P] Add the `after_specify` hook and the `speckit-belay-close-proposal` skill to the inventory table in
  `docs/runbooks/spec-kit.md`, then refresh `openwiki/runbooks/spec-kit.md`.
  - **Done when**: the inventory lists both, and `--stale` does not list the page.
- [ ] T070 [P] Update `docs/runbooks/ci.md`: what `guardrails` runs now includes the three `pdlc` targets, and
  `pdlc:integration-forge` is operator-run. Then refresh `openwiki/runbooks/ci.md`.
  - **Done when**: `--stale` does not list the page.
- [ ] T071 [P] Update `openwiki/process/spec-driven-development.md` at lines 18 and 26 (canonical). Stage 1, the
  proposal, may now live in a repository's issue backlog, filed from Claude Desktop or the web form, and is picked up
  with `Proposal #<n>:`. `docs/proposals/` stays for history and long research (FR-027).
  - **Done when**: the diagram node and step 1 name both homes.
- [ ] T072 [P] Update `openwiki/invariants/testing-tiers.md` (canonical):
  - replace line 26's "no integration tier exists yet";
  - add rows for `pdlc:test` (unit and contract, gating), `pdlc:integration` (real git, gating) and
    `pdlc:integration-forge` (real forge, operator-run, fails rather than skips).
  - **Done when**: the table names all three tiers, with their commands and gating.
- [ ] T073 [P] Update `openwiki/projects/repository.md` line 40 (canonical): `mcp-servers/` now holds `pdlc`, the
  operator-tool server (ADR-0005), and `.forgejo/issue_template/` holds two forms.
  - **Done when**: the row names `pdlc`.
- [ ] T074 [P] Update `openwiki/invariants/secrets-management.md` (canonical) with:
  - the `pdlc` token: host-only, `write:issue` + `read:repository`, stored in a Claude Desktop sensitive setting at the
    location T006 observed, and revoked separately;
  - the mapping of `FORGE_ISSUE_TOKEN` to `PDLC_FORGE_TOKEN` for `pdlc:integration-forge`.
  - **Done when**: both are listed, and the page names no host.
- [ ] T075 [P] Update `docs/repo-foundation-setup.md` line 384: the `setup-labels` comment adds `type/proposal` and
  `status/proposal-draft`.
  - **Done when**: the comment matches `TAXONOMY`.
- [ ] T076 Add the wiki and index entries:
  - add `openwiki/runbooks/pdlc.md`, with `resource: docs/runbooks/pdlc.md`, recorded by `wiki-refresh --record`;
  - list it in `openwiki/runbooks/index.md`;
  - add AGENTS.md index entries for the `pdlc` runbook (Runbooks) and ADR-0005 (Decisions).
  - **Done when**: `pnpm nx run scripts:lint` passes the OKF and governance gates, and every AGENTS.md link resolves.
- [ ] T077 **Close-out re-search**: re-run T001's searches, plus `git grep -n "there is no close verb"` and
  `git grep -n "no integration tier"`. Every remaining hit in a doc that states current procedure is either fixed or
  justified here, one line each.
- [ ] T078 Run every check the diff touches, before the push. Each must pass with skip count 0:
  - `node scripts/check-speckit-overrides.mjs`
  - `pnpm nx run scripts:lint`
  - `pnpm nx run scripts:test`
  - `pnpm nx run scripts:sast`
  - `pnpm nx run pdlc:lint`
  - `pnpm nx run pdlc:test`
  - `pnpm nx run pdlc:integration`
  - `node scripts/wiki-refresh.mjs --stale` (it must report nothing)
  - `pnpm nx run pdlc:integration-forge` (T065, operator-run)

  Then run quickstart §4 (startup refusal) on the host with the bundle from T051.
  - **Done when**: every command above is recorded with its summary line in the PR body.
- [ ] T079 **Open the PR** from a real branch, with the repository's PR tools (`docs/runbooks/ci.md`):
  1. `git push origin HEAD:014-pdlc-proposal-intake`
  2. `node scripts/forge-pr.mjs open --head 014-pdlc-proposal-intake --title "Feature 014: Claude Desktop proposal intake (pdlc server, BELAY adopts proposals)" --body-file <file>`
  3. `node scripts/ci-status.mjs watch --pr <n>`, until it exits 0 (3 means still waiting, never a failure)
  4. `node scripts/forge-pr.mjs merge <n> --expect-head <full sha>`

  Tick this task in the branch's LAST commit, and quote the branch and the PR number. **CI evidence is never recorded
  here.** The run ids, the CI verdict and the merge sha go in the PR's closing comment, and in the closing comment of
  each issue the PR resolves.
- [ ] T080 **After merge** (operator, on `main`; not part of the PR):
  1. run `node scripts/backlog.mjs setup-labels` once in BELAY;
  2. reinstall the bundle and re-upload the skill (T052);
  3. run quickstart §5 (end to end on BELAY: SC-001, SC-005, SC-009) and §6 (independence: SC-010).

  Record the outcome in the PR's closing comment.
  - **Deferred, outside this PR**: quickstart §7 (SC-007, US6-AC2 and US6-AC3) runs after MCM's own feature merges,
    following the guide from T064. Its result goes in the closing comment of MCM's feature, which links back to this
    one.

---

## Dependencies and execution order

### Phase dependencies

- **Setup (Phase 1)**:
  - T002 → T004, and T003 → T004.
  - T005 is independent of T002–T004, but **nothing merges before T002**: the plan gate puts the amendment first.
  - T006 needs only a scratch extension. T053 (US5) depends on it, and so does T047 (the `runtimes.node` value).
- **Foundational (Phase 2)**: depends on T005. T007 and T008 come before `pdlc:test` can enforce coverage, and T023
  closes the phase. **This phase blocks every story.**
- **US1 (Phase 3)**: after Phase 2. It is the MVP.
- **US2 (Phase 4)**: after Phase 2. It extends `src/proposals.mjs` and `src/tools.mjs`, which US1 created, so it runs
  after US1 in practice.
- **US3 (Phase 5)**: after US1 and US2. Its tests guard their operations.
- **US4 (Phase 6)**: after Phase 2 only. It is independent of US1–US3, apart from sharing `src/tools.mjs`.
- **US5 (Phase 7)**: T047–T050 need only Phase 2. T051 (pack) needs every tool wired (US1–US4). T052 needs T006.
- **US7 (Phase 8)**: needs only T009 (the contract files). It is otherwise independent of the server and can run in
  parallel with US1–US5.
- **US6 (Phase 9)**: after US7 (the guide points at BELAY's adoption) and T052 (the same runbook file).
- **Polish (Phase 10)**: after the stories. T079 is the last task in the PR, and T080 follows the merge.

### Within each story

- The test task is verified RED, then the paired implementation is verified GREEN, then the touched suite passes.
- Pure modules come before the modules that compose them, and the handler wiring (`src/tools.mjs`) comes last.

### Parallel opportunities

- Phase 1: T003 beside T002, and T005 and T006 beside both.
- Phase 2: every `[P]` test task (T007, T010, T012, T014, T016, T018, T020, T022) is a different file. Their
  implementations are also different files, apart from T023.
- US1: T024–T029 and T034 in parallel; T030–T032 in parallel after them.
- US7 can run in parallel with all of US1–US5.
- Polish: T068–T075 are separate files.

## Parallel example: User Story 1

```text
Task: "T024 body format tests in mcp-servers/pdlc/tests/unit/proposal-body.test.mjs"
Task: "T026 local-copy unit tests in mcp-servers/pdlc/tests/unit/local-copy.test.mjs"
Task: "T027 real-git integration test in mcp-servers/pdlc/tests/integration/local-copy.integration.test.mjs"
Task: "T028 create/get tests in mcp-servers/pdlc/tests/unit/proposals.test.mjs"
Task: "T034 skill master test in mcp-servers/pdlc/tests/unit/skill-master.test.mjs"
# then, once each is RED:
Task: "T030 src/proposal-body.mjs"   Task: "T031 src/local-copy.mjs"   Task: "T032 src/proposals.mjs"
```

## Parallel example: User Story 7 (beside the server work)

```text
Task: "T054 label tests"  Task: "T057 form-copy tests"  Task: "T058 Spec Kit gate tests"  Task: "T059 independence guard"
# T054–T056 share scripts/__tests__/backlog.test.mjs: write them in one sitting, then T060 implements all three.
```

## Implementation strategy

### MVP first (User Story 1)

1. Phase 1, with the amendment and ADR first and the host measurements early.
2. Phase 2.
3. US1: **stop and validate**. `pdlc:test` and `pdlc:integration` are green, and a draft can be filed and read back
   through the protocol.

### Incremental delivery (one PR, per the PR-batching rule: one feature, and a failure is attributable by phase)

1. US2, then US3: the full, safe Claude Desktop flow.
2. US4 and US5: setup check, bundle, install runbook. This is where the host install becomes possible.
3. US7: BELAY adopts. It can be built in parallel from Phase 2 on.
4. US6: the MCM guide, written from what US7 proved.
5. Polish, the PR, then T080 after merge.

## Notes

- `[P]` means a different file with no incomplete dependency. US7's three `backlog.test.mjs` tasks share a file, so
  write them in one sitting.
- Do not commit the scratch "hello" extension (T006), anything under `target/`, or any token.
- Commit after each task or logical group, from the worktree only.
