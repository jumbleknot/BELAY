# Feature Specification: Backlog Tooling and Tasks-to-Issues

**Feature Branch**: `003-backlog-taskstoissues`

**Created**: 2026-11-22

**Status**: Draft

**Input**: User description: "Feature 003: Forgejo backlog tooling and /speckit-taskstoissues for BELAY. Source of truth: docs/superpowers/specs/2026-11-22-speckit-forgejo-parity-design.md, section 'Feature 003', plus the user's direction to reuse MovieCollectionManager's implementation as much as possible, stripping only MCM coupling.

Scope:
- a backlog tool with reads (list, ready, show, validate-form) and writes (create refusing a duplicate open title unless asked, update, comment, dep with a cycle check, setup-labels with a dry run, setup-milestone);
- every write checked against origin's owner and repo;
- unknown labels and milestones refused locally;
- pages capped at 50, with totals from the count header;
- exit codes 0 ok, 1 unexpected, 2 usage, 3 credential, 4 authorization, 5 transport;
- writes use FORGE_ISSUE_TOKEN; reads prefer it and fall back to FORGE_TOKEN; tokens from the environment only;
- the label set type/{bug,feature,tech-debt,chore}, priority/p1..p3, status/{blocked,needs-spec}; set the labels up once on BELAY, then label issue #1;
- a project-owned /speckit-taskstoissues skill forked from MCM's Forgejo version and registered with the Spec Kit gate (before hooks, prerequisites, a milestone per feature, dedupe by task id, one issue per task, dependencies for ordering, after hooks; tasks.md stays authoritative);
- closing is comment then close, and a blocked item can't be closed;
- a runbook;
- tests with a stubbed network.

Out of scope: issue #1. Done when this feature's PR is opened and merged with forge-pr/ci-status, and /speckit-taskstoissues has run on this feature's own tasks.md."

## User Scenarios & Testing *(mandatory)*

The people served are BELAY's maintainer and the AI coding agents working in the repository. Today, discovered work dies with the session unless someone files it by hand. Issue #1 was filed with a hand-written API call. A feature's task list has no counterpart in the tracker, so nobody outside the session can see what's left. This feature gives agents one safe, scriptable way to read and write the backlog, and a command that turns a feature's task list into tracked issues.

### User Story 1 - See what's in the backlog and what's ready (Priority: P1) 🎯 MVP

The maintainer or an agent lists backlog items, filtered by state, label, milestone or text. They see "ready" items: open, not blocked, highest priority first. They can open one item with its labels, milestone and dependencies. Results are complete even when there are more items than fit on one page.

**Why this priority**: Every other story starts from reading the backlog. Choosing the next item, and spotting a duplicate before filing one, both depend on it.

**Independent Test**: List BELAY's issues and see issue #1. Show issue #1 with its labels. Ask for ready items: issue #1 appears unless it's blocked.

**Acceptance Scenarios**:

1. **Given** open and closed items, **When** the maintainer lists with a state, label, milestone or text filter, **Then** only matching items are returned. The total comes from the forge's count, not from how many rows one page returned.
2. **Given** more matching items than one page holds, **When** listing, **Then** later pages can be requested, and the total is still right.
3. **Given** items with priorities and dependencies, **When** "ready" is asked for, **Then** only open items with no open blocker and no blocked label are returned, highest priority first.
4. **Given** an item number, **When** it is shown, **Then** its title, state, labels, milestone, body, and the items it blocks or is blocked by are printed.
5. **Given** the tracker also contains pull requests, **When** listing, **Then** pull requests never appear among backlog items.

---

### User Story 2 - File and maintain backlog items safely (Priority: P1)

The maintainer or an agent files a new item with a title, a body from a file, labels and an optional milestone. A second open item with the same title is refused unless explicitly allowed. They update an item's state, title, body, labels or milestone, and comment on it. Closing is done as a comment explaining the verification, then the close. An item that is still blocked can't be closed.

**Why this priority**: Filing discovered work is the backlog's purpose. Duplicates and unexplained closes are exactly what makes a tracker untrustworthy.

**Independent Test**: File a test item, then file it again: the second is refused. Comment on it, close it, and see the comment and the closed state.

**Acceptance Scenarios**:

1. **Given** no open item with that title, **When** an item is created with valid labels, **Then** it exists with those labels, and its number and link are printed.
2. **Given** an open item with the same title, **When** an item is created, **Then** it is refused and names the existing item, unless the "allow duplicate" option is given.
3. **Given** a label or milestone name the repository doesn't have, **When** an item is created or updated with it, **Then** it is refused locally, before any write, naming the unknown value. The forge would otherwise silently drop it.
4. **Given** an item, **When** it is updated, commented on, or closed after a comment, **Then** the change is applied, and nothing else about the item changes.
5. **Given** an item with an open blocker, **When** closing is attempted, **Then** it is refused, naming the blocker.
6. **Given** the origin remote names a different owner or repository than the write targets, **When** any write is attempted, **Then** it is refused before any request.

---

### User Story 3 - Turn a feature's tasks into tracked issues (Priority: P1)

After `/speckit-tasks`, the maintainer runs `/speckit-taskstoissues`. Each task in the feature's task list becomes one issue, titled with its task id. The issues sit in a milestone named after the feature, and are linked so each one is blocked by the task it depends on. Running it again creates nothing new for tasks that already have an issue. The task list stays the authority. The issues mirror it for visibility outside the session.

**Why this priority**: This is the bridge between the spec-driven workflow and the tracker that the design asked for. Its end-to-end check is running it on this feature's own task list.

**Independent Test**: Run it on this feature's task list. One issue per task appears in milestone `003-backlog-taskstoissues`, with the ordering dependencies set. Run it again: zero new issues.

**Acceptance Scenarios**:

1. **Given** a feature's task list and no milestone yet, **When** the command runs, **Then** the milestone is created, and one issue per task is created in it, titled `T0NN: <description>`. The parallel and story markers are removed from the title.
2. **Given** issues already exist for some tasks, including beyond the first page of results, **When** the command runs again, **Then** only the tasks without an issue get one.
3. **Given** the task order, **When** issues are created, **Then** each issue is marked blocked by the issue of the task it depends on, so "ready" shows the next task first.
4. **Given** the feature's extension hooks, **When** the command runs, **Then** the registered before and after hooks are offered, as for every other Spec Kit command.
5. **Given** a Spec Kit upgrade, **When** the Spec Kit gate runs, **Then** it checks that this project-owned command still exists, still carries its marker, and has not been taken back by a Spec Kit manifest.

---

### User Story 4 - Consistent labels and milestones (Priority: P2)

The repository has one agreed label set:
- a type: bug, feature, tech-debt or chore;
- a priority, 1 to 3;
- a status: blocked or needs-spec.

It's created once, with a dry run available first. Milestones map to feature directories. Issue #1 gets its labels.

**Why this priority**: Labels are the machine-readable state that "ready" and the decision rules depend on. Without the set in place, every labelled write would be refused.

**Independent Test**: The dry run lists what would be created. The real run creates them; a second run creates nothing. Issue #1 then shows a type and a priority label.

**Acceptance Scenarios**:

1. **Given** a repository without the label set, **When** label setup runs as a dry run, **Then** it lists the labels it would create and changes nothing.
2. **Given** the same repository, **When** label setup runs for real, **Then** exactly the missing labels are created. A second run creates nothing.
3. **Given** a feature directory name, **When** milestone setup runs, **Then** a milestone of that name exists, created only if it was missing.

---

### User Story 5 - Ordering with dependencies (Priority: P2)

The maintainer or an agent records that one item blocks another, or removes that link. A link that would create a cycle is refused.

**Why this priority**: Dependencies are what make "ready" meaningful, and what keeps a blocked item from being closed early.

**Independent Test**: Make item A block item B: B leaves "ready". Try to make B block A: refused as a cycle. Remove the link: B returns to "ready".

**Acceptance Scenarios**:

1. **Given** two open items, **When** one is marked as blocking the other, **Then** the blocked item leaves "ready" until its blocker closes.
2. **Given** an existing chain of links, **When** a link that would close a cycle is added, **Then** it is refused, naming the cycle.
3. **Given** an existing link, **When** it is removed, **Then** the formerly blocked item becomes ready again, if nothing else blocks it.

---

### User Story 6 - The rules for using the backlog (Priority: P3)

Agents and the maintainer have one written set of rules:
- **When to file:** work found outside the current change's scope, with acceptance criteria.
- **When to close:** criteria met and verified, explained in a comment.
- **What each label means.**
- **How the backlog feeds the spec-driven lifecycle:** large items get `status/needs-spec`.
- **No bulk operations** without the maintainer's instruction.
- **The forge's measured traps.**

These rules live in a skill and in the runbook.

**Why this priority**: The tool enforces mechanics. These rules cover the judgment it can't make.

**Independent Test**: The skill and runbook state each rule, and every command example in them parses.

**Acceptance Scenarios**:

1. **Given** an agent deciding whether to file something, **When** it reads the backlog skill, **Then** the filing, closing, labelling and lifecycle rules are stated, with BELAY's label set.
2. **Given** the runbook, **When** a reader looks up a command, **Then** its options, exit codes and credential are documented.

### Edge Cases

- **A transport failure** (timeout, unreachable forge) exits 5 with a message, and never reports a partial success as success.
- **A missing credential** exits 3, naming the variable. **A rejected credential** (401 or 403) exits 4, naming the scope it needs. Neither ever prints the credential.
- **A task line without a task id** in the task list is skipped and reported. It is never filed with a made-up id.
- **The forge's search matching more than the exact title** (substring) is handled: duplicate detection compares exact titles.
- **An issue body read from standard input** (`-`) works in place of a file.
- **A rerun of tasks-to-issues after a task was renamed** files nothing new for that id. The existing issue keeps its old title, and the run reports the mismatch.

## Requirements *(mandatory)*

### Functional Requirements

**Reads**

- **FR-001**: A backlog tool MUST list issues by state, label, milestone and text, one page at a time with a page size up to 50. Totals MUST come from the forge's total count, and pull requests MUST never be listed.
- **FR-002**: It MUST list "ready" items: open, with no open blocker and no blocked label, ordered by priority.
- **FR-003**: It MUST show one item with its labels, milestone, body and dependencies.
- **FR-004**: It MUST report which issue forms the repository's tracker has in effect (`validate-form`).

**Writes**

- **FR-005**: It MUST create an item from a title, a body (file or standard input), labels and an optional milestone. A duplicate open title MUST be refused, naming the existing item, unless the duplicate is explicitly allowed.
- **FR-006**: It MUST update an item's state, title, body, labels and milestone, and add comments.
- **FR-007**: It MUST add or remove a blocks / blocked-by link, refusing a link that would form a cycle.
- **FR-008**: It MUST refuse to close an item that has an open blocker.
- **FR-009**: It MUST create the repository's label set (with a dry run) and a named milestone. Both MUST be idempotent.
- **FR-010**: Unknown label or milestone names MUST be refused locally, before any write.
- **FR-011**: Every write MUST be checked against the owner and repository from the `origin` remote, and refused on a mismatch.

**Credentials and exits**

- **FR-012**: Writes MUST use `FORGE_ISSUE_TOKEN`. Reads MUST prefer `FORGE_ISSUE_TOKEN` and fall back to `FORGE_TOKEN`. Tokens MUST come from the environment only, and MUST never appear in arguments, output, logs or files.
- **FR-013**: Exit codes MUST be: 0 ok, 1 unexpected, 2 usage or validation, 3 missing credential, 4 authorization, 5 transport.

**Label set**

- **FR-014**: The label set MUST be:
  - `type/bug`, `type/feature`, `type/tech-debt`, `type/chore`;
  - `priority/p1`, `priority/p2`, `priority/p3`;
  - `status/blocked`, `status/needs-spec`.

  MovieCollectionManager's `status/bot-managed` MUST NOT be included. It's created on BELAY once, and issue #1 is then labelled.

**Tasks to issues**

- **FR-015**: A project-owned `/speckit-taskstoissues` command MUST:
  - offer the feature's before and after extension hooks;
  - check the feature's prerequisites;
  - ensure a milestone named after the feature directory;
  - find tasks that already have an issue by the task id in titles, across all pages;
  - create one issue per remaining task, titled `T0NN: <description>`, with the parallel and story markers removed;
  - link issues by dependency for ordering.

  The task list MUST remain the authority.
- **FR-016**: That command MUST be registered with the Spec Kit gate as project-owned, with a marker, and named in the Spec Kit runbook. The gate MUST fail if it goes missing, loses its marker, or is claimed by a Spec Kit manifest.

**Guidance and docs**

- **FR-017**: A backlog skill MUST state the decision rules (when to file, when to close, what the labels mean, lifecycle fit, no bulk operations) and the forge's measured traps, with BELAY's label set.
- **FR-018**: A backlog runbook MUST document every command, its options, its exit codes and its credential.

**Reuse and constraints**

- **FR-019**: Reuse MovieCollectionManager's backlog tool, tests, tasks-to-issues skill, backlog skill and runbook as much as possible. Change them only to remove MovieCollectionManager coupling: its credential names, the bot-managed label and Renovate item, item and feature numbers, and its dev-container and CI-evidence couplings.
- **FR-020**: The tool MUST be checked by tests that never use the network, run under the existing script-test target, with any selftest under the lint target.

### Key Entities

- **Backlog item:** a tracker issue (never a PR) with a number, title, body, state, labels, an optional milestone, and blocks / blocked-by links.
- **Label set:** the nine labels in FR-014. Type and priority are each "exactly one" by rule. Status labels are optional.
- **Milestone:** named after a feature directory (`NNN-slug`). An item with no milestone is in the free backlog.
- **Task issue:** an item created from a task line, titled `T0NN: <description>`. Its task id is the deduplication key.
- **Ready item:** open, no open blocker, no `status/blocked`, ordered by priority.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Running tasks-to-issues on this feature's own task list creates exactly one issue per task in its milestone, and a second run creates zero.
- **SC-002**: Filing the same title twice while the first is open produces exactly one item.
- **SC-003**: A write with an unknown label, an unknown milestone, a mismatched repository, or a cycle-forming link changes nothing on the forge. That's verified by tests that count the write requests sent.
- **SC-004**: No credential value appears in any output, error message or log. That's verified by tests that plant a credential.
- **SC-005**: BELAY's label set exists after setup, and issue #1 carries one type label and one priority label.
- **SC-006**: This feature's PR is opened, checked and merged with `forge-pr` and `ci-status`.

## Assumptions

- **`FORGE_ISSUE_TOKEN`** is set on the maintainer's machine with `write:issue`, and `FORGE_TOKEN` (read-only) is set too. Both are already used by features 001 and 002.
- **BELAY has no issue-form templates yet.** `validate-form` reports "zero templates present" rather than failing.
- **Running tasks-to-issues is optional.** It's for visibility. A feature can still be closed out from `tasks.md` alone.
- **Issue #1's labels** are `type/tech-debt` and `priority/p2`, chosen because it ports existing checks without adding features. The maintainer can change them.
- **The backlog skill is project-owned** (`.claude/skills/forgejo-issues/SKILL.md`, the name MovieCollectionManager uses). It's not a Spec Kit file, so only the tasks-to-issues command needs gate registration.
