# Feature Specification: SAST and SCA gate, stage 1 (Semgrep and pnpm audit)

**Feature Branch**: `006-sast-stage1`

**Created**: 2026-11-23

**Status**: Draft

**Input**: User description: "Approve uv on the runner, start item #37 stage 1."

## Context

Backlog item #37 ports MovieCollectionManager's (MCM) static security gate in stages. The
maintainer approved **uv on the CI runner** on 2026-11-23, which unblocks stage 1: code-pattern
analysis (SAST) and the JavaScript dependency audit (SCA). Rust and Python dependency audits follow
with the first Rust crate and the first Python project (stages 2 and 3). A baked scanner image
follows once installs dominate the job's run time (stage 4).

This spec takes MCM's feature 033 spec (`specs/033-sast-semgrep/spec.md` in MCM) as its baseline.
It keeps 033's requirements and clarifications, and narrows them to what stage 1 delivers. Where a
requirement is deferred to a later stage, it says so.

## Clarifications

Carried from MCM 033 (session 2026-07-10), unchanged:
- **The allowlist is the baseline.** A High/Critical finding fails the build unless it is
  allowlisted. There is no stored prior-scan comparison. On first landing, the allowlist is seeded
  with every finding then present.
- **The secret-scan gate stays the single owner of credential detection.** The code scanner's
  secret rules stay disabled.
- **SCA runs in full on every run** (a new advisory can hit an unchanged dependency). SAST runs full
  on push and changed-files on pull requests.
- **High and Critical block; Medium and Low warn.**
- **SAST covers the whole first-party tree**, with no directory carve-out.
- **Custom rules declare their own severity by security impact.**
- **Dependency scope gates SCA:** a High/Critical advisory in a runtime dependency blocks; the same
  advisory in a dev/test/build-only dependency is a warning.

Session 2026-11-23 (BELAY):
- **Q: Which scanners in stage 1?** → Semgrep (SAST) and `pnpm audit` (SCA). cargo-audit and
  pip-audit are stage 2 and 3. The set of enabled scanners is configuration, so adding one later
  does not restructure the job.
- **Q: Where does it run?** → A separate `sast` job in the `guardrails` workflow, on the `belay`
  runner, so `guardrails / guardrails` keeps its run time. Making `guardrails / sast` a required
  status is a branch-protection change the maintainer makes after its first green run.
- **Q: Custom rules?** → Port the MCM rules whose invariant BELAY's constitution also states, with
  MCM-specific paths and API names replaced. Drop the rules bound to MCM-only APIs until BELAY has
  that surface.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Run the static security scan locally, with one report (Priority: P1)

A contributor runs one documented command in the dev container. It scans the tree for insecure code
patterns and audits the JavaScript dependencies, then writes one consolidated report with every
finding on one Critical/High/Medium/Low scale, plus a readable summary. No running service is
needed.

**Why this priority**: the same command is what CI runs, so a contributor can see a failure before
pushing.

**Independent Test**: run the command on the tree. It exits 0 and writes the machine-readable
report and the summary. Run it with a scanner's toolchain made unavailable: it fails with a message
naming the scanner, rather than reporting clean.

**Acceptance Scenarios**:

1. **Given** the dev container, **When** the contributor runs the scan command, **Then** a findings
   report and a summary are written, each finding carries a scanner, a rule or advisory id, a
   location and a normalized severity.
2. **Given** an enabled scanner cannot run (missing toolchain, unreachable rule or advisory source),
   **When** the scan runs, **Then** it fails naming that scanner. It never reports a clean result
   for a surface it did not scan.
3. **Given** scanned source or scanner output that incidentally contains a credential, **When** the
   report is written, **Then** the credential does not appear in any report or log.

---

### User Story 2 - New High/Critical findings block a pull request (Priority: P1)

A pull request that introduces a High or Critical insecure pattern, or a runtime dependency with a
High or Critical advisory, fails the `sast` job. The failure names the finding. Medium and Low
findings appear as warnings and do not fail it.

**Why this priority**: this is the gate itself.

**Independent Test**: plant a High-severity pattern in a scratch branch, and the job fails naming
it. Remove it, and the job passes.

**Acceptance Scenarios**:

1. **Given** a change that introduces an un-allowlisted High/Critical finding, **When** the gate
   runs, **Then** it exits non-zero and names the finding.
2. **Given** only Medium/Low findings, **When** the gate runs, **Then** it passes and lists them as
   warnings.
3. **Given** a High advisory in a dev-only dependency, **When** the gate runs, **Then** it is a
   warning; the same advisory in a runtime dependency blocks.
4. **Given** a pull request that changes no dependency manifest, **When** the job runs, **Then** the
   dependency audit still runs in full.
5. **Given** any run, **When** it finishes, **Then** the reports are available from the run, and a
   failure is summarised by the failure digest.

---

### User Story 3 - Triaged findings are suppressed without weakening the gate (Priority: P2)

A finding triaged as a false positive or an accepted risk is added to a version-controlled
allowlist with a justification, an author and an optional expiry. It stops blocking, and stays
visible in the report. When its expiry passes, it blocks again.

**Why this priority**: without it, one false positive forces disabling the gate.

**Independent Test**: allowlist one finding, and the gate passes for it while an unrelated new
High still fails. Set the entry's expiry in the past, and the finding blocks again.

**Acceptance Scenarios**:

1. **Given** an allowlisted High finding, **When** the gate runs, **Then** it passes for that finding
   and the finding is still in the report.
2. **Given** an entry with a blank justification, a blank author or an invalid pattern, **When** the
   gate runs, **Then** it errors rather than suppressing anything.
3. **Given** an entry whose expiry has passed, **When** the gate runs, **Then** the finding blocks
   again; an entry near expiry is warned about.
4. **Given** the feature lands, **When** `main` runs the gate, **Then** it passes, because the
   allowlist is seeded with every finding present at landing.

---

### User Story 4 - Project invariants are enforced as custom rules, with proof (Priority: P2)

Security invariants the constitution states (no tokens or credentials in logs; no `curl … | sh` in a
workflow without a pinned, verified source) are encoded as custom code rules. Each ships with
fixtures that show it fires on the insecure form and stays silent on the safe one, and those fixture
tests run before the scan.

**Why this priority**: community rules do not know BELAY's invariants.

**Independent Test**: run the rule tests. Each rule passes its fixtures. Remove a rule's fixture:
the rule test fails, rather than silently skipping.

**Acceptance Scenarios**:

1. **Given** each custom rule, **When** its fixture tests run, **Then** it flags the insecure form
   and not the safe one.
2. **Given** a custom rule with no fixture, **When** the rule tests run, **Then** they fail.

---

### Edge Cases

- A pull request that changes no scannable file still runs the dependency audit, and the SAST pass
  reports that it scanned zero changed files.
- The Semgrep rule registry or the npm advisory endpoint is briefly unreachable: a transient failure
  is retried a bounded number of times; a persistent one fails the job naming the scanner.
- A scanner reports a native severity the mapping does not know: the scan fails rather than
  guessing.
- The gate's own selftest runs before the real scan, so a broken gate cannot pass vacuously.
- A scanner the configuration does not enable (cargo-audit, pip-audit in stage 1) is reported as
  "not enabled", never as "clean".

## Requirements *(mandatory)*

### Functional Requirements

Numbering follows MCM 033, so the two specs can be read side by side.

- **FR-001**: One documented command MUST run the static analysis locally, with no running service.
- **FR-002**: The same analysis MUST run as a CI job on every pull request and every push to `main`.
- **FR-003**: Code-pattern analysis MUST cover the whole first-party tree (scripts, workflows,
  Dockerfiles, and every application surface as it arrives), managing noise with curated rulesets
  and the allowlist, not by excluding paths.
- **FR-004**: Code-pattern analysis MUST enforce BELAY's stated invariants as custom rules, each
  declaring a severity by impact: credential/token logging High; workflow `curl … | sh` High.
- **FR-005** *(narrowed)*: Dependency analysis MUST audit the JavaScript workspace's locked
  dependencies against public advisories. Rust (stage 2) and Python (stage 3) are deferred, and the
  scan reports them as not enabled.
- **FR-006**: Credential detection MUST stay with the existing secret-scan gate; the code scanner's
  secret rules stay disabled.
- **FR-007**: Scan definitions, custom rules, the severity mapping, the enabled-scanner list and the
  allowlist MUST be version-controlled configuration.
- **FR-008**: Results MUST be consolidated into one machine-readable report and one summary,
  available from the CI run.
- **FR-009**: Every finding MUST carry a normalized severity from a documented mapping.
- **FR-010**: The gate MUST fail on an un-allowlisted High/Critical blocking finding, and MUST NOT
  fail on Medium/Low.
- **FR-011**: The allowlist MUST key entries by scanner, rule/advisory id and location pattern, with
  a justification, an author and an optional expiry; it suppresses the gate only.
- **FR-012**: On landing, the allowlist MUST be seeded with every finding then present.
- **FR-013**: Dependency analysis MUST run in full on every run.
- **FR-014**: Code-pattern analysis MUST run full on push and MAY be changed-files on pull requests.
- **FR-015**: An enabled scanner that cannot run MUST fail the scan with an actionable message.
- **FR-016**: Everything MUST be self-hosted and keyless.
- **FR-017**: The job MUST need no new secret.
- **FR-018**: Reports and logs MUST NOT leak credentials found incidentally.
- **FR-019**: Each custom rule MUST ship insecure/safe fixtures, run as part of the job.
- **FR-020**: The gate MUST have a selftest needing no live scan.
- **FR-021**: SCA findings MUST be gated by dependency scope (runtime blocks; dev/test/build warns).
- **FR-022** *(BELAY)*: The enabled scanners MUST be a configuration list, so stages 2–3 add a list
  entry and a toolchain step, not a restructure.
- **FR-023** *(BELAY)*: The uv and Semgrep versions MUST be pinned in the repository, and the
  installer MUST run from a pinned version.

### Key Entities

As MCM 033: **Scan Definition**, **Code Scanner**, **Dependency Scanner**, **Custom Rule**,
**Finding**, **Severity Mapping**, **Finding Allowlist**, **Scan Report**. BELAY adds
**Enabled-scanner list**: the configured subset of scanners a run executes.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: One documented command produces one consolidated report covering code findings and
  JavaScript dependency findings, with no running service.
- **SC-002**: A pull request introducing a High/Critical code pattern is blocked, and the finding is
  in the run's report.
- **SC-004**: A pull request with no new High/Critical finding passes, with its report available.
- **SC-005**: Allowlisting one finding lets it pass while an unrelated new High still fails, in one
  demonstration.
- **SC-006**: `main` passes the gate immediately after landing, with no gate disabled.
- **SC-007**: Every custom rule passes its fixture tests.
- **SC-008**: No external SaaS account or new secret is involved.
- **SC-009**: No credential appears in any committed file, report or log this feature produces.
- **SC-012** *(BELAY)*: `guardrails / guardrails`' own run time does not grow; the `sast` job runs
  alongside it.

SC-003, SC-010 and SC-011 (dependency demonstrations) are verified by the gate's unit tests with
fixture reports in stage 1, because BELAY's workspace has two dependencies and no known advisory.

## Out of scope

- cargo-audit (stage 2), pip-audit (stage 3), the baked scanner image (stage 4).
- DAST, license scanning, and automatic dependency-bump pull requests.
- Making `guardrails / sast` a required status: a branch-protection change for the maintainer.

## Assumptions

- The maintainer approved uv on the runner (2026-11-23). uv is installed per run from a pinned
  version; Semgrep runs through `uvx` at a pinned version.
- The `belay` runner's job container has outbound access to astral.sh, PyPI, semgrep.dev and the
  npm registry. The dev container's egress allowlist already carries all four.
- `actions/upload-artifact` is mirrored on the forge (MCM's `sast` job uses it at a pinned SHA).
