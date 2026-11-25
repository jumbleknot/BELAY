# Contract: the `pdlc` tool server's tools

**Normative.** This is decision D7 in the PRD and FR-001 to FR-003 in the spec. The server is registered as **`pdlc`**.
A change to any tool name, parameter name or enum value below is a **breaking change**. The same pull request must also:

- update `mcp-servers/pdlc/skill/proposal-intake/SKILL.md`;
- update the `tools` array in `mcp-servers/pdlc/manifest.json`;
- bump the package's major version.

The contract test reads `tools/list` over the real protocol and fails on any difference from this page.

## Conventions

- **Success**: the tool result has `content: [{type: "text", text: <JSON>}]` and `structuredContent: <the same
  object>`.
- **Refusal or error**: `isError: true`, with text in this form:

  ```json
  {"refused": true, "code": "<code>", "reason": "<one sentence a person can act on>"}
  ```

  A refusal leaves the forge and the clone unchanged (FR-019).
- `repo` is matched case-insensitively against `list_repos`. Results always carry the canonical name.
- No result, error or log line ever contains the token or an `Authorization` value.
- Every write result carries the issue's **new** `updated_at`.

### Refusal codes

| Code | When |
| --- | --- |
| `unknown_repo` | `repo` is not among the owner's repositories (FR-012) |
| `not_a_proposal` | The target issue lacks `type/proposal`, or is a PR (FR-013) |
| `bot_managed` | The target carries `status/bot-managed` (FR-013) |
| `unknown_label` | A required label does not exist in the repository; names it (FR-014) |
| `stale` | `updated_at` ≠ `expected_updated_at`; returns the current `updated_at` (FR-016) |
| `duplicate_title` | An open proposal has the same title; returns its number (US1-5) |
| `copy_dirty`, `copy_off_branch`, `copy_diverged`, `copy_foreign` | Sync refused; says which (FR-017, US3-4) |
| `invalid_input` | Schema validation failed, or a size limit was exceeded |
| `forge_auth` | 401/403; names the capability refused, never the token (spec edge case) |
| `forge_unreachable` | Transport failure; nothing was written |
| `not_found` | The issue does not exist |

## Tools

### `list_repos`

- **Input**: `{}`
- **Output**: `{repos: [{name, description, default_branch, has_clone}], truncated: boolean}`

### `repo_status`

- **Input**: `{repo: string}`
- **Output**:

  ```json
  {"repo": "…", "path": "…", "exists": true, "branch": "main", "default_branch": "main",
   "clean": true, "behind": 0, "ahead": 0}
  ```

  When the copy is absent: `exists: false`, and the other fields are `null`.
- **Side effects**: `git fetch` only. Changes no files in the working tree.

### `sync_repo`

- **Input**: `{repo: string}`
- **Output**: `{repo, path, action: "cloned" | "fast_forwarded" | "up_to_date", from, to, default_branch}`
- **Refuses** with `copy_dirty`, `copy_off_branch`, `copy_diverged` or `copy_foreign`, changing nothing.

### `check_setup`

- **Input**: `{repo: string}`
- **Output**: `{repo, ok, default_branch, missing_labels: string[], form: "ok" | "missing" | "not_in_effect" | "out_of_step", fix_hint}`
- `ok: false` is a **result, not an error**: the skill reads it and stops.

### `list_proposals`

- **Input**:

  ```json
  {"repo": "string", "status": "draft | ready | all", "query": "string (optional)",
   "state": "open | closed | all (optional, default open)"}
  ```

- **Output**: `{proposals: [{number, title, status, priority, state, updated_at}], total, truncated}`
- `status: all` filters on `type/proposal` alone. `draft` and `ready` also filter on their status label.

### `get_proposal`

- **Input**: `{repo: string, number: integer ≥ 1}`
- **Output**:

  ```json
  {"number": 0, "title": "…", "status": "…", "priority": "…", "state": "…",
   "sections": {"<id>": "…"}, "labels": [], "comments": [{"author": "…", "created_at": "…", "body": "…"}],
   "updated_at": "…", "url": "…", "warnings": []}
  ```

- Refuses with `not_a_proposal` if the issue lacks `type/proposal`. Reading an unrelated issue is not this tool's job.

### `create_proposal`

- **Input**:

  ```json
  {"repo": "string", "title": "string", "sections": {"<id>": "string"},
   "priority": "p1 | p2 | p3", "status": "draft | ready"}
  ```

  `sections` takes only the ids in [proposal-body.md](proposal-body.md). Unknown keys are `invalid_input`. A missing
  `feature_name` is `invalid_input`.
- **Output**: `{number, title, status, priority, url, updated_at}`

### `update_proposal`

- **Input**:

  ```json
  {"repo": "string", "number": "integer", "expected_updated_at": "string",
   "title": "string (optional)", "sections": "partial object (optional)",
   "priority": "p1 | p2 | p3 (optional)", "status": "draft | ready (optional)"}
  ```

  `sections` here is partial. Only the given sections are replaced, and the rest are kept as parsed.
- **Output**: `{number, title, status, priority, url, updated_at, changed: string[]}`

### `add_comment`

- **Input**: `{repo: string, number: integer, body: string (1..65536 bytes)}`
- **Output**: `{number, comment_url, updated_at}`

## Deliberately absent (FR-002)

There is no close, reopen, delete, label-create, arbitrary label add or remove, milestone, assignee, bulk or file-write
tool. The contract test fails if one appears.
