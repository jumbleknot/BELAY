# ADR-0006: The `pdlc` server writes and publishes one feature's spec branch, and a proposal stays open until it merges

- **Status:** Accepted
- **Date:** 2026-11-27
- **Approved by:** the maintainer, 2026-11-27, in a Claude Code session implementing feature 016 (decision M8):
  "ADR-0006 approved, proceed". Approved with M10 included, after the maintainer's review replaced the
  second test run at merge
- **Related:** [feature 016](../../specs/016-pdlc-spec-intake/spec.md) (backlog item #91) and its
  [research](../../specs/016-pdlc-spec-intake/research.md) (R1 to R16, M5 to M9);
  [feature 014](../../specs/014-pdlc-proposal-intake/spec.md); supersedes part of
  [ADR-0005](ADR-0005-operator-tool-mcp-servers.md)

## Context

Feature 014 (ADR-0005) gave the Product Owner and Analyst a Claude Desktop session that files and refines
proposals through the local `pdlc` server. It deliberately stopped at the proposal:

- the server's local copies were **read-only and fast-forward only** (014 FR-017), and its token was
  `write:issue` + `read:repository`;
- **writing specs was out of scope** for the server (014 Assumptions);
- a proposal **closed when its spec existed** (014 FR-008, FR-033), through BELAY's `after_specify` hook;
- a target repository's whole flow had to **work with the server absent** (014 FR-035).

In practice an Engineer runs `/speckit-specify` and `/speckit-clarify` in VS Code for the owner. The spec
loses its owner, ready proposals wait for a technical person, and clarification is skipped or answered by
the wrong person. Once the proposal closes, nothing in the backlog says where a feature is between "spec
written" and "merged", so an Architect has no list of approved specs waiting for a plan.

Feature 016 moves the spec stage into Claude Desktop. That needs the server to create a branch, commit and
push, which three of 014's decisions above rule out.

## Decision

**Four of feature 014's decisions are amended** (feature 016, spec Context table):

| Feature 014 decision | Amended to |
| --- | --- |
| Local copies are read-only and fast-forward only (014 FR-017) | A copy may also hold a feature branch for the spec being written, and the server may commit and publish **that branch only**. The default branch stays fast-forward only (016 FR-020 to FR-023) |
| Writing specs is out of scope for the server (014 Assumptions) | The server supports writing one feature's spec, on that feature's branch, inside that feature's spec folder only |
| A proposal closes when its spec exists (014 FR-008, FR-033) | A proposal stays open and moves through stages (`spec-in-progress`, `ready-to-plan`, `in-engineering`); it closes, at `merged`, when its feature branch merges into the default branch (016 FR-010 to FR-016) |
| A target repository's whole flow works with the server absent (014 FR-035) | **Kept.** The VS Code route remains, and every stage change it needs is made by the repository's own tooling (`backlog.mjs stage`, Spec Kit hooks, a CI workflow), never by the server (016 FR-031) |

**How the server does it** (016 research):

- **The target repository's own Spec Kit runs, not a copy of it** (R1). The Claude Desktop model follows
  the repository's own specify and clarify prompts, read from the local copy. The server runs the
  repository's branch script as a **dry run** (`-DryRun -Json`), so the repository's numbering and branch
  naming apply, and its `resolve-template` script for the spec template. The server then creates the
  branch itself through its git allowlist.
- **Repository code runs only in a disposable scratch clone.** Each script runs in
  `<clone_root>/.pdlc-scratch/<Repo>-<random>/`, a `clone --shared --no-checkout` of the local copy whose
  `origin` is the local path. It has no credential in its environment, runs through `execFile` with a
  fixed script path and no shell, and is deleted afterwards. The scripts come from the operator's own
  repository at a commit on its protected default branch. The scratch folder is the one write target
  repository code can reach, so nothing a script does can touch the copy, a spec worktree or the forge.
- **One git worktree per spec in progress** (R2), at `<clone_root>/.pdlc-specs/<Repo>/<NNN-slug>/`. The
  copy itself stays on its default branch, so 014's `sync_repo` and grounding are unchanged.
- **Exact git shapes, not new verbs** (R4). The allowlist gains enumerated argument shapes only. A push
  must be `push origin refs/heads/<b>:refs/heads/<b>` for the recorded feature branch, never the default
  branch, never `--force`, `+`, `--delete` or `--mirror`. A commit is `--no-verify` with a fixed message
  shape. The one `reset` is `--soft` onto the recorded published tip, to recover an unpublished commit
  after a lost publish race. No published commit is ever rewritten.
- **A file-write allowlist** (R5): `specs/<NNN-slug>/spec.md` and `specs/<NNN-slug>/checklists/*.md` in
  the worktree, plus the server's own drafts, backups, scratch clones and state files under
  `<clone_root>/.pdlc-*/`. Every path is resolved and checked before the write.
- **Stages are status labels with a machine-readable trailer comment** (R7), one per issue, defined in
  the shared label contract and `backlog.mjs` `TAXONOMY`. A fixed transition table is enforced in both the
  server and `backlog.mjs`.
- **Closing on merge is CI's job, not the server's** (R10). A new `feature-merged` workflow on `main`
  moves the issue to `merged` and closes it. It is not a required check, and counting never blocks or
  fails a merge.

**Maintainer decisions recorded here**:

- **M5: widen the `pdlc` token** to `write:issue` + `write:repository` rather than add a second token
  (2026-11-27). A second token would sit in the same process and the same Claude Desktop settings file,
  so splitting buys little. The two bounds are the server's push guard and branch protection on each
  target's default branch.
- **M6: the merge workflow's credential** is the run token if it can comment on and close an issue in
  its own repository, otherwise `CI_DIGEST_TOKEN` (already `write:issue`). Measured before it is relied
  on (R11) (2026-11-27).
- **M7: the right-hand pane** is one hand-written, self-contained HTML file served as an MCP App
  resource, with no new dependency and no build step (2026-11-27).
- **M9: `pwsh` on the CI runner**: pending. Recorded here once answered.
- **M10: test counts at merge add no test run to CI** (2026-11-27, at this ADR's review; MCM's suite
  alone takes 30+ minutes). "Created" is `scripts/count-repo-metrics.mjs`'s test declarations at the
  merge commit minus its first parent, read from git objects in `feature-merged`, in seconds. The
  outcomes are the **whole suite's** passed, failed, skipped and todo counts from the merged commit's
  own `guardrails` run, posted by a final non-failing step of that run. The tasks-template override
  gains two required tasks, a test baseline at the start and a test count before the pull request, which
  comment on the proposal issue. With no proposal, every one of these posts nothing and nothing fails.
  A failed issue update in a template task is reported and implementation continues.

**No new dependency, toolchain or top-level folder.** The server keeps `@modelcontextprotocol/sdk` and
`zod` at their ADR-0005 pins. The pane lives at `mcp-servers/pdlc/ui/`.

**This supersedes part of ADR-0005**: its `read:repository` scope for the `pdlc` token, and its premise
that the server keeps only read-only clones. The rest of ADR-0005 (the operator-tool class, stdio
locality, the audit rule, packaging, its dependencies) stands.

Alternatives considered:

- **Run Claude Code headless (`claude -p "/speckit-specify …"`) from the server.** Rejected: a second model
  behind the first, a Claude Code install and login on the workstation, the risk of `ANTHROPIC_API_KEY`
  billing, edit rights in the copy that no allowlist can bound, and clarify questions relayed through two
  conversations.
- **Reimplement Spec Kit's numbering and template in the server.** Rejected: it drifts on the next Spec Kit
  upgrade, and 016 FR-002 requires the repository's own step.
- **Run the branch script for real, or its dry run in the local copy.** Rejected: its `checkout -b` and
  `fetch --all --prune` are writes the allowlist cannot see before they happen, and it would need the token
  in its environment. Checking `git status` afterwards checks after the write, not before.
- **Switch the local copy to the feature branch.** Rejected: it breaks `sync_repo` and allows one spec at a
  time.
- **A second, push-only token.** Rejected (M5): same process, same settings file, little separation.
- **Close the issue from the server, or in `guardrails`.** Rejected: closing is not a server operation
  (016 FR-027), and `guardrails` runs on `main` cancel each other (`cancel-in-progress`), so a close
  there could be lost. Only the outcomes comment, which only that run can produce, lives in `guardrails`.
- **Run every test target again at the parent commit** to count exactly which tests the feature added
  and how many of those passed. Rejected (M10): a second full suite run per proposal merge, 30+ minutes
  on MCM.
- **The ext-apps SDK and a bundler for the pane, or Claude Desktop artifacts.** Rejected: new dependencies
  and a build toolchain (M7); artifacts cannot take the author's typed edits.

## Consequences

- **The `pdlc` credential gains repository write.** It is re-scoped to `write:issue` + `write:repository`,
  still dedicated, workstation-only and separately revocable. The manifest's `forge_token` description,
  `docs/runbooks/pdlc.md` and the secrets posture change with it. The operator confirms by hand, once per
  target repository, that its default branch is protected; `check_setup` reports
  `default_branch_protected` as `true`, `false` or `unknown`.
- **The server executes repository code** (two Spec Kit scripts), bounded as above. A target repository
  whose specify or clarify step needs a hook the server cannot honour is refused (`spec_hook_unsupported`),
  never skipped silently.
- **The workstation gains server-owned folders** under the clone root: `.pdlc-specs/`, `.pdlc-drafts/`,
  `.pdlc-backups/` and `.pdlc-scratch/`. Withdrawal deletes nothing.
- **The tool contract changes**, so the server moves to 0.2.0, and the manifest, master skill, label
  contract and contract test move together. Every target repository gains four stage labels.
- **BELAY's hooks change.** `speckit.belay.close-proposal` and the `close-proposal` verb are replaced by
  `speckit.belay.spec-stage` on `after_specify` and `after_plan`, and `backlog.mjs stage`. Proposals
  already closed under close-on-spec stay closed.
- **A new non-gating CI workflow**, `feature-merged.yml`, runs on every push to `main`. It runs no test and
  finishes in seconds. `guardrails` gains a collecting reporter and one final `continue-on-error` step on
  push to `main`; neither adds a test run nor changes its 10-minute budget.
- **BELAY's tasks template changes** (two required count tasks, a `backlog.mjs record-tests` verb), so the
  override gate and the Spec Kit runbook move with it. The counter recognises JavaScript `node:test`
  declarations only; MCM must name a counting rule for its own test kinds before it adopts the counts.
- **`pdlc:integration` needs `pwsh`** to run the real Spec Kit scripts. Where that tier runs in CI is M9.
- **MCM adopts the stages and close-on-merge** only after BELAY proves them, through the updated hand-off
  guide.
