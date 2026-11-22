# Feature Specification: PR and CI-Status Tooling

**Feature Branch**: `002-pr-ci-tooling`

**Created**: 2026-11-22

**Status**: Draft

**Input**: User description: "Feature 002: PR and CI-status tooling for BELAY on Forgejo. Source of truth: docs/superpowers/specs/2026-11-22-speckit-forgejo-parity-design.md, section 'Feature 002', plus the user's direction to reuse MovieCollectionManager's implementation as much as possible, stripping only MCM coupling.

Scope:
- a CI-status tool (status / watch / failure / durations, selected by commit, PR, branch or run; status exits 0 only when the commit is mergeable; failure reads BELAY's repo-scoped digest evidence);
- a PR tool (open, refusing AGit heads; merge only on a matching head, green CI and a mergeable PR, then delete the branch; dispatch a workflow);
- a shared forge-credential module deriving the forge and repo from origin and using the git credential for repository writes (user-approved 2026-11-22);
- argument parsing via the existing argv contract;
- tokens never in argv or logs;
- the tasks-template override's 'Open the PR' task names these commands;
- a runbook;
- tests with a stubbed network.

Out of scope: backlog / taskstoissues (feature 003), MCM's other guardrail checks (issue #1). Done when this feature's own PR is opened and merged with these tools after the CI-status tool reports green."

## User Scenarios & Testing *(mandatory)*

The people served are BELAY's maintainer and the AI coding agents working in the repository. Today an agent can't open a PR, tell whether CI passed, or merge without the maintainer's browser. On feature 001 that meant hand-written API calls, and a 36-minute wait that nobody could see the reason for. This feature makes the whole loop, from push to PR to green to merge, runnable from a terminal, with the same safety checks every time.

### User Story 1 - Know whether a change can merge (Priority: P1) 🎯 MVP

The maintainer or an agent asks, about a commit, a pull request, a branch or a CI run: can this merge? Every required check is evaluated. They get one answer with an exit status they can script against:
- mergeable;
- a required check failed;
- still waiting;
- the question itself was bad.

They can also wait until there's an answer.

**Why this priority**: Every other story depends on knowing CI's verdict without a browser. Merging safely needs it, and so does knowing when to read a failure.

**Independent Test**: Against a commit whose guardrails passed, the tool reports mergeable and exits 0. Against a commit with a failed run, it exits 1 and names the failed check. Against a commit still running, it exits 3. With no target, it exits 2.

**Acceptance Scenarios**:

1. **Given** a commit whose required checks all passed, **When** status is asked for it, **Then** it reports mergeable and exits 0.
2. **Given** a commit with a failed required check, **When** status is asked, **Then** it names the check and exits 1.
3. **Given** a commit whose required checks haven't all reported, **When** status is asked, **Then** it reports what it's waiting for and exits 3. It never reports that as a failure.
4. **Given** a pull request number, a branch name or a CI run id instead of a commit, **When** status is asked, **Then** it evaluates the commit that target points at.
5. **Given** a run still in progress, **When** the user waits on it with a time limit, **Then** it returns as soon as the verdict is known, or exits 3 at the time limit.
6. **Given** a missing or unusable read credential, **When** any query runs, **Then** it exits 2 with a message naming the credential and the scope it needs, and never prints the credential.

---

### User Story 2 - Open a pull request without the web UI (Priority: P1)

From a pushed branch, the maintainer or an agent opens a pull request against `main`, with a title and a body taken from a file. They get the PR number and link back.

**Why this priority**: Opening the PR is the first step of every feature's close-out, and today it needs a browser.

**Independent Test**: Push a scratch branch and open a PR from it. The tool prints the number and link, and the PR exists on the forge with that title and body.

**Acceptance Scenarios**:

1. **Given** a pushed branch, **When** a PR is opened with a title and a body file, **Then** the PR exists against `main` (or the named base), and its number and link are printed.
2. **Given** a head given as a `refs/…` path (an AGit-style head, whose runs get no secrets), **When** opening is attempted, **Then** it is refused with an explanation, and nothing is created.
3. **Given** a body file that doesn't exist, **When** opening is attempted, **Then** it exits 2 before contacting the forge.
4. **Given** the forge rejects the request, for example because the credential lacks permission, **When** opening is attempted, **Then** it exits 1 with the forge's reason, and never prints the credential.

---

### User Story 3 - Merge only what was checked (Priority: P1)

The maintainer or an agent merges a pull request, stating which head commit they expect. The merge only happens when:
- the PR's head is exactly that commit;
- CI reports it mergeable (User Story 1);
- the forge reports the PR mergeable.

The branch is deleted afterwards, and the merge commit is printed.

**Why this priority**: This is the step that protects `main`. Merging a head nobody checked, or a red one, is the failure the whole guardrails effort exists to prevent.

**Independent Test**: Try to merge with a stale expected head. It's refused with nothing merged. Merge with the correct head after a green run. It merges, the branch is gone, and the merge commit is printed.

**Acceptance Scenarios**:

1. **Given** a PR whose head differs from the expected head, **When** merge is attempted, **Then** it is refused, naming both commits, and nothing is merged.
2. **Given** the expected head, but CI not yet mergeable (failed or waiting), **When** merge is attempted, **Then** it is refused with the CI verdict, and nothing is merged.
3. **Given** the expected head and green CI, but the forge reports the PR not mergeable (a conflict, or an outdated branch), **When** merge is attempted, **Then** it is refused with the forge's reason.
4. **Given** all three conditions hold, **When** merge is attempted, **Then** the PR merges at exactly that head, the branch is deleted, and the merge commit is printed.
5. **Given** an expected head that isn't a full commit id, **When** merge is attempted, **Then** it exits 2 before contacting the forge.

---

### User Story 4 - Read why CI failed (Priority: P2)

For a failed commit, PR, branch or run, the maintainer or an agent reads the failure evidence the guardrails digest saved: the failing step, its output, and what wasn't collected. They can read the summary, or the full bundle.

**Why this priority**: The PR comment from feature 001 shows a summary. Diagnosing a failure properly needs the full evidence, which today can only be fetched with hand-written requests.

**Independent Test**: Against a run that failed and published a digest, the tool prints the failing step and its output from the stored evidence. Against a passing run, it says there is no failure evidence.

**Acceptance Scenarios**:

1. **Given** a failed run with a published evidence bundle, **When** failure evidence is asked for, **Then** the failing step, its output and the "not collected" notes are printed. With the full option, the whole bundle is printed.
2. **Given** a passing run, **When** failure evidence is asked for, **Then** it says plainly that nothing failed and exits 0. A run that did fail exits 1 with its evidence, the same meaning `status` gives exit 1. A failed run with no bundle says that no bundle was published.
3. **Given** evidence from another repository under the same owner, **When** BELAY's failure evidence is asked for, **Then** only BELAY's repository-scoped evidence is read.

---

### User Story 5 - Step timings and manual runs (Priority: P3)

The maintainer sees how long each CI step has taken across recent runs. They can also start a workflow by hand on a branch that has no pull request.

**Why this priority**: These are useful but rare. Timings inform step time limits, and dispatch checks a branch without a PR.

**Independent Test**: The durations view lists per-step timings from recent bundles. Dispatching guardrails on a branch starts a run for that branch.

**Acceptance Scenarios**:

1. **Given** recent runs that recorded step durations, **When** durations are asked for, **Then** per-step timings are listed, optionally for one job.
2. **Given** a workflow file and a branch, **When** dispatch is requested with optional inputs, **Then** a run starts on that branch. The tool also says that a dispatched run posts no commit status.

---

### User Story 6 - The workflow points at the tools (Priority: P2)

Every future feature's task list ends with an "Open the PR" task that names these commands. The runbook explains them. Whoever closes out a feature therefore uses the checked path, not hand-written API calls.

**Why this priority**: Tools nobody is pointed at don't get used. Feature 001 shows the hand-written alternative is slower and easy to get wrong.

**Independent Test**: The next task list generated with `/speckit-tasks` ends with an "Open the PR" task naming the open, status and merge commands. The Spec Kit gate still passes.

**Acceptance Scenarios**:

1. **Given** the tasks-template override, **When** a task list is generated, **Then** its "Open the PR" task names the commands to open the PR, check CI, and merge with an expected head.
2. **Given** that edit to the override, **When** the Spec Kit gate runs, **Then** it passes with the fork point unchanged.
3. **Given** the CI runbook, **When** a reader looks up how to open, check and merge, **Then** each command, its exit codes and its credential are documented.

### Edge Cases

- **A branch that is behind `main`.** The forge reports the PR not mergeable, because the protection rule blocks outdated branches. The merge is refused with that reason.
- **Several runs for one commit** (a re-run, or a push and a PR event). Status evaluates the latest result of each required check.
- **A forge request that hangs.** Every request has a time limit and fails with a transport error, never a silent wait.
- **Paginated results.** Lists longer than one page are followed to the end. Totals come from the forge's count header, not from one page.
- **An origin that isn't an HTTP(S) URL.** The credential module refuses it with an explanation, and never guesses a scheme or host.
- **An empty password from the credential helper.** It fails at once, naming what was asked for, instead of becoming a 401 later.
- **A required check missing from protection.** Status evaluates the checks branch protection actually requires, read from the forge.

## Requirements *(mandatory)*

### Functional Requirements

**CI status**

- **FR-001**: A CI-status tool MUST answer whether a target can merge. The target is selected by full commit id, PR number, branch name or CI run id, and the verdict is based on every check the branch protection on `main` requires.
- **FR-002**: Its exit status MUST be:
  - 0: mergeable;
  - 1: a required check failed;
  - 2: bad arguments or credentials;
  - 3: still waiting, which is never reported as a failure.
- **FR-003**: It MUST offer a "watch" mode that waits, with a time limit, until the verdict is known.
- **FR-004**: It MUST offer a "failure" mode that reads BELAY's repository-scoped evidence bundle (`belay-ci-failures`) for a failed target, as a summary by default or in full on request. It MUST NOT read another repository's evidence.
- **FR-005**: It MUST offer a "durations" mode listing per-step timings from recent evidence, optionally for one job.
- **FR-006**: It MUST read with the read-only credential from the environment (`FORGE_TOKEN`). A missing credential, or one without enough scope, MUST exit 2 with a message naming the scope it needs.

**Pull requests**

- **FR-007**: A PR tool MUST open a pull request from a pushed branch, with a title and a body read from a file, against `main` or a named base. It MUST print the number and link.
- **FR-008**: Opening MUST refuse a head given as a `refs/…` path, and MUST refuse a missing body file before contacting the forge.
- **FR-009**: The PR tool MUST merge only when all three hold: the PR's head equals the expected full commit id; the CI-status tool reports that commit mergeable; and the forge reports the PR mergeable. It MUST merge at exactly that head, delete the branch afterwards, and print the merge commit. Any failed condition MUST refuse the merge with the reason, and nothing changes.
- **FR-010**: The PR tool MUST dispatch a named workflow on a branch, with optional key=value inputs.
- **FR-011**: Its exit status MUST be: 0 done; 1 refused or failed; 2 bad arguments.

**Credentials**

- **FR-012**: One credential module MUST derive the forge's API base, the owner and the repository from the `origin` remote. The scheme and host MUST be taken as written there, never typed.
- **FR-013**: Repository writes (open, merge, dispatch) MUST use the credential the git credential helper returns for origin's scheme and host. This is the user-approved write credential, 2026-11-22.
- **FR-014**: Credentials MUST go only from the environment or the credential helper into request headers. They MUST never appear in arguments, output, logs or files.

**Safety and parsing**

- **FR-015**: Every forge request MUST have a time limit.
- **FR-016**: Every write MUST be checked against the owner and repository derived from origin.
- **FR-017**: All three entry points MUST parse arguments through the repository's shared argument contract: unknown flags exit 2, and `--help` and a bare call print usage and do nothing.

**Workflow integration**

- **FR-018**: The tasks-template override's "Open the PR" task MUST name the open, status (or watch) and merge commands. The override's fork-point header MUST stay unchanged, and the Spec Kit gate MUST pass.
- **FR-019**: The CI runbook MUST document every command, its exit codes, and which credential it uses.

**Reuse and constraints**

- **FR-020**: Reuse MovieCollectionManager's CI-status tool, PR tool and credential module as much as possible, with their tests. Change them only to remove MovieCollectionManager coupling: MCM's deploy pipeline (dispatched deploy rows, the deploy-failed exit code), MCM names, labels, item and feature numbers, and MCM-specific credential variable names.
- **FR-021**: The tools MUST be checked by tests that never use the network, run under the existing script-test target, with a stubbed forge. Each tool's selftest MUST run under the existing lint target.

### Key Entities

- **Target:** what a question is about. That's a commit, a PR (its head commit), a branch (its tip) or a CI run (the commit it ran for).
- **Verdict:** mergeable, failed (with the failing required checks) or waiting (with the checks not yet reported).
- **Required check:** a status context that branch protection on `main` requires. Today that's `guardrails / guardrails (pull_request)`.
- **Evidence bundle:** a failed job's stored digest evidence in `belay-ci-failures` (feature 001).
- **Write credential:** the git credential for origin's forge, used only for open, merge and dispatch.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: This feature's own PR is opened, checked and merged entirely with these tools, with no browser and no hand-written requests.
- **SC-002**: The CI-status verdict for a commit matches what the forge's PR page shows, for passing, failing and waiting commits.
- **SC-003**: A merge with a wrong expected head, a red or waiting CI, or an unmergeable PR is refused 100% of the time, and nothing changes on the forge.
- **SC-004**: No credential value appears in any output, error message or log produced by the tools. This is verified by tests that plant a credential and search the output for it.
- **SC-005**: A failed run's evidence can be read in one command, in under 10 seconds on the homelab network.
- **SC-006**: The next generated task list's "Open the PR" task names the tools, and the Spec Kit gate passes.

## Assumptions

- **The forge, owner and repository** come from `origin` (`http://<tailnet-host>:3000`, `jumbleknot/BELAY`). BELAY's branch protection requires only the guardrails context.
- **`FORGE_TOKEN`** (read-only) is set on the maintainer's machine. Using the git credential for repository writes was approved by the user on 2026-11-22. `FORGE_ISSUE_TOKEN` isn't needed here; it's for feature 003.
- **MovieCollectionManager's deploy-specific behaviour is removed.** BELAY has no deploys. That covers dispatched-deploy rows, the "deploy failed" exit code, and the waits on advisory deploy checks.
- **The digest's last line refers to this tool.** Feature 001's digest already prints `node scripts/ci-status.mjs failure --run …`, so this feature makes that line true.
- **First feature closed out by its own tools.** This feature's "Open the PR" task uses the new tools, so feature 002 is the first feature closed out without hand-made requests.
