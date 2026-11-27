# Feature Specification: PDLC spec intake (write, clarify and approve a spec from Claude Desktop)

**Feature Branch**: `016-pdlc-spec-intake`

**Created**: 2026-11-27

**Status**: Draft

**Input**: User description: "Proposal #91: Proposal: PDLC spec intake

PDLC Proposal Intake (feature 014) lets a Product Owner or Analyst capture a proposal in Claude Desktop, but stops
there. Extend it so that the same people take a ready proposal through spec creation, clarification, review, editing
and approval entirely in Claude Desktop; approval produces a published feature branch holding the committed,
approved spec; and one backlog issue follows the feature through the stages proposal, spec in progress, ready to plan,
in engineering and merged, closing only when the feature branch merges into main. Source: backlog item #91 (body via
`node scripts/backlog.mjs show 91`)."

## Context

Feature 014 gave the Product Owner and Analyst roles a home for proposals: a Claude Desktop session, through the
local `pdlc` tool server on the workstation, files and refines proposals as issues in a repository's backlog. The
next stage, turning a ready proposal into a spec, still needs someone to open VS Code and run `/speckit-specify` and
`/speckit-clarify`. In practice an Engineer runs them on the owner's behalf, so the spec loses its owner, ready
proposals wait for a technical person, and clarification is skipped or answered by the wrong person.

Separately, a proposal closes the moment its spec exists. Between "spec written" and "merged into main" nothing in the
backlog says where a feature is, so an Architect has no single place to see which specs are approved and waiting for
a plan.

This feature extends the `pdlc` server and the `proposal-intake` skill (both owned by BELAY) so the spec stage
happens in Claude Desktop too, and replaces close-on-spec with a stage model that follows a feature to merge. BELAY is
again the first target repository and the end-to-end proof; MCM follows from a hand-off guide afterwards.

**Decisions of feature 014 that this feature amends** (each needs the maintainer's yes and is recorded in a decision
record, per FR-034):

| Feature 014 decision | Amended to |
| --- | --- |
| Local copies are read-only and fast-forward only (014 FR-017) | A copy may also hold a feature branch for the spec being written, and may commit and publish that branch only (FR-020 to FR-023). The default branch stays fast-forward only |
| Writing specs is out of scope for the server (014 Assumptions) | The server supports writing one feature's spec, on that feature's branch only |
| A proposal closes when its spec exists (014 FR-008, FR-033) | A proposal stays open and moves through stages; it closes when its feature branch merges into the default branch (FR-010 to FR-016) |
| A target repository's whole flow works with the server absent (014 FR-035) | Kept: the VS Code route to specify remains, and every stage change it needs happens without the server (FR-031) |

## Clarifications

### Session 2026-11-27

- Q: When the feature branch changed on the forge, does the session only refuse to publish? → A: It refuses, says what
  changed, and offers to bring the latest into the author's local copy and continue from it (User Story 8 scenario 4,
  FR-022).
- Q: Where does the author review and edit? → A: The in-progress proposal and spec are shown in Claude Desktop's
  right-hand pane, with the chat in the main pane; the author can edit directly in the pane (User Story 9, FR-035 to
  FR-037).
- Q: What does the issue record on merge? → A: The closing comment states the number of tests the feature created and
  the number that passed, filled in automatically (User Story 4 scenario 2, FR-038, FR-039).
- Q (maintainer, at ADR-0006 review): counting must not add a test run to CI, because MCM's suite alone takes 30+
  minutes. How are tests counted? → A (decision M10): "created" is the repository's metrics counter's test
  declarations at the merge commit minus its first parent, read from git with no test run. The outcomes are the merged
  commit's own CI test run, whole suite, posted by that run. The tasks template records a test baseline at the start
  and a count before the pull request, on the issue when there is one. Where the feature did not come from a proposal,
  nothing is posted and nothing fails (FR-038 to FR-040).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Write a spec from a ready proposal in Claude Desktop (Priority: P1)

The Product Owner or Analyst opens a proposal session, chooses a repository and a ready proposal, and chooses to start
its spec. The session checks that the repository has Spec Kit initialised, creates the feature through the
repository's own specify step (its numbering, branch naming, template and hooks), using the proposal as the input, and
shows the author the draft spec. The issue moves to **spec in progress**. The author never opens VS Code, the forge or a
terminal.

**Why this priority**: this is the gap the feature exists to close. Without it nothing else has a reason to exist.

**Independent Test**: from Claude Desktop alone, against a scratch repository with Spec Kit initialised and a ready
proposal, start the spec. A `specs/NNN-<slug>/spec.md` exists on a new feature branch named by the repository's own
convention, its **Input** line names the proposal, its structure matches the repository's spec template, and the issue
shows **spec in progress** with a comment naming the branch.

**Acceptance Scenarios**:

1. **Given** a ready proposal in a repository with Spec Kit initialised, **When** the author chooses to start its spec,
   **Then** a new feature is created with the next feature number and the branch name the repository's own specify
   step would produce, and its spec's **Input** line carries `Proposal #<n>: <title>` followed by the proposal body.
2. **Given** a spec has just been created, **When** the session shows it, **Then** the author sees it section by
   section in plain language, with any `[NEEDS CLARIFICATION]` markers listed.
3. **Given** the spec was created, **When** the author looks at the issue in a later session, **Then** it shows the
   **spec in progress** stage and names the feature branch.
4. **Given** a draft proposal, or an issue that is not a proposal, **When** the author tries to start a spec from it,
   **Then** the session refuses and says why, and nothing is created.
5. **Given** a ready proposal that already has a spec in progress, **When** the author tries to start another,
   **Then** the session offers to resume the existing one instead, and no second feature is created.

---

### User Story 2 - Clarify, review, edit and approve the spec (Priority: P1)

The session runs the repository's clarify step as a conversation with the author: one question at a time, each with
suggested answers, the answers recorded in the spec. The author reviews the spec, asks for changes, and can stop and
resume in a later session. When they are satisfied they approve it. Approval commits the approved spec on the
feature branch, publishes the branch to the forge, moves the issue to **ready to plan**, and adds a comment naming the
branch and linking the spec folder.

**Why this priority**: an unapproved, unclarified spec is the problem today. Approval is the hand-off the Architect
waits for.

**Independent Test**: continue Story 1's spec. Answer the clarification questions, edit one requirement, stop, resume
in a new session, approve. The branch exists on the forge, holds the spec with the answers and the edit, and the issue
shows **ready to plan** with a comment naming the branch and linking the folder.

**Acceptance Scenarios**:

1. **Given** a spec in progress, **When** the author chooses to clarify it, **Then** the session asks the repository's
   clarify questions one at a time with suggested answers, and each answer is recorded in the spec where the
   repository's clarify step records it.
2. **Given** a spec in progress, **When** the author asks for a change in plain words, **Then** the session shows the
   changed text before keeping it.
3. **Given** the author stops mid-way, **When** they start a later session and choose the same proposal, **Then** the
   spec is exactly as they left it and they can carry on.
4. **Given** a spec that has not been through clarification, **When** the author tries to approve it, **Then** the
   session runs clarification first (or records that it found nothing to ask) before approval is offered.
5. **Given** the author approves, **When** approval completes, **Then** the approved spec is committed on the feature
   branch, the branch is published to the forge, the issue moves to **ready to plan**, and a comment names the branch
   and links the spec folder.
6. **Given** a spec still containing `[NEEDS CLARIFICATION]` markers, **When** the author tries to approve, **Then**
   the session refuses and lists the open markers.

---

### User Story 3 - See every spec ready to plan, and pick one up (Priority: P1)

An Architect or Engineer lists ready work in Claude Code and sees each spec that is ready to plan, with its feature
branch. They check out that branch and run `/speckit-plan` exactly as for a spec written in VS Code. When planning
starts, the issue moves to **in engineering** without anyone editing it, and the spec locks for Claude Desktop.

**Why this priority**: the hand-off is only real if the receiving side can find the spec and continue from it without
fix-up.

**Independent Test**: after Story 2's approval, run the ready listing in Claude Code: the spec appears with its branch.
Check out the branch, run `/speckit-plan` with no other step. The plan is produced, the issue shows **in engineering**,
and a Claude Desktop attempt to edit the spec is refused.

**Acceptance Scenarios**:

1. **Given** one or more specs ready to plan, **When** an Architect lists ready work, **Then** each appears with its
   feature branch and spec folder, and a spec still in progress does not appear (its count is shown, as drafts are
   today).
2. **Given** a spec ready to plan, **When** an Architect checks out its branch and runs `/speckit-plan`, **Then** it
   runs with no fix-up, no re-run of specify and no moving of files.
3. **Given** planning has started, **When** the issue is read, **Then** it shows **in engineering**, and the Architect
   did not change it by hand.
4. **Given** a spec in **in engineering**, **When** the author tries to edit or re-approve it from Claude Desktop,
   **Then** the session refuses and says planning has started.

---

### User Story 4 - One issue follows the feature to merge (Priority: P2)

The proposal issue stays open from proposal to merge and always shows one current stage: proposal (draft or ready),
spec in progress, ready to plan, in engineering, and finally merged, at which point it closes. Each stage change leaves
a trace on the issue.

**Why this priority**: it gives everyone one place to see a feature's stage, but the hand-off in Stories 1 to 3 is
usable without it.

**Independent Test**: take one proposal through every stage. At each point the issue carries exactly one stage, its
timeline records the change, and it closes only when the feature branch's pull request merges into the default branch.

**Acceptance Scenarios**:

1. **Given** an issue at any stage, **When** it is read, **Then** it shows exactly one stage.
2. **Given** the feature branch's pull request merges into the default branch, **When** the merge completes, **Then**
   the issue moves to **merged** and is closed, with a comment naming the merge and stating the number of tests the
   feature created; the merged commit's test run adds a comment with the suite's passed, failed, skipped and todo
   counts; nobody edits it by hand.
3. **Given** a feature branch's pull request is closed without merging, **When** that happens, **Then** the issue stays
   open at its current stage.
4. **Given** a spec created from a proposal, **When** the spec folder first exists, **Then** the proposal is **not**
   closed.

---

### User Story 5 - Reopen an approved spec until planning starts (Priority: P2)

After approval, the author realises something is wrong. Until planning starts they reopen the spec from Claude
Desktop; the issue drops back to **spec in progress** and leaves the ready listing; they edit and approve again, and
the new approval is committed and published on the same branch.

**Why this priority**: owners will find mistakes after approving. Without a way back they ask an Engineer to edit, and
the owner is lost again.

**Independent Test**: approve a spec, reopen it, edit one line, approve again. The branch gains a new commit with the
change, the issue went **ready to plan**, **spec in progress**, **ready to plan**, and the ready listing hid the spec
while it was in progress.

**Acceptance Scenarios**:

1. **Given** a spec **ready to plan**, **When** the author reopens it, **Then** the issue moves to **spec in progress**
   and the spec leaves the ready listing.
2. **Given** a reopened spec, **When** the author approves again, **Then** the change is committed and published on the
   same feature branch, and the issue returns to **ready to plan** with a comment saying it was re-approved.
3. **Given** a spec **in engineering**, **When** the author tries to reopen it, **Then** the session refuses and says
   planning has started.

---

### User Story 6 - Withdraw a spec in progress (Priority: P3)

The author decides a spec should not go ahead. They withdraw it from Claude Desktop. The issue returns to being a
ready proposal (or a draft, if they choose), with a comment naming the abandoned feature branch. Nothing is deleted.

**Why this priority**: abandoned specs are rarer than finished ones, but without a way out they linger at **spec in
progress** and mislead the backlog.

**Independent Test**: start a spec, withdraw it. The issue shows a proposal stage again, a comment names the branch,
the branch is unchanged on the forge (if it was published) or on the workstation, and no file or branch was deleted.

**Acceptance Scenarios**:

1. **Given** a spec in progress or ready to plan, **When** the author withdraws it, **Then** the issue moves to the
   proposal stage they choose (ready or draft) and a comment names the feature branch.
2. **Given** a withdrawn spec, **When** the author later starts a spec from the same proposal, **Then** a new feature is
   created; the withdrawn branch is not reused.
3. **Given** a spec in **in engineering**, **When** the author tries to withdraw it, **Then** the session refuses.

---

### User Story 7 - Stop cleanly where Spec Kit is not set up (Priority: P2)

In a repository without Spec Kit initialised, the session offers proposal work as today and ends after the proposal is
saved, with a plain message saying spec creation is unavailable in that repository and why. Nothing is created in the
repository.

**Why this priority**: target repositories adopt proposals and Spec Kit independently. A late, confusing failure would
cost the author an interview.

**Independent Test**: in a repository with proposals set up but no Spec Kit, save a ready proposal. The session says
spec creation is unavailable and why, and the repository gains no branch, file or commit.

**Acceptance Scenarios**:

1. **Given** a repository without Spec Kit initialised, **When** the author saves a proposal, **Then** the session does
   not offer spec creation and says why, in plain words.
2. **Given** the same repository, **When** the session ends, **Then** no branch, commit or file was created in the
   repository or its local copy.

---

### User Story 8 - The server refuses anything outside the feature's own spec (Priority: P1)

The server now creates branches, commits and publishes. Its guards keep every write to the feature's own spec folder,
its own feature branch and its own issue, and keep the default branch untouched. Every refusal says why and changes
nothing.

**Why this priority**: a session driven by a language model will sometimes ask for the wrong thing. Write access to a
repository is only safe with these guards.

**Independent Test**: for each guard, issue the request it exists to refuse and observe the refusal and the unchanged
state.

**Acceptance Scenarios**:

1. **Given** a request to write a file outside the feature's spec folder, **When** the server receives it, **Then** it
   refuses and changes nothing.
2. **Given** a request to commit to, publish or move the default branch or any branch other than the feature's own,
   **When** the server receives it, **Then** it refuses.
3. **Given** a request that would rewrite published history (force publish, rebase, reset of a published commit),
   **When** the server receives it, **Then** it refuses.
4. **Given** the feature branch changed on the forge since the session last read it, **When** the session tries to
   publish, **Then** it refuses, says what changed, and writes nothing. It then offers to bring the latest published
   branch into the author's local copy and continue from it; on yes, the author's unpublished edits are re-applied on
   top, any edit that conflicts is shown to the author to resolve, and nothing is published until the author
   approves again.
5. **Given** any stage change, **When** it targets an issue other than the one the feature came from, **Then** it is
   refused.
6. **Given** any tool call, **When** it runs, **Then** the forge credential appears in no tool result, log line,
   process argument or repository configuration.

---

### User Story 9 - Review and edit side by side (Priority: P2)

While reviewing or editing an in-progress proposal or an in-progress spec, the author sees the document in Claude
Desktop's right-hand pane and talks to the session in the main chat pane. A change asked for in the chat appears in the
pane; a change the author types directly in the pane is taken in by the session and is what gets saved.

**Why this priority**: reviewing a long spec scrolled through a chat is slow and error-prone, and a small wording fix
is quicker to type than to describe. Stories 1 to 3 work without it, so it is not P1.

**Independent Test**: open an in-progress proposal, then an in-progress spec. Each appears in the right-hand pane. Ask
for one change in the chat and see it in the pane; type one change directly in the pane, save or approve, and find both
changes in the saved proposal or the committed spec.

**Acceptance Scenarios**:

1. **Given** the author is reviewing or editing an in-progress proposal or spec, **When** the session shows it,
   **Then** it appears in the right-hand pane, and the chat stays in the main pane.
2. **Given** the document is in the pane, **When** the author asks for a change in the chat, **Then** the pane shows
   the changed document.
3. **Given** the document is in the pane, **When** the author edits it directly there, **Then** the session takes the
   edit in before its next change or save, tells the author what it took in, and the saved proposal or committed spec
   contains it.
4. **Given** a document that is not in progress (a spec at **in engineering**, a closed proposal), **When** it is shown
   in the pane, **Then** it is read-only there, and a direct edit is refused with the reason.

---

### Edge Cases

- **Two sessions on one spec, or the branch changed outside Claude Desktop** between sessions: on resume, and before
  every publish, the session compares the branch with what it last saw. If it changed, the author is shown what
  changed and offered to bring the latest into their local copy and continue from it (FR-022); nothing is
  overwritten silently.
- **The right-hand pane is unavailable** (for example, the Claude Desktop build does not offer it): the session shows
  the document in the chat as today, says the pane is unavailable, and every edit still goes through the chat.
- **The author edits in the pane and asks for a chat edit before the pane edit is taken in**: the pane edit is taken
  in first, so the chat edit applies to what the author sees; neither is lost.
- **Test counts cannot be determined at merge** (the counter cannot read the parent commit, or the merged commit's test
  run was cancelled by a later push or did not report): the comment says which count is unknown and why. It never
  reports zero for a count it could not read.
- **A feature that did not come from a proposal** (no `Proposal #<n>` in its spec's **Input** line), or whose issue
  is not an open proposal: the tasks template's count tasks still record the counts in `tasks.md`, and they and the
  CI steps post nothing and exit successfully.
- **A session ends part-way through an edit**: edits are kept between sessions as unpublished changes. Resume shows
  the author what changed since the last approval, or since the start if the spec was never approved, and continues
  from there. (Reworded at `/speckit-analyze`, finding U4: unpublished edits are the normal state between sessions,
  so there is nothing separate to keep or discard.)
- **The feature number the specify step would take is already used on the forge** by another branch (another person's
  feature): the next free number is used, as the repository's own specify step would choose with the forge's branches
  in view.
- **Publishing fails part-way** (forge unreachable): the commit stays local, the issue stage does not move, and a later
  approval retries. No stage says "ready to plan" for a spec that is not on the forge.
- **The repository's specify step has mandatory hooks** (such as BELAY's close-proposal hook, which this feature
  replaces): they are honoured or replaced by the new stage behaviour; none is silently skipped.
- **The proposal is edited after its spec is started**: the spec is not rewritten; the author is told the proposal
  changed and can bring the change into the spec by editing it.
- **A feature branch is merged without its issue ever reaching "in engineering"** (for example, a spec taken through
  the VS Code route): the issue still moves to merged and closes.
- **A pull request merges a branch whose issue is not a proposal**: nothing in this feature touches that issue.
- **Spec Kit is initialised but at a version whose specify or clarify step the session cannot follow**: spec creation
  is refused with a message naming the version, before anything is created.
- **The `pdlc` server is absent**: Claude Desktop spec sessions stop; the VS Code route (specify, plan, merge) still
  moves the issue through its stages.

## Requirements *(mandatory)*

### Functional Requirements

**Spec creation from a proposal**

- **FR-001**: The author MUST be able to start a spec from a **ready** proposal in Claude Desktop, and MUST NOT be able
  to start one from a draft proposal or a non-proposal issue.
- **FR-002**: Spec creation MUST use the target repository's own specify step: its feature numbering, its branch
  naming, its spec template (including overrides and presets) and its hooks. It MUST NOT use a template or numbering
  rule held by the server or the skill.
- **FR-003**: The spec's **Input** line MUST carry `Proposal #<n>: <title>` followed by the proposal body, the same
  pick-up convention the VS Code route uses.
- **FR-004**: A proposal MUST have at most one spec in progress at a time; starting again MUST offer to resume.
- **FR-005**: Before offering spec creation, the session MUST check that the repository has Spec Kit initialised at a
  version whose steps it can follow. If not, it MUST end after the proposal is saved, say why in plain words, and
  create nothing.

**Clarify, review, edit, approve**

- **FR-006**: Clarification MUST follow the target repository's own clarify step, asked one question at a time with
  suggested answers, and MUST record each answer where that step records it.
- **FR-007**: The author MUST be able to review the spec, request edits in plain words, see each edit before it is
  kept, and stop and resume in a later session with the spec exactly as they left it.
- **FR-035**: While the author reviews or edits an in-progress proposal or an in-progress spec, Claude Desktop MUST
  show the document in its right-hand pane, with the conversation in the main pane, and the pane MUST reflect every
  change made through the chat.
- **FR-036**: The author MUST be able to edit an in-progress proposal or spec directly in the right-hand pane. The
  session MUST take each direct edit in before its next change or save, tell the author what it took in, and save or
  commit it with the rest. A direct edit MUST NOT be lost or silently overwritten by a chat edit.
- **FR-037**: A document that is not in progress (a spec at **in engineering** or later, a closed proposal) MUST be
  read-only in the pane. Where the pane is unavailable, the session MUST fall back to showing the document in the chat
  and say so.
- **FR-008**: Approval MUST be refused while the spec contains `[NEEDS CLARIFICATION]` markers, and MUST be offered
  only after clarification has run at least once on the current spec.
- **FR-009**: Approval MUST commit the approved spec on the feature branch, publish the branch to the forge, move the
  issue to **ready to plan**, and add a comment naming the branch and linking the spec folder. The stage MUST NOT move
  unless the publish succeeded.

**Stages on the issue**

- **FR-010**: A proposal issue MUST carry exactly one stage at a time: **proposal** (draft or ready, as in feature
  014), **spec in progress**, **ready to plan**, **in engineering**, or **merged**.
- **FR-011**: Each stage MUST be machine-readable on the issue in the same way the proposal states are (a status
  label), with its definition in the shared label contract and in each target repository's label set.
- **FR-012**: A proposal MUST NOT be closed when its spec is created. The close-on-spec behaviour from feature 014 MUST
  be replaced in BELAY by moving the issue to **spec in progress**.
- **FR-013**: The issue MUST move to **in engineering** when planning starts for the feature, with no manual issue edit
  by the Architect or Engineer. "Planning has started" means the plan step has run for the feature in the target
  repository.
- **FR-014**: The issue MUST move to **merged** and close when the feature branch's pull request merges into the
  default branch, with no manual issue edit. A pull request closed without merging MUST NOT move or close the issue.
- **FR-038**: As part of closing the issue on merge, the closing comment MUST state, with no manual step, the number of
  tests the feature branch created: the repository's metrics counter's test declarations at the merge commit minus
  those at its first parent. The merged commit's own CI test run MUST then add, with no manual step, a comment with
  that run's whole-suite outcomes per test target: passed, failed, skipped and todo. Skipped and todo tests MUST be
  reported separately and MUST NOT be counted as passed. Counting MUST NOT run any test target a second time
  (decision M10).
- **FR-039**: When a test count cannot be determined, the comment MUST say which count is unknown and why; it MUST
  NOT report zero for a count it could not read. A missing count MUST NOT block the close, and counting MUST NOT
  fail or delay a merge or the default branch's checks.
- **FR-040**: BELAY's tasks template MUST include two required tasks: one in the first phase recording the test
  baseline, and one immediately before the pull request is opened recording the test count. Each records the count in
  `tasks.md` and, when the spec came from a proposal, comments it on that issue. When the spec did not come from a
  proposal, or its issue is not an open proposal, the task MUST post nothing and MUST NOT fail. When the issue update
  itself fails, the task MUST report the failure and implementation MUST continue.
- **FR-015**: Every stage change MUST add a comment or timeline entry on the issue saying what moved it.
- **FR-016**: The ready-work listing MUST show each issue at **ready to plan** with its feature branch and spec folder,
  MUST hide issues at **spec in progress** and **in engineering** (reporting how many it hid), and MUST keep its
  current handling of draft and ready proposals.

**Reopen and withdraw**

- **FR-017**: Until the issue reaches **in engineering**, the author MUST be able to reopen an approved spec, which
  moves the issue to **spec in progress**; approving again MUST commit and publish on the same branch and return it to
  **ready to plan**.
- **FR-018**: Once the issue reaches **in engineering**, the spec MUST be locked from Claude Desktop: edit, reopen,
  re-approve and withdraw MUST be refused, saying planning has started.
- **FR-019**: Until **in engineering**, the author MUST be able to withdraw a spec, moving the issue back to a proposal
  stage of their choice with a comment naming the branch. Withdrawal MUST NOT delete any branch, commit or file, and a
  later spec from the same proposal MUST be a new feature.

**Guards**

- **FR-020**: The server MUST write files only inside the one feature's spec folder, plus any file the target
  repository's own specify or clarify step writes outside it (each named in the plan and covered by a test).
- **FR-021**: The server MUST commit and publish only the feature's own branch. It MUST NOT commit to, publish, move or
  rewrite the default branch or any other branch, MUST NOT rewrite published history, and the default branch of the
  local copy MUST stay fast-forward only.
- **FR-022**: Before every publish and on every resume, the server MUST detect a feature branch that changed on the
  forge since the session last saw it, refuse to overwrite, and report what changed. It MUST then offer to bring the
  latest published branch into the author's local copy and continue from it. Taking the latest MUST keep the author's
  unpublished edits (re-applied on top, with each conflicting edit shown to the author to resolve), MUST NOT rewrite
  any published commit, and MUST NOT publish anything until the author approves again.
- **FR-023**: Stage changes and comments MUST target only the issue the feature came from, and only along the
  transitions in FR-010 to FR-019; any other transition MUST be refused.
- **FR-024**: The forge credential MUST NOT appear in any tool result, log line, process argument or repository
  configuration, and spec text MUST NOT appear in process arguments.
- **FR-025**: Every refusal MUST say what was refused and why, and MUST leave the forge and the local copy unchanged.
- **FR-026**: Every guard in FR-020 to FR-024 MUST have an automated test that observes the refusal.
- **FR-027**: The server MUST still offer no close, delete, reopen-issue, arbitrary-relabel or bulk operation. Closing
  on merge is not a server operation.

**Equivalence with the VS Code route**

- **FR-028**: A spec produced in Claude Desktop MUST be indistinguishable, for `/speckit-plan` and every later step,
  from one produced by `/speckit-specify` and `/speckit-clarify` in VS Code: same folder, same branch shape, same files.
- **FR-029**: The Architect and Engineer workflow from planning onward MUST be unchanged, apart from the stage moves in
  FR-013 and FR-014 happening on their behalf.

**Contracts, skill and documentation**

- **FR-030**: The tool contract, the master `proposal-intake` skill (or a companion skill for the spec stage) and the
  shared label contract MUST change together in one change, and the existing automated contract test MUST fail when
  the announced tools differ from the contract.
- **FR-031**: With the `pdlc` server absent, a target repository MUST still take a ready proposal through
  `/speckit-specify` in VS Code, and the issue MUST still move through **spec in progress**, **in engineering** and
  **merged** by the repository's own tooling. Nothing a target repository runs may call, require or check for the
  server.
- **FR-032**: BELAY MUST document the spec stage (install changes, the credential's new scope, the stages, reopen and
  withdraw, refusal codes) in its `pdlc` and backlog runbooks and its lifecycle page, refreshing the knowledge pages
  that summarise them in the same change.
- **FR-033**: BELAY MUST update the MCM hand-off guide with what MCM must change to adopt the stages and close-on-merge.
- **FR-034**: The amendments to feature 014's decisions (table in Context) MUST be recorded in a decision record
  before implementation, with the maintainer's approval.

### Key Entities

- **Proposal issue**: the feature 014 proposal, now open from proposal to merge. Adds a **stage** and, once a spec
  exists, a **feature branch** and **spec folder**.
- **Stage**: one of proposal (draft or ready), spec in progress, ready to plan, in engineering, merged. Exactly one
  per issue; each change leaves a trace on the issue.
- **Spec in progress**: a feature folder and branch created from one proposal by the target repository's specify step,
  being clarified and edited by its author. Not yet visible as ready work.
- **Approved spec**: a spec the author approved, committed and published on its feature branch; the issue is at
  **ready to plan**.
- **Feature branch**: the branch the repository's specify step names for the feature. The only branch the server may
  commit to or publish.
- **Author**: the Product Owner or Analyst running the Claude Desktop session. Approves their own spec.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: One proposal goes from interview to an approved, committed spec on a published feature branch with zero
  visits by the author to VS Code, the forge or a terminal.
- **SC-002**: An Architect checks out that branch and runs `/speckit-plan` with zero fix-ups, zero re-runs of specify
  and zero manual file moves.
- **SC-003**: Using the backlog alone, an Architect lists every spec ready to plan and names its feature branch, with no
  need to ask anyone. In a test backlog holding specs at every stage, the listing shows 100% of the ready-to-plan
  specs and 0% of the others.
- **SC-004**: One issue shows each stage in turn (proposal, spec in progress, ready to plan, in engineering, merged) and
  closes only when the feature branch merges into the default branch; at no point does it carry two stages.
- **SC-005**: In a repository without Spec Kit initialised, the session ends after the proposal is saved with a plain
  message saying why spec creation is unavailable, and zero branches, commits or files are created.
- **SC-006**: 100% of the guards in FR-020 to FR-024 have a test that observes a refusal, and every refusal leaves the
  forge and the local copy unchanged.
- **SC-007**: Across the full end-to-end run, zero commits reach the default branch from the server, and zero branches
  other than the feature's own are created or published.
- **SC-008**: With the server not installed, a ready proposal in BELAY goes through `/speckit-specify` in VS Code to a
  merged feature and a closed issue, passing through every stage, and BELAY's lint and test targets pass with no step
  failing, warning or skipping because the server is missing.

- **SC-009**: In the end-to-end run, the in-progress proposal and the in-progress spec are each reviewed in the
  right-hand pane, and at least one chat edit and one direct pane edit of each reach the saved proposal and the
  committed spec, with zero edits lost.
- **SC-010**: When the end-to-end feature merges, its issue's closing comment states the number of tests the feature
  created, matching `count-repo-metrics.mjs` run by hand at the merge commit and its parent. The outcomes comment
  states passed, failed, skipped and todo per target, matching the merged commit's CI test log. The merge adds no
  second test run to CI.
- **SC-011**: When the feature branch changes on the forge during a session, the author takes the latest into their
  local copy and continues, with 100% of their unpublished edits kept or shown to them as conflicts.

**Done when** SC-001 to SC-011 are demonstrated end to end on BELAY.

## Assumptions

- One operator on one workstation still plays Product Owner and Analyst, as in feature 014. Two-person editing is
  handled as a conflict to surface (FR-022), not a collaboration feature.
- The author approves their own spec. There is no second approver.
- The in-progress spec lives on the workstation's local copy, on the feature branch, between sessions; it is
  published on approval. Publishing earlier is a planning option only if it does not make an unapproved spec look
  ready.
- "Planning has started" is signalled by the plan step running for the feature. How that moves the stage (for example
  a hook on the plan step) is a planning decision.
- Moving the issue to **merged** and closing it on merge happens in the target repository's own automation, not in the
  `pdlc` server. How (for example a workflow on the default branch) is a planning decision.
- How a Claude Desktop session runs the repository's own specify and clarify steps on the author's behalf (requester's
  expectation: Spec Kit itself creates the branch, and Spec Kit's specify and clarify steps are what run, not a
  reimplementation) is a planning decision. FR-002, FR-006 and FR-028 are the requirements it must meet.
- The `pdlc` credential needs repository write to publish feature branches. Whether that widens the existing dedicated
  credential or uses a second one is a planning decision, measured as in feature 014; either way it stays dedicated,
  narrowest-scope and separately revocable, and the default branch stays protected server-side.
- The right-hand pane is the side pane Claude Desktop shows next to the chat. Planning measures whether direct edits in
  it reach the session, and how, before the design is fixed. If they cannot, FR-036 is raised with the maintainer
  rather than quietly dropped.
- "Tests created" counts the feature's new test declarations, not the whole suite. The outcomes are whole-suite
  counts of executed test cases, because telling the feature's cases apart would need a second test run (decision
  M10). The two numbers are different units and are never presented as "N created, M of those passed".
- MCM's tests may not all be JavaScript `node:test` declarations, which is all BELAY's counter recognises. MCM
  adopting the counts needs a counting rule for its own test kinds, named in the hand-off guide (FR-033).
- The forge's existing protection of the default branch (no direct push, required checks) stays in place and is a
  second bound on FR-021.
- Spec Kit's `before_specify` branch hook and BELAY's numbering rules apply unchanged; the session sees the forge's
  branches when choosing a number.
- MCM adopts the stages and close-on-merge after BELAY proves them, as with feature 014, through an updated hand-off
  guide (FR-033).
- Out of scope, from the proposal: initialising Spec Kit in a target repository; plan, tasks, implement and everything
  after (they stay in VS Code); opening, reviewing or merging pull requests from Claude Desktop; starting a spec
  without a ready proposal; migrating already closed proposals or existing specs into the stages; active
  notifications (mentions, assignment, messages).
- Proposals closed under feature 014's close-on-spec rule, including this feature's own proposal (item #91), stay
  closed; the stage model applies to specs started after this feature merges.
