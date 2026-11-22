# Data Model: Backlog Tooling and Tasks-to-Issues (003)

All of these records live in the Forgejo tracker at `origin`. Nothing is stored locally.

## Backlog item (issue)

| Field | Rule |
| --- | --- |
| number | Assigned by the forge. |
| title | Required. `create` refuses a title an **open** item already has, compared exactly, not by the forge's substring search, unless `--allow-duplicate` is given. |
| body | From `--body-file <path>`, or `-` for standard input. |
| state | `open` or `closed`. Closing is refused while the item has an open blocker. |
| labels | Names only from the label set. An unknown name is refused locally, because the forge silently drops it. |
| milestone | Optional, a name that exists. An unknown name is refused locally. `none` clears it. |
| kind | Always an issue. Every list call sends `type=issues`, so pull requests never appear. |

**Close sequence:** `comment <n> --body-file <verification>`, then `update <n> --state closed`.

## Label set

Each label is a name, a colour and a description; the set is MCM's minus `status/bot-managed`.

| Name | Color | Description | Rule |
| --- | --- | --- | --- |
| `type/bug` | `#d73a4a` | Something is wrong | exactly one `type/*` |
| `type/feature` | `#0e8a16` | New capability | |
| `type/tech-debt` | `#fbca04` | Cost already incurred, not yet paid | |
| `type/chore` | `#c5def5` | Maintenance, no behaviour change | |
| `priority/p1` | `#b60205` | Do next | exactly one `priority/*` |
| `priority/p2` | `#e99695` | Do soon | |
| `priority/p3` | `#f9d0c4` | Do eventually | |
| `status/blocked` | `#5319e7` | Waiting on another item — graph is truth | optional |
| `status/needs-spec` | `#1d76db` | Too large to implement without spec→plan→tasks | optional |

`setup-labels` creates only the missing ones, and `--dry-run` lists them without changing anything.

## Milestone

| Field | Rule |
| --- | --- |
| name | A feature directory (`NNN-slug`). `setup-milestone <name>` creates it only if it's missing. |
| meaning | Items without a milestone are the free backlog. |

## Dependency

| Field | Rule |
| --- | --- |
| link | `dep <n> --blocked-by <m>` or `--blocks <m>`; `--remove` deletes the link. |
| cycle | A link that would make `n` reachable from itself is refused, naming the cycle. |

## Ready item

An item is ready when it's open, has no open blocker and no `status/blocked` label. Ready items are ordered by `priority/p1`, then `p2`, then `p3`, then unprioritized.

## Task issue (from `/speckit-taskstoissues`)

| Field | Rule |
| --- | --- |
| title | `T0NN: <description>`, with the `[P]` and `[US#]` markers removed. |
| key | The task id (`\bT\d{3,}\b` in the title). Existing ids are found across **all** pages before creating. |
| milestone | The feature directory name. |
| dependency | Blocked by the task it depends on, following `tasks.md`'s order and stated dependencies. |
| authority | `tasks.md`. Issues mirror it. A task whose title changed keeps its existing issue, and the mismatch is reported. |

## Credential

| Use | Variable | Rule |
| --- | --- | --- |
| writes | `FORGE_ISSUE_TOKEN` | `write:issue`. If it's missing, exit 3. |
| reads | `FORGE_ISSUE_TOKEN`, otherwise `FORGE_TOKEN` | A 401 or 403 exits 4 and names the scope. |
