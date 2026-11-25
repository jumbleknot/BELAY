# Data model: Claude Desktop proposal intake

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md)

The server holds **no state of its own**. The forge holds every proposal, and the clone folder holds every local copy.
The entities below are what the server reads, validates and returns. Wire shapes are in
[contracts/tools.md](contracts/tools.md).

## Configuration

Read once at startup from the environment. In the bundle, these come from `user_config` through `mcp_config.env`
(research R12).

| Field | Variable | Validation | On failure |
| --- | --- | --- | --- |
| `forgeUrl` | `PDLC_FORGE_URL` | An `http://` or `https://` URL with no path beyond `/`, no userinfo, no query. The scheme is taken as written, never guessed | Exit non-zero, naming the variable; the value is not echoed if it holds userinfo |
| `owner` | `PDLC_FORGE_OWNER` | Non-empty; forge user-name characters only | Exit naming the variable |
| `token` | `PDLC_FORGE_TOKEN` | Non-empty after trim | Exit naming the variable; the value is **never** printed |
| `cloneRoot` | `PDLC_CLONE_ROOT` | An absolute path to an existing directory | Exit naming the variable and saying "absolute" or "does not exist" |

Derived: `apiBase = forgeUrl + /api/v1`.

## Repository (a row of `list_repos`)

| Field | Source | Notes |
| --- | --- | --- |
| `name` | `GET /repos/search` → `name` | Canonical case. The only name the server uses afterwards |
| `description` | `description` | |
| `default_branch` | `default_branch` | Usually `main`. Status and sync use this, never a literal |
| `has_clone` | Whether `<cloneRoot>/<name>/.git` exists | Existence only; `repo_status` does the full check |

Kept only when `owner.login` equals the configured owner, compared case-insensitively. This is the
**owner-and-repository guard's allowlist** (FR-012). It is cached for the life of the process and refreshed once on a
miss before the server refuses.

## Local proposal copy

Location: `<cloneRoot>/<name>`.

| Field | How it is determined |
| --- | --- |
| `path` | The folder |
| `exists` | The folder exists |
| `is_copy_of_repo` | `git rev-parse --show-toplevel` equals the folder, **and** `remote.origin.url` equals `<forgeUrl>/<owner>/<name>.git` (case-insensitive on owner and name, with no userinfo) |
| `branch` | `git symbolic-ref --short HEAD` (detached means "not on the default branch") |
| `dirty` | `git status --porcelain=v1 --untracked-files=normal` is non-empty. Untracked files count |
| `behind` | `git rev-list --count HEAD..origin/<default>` after `git fetch origin <default>` |
| `ahead` | `git rev-list --count origin/<default>..HEAD` |
| `diverged` | `ahead > 0` |

**Sync transitions** (`sync_repo`):

```text
absent ──clone (blobless, single branch)──▶ clean, on default, behind=0
clean ∧ on default ∧ ahead=0 ──fetch + merge --ff-only──▶ clean, behind=0
dirty | off default | diverged | not a copy of the repo ──▶ REFUSED, nothing changed, reason names which
```

Git verbs the server may run: `clone`, `fetch`, `merge --ff-only`, `status`, `rev-parse`, `rev-list`,
`symbolic-ref`, `config --get`. **Nothing else.** That rules out `commit`, `push`, `branch`, `checkout -b`, `stash`,
`reset` and `rebase` (FR-017), and an allowlist in the git runner enforces it.

## Proposal

A forge issue carrying `type/proposal`.

| Field | Source | Rule |
| --- | --- | --- |
| `number` | `number` | |
| `title` | `title` | Created as `Proposal: <feature name>` (FR-009). The duplicate check compares `trim().toLowerCase()` across **open** proposals |
| `status` | labels | `draft` ⇔ `status/proposal-draft`; `ready` ⇔ `status/needs-spec`. Neither or both → `unknown`, returned with a warning |
| `priority` | labels | `p1` / `p2` / `p3` from exactly one `priority/*`. None or several → `unknown` + warning. **The label beats the body section** (R10) |
| `state` | `state` | `open` / `closed` |
| `sections` | body | Parsed per [contracts/proposal-body.md](contracts/proposal-body.md) |
| `labels` | `labels[].name` | |
| `comments` | `GET …/issues/{n}/comments` | `{author, created_at, body}` |
| `updated_at` | `updated_at` | Exact string; the stale-write token (R9) |
| `url` | `html_url` | |
| `warnings` | derived | Parse problems and label/section mismatches |

**State transitions**:

| From | To | Who | Label change |
| --- | --- | --- | --- |
| (none) | draft | `create_proposal status=draft`, or the web form | + `type/proposal`, `status/proposal-draft`, `priority/pN` |
| (none) | ready | `create_proposal status=ready` | + `type/proposal`, `status/needs-spec`, `priority/pN` |
| draft | ready | `update_proposal status=ready` | − `status/proposal-draft`, + `status/needs-spec` |
| ready | draft | `update_proposal status=draft` | − `status/needs-spec`, + `status/proposal-draft` |
| any | priority change | `update_proposal priority=pM` | − `priority/pN`, + `priority/pM` |
| open | closed | **Claude Code in the target repository only** (`backlog.mjs close-proposal`) | none (FR-008) |

**Write guards**, applied in this order and refusing at the first failure (FR-012 to FR-019):

1. `repo` is in the owner's allowlist.
2. On update and comment: the issue exists, is an issue rather than a PR, carries `type/proposal` and does not carry
   `status/bot-managed`.
3. Every label name used resolves in this repository.
4. On update: `updated_at` equals `expected_updated_at`.
5. On create: no open proposal has the same title.
6. Body and comment size is at most 64 KiB, and the title is at most 255 characters (the forge's limit).

## Proposal section

Nine fixed entries. The single source is the master form's field labels, and FR-011's test ties them to the server's
list.

| Order | `id` (the tool contract key) | Form field `id` | Heading | Required |
| --- | --- | --- | --- | --- |
| 1 | `feature_name` | `feature-name` | Proposed feature name | yes |
| 2 | `problem` | `problem` | Problem | yes |
| 3 | `proposed_value` | `proposed-value` | Proposed value | yes |
| 4 | `personas` | `personas` | Personas involved | yes |
| 5 | `goals_success` | `goals-success` | Goals and success definition | yes |
| 6 | `rough_scope` | `rough-scope` | Rough scope | yes |
| 7 | `open_questions` | `open-questions` | Open questions | no |
| 8 | `out_of_scope` | `out-of-scope` | Out of scope | no |
| 9 | `priority` | `priority` | Priority | yes (`p1`/`p2`/`p3`) |

The server stores what it is given. "Required" is enforced by the **skill** before it confirms a proposal as ready
(spec, Assumptions). The server itself refuses only `create_proposal` with an empty `feature_name`, because the title
derives from it.

## Proposal labels (`contract/proposal-labels.json`)

| Name | Colour | Description | New? |
| --- | --- | --- | --- |
| `type/proposal` | `#c2e0c6` | A feature idea before it has a spec | **new** |
| `status/proposal-draft` | `#fef2c0` | Proposal still being shaped; not ready to specify | **new** |
| `status/needs-spec` | `#1d76db` | Too large to implement without spec→plan→tasks | existing (D5) |
| `priority/p1`…`p3` | existing | existing | existing |
| `status/bot-managed` | existing | existing | existing (used by the guard only) |

`check_setup` requires every label in this file **except** `status/bot-managed`. A repository without the bot has
nothing to guard against.

## Setup check result

| Field | Meaning |
| --- | --- |
| `ok` | All checks passed |
| `missing_labels` | Names from the label file the repository lacks |
| `form` | `ok` \| `missing` (no file on the default branch) \| `not_in_effect` (file present, but the forge has not parsed it) \| `out_of_step` (bytes differ from the master) |
| `default_branch` | The branch checked |
| `fix_hint` | A fixed sentence: these are fixed in Claude Code in that repository (its label setup, and a copy of the master form) |

## close-proposal (BELAY `backlog.mjs`)

Inputs are `<n>` and `--spec specs/NNN-slug`.

1. Preconditions: the issue is open, carries `type/proposal`, does not carry `status/bot-managed`, and
   `specs/NNN-slug/spec.md` exists.
2. Effect: one comment, `Superseded by spec \`specs/NNN-slug/\` (branch \`<current branch>\`).`, then the state
   becomes `closed`.
3. Idempotent: closed, and a comment containing `specs/NNN-slug/` exists → exit 0 with "already closed". Closed without
   that comment → refuse (exit 2), because someone else closed it.
