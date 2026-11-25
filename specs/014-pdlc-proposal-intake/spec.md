# Feature Specification: Claude Desktop proposal intake (the `pdlc` tool server and its shared contracts)

**Feature Branch**: `014-pdlc-proposal-intake`

**Created**: 2026-11-24

**Status**: Draft

**Input**: User description: "Enable Claude Desktop to become part of the PDLC: ideate on new features and capture
high-level feature requirements as proposals in a repository's issue backlog, which Claude Code then picks up and
takes through the existing SDD process. Split across the proposal-intake skill in Claude Desktop (already saved
there), BELAY (the PDLC tooling: the tool server, the master proposal form, the label definitions, the master copy of
the skill) and MCM (which pulls ready proposals from its backlog into SDD). Include what must be done in MCM to hand
off. Source: `docs/proposals/claude-desktop-proposal-intake/` (PRD-PdlcMcpServer.md, PRD-ProposalsInBacklog.md,
SKILL.md, proposal.yaml)."

## Context

Proposals are the first stage of the product lifecycle and the only one with no structure and no home in the
backlog. Today they are free-form files that reach `/speckit-specify` by copy and paste, and nothing records whether
an idea is still being shaped or is ready to specify.

The people doing that shaping, the Product Owner and Analyst roles (played by one operator), work best in a Claude
Desktop conversation, not in an editor, the forge's web UI or a terminal. But a Claude Desktop session cannot reach
the homelab forge: measured 2026-11-21, its shell is blocked by a network allowlist, so neither the forge's API nor a
repository fetch works from inside the session. Both work from the operator's workstation. So the access has to be a
**local tool server** on the workstation that Claude Desktop connects to, registered as **`pdlc`**.

The `proposal-intake` skill that drives the conversation is already saved in Claude Desktop and calls the server's
tools by fixed names. This feature builds the server and the shared contracts in BELAY, and writes down exactly what
the MCM repository must do so that proposals filed there flow into its SDD process.

The work is split across three places:

| Place | Owns |
| --- | --- |
| Claude Desktop | The `proposal-intake` skill (the conversation). Its master copy lives in BELAY. |
| BELAY (this repository) | The `pdlc` tool server; the master proposal form; the proposal label definitions; the master copy of the skill; install and hand-off documentation. BELAY is also the **first target repository**: it adopts proposals in its own backlog in this feature, and is the end-to-end proof before MCM. |
| MCM (`jumbleknot/mcm`) | Its copy of the form; the two new labels in its backlog tooling; picking up a ready proposal into `/speckit-specify` and closing it when the spec exists. |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Capture a new proposal entirely in Claude Desktop (Priority: P1)

The operator opens Claude Desktop and starts a proposal session. They pick a repository from a list, bring that
repository's dedicated proposal copy up to date with its latest `main`, and choose to start a new proposal. The
session grounds itself in the repository's own knowledge (its wiki, constitution and existing feature names),
interviews them one question at a time (or drafts from an uploaded meeting transcript), asks for a priority, and on
request saves the result to the repository's issue backlog as a **draft** proposal. The operator never opens an
editor, the forge's web UI or a terminal.

**Why this priority**: this is the whole point of the feature. Without it, nothing else has a reason to exist.

**Independent Test**: from Claude Desktop alone, against a scratch repository that has the form and labels, choose
the repository, sync it, create a proposal and save it as a draft. The issue exists with the draft labels, one
priority label, the `Proposal: <feature name>` title, and a body whose sections match the form exactly.

**Acceptance Scenarios**:

1. **Given** the server is configured, **When** the session asks for the repositories, **Then** it gets every
   repository under the configured owner, each with its description, default branch and whether a proposal copy
   already exists locally.
2. **Given** a repository with no local proposal copy, **When** the operator chooses to get latest, **Then** a copy
   of its `main` is created in the configured clone folder, and the session can read files from it.
3. **Given** an existing local copy that is behind `origin/main`, **When** the session asks for its status, **Then**
   it reports the current branch, whether the copy is clean, and how many commits it is behind, without changing any
   file.
4. **Given** a completed interview, **When** the operator chooses "Save as draft", **Then** one new issue is filed
   with the title `Proposal: <feature name>`, the labels `type/proposal` + `status/proposal-draft` + exactly one
   `priority/*`, and a body with one `### <Label>` heading per section in the form's order.
5. **Given** an open proposal already has the same title, **When** the session tries to file another, **Then** the
   server refuses and names the existing issue, and nothing is filed.
6. **Given** the operator filed a proposal through the forge's web form, **When** the session reads it, **Then** it
   parses into the same sections as one filed by a session.

---

### User Story 2 - Refine a draft and confirm it as ready (Priority: P1)

In a later session the operator finds an existing draft by search term or by listing drafts, reads it section by
section, changes what needs changing, and confirms it as **ready**. Ready means the proposal is complete enough to
specify: it now carries `status/needs-spec`, the label that is already the documented bridge into SDD. A ready
proposal can be moved back to draft. If someone else edited the issue in the meantime, the server refuses the write
rather than silently overwrite their change.

**Why this priority**: a proposal is rarely right first time. Draft-then-ready is the machine-readable state change
that lets Claude Code tell an idea still being shaped from one it may pick up.

**Independent Test**: create a draft (Story 1), then in a new session find it, edit one section, confirm it as ready.
The issue now carries `status/needs-spec` and no `status/proposal-draft`. Edit the issue in the web UI, then try to
update from the stale copy: the server refuses and nothing changes.

**Acceptance Scenarios**:

1. **Given** open proposals in a repository, **When** the session lists them by status (draft, ready or all), with an
   optional search term and issue state (open by default), **Then** it gets each match's number, title, status,
   priority and last-updated time, and a truncated answer says it is truncated.
2. **Given** a proposal number, **When** the session reads it, **Then** it gets the body parsed into its sections,
   its labels, its comments and its last-updated time.
3. **Given** a draft and the last-updated time the session read, **When** the operator confirms it as ready,
   **Then** `status/proposal-draft` is replaced by `status/needs-spec`, and the other labels are unchanged.
4. **Given** a ready proposal, **When** the operator moves it back to draft, **Then** `status/needs-spec` is replaced
   by `status/proposal-draft`.
5. **Given** the issue changed after the session read it, **When** the session updates it, **Then** the server
   refuses, says it changed, and writes nothing.
6. **Given** a proposal drafted from a transcript, **When** it is saved, **Then** the session can add a comment naming
   the meeting and date.

---

### User Story 3 - The server refuses anything outside proposals (Priority: P1)

The forge credential the server holds can write issues anywhere on the account. The server, not the credential, is
what keeps writes inside proposals in the configured owner's repositories, and keeps the local copies read-only. Every
refusal says why and changes nothing.

**Why this priority**: a session driven by a language model will sometimes ask for the wrong thing. The guards are
what make it safe to give that session write access at all.

**Independent Test**: for each guard, issue the request it exists to refuse and observe the refusal and the unchanged
state.

**Acceptance Scenarios**:

1. **Given** a request that names another owner, or a repository not in the owner's list, **When** the server
   receives it, **Then** it refuses before any forge call.
2. **Given** an issue without `type/proposal`, or one carrying `status/bot-managed`, **When** the session tries to
   update or comment on it, **Then** the server refuses.
3. **Given** a label name the target repository does not have, **When** the server would use it in a filter or a
   write, **Then** it refuses and names the label, instead of returning the unfiltered set or writing without it.
4. **Given** a local copy that has uncommitted changes, is not on `main`, or has diverged from `origin/main`,
   **When** the session asks to sync it, **Then** the server changes nothing and says which of the three it found.
5. **Given** any tool call, **When** it runs, **Then** no commit, branch, push, stash, pull request or CI run is
   created in the target repository, and the forge credential appears in no tool result, log line or process
   argument.
6. **Given** a listing, **When** the forge returns pull requests alongside issues, **Then** the server returns only
   issues.
7. **Given** the server's announced tool list, **When** it is compared with the contract, **Then** the names and
   parameters match exactly, and there is no close, delete, arbitrary-relabel or bulk tool.

---

### User Story 4 - Tell the operator when a repository is not set up for proposals (Priority: P2)

Before any proposal work, the session checks that the chosen repository has the proposal labels and the proposal
form on its default branch, and that its form matches BELAY's master copy. If anything is missing or out of step, the
operator is told exactly what, and that it is fixed in Claude Code in that repository, not from Claude Desktop.

**Why this priority**: without it, a session against a repository that has not adopted proposals fails late and
confusingly (for example, a write refused for an unknown label after a long interview).

**Independent Test**: run the setup check against a repository with nothing set up, one with labels but no form, one
with a form that differs from the master, and one fully set up. Each answer names exactly what is missing or out of
step, and the last passes.

**Acceptance Scenarios**:

1. **Given** a repository missing one or more proposal labels, **When** the setup check runs, **Then** it fails and
   names each missing label. It does not create them.
2. **Given** a repository without the proposal form on its default branch, **When** the setup check runs, **Then** it
   fails and says the form is missing from the default branch.
3. **Given** a repository whose form differs from BELAY's master copy, **When** the setup check runs, **Then** it
   reports the form as out of step with the master.
4. **Given** a repository with every label and a matching form, **When** the setup check runs, **Then** it passes.

---

### User Story 5 - Install and connect the server on the workstation (Priority: P2)

The operator follows one written procedure to install the server on the workstation, create its dedicated forge
credential, set its configuration in Claude Desktop, create the clone folder and connect it to the Claude Desktop
project, and confirm the skill in Claude Desktop matches BELAY's master copy. A missing setting stops the server at
startup with a message naming the setting.

**Why this priority**: the operator does this once per workstation, but a wrong step (for example, reusing another
tool's credential) is a security mistake, not just an inconvenience.

**Independent Test**: on a workstation, follow the procedure from the top. Remove one setting and start the server:
it refuses and names the setting. With all settings present, the skill's first step lists repositories.

**Acceptance Scenarios**:

1. **Given** the procedure, **When** the operator follows it, **Then** the server is connected in Claude Desktop and
   the skill's first step lists repositories.
2. **Given** a missing setting (forge address, owner, credential or clone folder), **When** the server starts,
   **Then** it exits with a message naming the setting, and prints no credential.
3. **Given** the procedure, **When** it describes the credential, **Then** it requires a new credential used by this
   server alone, with the narrowest scope that works, so it can be revoked without affecting any other tool.

---

### User Story 6 - Hand off to MCM (Priority: P2)

The operator follows a hand-off guide in BELAY to make MCM a repository that accepts proposals and feeds ready ones
into its SDD process. The guide says what MCM must change, in what order, what to run once after merge, and how to
confirm the hand-off worked end to end: a proposal filed from Claude Desktop into MCM, confirmed as ready, picked up
by Claude Code, specified, and closed with a link to its spec.

**Why this priority**: adoption is opt-in. MCM's existing backlog and SDD process keeps working unchanged whether or
not it adopts proposals; until it does, the setup check simply reports MCM as not set up for proposals, and Claude
Desktop sessions cannot file proposals there. The guide is P2 because it comes after the server exists and the loop
has been proven on BELAY (User Story 7), and it builds on both.

**Independent Test**: a reader with only the guide and the MCM companion PRD can carry out the MCM change in a Claude
Code session in MCM without asking anything; afterwards the setup check passes for MCM.

**Acceptance Scenarios**:

1. **Given** the hand-off guide, **When** the operator reads it, **Then** it lists every MCM change in the
   "Hand-off to the MCM repository" section below, the order to make them in, the one-time label creation after
   merge, and the end-to-end confirmation.
2. **Given** MCM has completed the hand-off, **When** the setup check runs against MCM, **Then** it passes.
3. **Given** a ready proposal in MCM, **When** Claude Code takes it through `/speckit-specify`, **Then** the proposal
   is closed with a comment linking its `specs/NNN-*/` folder.

---

### User Story 7 - BELAY accepts proposals and closes the loop itself (Priority: P2)

BELAY is the first repository to adopt proposals, so the full loop (idea in Claude Desktop, ready proposal in the
backlog, spec in Claude Code, proposal closed) is proven here before MCM follows the same steps. A proposal filed in
BELAY, from Claude Desktop or the web form, appears in BELAY's ready-work listing once it is ready, is picked up in
Claude Code and fed to `/speckit-specify`, and is closed with a link to its spec.

**Why this priority**: it proves the hand-off works on a repository this feature controls, so the MCM hand-off guide
describes steps that are known to work rather than steps that should.

**Independent Test**: after this feature merges and BELAY's labels are created, the setup check passes for BELAY. File
a proposal from Claude Desktop, confirm it as ready, list ready work in Claude Code (it appears; a draft does not),
run `/speckit-specify` from it, and observe the proposal closed with a comment linking the new spec folder.

**Acceptance Scenarios**:

1. **Given** BELAY's default branch after merge and the one-time label setup, **When** the setup check runs against
   BELAY, **Then** it passes.
2. **Given** a draft and a ready proposal in BELAY, **When** Claude Code lists ready work, **Then** the ready proposal
   appears and the draft does not.
3. **Given** a filter naming `type/proposal` before the labels exist on the forge, **When** the backlog tool runs it,
   **Then** it refuses the name locally rather than returning the unfiltered set.
4. **Given** a ready proposal, **When** Claude Code specifies a feature from it, **Then** once the `specs/NNN-*/`
   folder exists the proposal is closed with a comment linking that folder.
5. **Given** the web form in BELAY, **When** someone files a proposal through it, **Then** it carries `type/proposal`
   and `status/proposal-draft`.

---

### Edge Cases

- The forge is unreachable from the workstation: every tool fails with a transport error that says so, and no
  partial write is left behind.
- The credential lacks a scope a tool needs (for example, listing the owner's repositories): the tool says which
  capability was refused, rather than returning an empty list that reads as "no repositories".
- A listing has more matches than one page holds: the server pages through, and if it stops early it says the answer
  is truncated.
- A proposal body was hand-edited in the web UI and lost a heading, or gained one: reading it returns the sections it
  can parse and reports the missing or unexpected headings, rather than failing or silently dropping text.
- The operator tries to confirm as ready a proposal with an empty required section: the skill refuses and offers
  draft (the server stores what it is given; completeness is the skill's check).
- A proposal has been closed because its spec exists: listing with state `closed` or `all` shows it; writes to it are
  refused only if it lost `type/proposal`. (Reopening and closing are not server operations.)
- The local copy folder exists but is not a copy of the chosen repository: sync refuses and changes nothing.
- The server is not installed or not running: a Claude Desktop session says the `pdlc` tools are unavailable and stops,
  and the target repository's whole proposal flow (web form, ready listing, pick-up, close-on-spec) works unchanged.
- The same title is filed twice in quick succession: the second is refused by the open-title check.
- A repository's default branch is not `main`: status and sync use the repository's default branch, and say which
  branch they used.

## Requirements *(mandatory)*

### Functional Requirements

**The tool server — contract and configuration**

- **FR-001**: The server MUST be registered in Claude Desktop under the name `pdlc` and MUST offer exactly these
  tools, with exactly these parameter names and status values. They are a fixed contract with the
  `proposal-intake` skill:

  | Tool | Parameters | Does |
  | --- | --- | --- |
  | `list_repos` | none | Repositories under the configured owner: name, description, default branch, whether a local copy exists |
  | `repo_status` | `repo` | Copy path, current branch, clean or dirty, commits behind the default branch on the forge. Fetches; changes no files |
  | `sync_repo` | `repo` | Creates the copy if absent; otherwise fast-forwards the default branch. Refuses on a dirty, off-branch or diverged copy, saying why and changing nothing |
  | `check_setup` | `repo` | Whether the proposal labels exist and the proposal form is on the default branch and matches the master. A failure names what is missing |
  | `list_proposals` | `repo`, `status` (`draft` \| `ready` \| `all`), `query?`, `state?` (`open` \| `closed` \| `all`, default `open`) | Number, title, status, priority, last updated |
  | `get_proposal` | `repo`, `number` | Body parsed into its sections, labels, comments, last-updated time |
  | `create_proposal` | `repo`, `title`, `sections`, `priority` (`p1` \| `p2` \| `p3`), `status` (`draft` \| `ready`) | Files a new proposal. Refuses when an open proposal has the same title |
  | `update_proposal` | `repo`, `number`, `expected_updated_at`, `title?`, `sections?`, `priority?`, `status?` | Edits a proposal. Refuses if the issue changed since `expected_updated_at` |
  | `add_comment` | `repo`, `number`, `body` | Adds a comment to a proposal |

  `sections` is keyed by the section ids in FR-010.
- **FR-002**: The server MUST NOT offer any close, delete, reopen, arbitrary-relabel or bulk operation.
- **FR-003**: A change to any tool name, parameter name or status value MUST update the master copy of the skill in
  the same change, and an automated test MUST fail when the announced tool list differs from FR-001.
- **FR-004**: The server MUST read four settings: the forge address, the single owner it may address, its dedicated
  forge credential, and the folder holding the local copies (one sub-folder per repository). A missing setting MUST
  stop it at startup with a message naming that setting.

**Proposal state and body (shared with every target repository)**

- **FR-005**: A **draft** proposal MUST carry `type/proposal` + `status/proposal-draft` + exactly one `priority/*`,
  and be open.
- **FR-006**: A **ready** proposal MUST carry `type/proposal` + `status/needs-spec` + exactly one `priority/*`, and be
  open. Moving between draft and ready MUST swap only the status label.
- **FR-007**: Changing priority MUST replace the one `priority/*` label, never add a second.
- **FR-008**: A proposal superseded by a spec is closed (by Claude Code in the target repository, never by this
  server) with a comment linking its `specs/NNN-*/` folder. Its labels are left unchanged.
- **FR-009**: Proposal titles MUST follow `Proposal: <feature name>`.
- **FR-010**: The server MUST write the body exactly as the forge renders the proposal form, one `### <Label>`
  heading per section in this order, and MUST parse the same headings when reading:

  | Section id | Heading |
  | --- | --- |
  | `feature_name` | Proposed feature name |
  | `problem` | Problem |
  | `proposed_value` | Proposed value |
  | `personas` | Personas involved |
  | `goals_success` | Goals and success definition |
  | `rough_scope` | Rough scope |
  | `open_questions` | Open questions |
  | `out_of_scope` | Out of scope |
  | `priority` | Priority |

- **FR-011**: The headings MUST match the field labels of BELAY's master proposal form exactly, and an automated test
  MUST fail if the master form and the server's heading list disagree.

**Guards**

- **FR-012**: Every request MUST address the configured owner and a repository that owner has; anything else MUST be
  refused before any forge call.
- **FR-013**: A write (update or comment) MUST be refused unless the target issue carries `type/proposal`, and MUST
  always be refused for an issue carrying `status/bot-managed`.
- **FR-014**: Labels MUST be resolved by name in the target repository, and an unknown label name MUST be refused,
  never passed through.
- **FR-015**: Listings MUST return issues only, never pull requests, and MUST page through every result or say the
  answer is truncated.
- **FR-016**: `update_proposal` MUST refuse when the issue's last-updated time differs from `expected_updated_at`.
- **FR-017**: Operations on a local copy MUST never create history: no commit, push, branch, stash or merge other than
  a fast-forward of the default branch. The forge credential MUST NOT be stored in the copy's configuration.
- **FR-018**: The forge credential MUST NOT appear in any tool result, log line or process argument, and proposal
  bodies MUST NOT appear in process arguments.
- **FR-019**: Every refusal MUST say what was refused and why, and MUST leave the forge and the local copy unchanged.
- **FR-020**: Every guard in FR-012 to FR-018 MUST have an automated test that observes the refusal.

**Master copies held in BELAY**

- **FR-021**: BELAY MUST hold the master copy of the proposal form (from
  `docs/proposals/claude-desktop-proposal-intake/proposal.yaml`), and the form MUST file a new proposal with
  `type/proposal` and `status/proposal-draft`.
- **FR-022**: BELAY MUST hold the proposal label definitions (`type/proposal` and `status/proposal-draft`, each with
  a colour and description), consistent with the label conventions target repositories already use.
- **FR-023**: BELAY MUST hold the master copy of the `proposal-intake` skill (from
  `docs/proposals/claude-desktop-proposal-intake/SKILL.md`), and the version saved in Claude Desktop MUST be updated
  from it whenever it changes.
- **FR-024**: The skill's grounding step MUST tolerate a target repository that lacks one of the files it reads
  (wiki index, constitution, specs folder), saying which is missing and continuing.

**Documentation**

- **FR-025**: BELAY MUST document how to install, configure and connect the server on the workstation, including
  creating the dedicated credential with the narrowest scope that works, and how to update the skill in Claude
  Desktop from the master copy.
- **FR-026**: BELAY MUST document how to hand off to a target repository, with MCM as the worked example, covering
  every item in "Hand-off to the MCM repository" below and the end-to-end confirmation.
- **FR-027**: BELAY's lifecycle documentation MUST say that a proposal may now live in a repository's issue backlog,
  filed from Claude Desktop or the web form, and the knowledge pages that summarise any changed source document
  MUST be refreshed in the same change.
- **FR-028**: BELAY MUST record how a target repository's copy of the form is kept in step with the master (by hand,
  confirmed by the setup check's out-of-step report).
**BELAY as the first target repository** (clarified 2026-11-24: BELAY adopts proposals in this feature)

- **FR-029**: BELAY MUST carry its own copy of the proposal form on its default branch, identical to the master, so
  the setup check passes for BELAY.
- **FR-030**: BELAY's backlog tooling MUST include `type/proposal` and `status/proposal-draft` in the label set it
  creates and checks, so a filter or write naming either is accepted once created and refused locally before then.
- **FR-031**: BELAY's "ready work" listing MUST show a ready proposal and MUST NOT show a draft proposal.
- **FR-032**: BELAY's backlog skill MUST explain the two proposal states, how to pick up a ready proposal and feed it
  to `/speckit-specify`, and the close-on-spec rule.
- **FR-033**: When a BELAY feature is specified from a ready proposal, the proposal MUST be closed with a comment
  linking its `specs/NNN-*/` folder once that folder exists. The mechanism MUST survive a Spec Kit upgrade (an
  override or a registered local edit, recorded in the Spec Kit runbook), and the operator MUST be able to name the
  proposal the feature came from.
- **FR-034**: BELAY's backlog runbook MUST document the proposal labels, the form and the states, and the backlog
  issue form and the proposal form MUST both pass form validation.

**Independence from the server**

- **FR-035**: A target repository that has adopted proposals MUST keep working with no dependency on the server. With
  the server absent, stopped or broken: its backlog tooling, ready-work listing, `/speckit-specify` and every gate
  MUST work as before. Proposals MUST still be fileable through the web form and editable in the web UI. A ready
  proposal MUST still be pickable in Claude Code, and close-on-spec MUST still happen. Only Claude Desktop proposal
  sessions stop working. Nothing a target repository runs (its tooling, skills, hooks or CI) may call, require or
  check for the server.

### Key Entities

- **Proposal**: an open or closed issue in a target repository's backlog carrying `type/proposal`. It has a number,
  a `Proposal: <feature name>` title, a status (draft or ready), one priority (p1, p2, p3), a body of nine sections,
  comments, and a last-updated time used for stale-write detection.
- **Proposal section**: one of the nine named parts of a proposal body, identified by a fixed section id and a fixed
  heading.
- **Target repository**: a repository under the configured owner that has adopted proposals (labels plus a copy of
  the form on its default branch).
- **Local proposal copy**: a dedicated, read-only copy of one target repository's default branch on the workstation,
  used only to ground proposal sessions. Never a development working copy.
- **Master proposal form**: BELAY's authoritative form definition, from which each target repository's copy is made.
- **Proposal labels**: `type/proposal` and `status/proposal-draft`, plus the existing `status/needs-spec`,
  `status/bot-managed` and `priority/*` labels the states rely on.
- **Tool contract**: the fixed set of tool names, parameters and status values the skill depends on.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From Claude Desktop alone, the operator can choose a repository, sync it, create a proposal, save it as
  draft, reopen it in a later session and confirm it as ready, with zero visits to an editor, the forge's web UI or a
  terminal.
- **SC-002**: A proposal filed by a session and one filed through the web form parse into identical section sets in
  100% of test cases.
- **SC-003**: 100% of the guards in FR-012 to FR-018 have a test that observes a refusal, and every refusal leaves the
  forge and the local copy unchanged.
- **SC-004**: A sync of a dirty, off-branch or diverged copy changes nothing in 100% of cases and names which
  condition it found.
- **SC-005**: Across the whole end-to-end run (SC-001 and SC-007), zero commits, branches, pull requests or CI runs
  are created in the target repository by the server.
- **SC-006**: The announced tool list matches the contract exactly, checked automatically on every change.
- **SC-007**: After MCM completes the hand-off, one proposal goes from a Claude Desktop interview to a closed issue
  linking an MCM `specs/NNN-*/` folder, with the setup check passing for MCM before the first save.
- **SC-008**: The forge credential appears in zero tool results, log lines or process arguments across the full test
  suite.
- **SC-009**: In BELAY, one proposal goes from a Claude Desktop interview to a closed issue linking a BELAY
  `specs/NNN-*/` folder, using only the steps the hand-off guide gives MCM.
- **SC-010**: With the server not installed, a proposal in BELAY goes from the web form to a closed issue linking its
  spec folder, and BELAY's lint and test targets pass. No step fails, warns or skips because the server is missing.

## Assumptions

- One operator on one workstation plays Product Owner and Analyst. No other users, accounts or machines; no hosted
  server.
- The workstation can reach the forge; the Claude Desktop session cannot, so every forge and repository operation
  goes through the server.
- The forge credential is new and dedicated to this server, with issue write and repository read scope, separate
  from every other tool's credential so it revokes separately. Whether that scope can list the owner's repositories,
  and whether cloning needs the credential, are measured during planning before the listing and sync designs are
  fixed.
- The local copies only need the default branch, read-only. Whether a reduced-history copy is enough is a planning
  decision.
- The setup check reports missing labels and never creates them: label creation stays in each repository's own
  backlog tooling.
- The skill, not the server, judges whether a proposal is complete enough to be ready. The server enforces states,
  labels and guards only.
- A proposal says WHAT and WHY, never HOW. That rule lives in the skill and the form.
- The skill in Claude Desktop is updated from BELAY's master copy by hand; there is no automatic sync into Claude
  Desktop.
- Moving existing `docs/proposals/` files into the backlog is out of scope, and `docs/proposals/` stays for history
  and long research documents.
- Writing specs, plans or tasks, and closing proposals, are out of scope for the server. Closing happens in Claude
  Code in the target repository.
- Where in BELAY's folder layout the server, the master form, the label definitions and the master skill live is a
  planning decision. A new top-level folder needs the maintainer's approval and a decision record first.
- Adopting proposals is opt-in per repository. A repository that has not adopted them, MCM included, keeps its current
  backlog and SDD process with no change and no dependency on the server; the server only declines to work with it.
  A repository that has adopted them does not depend on the server either (FR-035).
- **Dependency**: the setup check passes for a repository only after its adoption has merged on its default branch
  and its labels have been created. The server is built and tested against a scratch repository, then proven end to
  end on BELAY (User Story 7), then MCM follows the hand-off guide.
- The BELAY adoption's close-on-spec mechanism is the reference MCM may copy, subject to MCM's own Spec Kit upgrade
  rules.

## Hand-off to the MCM repository

This section is the source for the hand-off guide (FR-026). It states what MCM must do, not how BELAY does it. MCM
runs it as its own SDD feature, from the companion PRD
`docs/proposals/claude-desktop-proposal-intake/PRD-ProposalsInBacklog.md`.

**Before starting in MCM**

1. This feature has merged in BELAY, so the master form and label definitions are final.
2. The `pdlc` server is installed (User Story 5) and the full loop has been proven on BELAY (User Story 7, SC-009).
   BELAY's adoption change is the worked example to copy from.

**In a Claude Code session in MCM** (from a worktree, on a feature branch)

1. Copy `PRD-ProposalsInBacklog.md` into MCM's `docs/proposals/` and run `/speckit-specify` from it, then plan, tasks
   and implement as usual. That feature must deliver:
   - **The form**: a copy of BELAY's master form at `.forgejo/issue_template/proposal.yaml`, byte-identical to the
     master. It takes effect only from the default branch.
   - **The labels**: `type/proposal` and `status/proposal-draft` added to the label set MCM's backlog tool creates and
     checks, with BELAY's colours and descriptions, so an unknown-label filter is refused rather than returning
     everything.
   - **Ready means ready**: MCM's "ready work" listing shows a ready proposal (`status/needs-spec`) and never a draft
     (`status/proposal-draft`).
   - **Pick-up**: MCM's backlog skill explains the two states, how to pick up a ready proposal and feed its body to
     `/speckit-specify`, and the close-on-spec rule.
   - **Close-on-spec**: when a feature came from a proposal, the proposal is closed with a comment linking its
     `specs/NNN-*/` folder once that folder exists. MCM decides whether this is a registered local edit to its
     specify skill or an after-specify hook (its Spec Kit upgrade rules apply), and how the specify run learns
     which proposal it came from.
   - **Docs**: MCM's backlog runbook (labels, form, states) and its lifecycle page (stage 1 now lives in the backlog),
     with the wiki pages that summarise them refreshed in the same pull request.
   - **Tests and gates**: tests for the label and ready-listing changes; form validation passing for both forms;
     the wiki gates passing.
   - **No dependency on the server** (FR-035): nothing in MCM calls, requires or checks for the `pdlc` server. The
     web form, ready listing, pick-up and close-on-spec all work with the server absent.
2. After that pull request merges, run MCM's label setup once so the two labels exist on the forge.

**Confirm the hand-off**

1. In Claude Desktop, run the setup check for MCM: it passes.
2. File a proposal into MCM from Claude Desktop and confirm it as ready.
3. In Claude Code in MCM, the ready-work listing shows it; pick it up, run `/speckit-specify` from it.
4. The proposal is closed, with a comment linking the new spec folder (SC-007).
5. Repeat steps 2 to 4 with the server stopped, filing the proposal through the web form instead: MCM's flow still
   works end to end (SC-010).

**Keeping in step**: when BELAY's master form or labels change, the setup check reports MCM's copy as out of step;
the copy is refreshed by hand in an MCM pull request.
