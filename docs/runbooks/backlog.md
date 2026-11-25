# The backlog — Forgejo Issues, driven by the assistant

The BELAY backlog lives in this repository's own Forgejo issue tracker. The maintainer works it through
the web UI; the coding assistant works it through `scripts/backlog.mjs`. The tracker is the one source of
truth for cross-feature work; inside a feature, `tasks.md` stays authoritative (see "Tasks to issues").

Feature: [specs/003-backlog-taskstoissues](../../specs/003-backlog-taskstoissues/spec.md). Decision rules for the assistant:
[.claude/skills/forgejo-issues/SKILL.md](../../.claude/skills/forgejo-issues/SKILL.md).

**No backlog operation creates a commit, branch, pull request or CI run.** That is the property the whole
design rests on: issue changes are HTTP calls, so there is no commit → PR → CI cycle to pay for a
one-line backlog edit.

## Commands

```bash
node scripts/backlog.mjs --help          # full flag reference, exit codes, measured API quirks
node scripts/backlog.mjs ready           # open, unblocked, priority-ordered; never the bot's dashboard or a draft proposal
node scripts/backlog.mjs list [--state open|closed|all] [--label L]... [--milestone M] [--q TEXT]
node scripts/backlog.mjs show <n>
node scripts/backlog.mjs create --title T --body-file F [--label L]... [--milestone M]
node scripts/backlog.mjs update <n> [--state closed] [--add-label L] [--remove-label L] [--body-file F]   # not for a proposal
node scripts/backlog.mjs close-proposal <n> --spec specs/NNN-slug [--json]   # the one close path for a proposal
node scripts/backlog.mjs comment <n> --body-file F
node scripts/backlog.mjs dep <n> --blocked-by <m> [--remove]
node scripts/backlog.mjs setup-labels [--dry-run]     # idempotent
node scripts/backlog.mjs setup-milestone NNN-slug     # idempotent
node scripts/backlog.mjs validate-form
```

An operator CLI, run directly with `node` like `ci-status.mjs` and `forge-pr.mjs`; it is not a test,
lint or build operation. Its unit tests run under Nx, through `pnpm nx run scripts:test`.

Exit codes: 0 ok · 1 unexpected · 2 usage or validation · 3 missing credential · 4 authorization ·
5 transport.

## The credential

| Variable | Permissions | Used for |
| --- | --- | --- |
| `FORGE_ISSUE_TOKEN` | `write:issue` + `read:repository` | every write; preferred for reads |
| `FORGE_TOKEN` | read-only (`ci-status.mjs`) | read fallback when the write token is absent |

Set both as user environment variables (on Windows, System Properties → Environment Variables), then
restart the editor or terminal, because a running process keeps its old environment. With the write token
unset, reads still work through `FORGE_TOKEN`, and writes are refused, naming the missing variable.

The two tokens stay separate on purpose. `FORGE_TOKEN`'s read-only scope is what `ci-status.mjs` relies
on; widening it would couple two tools to one credential and silently give the CI-status path write
capability. Separate tokens, separate revocation. Pull requests use neither: `forge-pr.mjs` writes with
the git credential (see [ci.md](ci.md)).

### Its reach is account-wide, by decision

> The write credential is **not** restricted to this repository. That is a deliberate choice, not an
> oversight. Forgejo tokens are account-wide — there is no repo-scoped token
> upstream — so **permission scope** is the server-side bound: this credential can write items and read
> repositories, and cannot push code, read packages or administer anything.
>
> The client-side bound is the tooling's **same-repository write guard**: every write asserts that the
> owner/repo it is about to address is the one derived from `git remote get-url origin`, and refuses
> otherwise. It is checked twice — once against any `--repo` value, and again at the request boundary so
> a mis-built path cannot slip through. **For this tool, that guard is what keeps writes here.** The token's *scope* bounds what
> any client can do (issues only: no push, packages or admin), not which repository — so the guard exists only in
> `scripts/backlog.mjs`, and any other client holding the token can write issues in any repository on the account.

Do **not** try to check the token's permissions by reading `permissions` from the repository API: it
reports what the owning *account* may do with the repository, not what the token may do. An
item-write-only token on an admin account reports `admin: true` and still cannot push a commit. No
endpoint this token can reach reports its own scopes (`/user` → 403; it carries no `read:user`), so the
scope split is proven behaviourally — the write sequence succeeds under it and the same four write verbs
return **403** under `FORGE_TOKEN`. That negative half is the only check that the read-only token has
not been widened; re-run it if either credential is ever re-minted.

## Conventions

**Labels** (created once by `setup-labels`, fourteen of them; it creates only the missing ones, so re-run it once
after a change adds labels):

| Family | Names |
| --- | --- |
| type | `type/bug` `type/feature` `type/tech-debt` `type/chore` `type/proposal` — exactly one |
| priority | `priority/p1` `priority/p2` `priority/p3` — exactly one |
| status | `status/blocked` (the dependency graph is the intended authority — but `ready` skips the graph for a labelled item, so a stale label silently hides it; it warns for an unlabelled item with an open blocker) · `status/needs-spec` (too large to implement directly: it goes through `specs/NNN-*/` spec → plan → tasks first) · `status/bot-managed` (the dependency bot's Dependency Dashboard issue: `ready` never lists it, and prints `(n bot-managed item(s) not listed)` instead; never edit or close it, see [renovate.md](renovate.md#reading-the-dashboard)) · `status/proposal-draft` (a proposal still being shaped: `ready` never lists it, and prints `(n draft proposal(s) not listed)`) |
| bot PRs | `dependencies` `security` — the dependency bot's pull requests, not backlog labels |

The proposal family's names, colours and descriptions are copied from the shared contract
`mcp-servers/pdlc/contract/proposal-labels.json` (feature 014); a test holds `TAXONOMY` equal to it.

**Milestones** map to feature directories (`NNN-slug`). No milestone is normal — that is the free
backlog. A milestone must exist before it can be used: an unknown name is refused locally, because the
API would silently ignore it.

**The item form** at `.forgejo/issue_template/backlog-item.yaml` fixes four sections — context,
acceptance criteria, affected components, discovered-during — so an operator-filed item and an
assistant-filed item are structurally identical. It only takes effect from the **default branch**;
`validate-form` says so explicitly rather than reporting the form as broken.

**The proposal form** at `.forgejo/issue_template/proposal.yaml` (feature 014) is a byte-identical copy of the
master, `mcp-servers/pdlc/contract/proposal.yaml`; a test fails if they differ. It files an issue titled
`Proposal: <feature name>` with `type/proposal` + `status/proposal-draft`, and nine sections, the same ones a
Claude Desktop session writes through the `pdlc` server ([pdlc.md](pdlc.md)). `validate-form` reports both forms,
and marks one that is only in the working tree as "not yet on the default branch".

**Proposals** are feature ideas before they have a spec. Two states, and a close that only one command makes:

| State | Labels | `ready` |
| --- | --- | --- |
| Draft | `type/proposal` + `status/proposal-draft` + one `priority/*` | hidden, counted in the note |
| Ready | `type/proposal` + `status/needs-spec` + one `priority/*` | listed in priority order |
| Superseded by a spec | unchanged | closed, with a comment linking `specs/NNN-*/` |

A ready proposal is picked up with `show <n>`, then `/speckit-specify` started with `Proposal #<n>: <title>`
followed by its body. The mandatory `after_specify` hook ([spec-kit.md](spec-kit.md), row 7) then runs
`close-proposal <n> --spec specs/NNN-slug`. That verb is the **one named exception** to "closing is a state change
on update": it refuses anything but an open, non-bot proposal whose `spec.md` exists, posts
``Superseded by spec `specs/NNN-slug/` (branch `NNN-slug`).`` first and closes second, never touches labels, and is
idempotent (exit 0 "already closed" when this flow closed it; exit 2 when someone else did). Exit codes are the
usual 0 / 2 / 3 / 4 / 5. Rules for the assistant: the "Proposals" section of the
[forgejo-issues skill](../../.claude/skills/forgejo-issues/SKILL.md).

**Tasks to issues.** `/speckit-taskstoissues` mirrors a feature's `tasks.md` into its milestone: one
item per task, titled `T0NN: …`, deduplicated by task id across all pages, and chained with `dep` so
`ready` shows the next task. Running it again creates nothing for tasks that already have an item.
`tasks.md` stays authoritative; the items are a mirror for coordination. The skill is project-owned and
guarded by the Spec Kit gate ([spec-kit.md](spec-kit.md), row 6).

The skill runs `scripts/taskstoissues.mjs`, which does the whole fan-out through `backlog.mjs`:

```bash
node scripts/taskstoissues.mjs NNN-slug --dry-run   # reads only; lists what it would create
node scripts/taskstoissues.mjs NNN-slug             # milestone, creates, dependency chain
```

It defaults to `specs/NNN-slug/tasks.md` (`--tasks <path>` overrides it), labels each item `type/chore`
and `priority/p2`, and exits 0, 2 for a usage error, or the failing `backlog.mjs` command's exit code.
Its tests are `scripts/__tests__/taskstoissues.test.mjs`.

## Operating notes

- **Closure is an explicit, verified act.** Merge-time auto-closing (`closes #N`) is deliberately not
  used: it would bypass the verify-then-close discipline, and issue and pull-request numbers share one
  sequence here, so a mistyped `#N` in a commit message could close an unrelated item.
- **No bulk operations without an explicit instruction.** Item history lives in the forge's database, not
  in git — there is no `git revert` for a mass close. Forgejo keeps per-issue edit history, but undoing a
  mass mistake is tedious.
- **Projects boards have no API in this build.** Board state is invisible to the assistant; labels are
  the shared truth. Treating the board as authoritative would silently fork the state.

## Diagnosing

| Symptom | Cause |
| --- | --- |
| exit 3, names `FORGE_ISSUE_TOKEN` | write token absent or empty — often set after the terminal or editor was started |
| exit 4, names a token and a permission | granular scope refusal; the same token can return 200 elsewhere in the same second |
| exit 5, "could not reach the forge at …" | transport, not permissions. Check the base named in the message carries host **and port**, the network, and that the forge is up |
| exit 2, "No such label" | the name does not exist on the repository. Refused locally on purpose — the API would silently return the unfiltered set |
| exit 2, "item #N is BLOCKED" | 412 from the forge; unblock first (`dep N --blocked-by M --remove`) or close the blocker |
| a listing shows pull requests | `type=issues` was dropped; measured on a Forgejo 1.22 tracker, that turned 1 row into 143 |
