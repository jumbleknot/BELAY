# Feature Specification: Guardrails CI

**Feature Branch**: `001-guardrails-ci`

**Created**: 2026-11-22

**Status**: Draft

**Input**: User description: "Feature 001: guardrails CI for BELAY on Forgejo Actions. Source of truth: docs/superpowers/specs/2026-11-22-speckit-forgejo-parity-design.md, section "Feature 001: guardrails CI" plus its Constraints and "Decided by the user". Scope: a guardrails workflow triggered on pull requests, pushes to main and manual dispatch with per-ref concurrency; it runs the Spec Kit override gate selftest and scan and every script test; every job ends with a failure-digest step ported from MovieCollectionManager with its coupling stripped; a ported digest-coverage gate proves every job has that step; a CI runbook; AGENTS.md and the Spec Kit runbook updated from 'run the gate by hand' to 'CI runs it'. Out of scope: MCM's other guardrail checks (issue #1), PR/CI-status tooling (feature 002), backlog (feature 003). Done when: the PR shows a green guardrails run on ci-homelab, a failure digest has been seen publishing with the secret, and branch protection is on."

## User Scenarios & Testing *(mandatory)*

The people served here are BELAY's maintainer and the AI coding agents working in the repository. Both need to know, without asking anyone and without pasting logs, whether a change keeps BELAY's guardrails intact. Every repo that consumes BELAY depends on that.

### User Story 1 - Every change is checked automatically (Priority: P1)

When the maintainer or an agent opens a pull request or pushes to `main`, BELAY's guardrails run without anyone starting them:
- the Spec Kit override gate, in both its selftest and its scan;
- the full suite of repository script tests.

The run reports one pass or fail result on the commit and on the pull request. Today the gate runs only if someone remembers to run it by hand.

**Why this priority**: The gate protects every Spec Kit customisation BELAY has made, and the script tests protect the gate itself. If nothing runs them, an upgrade or careless edit can silently undo the customisations, and the downstream repos inherit the damage. Every other story builds on this one.

**Independent Test**:
1. Open a pull request that changes nothing the gate guards, and see a passing result.
2. Open one that breaks a guarded file (for example, reverts a registered local edit), and see a failing result that names the cause.

**Acceptance Scenarios**:

1. **Given** a pull request whose changes keep every guardrail intact, **When** it is opened or updated, **Then** a guardrails run starts automatically on BELAY's runner and reports success on the pull request.
2. **Given** a pull request that reverts a registered Spec Kit local edit, **When** the run executes, **Then** it reports failure, and the job output names the failure code and the file.
3. **Given** a pull request that breaks one script test, **When** the run executes, **Then** it reports failure, and the output names the failing test.
4. **Given** a push to `main`, **When** it lands, **Then** one guardrails run executes for that commit.
5. **Given** a push to a branch with an open pull request, **When** it lands, **Then** exactly one run executes, not two.
6. **Given** a run is still in progress for a pull request, **When** a newer commit is pushed to the same branch, **Then** the older run is cancelled and only the newest is reported.
7. **Given** the maintainer wants to re-check `main` without a new commit, **When** they start the workflow by hand, **Then** it runs against the chosen ref.

---

### User Story 2 - A failure explains itself (Priority: P2)

When a guardrails job fails, the maintainer or an agent can see what failed, in which step, and the tail of that step's output. They see it on the pull request, or on the commit for pushes to `main`, without opening the runner's log viewer or pasting logs into a conversation. Fuller evidence is kept where it can be fetched later.

**Why this priority**: Agents cannot read Forgejo's job logs through the API. Without a digest, every CI failure needs a human to copy the log by hand. MovieCollectionManager solved this, and BELAY should start with it rather than bolting it on later.

**Independent Test**: Make a job fail deliberately on a pull request. Confirm that:
- a single digest comment appears on the PR, naming the job, the failing step and the redacted tail of its output;
- a second failure of the same job updates that comment rather than adding another;
- when the job passes again, the digest reflects that.

**Acceptance Scenarios**:

1. **Given** a guardrails job fails on a pull request, **When** the job ends, **Then** a digest comment for that job appears on the pull request with the failing step and the tail of its output.
2. **Given** a digest comment already exists for that job, **When** the job fails again on a later run, **Then** the same comment is updated, with no duplicate.
3. **Given** a guardrails job fails on a push to `main`, **When** the job ends, **Then** the digest is attached to that commit as a status the maintainer can read.
4. **Given** the output contains something shaped like a credential, or the forge's real host name, **When** the digest is published, **Then** that text is redacted. If redaction cannot be confirmed, the excerpt is withheld entirely.
5. **Given** a run was cancelled because a newer commit superseded it, **When** its jobs end, **Then** no digest is published for that run.
6. **Given** the digest step itself fails (network error, missing permission, bad token), **When** the job ends, **Then** the job's pass or fail result is exactly what it would have been without the digest step.
7. **Given** the purpose-scoped digest token is not available to the run, **When** a job fails, **Then** the digest falls back to the run's own token. If that also can't publish, the digest is printed into the job log instead, with a note that it is the degraded channel.

---

### User Story 3 - Digest coverage cannot quietly erode (Priority: P3)

When someone adds a new job to a workflow, they cannot forget the digest step without the guardrails failing. The rule is:
- every job in every workflow carries the digest step, guarded so it always runs and can never change the job's outcome;
- a job may opt out only with a written reason in the workflow file.

**Why this priority**: The digest is only useful if every job has it. One job without it means its failures need a human to paste logs again, and nobody notices.

**Independent Test**: Add a job without a digest step on a branch, and confirm the guardrails run fails naming that job. Then add the opt-out marker with a reason, and confirm it passes.

**Acceptance Scenarios**:

1. **Given** every job in every workflow has a correctly guarded digest step, **When** the coverage check runs, **Then** it passes.
2. **Given** a job with no digest step, **When** the coverage check runs, **Then** it fails, naming the workflow file and the job.
3. **Given** a job whose digest step can change the job's outcome, because the always-run guard or the continue-on-error guard is missing, **When** the coverage check runs, **Then** it fails, naming what is missing.
4. **Given** a job whose digest step doesn't receive the job's status, **When** the coverage check runs, **Then** it fails.
5. **Given** a job marked exempt with a non-empty written reason, **When** the coverage check runs, **Then** it passes that job. **Given** the marker has an empty reason, **Then** it fails.
6. **Given** the coverage check's own selftest is run, **When** it executes, **Then** it proves each failure above is detected.

---

### User Story 4 - `main` only accepts checked changes (Priority: P2)

Once guardrails have passed for the first time, `main` accepts changes only through pull requests whose guardrails run passed. The maintainer has one written procedure to switch this on and to know which check to require.

**Why this priority**: Without protection, a direct push or a hand-merge skips everything above. It ranks below automatic checking because it depends on a first passing run existing.

**Independent Test**: With protection on, try to push directly to `main` and confirm the forge refuses. Open a pull request with failing guardrails and confirm it cannot be merged.

**Acceptance Scenarios**:

1. **Given** the CI runbook, **When** the maintainer follows its branch-protection section after the first passing run, **Then** `main` refuses direct pushes and requires the guardrails check before merging.
2. **Given** protection is on, **When** a pull request's guardrails run fails, **Then** the forge does not allow it to be merged.
3. **Given** the runbook, **When** the maintainer looks up which status to require, **Then** it gives the exact status name the guardrails run reports.

---

### Edge Cases

- **The runner has no matching label, or is offline.** The run stays queued instead of passing. The runbook says how to check the runner and its labels.
- **The runner image's Node is older than BELAY needs.** The workflow provisions the required Node itself and doesn't rely on whatever the image ships.
- **A pull request from a ref that gets no secrets** (for example, a push to an AGit ref). The digest falls back to the run token or the job log, as in US2 scenario 7, and never fails the job.
- **A newly added test file.** It runs without anyone editing the workflow, because the suite selects every script test file, not a fixed list.
- **A pull request changes only documentation.** Guardrails still run, because the required check must report on every pull request or protection would block it.
- **Text in job output that imitates a digest comment's identifying marker.** It cannot hijack or duplicate another job's digest comment.
- **A workflow file the coverage check cannot read.** The check fails with a "cannot parse" error, distinct from "job lacks digest". It never passes silently.

## Requirements *(mandatory)*

### Functional Requirements

**Running the guardrails**

- **FR-001**: The repository MUST have a guardrails workflow that runs on every pull request, on every push to `main`, and on manual dispatch against a chosen ref.
- **FR-002**: The workflow MUST NOT run twice for one push to a branch with an open pull request. A newer run for the same ref MUST cancel an older one still in progress.
- **FR-003**: The workflow MUST run the Spec Kit override gate's selftest, then its scan. Either failing MUST fail the run.
- **FR-004**: The workflow MUST run every script test file in the repository's script tests folder, selected by pattern rather than a fixed list. Any failing test MUST fail the run.
- **FR-005**: The workflow MUST provision the Node version BELAY requires (24 or later) itself, instead of relying on the runner image's default.
- **FR-006**: The workflow MUST run on BELAY's registered runner, `ci-homelab`.
- **FR-007**: The workflow MUST run the digest-coverage check (FR-016), both its selftest and its scan.

**Failure digest**

- **FR-008**: Every job MUST end with a failure-digest step that always runs, whether the job passed or failed, and that can never change the job's outcome.
- **FR-009**: The digest step's outcome MUST NOT affect the job's result. Every error inside it MUST be reported to the job log and then swallowed.
- **FR-010**: On a pull request, a failing job's digest MUST be posted as a pull-request comment that names the job, the failing step and the tail of that step's output. Each job MUST keep one comment, updated on later runs, never duplicated. The comment MUST be identified by a marker at the start of its body, and output text MUST NOT be able to forge that marker.
- **FR-011**: Outside a pull request, the digest MUST be recorded against the commit as a commit status.
- **FR-012**: Fuller evidence (complete step output, not just the tail) MUST be stored in the forge's package registry, and the digest MUST link to it.
- **FR-013**: Everything published MUST pass through a fail-closed redactor first. It MUST rewrite every occurrence of credential-shaped strings and of the forge's real host name, not just the first, and then re-check its own output. If anything credential-shaped survives, the excerpt MUST be withheld entirely.
- **FR-014**: Credential order:
  1. publish with the purpose-scoped `CI_DIGEST_TOKEN` secret;
  2. if that is absent or empty, publish with the run's automatic token;
  3. if neither can publish, print the digest into the job log and mark it as the degraded channel.

  A job in a cancelled run MUST publish nothing. Tokens MUST be read only from the environment, never from arguments.
- **FR-015**: Every guardrails step whose output a digest may quote MUST have that output captured to a per-step log. Capturing MUST NOT change the step's exit status: a failing step must still fail.

**Coverage check**

- **FR-016**: A digest-coverage check MUST fail when any job, in any workflow file in the repository's Forgejo workflows folder, lacks a correctly guarded digest step. Correctly guarded means: always runs, cannot change the outcome, and receives the job's status. The only exception is a job carrying an opt-out marker with a non-empty written reason. A workflow file it cannot read MUST fail as a parse error. It MUST provide a selftest that proves each detection.

**Documentation**

- **FR-017**: A CI runbook MUST document:
  - what the guardrails run and how to read a failure digest;
  - the runner and its required label;
  - the `CI_DIGEST_TOKEN` secret and its required scopes (`write:issue`, `write:package`, `read:repository`);
  - the step-by-step branch-protection setup for `main`: refuse direct pushes, and require the guardrails check, with its exact status name.
- **FR-018**: AGENTS.md and the Spec Kit runbook MUST say that CI now runs the gate, replacing "run it by hand". Running it locally before committing remains recommended.

**Constraints**

**JavaScript workspace**

- **FR-019**: BELAY MUST become a pnpm and Nx workspace, set up the way MovieCollectionManager's is.
  - **Root manifest:**
    - pins pnpm through `packageManager`, at MovieCollectionManager's version;
    - declares a Node engine floor that matches the constitution;
    - refuses installs by any other package manager;
    - carries no MovieCollectionManager app scripts.
  - **Nx configuration:** pinned to MovieCollectionManager's Nx version. It starts with no plugins, because MovieCollectionManager's Rust, Expo and Playwright plugins serve apps BELAY doesn't have. Plugins are added when a project needs one.
  - **Workspace file:** covers `packages/*`. It includes MovieCollectionManager's install-script allow-list, with each entry decided explicitly, and its supply-chain settings, carrying only the entries that apply to BELAY's dependencies.
  - **Lock file:** committed.
  - **`yaml`:** a development dependency, at MovieCollectionManager's version range.
  - **Ignore rules:** installed dependencies and Nx's local cache are ignored by Git.
- **FR-020**: CI MUST install pnpm at the version the root manifest pins, using a ported version of MovieCollectionManager's install script that fails if the installed version doesn't match. It MUST then install dependencies from the lock file without modifying it, before any step that needs them.

**Reuse**

- **FR-021**: Reuse MovieCollectionManager's existing implementation as much as possible:
  - **What to port:** its secret-scan rules, its redactor, its failure-digest writer, its digest-coverage check (including its use of the `yaml` package), its per-step log capture and its pnpm install script.
  - **Change as little as possible:** keep their behaviour, rules and tests. Change them only to remove MovieCollectionManager coupling.

  The secret-scan rules MUST be ported as MovieCollectionManager has them, with no rule weakened. The only rule left out is one that matches only MovieCollectionManager's own generated credentials, because it can never match in BELAY.
- **FR-022**: New and ported scripts MUST use only Node built-ins and the workspace's declared dependencies. MovieCollectionManager-specific names, labels, feature numbers and app references MUST NOT appear in anything ported.
- **FR-023**: Each ported script MUST bring its MovieCollectionManager tests, adapted to BELAY, and those tests MUST run under FR-004.
- **FR-024**: AGENTS.md MUST record the toolchain decision as a repo-wide convention:
  - the package manager, the workspace tool, and how to install;
  - how to run the script tests and the gates locally;
  - that the Spec Kit gate itself still runs without an install.

  It MUST replace the "no toolchains chosen yet" wording.

### Key Entities

- **Guardrails run**: one execution of the workflow for a commit. It has a single pass or fail status, which `main`'s protection requires.
- **Failure digest**: the per-job summary of a failure (job, failing step, redacted output tail, link to full evidence), published on the pull request or the commit.
- **Evidence bundle**: the fuller redacted step output for a failed job, stored in the package registry and linked from the digest.
- **Digest opt-out marker**: a written, reasoned exemption on a single job. It is the only way a job may lack a digest step.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of pull requests and pushes to `main` get a guardrails result with no manual action. The feature's own pull request shows a passing run on `ci-homelab`.
- **SC-002**: A deliberately broken guarded file, or a deliberately failing test, turns the result red in a single run, and the failure output names the cause.
- **SC-003**: For a failed job, the maintainer or an agent can identify the failing step and see its output tail from the pull request or commit alone, without opening the log viewer. This is shown at least once on the feature's own pull request, with the digest published using `CI_DIGEST_TOKEN`.
- **SC-004**: Retrying a failing job twice leaves exactly one digest comment for that job on the pull request.
- **SC-005**: Breaking the digest step (for example, an invalid token) changes no job's pass or fail result.
- **SC-006**: Adding a job with no digest step turns the result red, naming the job.
- **SC-007**: After the maintainer follows the runbook, a direct push to `main` is refused, and a pull request with a failing guardrails result cannot be merged.
- **SC-008**: No ported file mentions MovieCollectionManager-specific names, labels or feature numbers.

## Assumptions

- `ci-homelab` serves the same kind of job images as MovieCollectionManager's runner and accepts the `ubuntu-latest` label. The first run confirms this. If the label differs, the workflow targets whatever label `ci-homelab` advertises.
- `CI_DIGEST_TOKEN` is already set as a BELAY repository secret with `write:issue`, `write:package` and `read:repository`. No other secrets or repository variables are needed for this feature.
- **The digest publishes the way MovieCollectionManager's does:** a PR comment on pull requests, a commit status otherwise, and fuller evidence in the package registry. This corrects the design document's shorthand "publishes to Forgejo issues". The user's decision was "do it the way MCM does".
- **The redactor reuses the credential detection rules of MovieCollectionManager's secret scanner**, so that scanner and its rules come into BELAY as a library. Running the secret scanner as its own guardrails check is still tracked by issue #1 and is not part of this feature.
- **BELAY adopts pnpm and Nx like MovieCollectionManager.** This is the user's decision, 2026-11-22, and it supersedes the design document's "no `package.json`" constraint. It's part of this feature because CI is its first consumer: the digest-coverage check needs the `yaml` package.
- **The Spec Kit gate's own `extensions.yml` reader stays dependency-free,** so the gate keeps running without an install.
- **No product projects are created in this feature.** The one exception is that the repository scripts get a single workspace project. This is because the constitution requires every test and lint run to go through the workspace tool. The scripts can still be run directly, and the Spec Kit gate still runs without an install.
- **One guardrails job is enough today.** The gate and the script tests are quick and share one setup. More jobs come with issue #1.
- The maintainer enables branch protection by hand in the forge's settings after the first passing run. No script holds an admin-scoped token.
- This feature's own "Open the PR" step is done by hand: the PR and merge tooling is feature 002.
