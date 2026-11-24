# Feature Specification: The dependency bot's health loop

**Feature Branch**: `012-renovate-health-loop`

**Created**: 2026-11-24

**Status**: Draft

**Input**: User description: "The dependency-bot health loop (backlog item 48, ADR-0004's consequence 'the bot is not done until its health loop is'): a weekly health job, a lockfile-refresh check and a branch reaper. Port of MovieCollectionManager's renovate-health, check-lockfile-refresh and reap-merged-branches."

## Context

Feature 011 gave BELAY a dependency bot that proposes updates. ADR-0004 records the consequence this feature exists
for: **a bot that silently stops working is worse than no bot**, because you believe you are covered.

MovieCollectionManager (MCM) runs the same bot. Its feature 057 found the bot broken in four independent ways, all
silent:
- it ran on the wrong Node version;
- its schedule window never met its trigger;
- it could not move some pins at all;
- allowlist entries expired without warning.

Each failure lasted weeks before anyone noticed, because nothing asked "is the bot still doing its job?". MCM then
measured a fifth: a bot branch that survived its merge was reused verbatim, and opened empty pull requests.

Feature 011 already makes a single run loud (its verdict status, the preflight, the failure digest). This feature
watches the bot **over time**: whether it is producing what it should, whether its own branches are sane, and whether
anyone would notice if the weekly signal stopped.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A weekly health report whose silence is the alarm (Priority: P1)

Once a week, after the bot's routine window, a report is posted to one tracking issue. When everything is healthy it
is one line. When something is wrong, it lists each problem the bot itself has reported, and every bot branch that is
not in a healthy state. Because the report is posted **every** week, a missing report means the health job itself
stopped. That is visible to anyone reading the issue, and to the agent that checks it.

**Why this priority**: this is the loop's core. Without it, every other check here is one more thing that can fail
quietly.

**Independent Test**: dispatch the health job. A new comment appears on the tracking issue: one line when the
dashboard reports no problems and every bot branch is healthy, and one line per finding otherwise.

**Acceptance Scenarios**:

1. **Given** the bot's dashboard lists no repository problems and every bot branch is healthy, **When** the weekly job
   runs, **Then** it posts a single "healthy" line, with the date and what it checked.
2. **Given** the dashboard lists a repository problem (for example, a lookup that failed), **When** the job runs,
   **Then** the report quotes that problem.
3. **Given** a bot branch whose pull request carries no change against `main`, **When** the job runs, **Then** the
   report names it as an empty PR.
4. **Given** a bot branch whose head is already in `main` and which has no open pull request, **When** the job runs,
   **Then** the report names it as stale: the bot would reuse it verbatim.
5. **Given** a bot pull request whose required checks are failing, **When** the job runs, **Then** the report names it
   and the failing checks. MCM's report twice said "healthy" while bot PRs were red (MCM item #485).
6. **Given** the dashboard issue cannot be found, or the forge refuses the request, **When** the job runs, **Then** the
   job fails loudly through the failure digest, and does not post "healthy".

---

### User Story 2 - A lock-file refresh that did not happen is noticed (Priority: P1)

The bot's lock-file maintenance is the channel that delivers transitive security fixes that the version ranges already
allow. MCM measured it dying silently, through a missing toolchain, a capped budget or a schedule that never ran, while
everything else looked fine. After each routine window, a check confirms that the lock-file refresh actually ran inside
that window. If it did not, the check fails.

**Why this priority**: it is the one channel whose silence MCM measured repeatedly. Lock-file maintenance PRs are
what keep transitive fixes arriving.

**Independent Test**: after a routine window, run the check. It passes when a lock-file-maintenance pull request was
opened or updated inside the window, or when the bot reported that the lock file was already current. It fails, naming
the window, otherwise.

**Acceptance Scenarios**:

1. **Given** the routine window ran and the bot opened or updated a lock-file-maintenance PR inside it, **When** the
   check runs, **Then** it passes, naming the PR.
2. **Given** the window passed with no lock-file-maintenance activity, and no record that the lock file was already
   current, **When** the check runs, **Then** it fails, naming the window it derived.
3. **Given** the only lock-file PR was forced from the dashboard outside the window, and the window itself did not
   update it, **When** the check runs, **Then** it reports the PR as forced and fails. A forced PR proves the tick
   worked, not that the window does.
4. **Given** the window in the bot's configuration changes, **When** the check runs, **Then** it derives the new window
   from the configuration. It never uses a copy of the window kept elsewhere.

---

### User Story 3 - Merged branches do not linger to be reused (Priority: P2)

A branch whose work is already merged into `main`, and which nothing is using, is deleted automatically. A surviving
bot branch is otherwise reused verbatim on the next run, which MCM measured opening empty PRs. The reaper never
deletes a branch that is still in use: one with an open pull request, a protected branch, or one too new to judge.

**Why this priority**: the merge tool and the repository setting already delete most merged branches (feature 011).
The reaper catches the ones they miss, such as a PR merged in the web UI with deletion unticked.

**Independent Test**: the reaper's default mode is a dry run, which lists what it would delete and deletes nothing.
With deletion enabled, a merged, unused branch is deleted, and every protected or in-use branch is left alone.

**Acceptance Scenarios**:

1. **Given** a remote branch whose head is already contained in `main`, with no open PR, older than the grace period,
   **When** the reaper runs with deletion enabled, **Then** that branch is deleted and the deletion is reported.
2. **Given** a branch with an open pull request, **When** the reaper runs, **Then** it is never deleted, even if
   merged.
3. **Given** `main`, or any branch matching a protection rule, **When** the reaper runs, **Then** it is never deleted.
4. **Given** a branch created minutes ago from `main`, which is trivially "merged", **When** the reaper runs, **Then**
   it is left alone until the grace period passes.
5. **Given** the reaper runs with no explicit deletion flag, **When** it finds candidates, **Then** it lists them and
   deletes nothing.

### Edge Cases

- **The weekly job itself dies**: covered by design. A week without a report comment is the signal, and the report
  issue says so in its description.
- **The dashboard issue was renamed or closed by hand**: it is found by its `status/bot-managed` label and its author,
  not by its title. If it cannot be found, that is a finding, not "healthy".
- **The tracking issue is missing** (deleted, or never created): the job creates it, labelled `status/bot-managed`, so
  `backlog.mjs ready` never lists it as work.
- **A run between two windows**: the lock-file check judges the most recent window that has fully passed, never one
  in progress.
- **Branch-ancestry checks on a shallow checkout** would call every branch unmerged. The jobs fetch full history, or the
  check fails rather than guessing.
- **Other agents' feature branches** share this repository. The reaper deletes one only when its head is already in
  `main`, its open-PR state has been checked, and it is past the grace period. A branch someone is about to push to
  is the reason for the grace period.
- **The forge paginates** branch, pull-request and issue lists. Every list is read to the end, and the total is
  checked against what was read.
- **No bot branches at all** (a quiet week): healthy, reported as "0 bot branches".

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A scheduled health job MUST run weekly, after the bot's routine window, and MUST post exactly one comment
  per run on a single tracking issue. That is the report, or, when a read failed, a failure comment that is not a
  report (FR-005).
- **FR-002**: When nothing is wrong, the comment MUST be one line. It MUST state the date, the number of bot branches
  classified and that the dashboard reported no problems.
- **FR-003**: The job MUST read the bot dashboard's repository-problems section and report every entry in it.
- **FR-004**: The job MUST classify every `renovate/*` branch, using MCM's measured rules:
  - **active**: its head is not yet in `main`;
  - **empty**: its head is already in `main` and it has an open PR, so the PR adds nothing;
  - **stale**: its head is already in `main` and it has no open PR, so the bot would reuse it verbatim;
  - **unknown**: its ancestry cannot be answered. This is reported, never dropped.

  It MUST report every branch that is not active.
- **FR-004a**: The job MUST report every open bot PR whose required checks are failing, naming the failing checks.
  "Healthy" MUST mean that no bot PR is blocked.
- **FR-005**: The job MUST fail loudly, through the failure digest, when it cannot read the dashboard, the branches or
  the pull requests. It MUST NOT post "healthy" from partial data. It posts a failure comment naming what it could
  not read, and that comment does not count as a report for the freshness check.
- **FR-006**: The tracking issue MUST carry the `status/bot-managed` label, so the backlog's `ready` list never shows
  it. The job MUST create it if it is missing.
- **FR-007**: A lock-file check MUST run after each routine window. It MUST derive the window from the bot's own
  configuration, and MUST fail when neither a lock-file-maintenance pull request was opened or updated inside that
  window nor the bot recorded the lock file as already current.
- **FR-008**: A branch reaper MUST delete remote branches whose head is already contained in `main` and that have no
  open pull request, are not protected, and whose tip commit is older than a grace period of 6 hours (MCM's measured
  value). It MUST keep a branch whose head lies on `main`'s first-parent history, because that is a branch created
  from `main` with no commits of its own yet. A tip commit's age cannot tell such a branch apart, since it points at
  an existing `main` commit. The open-PR read MUST fail closed: a short or malformed listing deletes nothing.
- **FR-009**: The reaper MUST default to a dry run that deletes nothing. Deletion MUST need an explicit flag, and the
  scheduled workflow is what passes it.
- **FR-010**: The reaper MUST never delete `main`, a branch matching a branch-protection rule, or a branch with an open
  pull request, whoever authored it.
- **FR-011**: Each check MUST have a self-test that proves its failure paths, run in CI before the real check, like
  every other `check-*` script in the repository.
- **FR-012**: Every new workflow MUST meet the repository's CI rules:
  - every step goes through the step wrapper;
  - the failure digest runs last;
  - the retention floor is raised for each new bundle-publishing job;
  - it runs on the repository's own runner;
  - it is never triggered by a pull request.
- **FR-013**: Every forge listing MUST be read to its end, past the page cap, and a result that is shorter than its
  reported total MUST fail, never be treated as complete.
- **FR-014**: The bot runbook MUST document the health loop: what each check proves, how to read the weekly report,
  what to do about each finding, and what a missing week means. The wiki page MUST be refreshed with it.

### Key Entities

- **Tracking issue**: the one issue the weekly report is posted to. Labelled `status/bot-managed`, and created if
  missing.
- **Health report**: one comment per week. Either one healthy line, or a list of findings.
- **Bot branch**: a `renovate/*` branch, with its open pull request (if any) and whether its head is already in
  `main`. Classified as active, empty, stale or unknown.
- **Dashboard problem**: an entry in the bot dashboard's repository-problems section.
- **Window**: the routine schedule from the bot's configuration, as concrete start and end times for the most recent
  window that has fully passed.
- **Reap candidate**: a branch contained in `main`, with no open PR, unprotected and past the grace period.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A week in which the health job does not run is noticeable within 8 days, because the tracking issue then
  has no report for that week.
- **SC-002**: A dashboard problem, an empty bot PR, a stale bot branch or a blocked bot PR appears in the next weekly
  report, within 7 days of arising.
- **SC-003**: A routine window with no lock-file refresh fails a check within 24 hours of the window ending.
- **SC-004**: No branch with an open pull request, no protected branch and no branch younger than the grace period is
  ever deleted. Each case is proven by a self-test.
- **SC-005**: A merged bot branch that the merge left behind is deleted within 24 hours of the grace period passing.
- **SC-006**: The first real health report is posted after the bot's first live window, and recorded on item #48.

## Assumptions

- **Feature 011 is in place**: the bot runs, its dashboard carries `status/bot-managed`, and the window is
  `* 5-6 * * 3` in UTC. The schedules here are planned relative to that window.
- **The read and write credentials already exist.** The forge's run token can post statuses, and `CI_DIGEST_TOKEN`
  can write issues. Planning decides which token each job uses. No new secret is expected; if one is needed, planning
  says so and the maintainer creates it.
- **Deleting branches needs a credential with repository write access.** Planning chooses between the run token, if
  this forge lets it delete branches, and the bot's own token.
- **The schedules follow MCM's shape**, adjusted to BELAY's window: the reaper daily, and the lock-file check and the
  health report after the window.
- **Out of scope**:
  - fixing the problems the loop reports, which is a human, or a separate PR;
  - watching image-scan allowlist expiry, which feature 010 already warns about 14 days ahead;
  - any change to how the bot itself runs.
