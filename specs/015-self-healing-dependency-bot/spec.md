# Feature Specification: Self-healing dependency bot

**Feature Branch**: `015-self-healing-dependency-bot`

**Created**: 2026-11-26

**Status**: Draft

**Input**: User description: "Proposal #86: Self-healing dependency bot. The proposal body is backlog item #86."

## Context

The dependency bot (ADR-0004, features 011 and 012) keeps every pinned thing current by opening update pull requests.
Feature 012 made the bot's health **visible**: a weekly report names red bot PRs, empty PRs and stale branches. It
left **fixing** them out of scope, as human work.

That human work is now the cost. Measured mainly on MovieCollectionManager (MCM), whose bot is older than BELAY's:

- **Failures need manual follow-up.** About 3 of every 4 weekly windows leave at least one red update PR. The
  maintainer finds them by checking CI by eye each morning, then starts a coding session for each one to get it to
  green.
- **Bot CI holds the single runner during working hours.** MCM's Friday window often runs well into the morning, and
  reruns after a failure can hold the runner until Saturday. The maintainer's own PRs, and coding agents' PRs, wait
  in the queue.
- **The queue never empties.** After a window, more than three updates are usually still waiting on the bot's
  dashboard, including known security fixes, so vulnerabilities stay open for another week or more.

This feature makes the bot finish its own work overnight. It finds red bot PRs, tries to fix them within a budget,
explains the ones it cannot fix, merges the low-risk ones that are green, and makes sure each window proposes
everything that is eligible. All of it is planned to finish before the working day starts. It is shared BELAY
tooling, so every consuming repository gets it without keeping its own copy.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A red bot PR is fixed, or explained, without the maintainer starting anything (Priority: P1)

After a window, every bot PR whose required checks fail is picked up automatically. A remediation attempt finds the
cause, makes the smallest change that is needed to land that dependency update, and re-runs CI. When the attempt
succeeds, the PR turns green, with a written account of what was wrong and what changed. When it cannot succeed
within its budget, the PR stays open and red, with a written diagnosis of what was tried and why it stopped.

**Why this priority**: this is the chore the proposal exists to remove: 3 of every 4 windows need a hand-started
session today.

**Independent Test**: on a test repository, open a bot PR that fails CI for a known, fixable reason (for example, a
renamed API in the updated package), and run the overnight cycle. The PR turns green and carries a cause-and-change
account, with no human action. Repeat with an unfixable failure. The PR stays red, with a diagnosis, once the
attempt budget is spent.

**Acceptance Scenarios**:

1. **Given** a bot PR with a failing required check, **When** the overnight cycle runs, **Then** a remediation
   attempt starts without any human action.
2. **Given** a remediation that turns the PR green, **When** it finishes, **Then** the PR carries a written account
   of the cause found, the change made and the CI result.
3. **Given** a remediation that has used its whole attempt budget without reaching green, **When** it stops,
   **Then** the PR stays open and red. It carries a diagnosis that says what was tried, what was learned and why the
   attempt stopped.
4. **Given** a remediation whose change would skip, delete or loosen a test, a gate or an allowlist, **When** that
   change is checked before it is pushed, **Then** it is refused. The PR is then diagnosed, not pushed.
5. **Given** a bot PR that is red because of something outside the update (for example, the forge or the runner is
   down), **When** the cycle runs, **Then** the diagnosis says that, and no code change is attempted.
6. **Given** a bot PR for a major upgrade, **When** it is red, **Then** it is not remediated. Majors keep waiting
   for the maintainer.

---

### User Story 2 - Bot work is designed to be finished before the working day starts (Priority: P1)

All bot-triggered CI for a window, including every remediation rerun, is planned and ordered to finish by 6:00 AM ET
on the morning after that repository's routine window. Then the maintainer's own PRs, and agents' PRs, have the
runner when the day starts. 6:00 AM is a **target, not a cut-off**. Work still running at 6:00 AM runs to
completion, is never paused or cancelled for the deadline, and the overrun is reported with its cause.

**Why this priority**: the runner contention costs the maintainer's working time every week, even when nothing
fails.

**Independent Test**: run a full window with remediation on a repository. Check the runner's job history: in a
normal window, the last bot-triggered job ends before 6:00 AM ET. Then force an overrun, for example with a slow
remediation. The work continues past 6:00 AM, and the morning report records the finish time and why it ran over.

**Acceptance Scenarios**:

1. **Given** a normal window, its remediations and their reruns, **When** 6:00 AM ET arrives, **Then** no
   bot-triggered job is running or queued.
2. **Given** bot work still running at 6:00 AM ET, **When** the deadline passes, **Then** the work continues to
   completion. Nothing is paused, cancelled or deferred to a later window because of the deadline.
3. **Given** a window that overran, **When** the report is written, **Then** it records when the last bot job
   ended, what was still running at 6:00 AM, and why. The cause is categorised (for example: too many PRs, a slow
   remediation, a slow check, an infrastructure delay), so that repeated overruns show what to tune.
4. **Given** a security fix that arrives outside the routine window, **When** it is proposed, **Then** it keeps its
   current cadence. Its CI and any remediation follow the same rules as any other bot PR.

---

### User Story 3 - Low-risk green updates merge themselves (Priority: P2)

Green bot PRs that are lock-file refreshes, patch or minor updates, or security fixes merge with no human action.
That includes PRs that turned green through remediation. Digest pins, action pins and majors never merge without
the maintainer.

**Why this priority**: without it, the maintainer still has to merge every PR each morning. But it changes a
recorded decision (ADR-0004: "the bot proposes and never merges"), so it follows the fixing stories.

**Independent Test**: on a test repository, open one green PR of each class. After the cycle, the lock-file, patch,
minor and security PRs are merged, and the digest-pin, action-pin and major PRs are still open.

**Acceptance Scenarios**:

1. **Given** a green PR in an auto-merge class, **When** the cycle reaches it, **Then** it merges, and the PR
   records that the merge was automatic and which class allowed it.
2. **Given** a green PR for a digest pin, an action pin or a major, **When** the cycle reaches it, **Then** it is
   left open for the maintainer.
3. **Given** a PR that remediation changed, **When** it turns green, **Then** it is merged only if its class allows
   it, and only after every required check has passed on the remediated head.
4. **Given** a required check that is skipped, pending or missing, **When** the merge decision is made, **Then**
   the PR is not merged.

---

### User Story 4 - Each window drains the queue (Priority: P2)

After a window, the dashboard lists no update still waiting for a schedule window, and no known security fix with
an available version is left unproposed. Majors awaiting approval and recorded holds do not count.

**Why this priority**: an update that waits a week is a security fix that waits a week.

**Independent Test**: start a window with more eligible updates than one pass of the bot proposes today. After the
window, the dashboard's "waiting for schedule" list is empty, and every open security advisory with a fixed version
has a PR.

**Acceptance Scenarios**:

1. **Given** more eligible updates than one pass proposes, **When** the window ends, **Then** every one has been
   proposed.
2. **Given** a known security fix with an available version, **When** the window ends, **Then** it has a PR or a
   recorded hold.
3. **Given** draining the queue makes the window's work longer, **When** the work is ordered, **Then** security
   fixes and remediations of red PRs come first. Nothing eligible is held back to a later window to meet the 6:00 AM
   target.

---

### User Story 5 - One shared capability, adopted by each repository (Priority: P3)

The capability is shared BELAY tooling. A consuming repository (MCM, BELAY, future ones) adopts it with
repository-level settings only: its window, its runner, and its class rules if they differ. It keeps no copy of the
logic.

**Why this priority**: it is how the proposal's value reaches more than one repository, but the behaviour has to
work on one repository first.

**Independent Test**: adopt the capability in MCM and in BELAY. Each repository's own files hold only settings, and
no remediation or merge logic.

**Acceptance Scenarios**:

1. **Given** a consuming repository, **When** it adopts the capability, **Then** what it maintains is settings
   only.
2. **Given** a change to the shared capability, **When** it is released, **Then** each consuming repository picks
   it up the way it picks up other shared BELAY tooling, with no per-repository edit to the logic.

---

### Edge Cases

- **Two bot PRs fail for the same reason** (for example, one breaking change reached through two updates): the
  diagnosis or fix is shared, not worked out twice, and neither PR is fixed in a way that breaks the other.
- **A remediated PR turns red again** after `main` moves: it is a new failure and gets a new attempt within the same
  window's budget, never an unbounded retry.
- **The bot opens a new PR for the same update** after a remediation pushed to its branch: the remediation is not
  silently lost. The PR's record shows what happened.
- **A failure is flaky** (it passes on a rerun with no change): it is recorded as flaky, not as fixed. The morning
  report counts it.
- **The remediation credential is missing or refused**: the cycle fails loudly through the existing failure digest,
  and every red PR is still listed in the morning report. It never reads as "nothing to fix".
- **The fix needs a change outside the dependency update** (for example, a change in feature code): it is out of
  scope, so the PR is diagnosed, not changed.
- **A security fix requires a major version**: it is handled as described in FR-012.
- **The health loop's weekly report** (feature 012) runs while remediation is active: it reports the remediation
  state and does not count a PR as "red" while an attempt on it is still running.

## Requirements *(mandatory)*

### Functional Requirements

**Detection and remediation**

- **FR-001**: The capability MUST detect every bot PR with a failing required check after each bot run, without a
  human looking.
- **FR-002**: It MUST attempt remediation of each detected PR automatically, then re-run CI on the result.
- **FR-003**: Each PR's remediation MUST be bounded: at most 3 attempts, and at most 60 minutes of total runner time,
  whichever is reached first. After that it stops and writes a diagnosis.
- **FR-004**: A remediation MUST change only what landing that dependency update needs. It MUST NOT skip, delete,
  mark as expected-to-fail or loosen any test, gate, check, threshold or allowlist entry. It MUST NOT change CI
  workflow definitions or the bot's own configuration.
- **FR-005**: The FR-004 rule MUST be checked mechanically on every remediation's change before it is pushed, and
  the result of that check MUST be recorded on the PR. This is how "never weakened a check" is provable for any
  remediated PR.
- **FR-006**: Every remediation MUST record on its PR:
  - the failing check;
  - the cause found;
  - the change made, or why none was made;
  - the CI result;
  - the attempts used.
- **FR-007**: Every diagnosis MUST put its cause in one of a fixed set of categories (for example: API change in the
  dependency, transitive conflict, lock-file drift, flaky check, infrastructure outage, out of scope, budget
  exhausted). This answers the proposal's first open question over time: what actually causes the failures.
- **FR-008**: Majors MUST NOT be remediated.

**The 6:00 AM target**

- **FR-009**: The capability MUST be designed so that all bot-triggered CI and remediation for a repository finishes
  by 6:00 AM ET on the morning after that repository's routine window. Each repository's own window sets its own
  target.
- **FR-010**: 6:00 AM ET is a target, not a cut-off. Bot work running at 6:00 AM MUST run to completion. It MUST NOT
  be paused, cancelled or deferred to a later window because of the target. Security fixes keep their current
  cadence outside the window.

**Merging**

- **FR-011**: A green bot PR MUST merge without human action when its class is a lock-file refresh, a patch, a minor
  or a security fix. A PR is green only when every required check has passed on its current head: skipped, pending
  or missing checks do not count.
- **FR-012**: Digest pins, action pins and majors MUST NOT merge without the maintainer. A security fix that requires
  a major version is a major: it waits for the maintainer and is not remediated. The morning report lists it
  separately, as a security fix awaiting approval.
- **FR-013**: Every automatic merge MUST record on the PR that it was automatic, and which class allowed it.
- **FR-014**: The automatic-merge rule MUST be recorded in a decision record that supersedes the part of ADR-0004
  that says the bot never merges. The existing guard that holds "automerge off" MUST be updated to assert the new
  rule, so it still fails if merging spreads beyond the allowed classes. It MUST NOT be
  deleted.

**Draining the queue**

- **FR-015**: After each window, every update that is eligible to be proposed MUST have a PR. Majors awaiting
  approval and recorded holds are excluded.
- **FR-016**: After each window, every known security fix that has an available version MUST have a PR or a
  recorded hold.
- **FR-017**: The window's work MUST be ordered so that security fixes and remediations of red PRs come first.
  Nothing eligible may be held back to a later window to meet the 6:00 AM target.
- **FR-018**: To meet FR-009 and FR-015 together, the plan MUST evaluate three ways of gaining throughput, with
  measured evidence for each:
  - batching and ordering the window's updates;
  - a second runner;
  - changing the dependency tool.
- **FR-019**: A second runner, or a different dependency tool, is a structural change. It needs the maintainer's
  approval and a decision record before it is adopted.
- **FR-020**: Changing the dependency tool MAY be chosen only when its benefit is strong and its downside is
  limited: the cure must not be worse than the problem. Concretely, the new tool MUST measurably improve at least one
  of window duration, queue drain or failure rate. It MUST keep every protection the current bot gives:
  - digest and SHA pinning;
  - lock-file maintenance, and the transitive security fixes it delivers;
  - the release-age cooling-off period;
  - security fixes exempt from the schedule;
  - justified holds with a re-check rule;
  - the dashboard and the feature 012 health checks, or equivalents;
  - the configuration guards.
  It MUST also be adoptable by every consuming repository without per-repository logic.

**Reporting and adoption**

- **FR-021**: After each window's work finishes, one report MUST list every bot PR in one of four states:
  - merged automatically;
  - green and waiting for the maintainer (security fixes awaiting approval are listed separately);
  - red with a diagnosis;
  - still running at 6:00 AM ET.
- **FR-022**: The report MUST record when the last bot job ended against the 6:00 AM target, and give the cause of
  any overrun in a fixed set of categories. When the report is missing, that MUST be visible, in the same way
  feature 012's weekly report is.
- **FR-023**: The capability MUST extend feature 012's health loop, not run beside it. A red PR with a diagnosis is
  reported as diagnosed, not as an unexplained failure.
- **FR-024**: The capability MUST be shared BELAY tooling. A consuming repository adopts it with settings only:
  window, runner, and any narrower class rules. It keeps no copy of the logic.
- **FR-025**: The capability MUST NOT act on non-bot PRs, and MUST NOT change anything that landing a dependency
  update does not need.
- **FR-026**: Every action it takes (detect, attempt, push, rerun, merge, stop) MUST be recorded on the PR it
  concerns.

### Key Entities

- **Bot PR**: an update PR the dependency bot opened. It has an update class (lock-file refresh, patch, minor,
  security, digest pin, action pin, major), required-check results, and a state (green, red, remediating,
  diagnosed, merged).
- **Remediation attempt**: one try at turning a bot PR green. It has a cause category, a change (or none), the
  guard check's result, the CI result, and the runner time used. A PR has at most 3.
- **Diagnosis**: the written result when remediation stops without green. It has a cause category, what was tried,
  and why the attempt stopped.
- **Window**: a repository's routine bot run. It sets the 6:00 AM ET target for the morning after.
- **Morning report**: the per-window summary of every bot PR's final state, when the work ended against the target,
  and the cause of any overrun.
- **Adoption settings**: a consuming repository's window, runner, and any narrower class rules.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: By 6:00 AM ET on the morning after a routine window, 100% of open bot PRs are either green or carry a
  written diagnosis.
- **SC-002**: At 6:00 AM ET on that morning, no bot-triggered job is running or queued. This is a target, measured
  and reported each window. An overrun is reported with its cause; it never stops the work (FR-010).
- **SC-003**: After a window, the dashboard lists no update still waiting for a schedule window. Majors awaiting
  approval and recorded holds do not count.
- **SC-004**: After a window, no known security fix with an available version is left without a PR or a recorded
  hold.
- **SC-005**: Green PRs in the auto-merge classes merge with no human action. No digest pin, action pin or major ever
  merges without the maintainer.
- **SC-006**: For 100% of remediated PRs, the record shows that no test, gate or allowlist was skipped, deleted or
  loosened.
- **SC-007**: 100% of remediated PRs carry a written account of the cause found and the change made.
- **SC-008**: MCM and BELAY both use the capability, and neither keeps bot-remediation or bot-merge logic of its own.
- **SC-009**: The maintainer starts no remediation session by hand for a bot PR in any window. Today's baseline is 3
  of every 4 windows.
- **Done when**: SC-001 to SC-007 and SC-009 hold on MCM for four consecutive weekly windows, and SC-008 holds for
  MCM and BELAY. A window counts when its work met the 6:00 AM target, or when it overran only for a reported cause
  outside the capability's control (an infrastructure outage, for example).

## Assumptions

- **The remediation budget** is 3 attempts and 60 minutes of runner time per PR (FR-003). The proposal left the
  limits open. These defaults fit inside the overnight target, and the plan may tune them with evidence.
- **"ET" means America/New_York local time**, following daylight saving. The bot's schedules are in UTC today
  (BELAY's window is Wednesday 05:00–06:59 UTC), so the target's UTC hour moves twice a year, and the plan must
  handle that.
- **The target is per repository**: the morning after that repository's own window (MCM's Friday, BELAY's
  Wednesday).
- **Remediation is done by an automated coding agent.** It runs on the subscription, never on a per-token API key,
  following the secrets posture. Its forge credential is the narrowest that can push to bot branches, re-run CI and
  merge. It is a new long-lived credential, so the secrets posture gains it with this feature.
- **Feature 012's health loop stays**, and this feature extends it (FR-023). Its scope note that fixing problems is
  human work is superseded for bot PRs only.
- **Cause categories start from what MCM has seen**, and are refined as diagnoses accumulate. The proposal says the
  real causes are not known yet; FR-007 is how they become known.
- **The SC-009 target is zero** hand-started remediation sessions. The proposal asked what target counts as
  success; zero follows from its first goal ("remediated without the maintainer starting anything").
- **The MCM side of adoption** (settings, and any MCM-specific runner arrangement) is done in MCM. This spec defines
  what BELAY provides and what an adopting repository must supply.
- **Out of scope**:
  - major upgrades: they keep waiting for dashboard approval, and are never remediated or merged automatically;
  - red CI on non-bot PRs;
  - any change not needed to land a dependency update.
