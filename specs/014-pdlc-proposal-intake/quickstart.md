# Quickstart: validating Claude Desktop proposal intake

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md)

These are the validation scenarios that prove the feature end to end. The tool shapes are in
[contracts/tools.md](contracts/tools.md), and the body format is in
[contracts/proposal-body.md](contracts/proposal-body.md). The full operator procedure becomes
`docs/runbooks/pdlc.md` during implementation. This page only proves that the feature works.

## 0. Prerequisites

| Where | What |
| --- | --- |
| Dev container | A worktree with a real `CI=true pnpm install --frozen-lockfile` (AGENTS.md: a symlinked `node_modules` cannot run `pnpm nx`). `FORGE_ISSUE_TOKEN` set |
| `ci-smoke` (one time, done by the operator) | `.forgejo/issue_template/proposal.yaml` committed to its default branch, byte-identical to `mcp-servers/pdlc/contract/proposal.yaml` |
| Windows host | Claude Desktop (current version), Git for Windows 2.31 or later on `PATH`, a clone folder (for example `E:\Programming\pdlc-clones`), and a **new** forge token named `pdlc` with `write:issue` + `read:repository` only |

## 1. Gated tiers (dev container; these are what CI runs)

```bash
pnpm nx run scripts:lint      # Spec Kit gate (the new hook + skill registered), topology scrub, argv-secret gate…
pnpm nx run scripts:test      # backlog.mjs: labels, ready excludes drafts, close-proposal, coverage ≥70%
pnpm nx run pdlc:lint
pnpm nx run pdlc:test         # unit + contract test over InMemoryTransport, coverage ≥70%
pnpm nx run pdlc:integration  # real git against local bare repositories: clone, fast-forward, the three refusals
```

**Expected**: all pass, and the **skip count is 0** in every `node --test` summary. In particular:

- The contract test lists exactly the nine tools in [tools.md](contracts/tools.md), with no extras.
- The heading test shows the master form's labels equal the parser's headings.
- The copy guard shows `.forgejo/issue_template/proposal.yaml` equals the master byte for byte.
- The label guard shows `TAXONOMY` in `backlog.mjs` carries the two new labels exactly as `proposal-labels.json` has
  them.

## 2. Live-forge integration (dev container, operator-run, never in CI)

```bash
pnpm nx run pdlc:integration-forge
```

**Expected**: against `ci-smoke`, these all pass:

- create a draft;
- refuse a duplicate title;
- read it back, with its sections equal to what was written;
- update it to ready with a correct `expected_updated_at`;
- refuse with `stale` after an out-of-band edit made by the test helper;
- refuse a write to a non-proposal issue;
- refuse another owner and an unknown repository;
- `check_setup` returns `ok`;
- `sync_repo` clones `ci-smoke` into a temp clone root, then reports `up_to_date`; `repo_status` reports `behind: 0`;
  the clone's `.git/config` holds no token (the authenticated clone, research R2).

The helper then closes the test's own issues. With `FORGE_ISSUE_TOKEN` unset, the target **fails**, naming the
variable. It does not skip.

## 3. Build and install the extension (Windows host)

```bash
pnpm nx run pdlc:pack         # → target/pdlc/pdlc-<version>.mcpb and target/pdlc/proposal-intake.zip
```

1. Copy both files to the host (VS Code Explorer → right-click → **Download**).
2. Open the `.mcpb` in Claude Desktop and fill in the four settings: forge URL, owner, token and clone folder.
3. Upload `proposal-intake.zip` as a skill, replacing the earlier copy.
4. Connect the clone folder to the Claude Desktop project.

**Host measurements (research R12, before the runbook is finalised)**: record whether `git` was found, the Node
version Claude Desktop bundles, the location of the server's log, and where the token setting is stored.

## 4. Startup refusal (US5-2)

Clear the clone-folder setting and restart the extension.

**Expected**: the server fails to start, and its log names `PDLC_CLONE_ROOT`. No token appears in the log.

## 5. End to end on BELAY (US1, US2, US7; SC-001, SC-005, SC-009)

Prerequisite: this feature has merged, and `node scripts/backlog.mjs setup-labels` has been run once in BELAY.

1. In Claude Desktop, ask for a proposal session. Choose **BELAY**.
   **Expected**: `check_setup` returns `ok`.
2. Get latest.
   **Expected**: `sync_repo` returns `cloned`, and the clone exists under the clone folder.
3. Start a new proposal, interview, choose p3, then **Save as draft**.
   **Expected**: the issue is titled `Proposal: …` and carries the draft labels.
4. In a new Claude Desktop conversation, find the draft, change one section, then **Confirm as ready**.
   **Expected**: it now carries `status/needs-spec` and no `status/proposal-draft`.
5. In Claude Code in BELAY, run `node scripts/backlog.mjs ready`.
   **Expected**: the proposal is listed. A second, draft proposal is not, and an `(n draft proposal(s) not listed)` note
   appears.
6. Run `/speckit-specify` with `Proposal #<n>: …` as its input.
   **Expected**: the spec folder is created, and the `after_specify` hook closes the proposal with a comment linking
   `specs/NNN-slug/`.
7. Check the target: **zero** commits, branches or PRs were created by the server. Every commit on the new branch came
   from Claude Code.

## 6. Independence from the server (FR-035, SC-010)

Disable the extension in Claude Desktop.

1. File a proposal in BELAY through the forge's web form.
   **Expected**: it carries `type/proposal` and `status/proposal-draft`.
2. Relabel it to ready in the web UI. Then repeat steps 5 and 6 of section 5.
   **Expected**: the same results.
3. Run `pnpm nx run scripts:lint` and `pnpm nx run scripts:test`.
   **Expected**: they pass, with nothing failing, warning or skipping because the server is absent.
4. Ask Claude Desktop for a proposal session.
   **Expected**: the skill says the `pdlc` tools are unavailable and stops.

## 7. MCM hand-off check (US6; SC-007, run after MCM's own feature merges)

Follow the "Confirm the hand-off" steps in `docs/runbooks/pdlc.md`, which come from the spec's
"Hand-off to the MCM repository" section.

**Expected**: `check_setup` passes for **mcm**, one proposal goes from Claude Desktop to a closed MCM issue linking its
spec, and the flow still works with the extension disabled.
