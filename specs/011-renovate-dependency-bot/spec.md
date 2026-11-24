# Feature Specification: A self-hosted dependency bot

**Feature Branch**: `011-renovate-dependency-bot`

**Created**: 2026-11-24

**Status**: Draft

**Input**: User description: "Adopt a self-hosted Renovate dependency bot (backlog item 47)"

## Context

BELAY pins nearly everything, and nothing moves the pins:
- every third-party CI action, by commit SHA;
- the dev-container base image, by digest;
- the exact versions of the lockstep tool groups;
- every install, through the lock file;
- the scanner versions (Semgrep, Trivy, cargo-audit, uv), as constants in scripts.

Pinning buys reproducibility and supply-chain safety. But a pinned thing never updates itself, and other repositories
consume BELAY's pins. ADR-0004 (2026-11-23) records the maintainer's approval of a self-hosted Renovate bot to propose
those updates. It fixes the boundaries: the bot proposes and never merges, CI judges, and a human merges.

Feature 010 showed the cost of the gap on its first run. The pinned dev-container base carries a fixable Critical
(CVE-2026-99083), and the only path to a clean base is a re-pin that nothing proposes.

MovieCollectionManager runs this bot and measured how it fails, mostly silently:
- on the wrong Node version;
- with a schedule window its cron never intersected;
- with lock files that proposed nothing, because ranges already allowed the fix;
- by reusing a surviving branch verbatim, which opened empty PRs;
- with Docker Hub paging past page 10 marking every image update "pending" forever.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Security fixes arrive as pull requests without anyone looking (Priority: P1)

When a dependency BELAY pins gets a security advisory and a fixed version exists, a pull request proposing the
fix appears within a day. It is labelled as a security update and carries the advisory and the changelog. CI runs on it
like any other PR, and a human merges it.

**Why this priority**: this is the reason for the bot. A security fix that no one notices is the expensive case.

**Independent Test**: with a pinned dependency that has a known advisory and a fix, run the bot. A labelled PR
proposing the fixed version appears, and the required checks run on it.

**Acceptance Scenarios**:

1. **Given** a pinned dependency with a published advisory and a fixed version, **When** the nightly run happens,
   **Then** a PR proposing the fix exists, labelled as security, outside the routine schedule window.
2. **Given** such a PR, **When** CI runs, **Then** the same required checks run as on a human PR, and nothing merges it
   automatically.

---

### User Story 2 - Routine updates arrive in a predictable, bounded window (Priority: P1)

Non-security updates arrive once a week, in one window, limited in number, grouped so that things which must move
together move in one PR. Lock files are refreshed so that transitive fixes the version ranges already allow actually
arrive. A brand-new release is held for a cooling-off period before it is proposed.

**Why this priority**: an unbounded stream of bot PRs is ignored. A bounded, grouped weekly set is reviewed.

**Independent Test**: read the configuration and the guard tests. The window intersects the trigger's schedule under
both daylight-saving offsets. Lockstep groups are one group each. Lockfile maintenance is on. The release-age cooling-off
is set, with a shorter value for security fixes.

**Acceptance Scenarios**:

1. **Given** the weekly window, **When** the bot runs inside it, **Then** it opens at most the configured number of
   PRs, highest priority first: lock files, then base images, then digest pins, then the rest.
2. **Given** a lockstep group (for example, the Node version pinned in several places), **When** it has an update,
   **Then** one PR moves every member, and the toolchain-consistency gate passes on it.
3. **Given** a release younger than the cooling-off period, **When** the bot runs, **Then** it is not proposed yet.
4. **Given** a dependency whose ranges already allow a fixed transitive version, **When** the window runs, **Then**
   a lockfile-maintenance PR proposes the refreshed lock file.

---

### User Story 3 - Every pin BELAY owns is something the bot can see (Priority: P1)

The bot understands the standard manifests. These are the package manifest and lock file, Dockerfiles (including digest pins),
and CI workflow action references. For a pin written as a constant in a script, it is taught where that constant lives.
Examples are the Trivy version and its sha256, the Semgrep version, the uv version, the pnpm version and the base-image digest.
A pin the bot cannot see is listed, so it is a known gap rather than a silent one.

**Why this priority**: an invisible pin is the same as no bot for that pin. Feature 010's Trivy pin and the
dev-container base are exactly the pins that matter most.

**Independent Test**: list every pinned version and digest in the tree, then compare the list with what the bot
reports it manages. Every pin is either managed or named in a recorded exclusion.

**Acceptance Scenarios**:

1. **Given** the Trivy pin (a version **and** a sha256 that must move together), **When** a new Trivy release appears,
   **Then** one PR moves both, or no PR is opened. Never the version alone, which the installer would refuse.
2. **Given** a guard over the tree, **When** a new pinned constant is added that the bot does not manage, **Then** the
   guard fails, naming it, until it is managed or excluded with a reason.

---

### User Story 4 - The bot's configuration is safe and checked (Priority: P2)

The configuration is validated strictly before every run, and by CI on every PR that touches it. A hold on a
dependency (not proposing a major version, or not proposing it at all) is never a bare ceiling. Each hold records
why, which backlog item tracks it, and what to check to lift it. Major upgrades of stateful or toolchain components
need explicit approval on the bot's dashboard before a PR is opened.

**Why this priority**: an unexplained hold is indistinguishable from a forgotten one, and an invalid configuration
silently does nothing.

**Independent Test**: a guard test reads the configuration. Every held or disabled rule has a written justification and a
re-check rule. The cron intersects the window. Automerge is off everywhere. The config validator passes.

**Acceptance Scenarios**:

1. **Given** a hold without a justification or a re-check rule, **When** the guard runs, **Then** it fails, naming the rule.
2. **Given** an invalid configuration, **When** a PR changes it, **Then** CI fails before anything is merged.
3. **Given** any rule, **When** the guard reads it, **Then** nothing enables automerge.

---

### User Story 5 - The bot's own state is visible, and does not pollute the backlog (Priority: P2)

The bot keeps one dashboard issue, listing what it knows about and why each update is waiting. That issue must not
appear in the agent-driven backlog's "ready" list as work. Its run verdict is visible like any other workflow.

**Why this priority**: BELAY's backlog is read by agents. A bot issue listed as ready work would mislead them.

**Independent Test**: after a run, the dashboard exists, and `backlog.mjs ready` does not list it.

**Acceptance Scenarios**:

1. **Given** a completed run, **When** the dashboard is read, **Then** it lists pending, scheduled and approval-required
   updates.
2. **Given** the dashboard issue, **When** an agent lists ready backlog work, **Then** the dashboard is not in the list.

### Edge Cases

- **A version-and-sha256 pair** (the Trivy pin): both must move in one change, or the installer refuses the bytes.
- **The base-image digest that a feature-010 allowlist entry is keyed to**: a re-pin PR discharges that entry
  (UNMATCHED), so the PR must also delete the entry and its Dockerfile upgrade layer, or the image-scan gate reports it.
  The runbook says so, and the PR is not merged until it does.
- **A surviving bot branch** from an earlier run is reused verbatim, which MCM measured opening empty PRs. Merged bot
  branches are deleted (the existing merge tool already deletes the head branch).
- **Docker Hub's tag listing stops at page 10** (HTTP 403), which would leave every image update pending.
- **The bot's token is missing or expired**: the run fails loudly and the failure digest names it, never "nothing to update".
- **An update to the bot's own pinned version** is proposed like any other, and its config is validated against the new
  version before it is used.
- **A PR from the bot touches a file a wiki page cites**: the wiki staleness gate (V17) fails it. Bot-rewritten files must
  not be cited as a `resource` (ADR-0002), and a guard confirms none is.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A scheduled CI workflow MUST run the bot against BELAY's own forge, as a dedicated bot account whose token
  lives only in an Actions secret, never in the dev container or a committed file.
- **FR-002**: The bot MUST only propose. Automerge MUST be disabled for every rule, and a human merges.
- **FR-003**: Security updates MUST be proposed outside the routine window, within a day of a fixed version existing.
- **FR-004**: Routine updates MUST be limited to one weekly window and a maximum number of new PRs per run, prioritised
  as: lock files, base images, digest pins, then the rest.
- **FR-005**: Lockfile maintenance MUST be enabled.
- **FR-006**: A release-age cooling-off MUST apply, with a shorter value for security updates.
- **FR-007**: Lockstep groups MUST move as one PR each, and every bot PR MUST pass the toolchain-consistency gate.
- **FR-008**: Every pinned version or digest in the tree MUST be managed by the bot, or listed in a recorded exclusion
  with a reason. A guard MUST fail on an unmanaged, unexcluded pin.
- **FR-009**: A pin made of a version and a checksum (the Trivy pin) MUST move both together, or not at all.
- **FR-010**: Every hold or disabled rule MUST carry a written justification, a backlog reference and a re-check rule. A
  guard MUST fail otherwise.
- **FR-011**: Major upgrades of toolchain and stateful components MUST require dashboard approval before a PR opens.
- **FR-012**: The configuration MUST be validated strictly before each run and in CI on any change to it.
- **FR-013**: A guard MUST check that the window intersects the workflow's cron under both daylight-saving offsets.
- **FR-014**: The dashboard issue MUST NOT be listed as ready work by the backlog tool.
- **FR-015**: A run MUST fail loudly, through the failure digest, when the token is missing or invalid, or when the
  forge or a registry refuses it. It must never report success having done nothing.
- **FR-016**: A manual run MUST default to a dry run, which posts no PRs.
- **FR-017**: The workflow MUST meet the repository's CI rules: every step through the step wrapper, the failure digest
  last, and the retention floor raised for its bundle-publishing job.
- **FR-018**: A runbook MUST cover:
  - what the bot does and when;
  - reading the dashboard;
  - approving a held major;
  - adding a regex-managed pin;
  - a re-pin that discharges an image-scan allowlist entry;
  - the bot's token, and rotating it.

  It MUST have a wiki concept page, and the secrets-posture page MUST list the new credential.

### Key Entities

- **Managed pin**: a version or digest in the tree that the bot tracks, with where it lives and how it is updated. That
  is a standard manifest, or a taught pattern for a constant in a script.
- **Exclusion**: a pin the bot deliberately does not manage, with a reason.
- **Hold**: a rule that limits or disables updates for a dependency, with a justification, a backlog reference and a
  re-check rule.
- **Group**: dependencies that must move together, in one PR.
- **Dashboard**: the bot's single tracking issue: what it knows, what is waiting and why, and what needs approval.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A pin with a published fix is proposed as a PR within 24 hours of the fixed version existing (security) or
  within the next weekly window (routine). This is demonstrated on the first run against today's tree.
- **SC-002**: Every pinned version and digest in the tree is either managed or excluded with a reason. A guard proves it
  and fails on a new unmanaged pin.
- **SC-003**: Zero bot PRs merge without a human. Automerge is off everywhere, and a guard proves it.
- **SC-004**: The routine window opens no more than the configured number of PRs per run.
- **SC-005**: The bot's dashboard never appears in `backlog.mjs ready`.
- **SC-006**: The first real run's outcome is recorded: the PRs opened, the dashboard state, and anything held or
  pending, with its reason.

## Assumptions

- **Renovate, self-hosted as a CI workflow**, per ADR-0004. The hosted app supports only GitHub, and BELAY's forge is
  self-hosted Forgejo.
- **The maintainer creates the bot account and its token** (a forge user with write access to this repository, scoped to
  what the bot needs) and stores the token as an Actions secret. The feature cannot create an account. Implementation
  stops at the first live run until the secret exists.
- **The bot runs on BELAY's containerized `belay` runner**, never the `kvm` host runner. It runs no PR code.
- **The schedule follows MovieCollectionManager's measured shape** unless planning finds a reason not to: a nightly run
  for security updates and one weekly window for routine ones. The exact times are a plan decision, ordered after feature
  010's Tuesday and Friday image sweep.
- **The health loop is a separate feature** (backlog item 48): the weekly health job, the lockfile-refresh check and the
  branch reaper. This feature leaves the dashboard and statuses those checks will read.
- **Feature 010's open allowlist entry** (CVE-2026-99083, expiring 2026-12-24) is expected to be the first base-image
  re-pin this bot proposes, once Docker Hub rebuilds `node:26-bookworm`.
