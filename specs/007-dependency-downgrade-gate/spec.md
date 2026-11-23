# Feature Specification: SAST dependency-downgrade gate

**Feature Branch**: `007-dependency-downgrade-gate`

**Created**: 2026-11-23

**Status**: Draft

**Input**: Backlog item #43: "port the dependency-downgrade gate (a PR must not move a package INTO an
advisory, in any scope)".

## Context

Feature 006 (SAST stage 1, item #37) blocks a High/Critical advisory only in a **runtime**
dependency. A dev-only advisory is a warning, by policy: only runtime dependencies reach a deployed
surface. That leaves one gap. A dependency bump can re-resolve some *other* package **into** a known
advisory, and the gate stays green because the package is dev-scope. The dev tree still runs inside
CI jobs that hold tokens.

MovieCollectionManager (MCM) measured exactly this: a build-tool bump pinned a transitive HTTP client
one patch release lower, into ten advisories (two High), all dev-scope, and the gate passed. MCM
closed the gap with `scripts/check-dependency-downgrade.mjs`. This feature ports it, with MCM `main`
at `fc2b953` as the baseline.

This feature does not change the dev-scope policy. It asks a narrower question that has no policy
answer: **did this change make an advisory apply to a package it did not apply to before?**

## Clarifications

Session 2026-11-23 (from item #43):
- **Q: What counts as a regression?** → Per lockfile and per advisory: at the base, the package
  resolved only to versions outside the advisory's vulnerable range; the head resolves a version
  inside that range, and that version is new to the lockfile. A sideways move into a range counts
  as well as a downgrade.
- **Q: What is deliberately not a regression?** → A package that was already exposed at the base (the
  existing gate and allowlist own it), and a package or lockfile that is new in the change (an
  ordinary finding).
- **Q: Where do the advisories come from?** → The pnpm-audit report the scan already writes. No second
  registry call.
- **Q: How is a regression accepted?** → The same allowlist entry, matcher and expiry rule as the main
  gate. Accepting a version is one decision, not two.
- **Q: When does it run?** → On pull requests only, after the main gate. A push has no base to have
  regressed from.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A pull request that moves a package into an advisory is blocked (Priority: P1) 🎯 MVP

A contributor bumps a dependency. Unnoticed, the bump re-resolves another package to a version inside
a known advisory's vulnerable range. The pull request's `sast` job fails and names the package, the
base and head versions, the advisory, its vulnerable range and its fixed range, and the lockfile.

**Why this priority**: this is the gap the feature exists to close.

**Independent Test**: fixture lockfiles and a fixture audit report: a base with a clean version and a
head with an affected one is reported; the reverse is not.

**Acceptance Scenarios**:

1. **Given** a package that resolved only to a clean version at the base, **When** the head resolves
   it to a lower version inside an advisory's range, **Then** the check fails naming it.
2. **Given** a package clean at the base, **When** the head moves it *sideways* into a range (for
   example from 1.x into a vulnerable 2.0.x), **Then** the check fails.
3. **Given** a head that keeps the clean version and adds an affected one beside it (a second
   dependent pins it), **Then** the check fails.
4. **Given** a package inside the advisory's range at the base already, **When** the head changes its
   versions, **Then** the check passes (the main gate and allowlist own it).
5. **Given** a package, or a whole lockfile, that is new in the change, **Then** the check passes.
6. **Given** a regression in a nested workspace's lockfile, **Then** it is reported under the same
   `<workspace>:pkg@version` location the scan uses.

---

### User Story 2 - An accepted regression is recorded once, in the existing allowlist (Priority: P2)

The maintainer decides a regression is acceptable for now. One allowlist entry accepts it in both the
main gate and this check, and its expiry applies in both.

**Independent Test**: an unexpired matching entry suppresses the regression; an expired one does not.

**Acceptance Scenarios**:

1. **Given** an unexpired allowlist entry matching the advisory and location, **Then** the check
   passes and prints the accepted regression.
2. **Given** the same entry, expired, **Then** the check fails.

---

### User Story 3 - The check fails closed (Priority: P1)

The check never reports "no regression" from an input it could not read.

**Acceptance Scenarios**:

1. **Given** a missing audit report, or one that audits no lockfile, **Then** the check exits 1 with
   the reason.
2. **Given** a base lockfile it cannot read (for example an unknown base ref), **Then** it exits 1.
3. **Given** a vulnerable range it cannot parse, or a version it cannot judge, **Then** it exits 1.
4. **Given** an unknown flag or a missing `--base`, **Then** it exits 2 (usage error).

---

### User Story 4 - The check runs on every pull request (Priority: P1)

The `sast` job runs the check on pull requests, after the gate, so a contributor never has to
remember it. A guard test fails if the step is removed, moved before the scan that writes its input,
or loses its pull-request-only condition.

### Edge Cases

- A pnpm 11+ lockfile is two YAML documents; versions in both `packages:` maps are read, and
  `snapshots:` keys (which carry peer suffixes) are not.
- An upgrade from a vulnerable to a clean version leaves no finding in the head report, so nothing
  is reported.
- An advisory range in a form the parser does not understand fails the check rather than passing it.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The check MUST report every (lockfile, advisory, version) where the package was
  resolved at the base, no base version was inside the advisory's vulnerable range, and the head
  resolves a version inside the range that is new to the lockfile.
- **FR-002**: The check MUST judge "clean" by the advisory's vulnerable range, not by version order.
- **FR-003**: The check MUST NOT report a package already exposed at the base, a package new to the
  lockfile, or a lockfile new in the change.
- **FR-004**: The check MUST read the head's advisories from the scan's pnpm-audit native report, and
  make no registry call of its own.
- **FR-005**: The check MUST read base lockfiles from git at the given ref.
- **FR-006**: The check MUST apply the main gate's allowlist with the main gate's matcher and expiry.
- **FR-007**: The check MUST fail closed on a missing or empty report, an unreadable lockfile, and an
  unparseable range or version.
- **FR-008**: The check MUST block in every dependency scope, dev included.
- **FR-009**: The `sast` job MUST run the check on pull requests only, after the gate, through
  `ci-log-step.sh`, against the pull request's base.
- **FR-010**: The check MUST add no npm dependency (moving the lockfile is the very surface it judges).
- **FR-011**: Each failure line MUST name the location, the package, its base versions, the head
  version, the advisory id, severity, vulnerable range, fixed range (when known) and the lockfile,
  and say how to fix it (an override floor or an allowlist entry).

### Key Entities

- **Regression**: a (lockfile, package, head version, advisory) the change newly made applicable.
- **Native report**: `security/sast/reports/pnpm-audit-native.json`, lockfile path → `pnpm audit
  --json` output, written by `sast-scan.mjs`.

## Success Criteria *(mandatory)*

- **SC-001**: The ported test file passes with 0 skipped, covering US1–US3.
- **SC-002**: On a throwaway branch that pins a dev dependency down into a known advisory, the check
  exits 1 and the main gate exits 0.
- **SC-003**: `guardrails-workflow.test.mjs` fails if the step is removed, reordered before the scan,
  or loses its PR-only condition.
- **SC-004**: `scripts:lint` and `scripts:test` pass with 0 skipped; a full scan still finds 0
  blocking findings.

## Assumptions

- BELAY has one tracked pnpm lockfile today (`pnpm-lock.yaml`); the check handles any number.
- The `sast` job already fetches the PR base ref (`git fetch … origin "$BASE_REF"`), so
  `origin/$BASE_REF` resolves.
- cargo-audit and pip-audit lockfiles (stages 2 and 3) are out of scope, as in MCM.
