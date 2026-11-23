# Feature Specification: Guardrail gate ports and registry retention

**Feature Branch**: `005-guardrail-gate-ports`

**Created**: 2026-11-23

**Status**: Draft

**Input**: User description: "Port MovieCollectionManager's remaining guardrail gates and registry retention to BELAY, covering backlog items #1, #2, #28 and #32."

## Context

BELAY's required `guardrails` check today runs the Spec Kit override gate, the digest-coverage gate,
a handful of selftests, the egress-policy drift check and the script unit tests. MovieCollectionManager
(MCM) keeps more of its rules true with gates, and four backlog items track bringing the ones that
apply across:

| Backlog item | What it asks for |
|---|---|
| item #1 | the remaining MCM guardrail checks: secret scan, SAST, naming-style gates, toolchain consistency |
| item #2 | the topology-scrub gate: no real tailnet host in the tree (a leak already cost a history rewrite) |
| item #28 | the OpenWiki gates: bundle conformance, governance, and recorded refresh fingerprints |
| item #32 | registry retention for the weekly `belay-devcontainer` image |

They are one feature because they share one shape (port an MCM gate, strip MCM coupling, wire it into
`guardrails`, document it) and one set of integration points, so one spec, plan and branch is cheaper
than four. Each gate stays its own command, so a red build still names the gate that failed.

The users are the maintainer and the AI assistant sessions that change BELAY. A gate's "user" is
whoever opens a pull request: the gate either lets the change through or names what to fix.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A real tailnet host can never be committed again (Priority: P1)

A contributor stages a change that contains a real tailnet host name: a docs page, a fixture, a
config file. The required check fails and names the file and line. Placeholder hosts used in docs and
tests (`<tailnet-host>`, anything containing `tailnet` or `example`) pass. The check itself never
contains the real host.

**Why this priority**: this leak has already happened once and was only undone by a history rewrite
and a force-push to `main`. Nothing stops it from recurring.

**Independent Test**: add a real-shaped host to any tracked file and run the gate: it fails, naming
the file. Remove it: it passes. The selftest proves detection without a real host in the tree.

**Acceptance Scenarios**:

1. **Given** a tracked file contains a real-shaped tailnet host, **When** the gate runs, **Then** it
   exits non-zero and names the file and line, without printing anything beyond the matched host.
2. **Given** only placeholder hosts are present, **When** the gate runs, **Then** it passes.
3. **Given** the gate is invoked with an unknown argument, **When** it runs, **Then** it exits with the
   bad-arguments code, distinct from a hit.
4. **Given** a pull request, **When** `guardrails` runs, **Then** the gate runs and a failure appears
   in the failure digest.

---

### User Story 2 - Credential-shaped strings and toolchain drift fail the build (Priority: P1)

The secret-scan rules that already protect CI digests also scan the whole tree on every pull request.
Separately, every place the repository pins the toolchain agrees: one Node major across workflows and
Dockerfiles, every Node-running CI job pins Node explicitly rather than inheriting the runner image's,
pnpm is named only by `packageManager` (and declared once), and the packages the constitution requires
to be exact (`nx`, `@nx/*`, `@playwright/test`) are exact.

**Why this priority**: both close gaps where a rule is written down but nothing checks it. The
constitution's lockstep rule has no enforcement today; the secret-scan rules run only against digests.

**Independent Test**: plant a credential-shaped string in a tracked file → the scan fails. Change one
workflow's Node pin to a different major, or make `nx` a caret range → the toolchain gate fails, naming
the file and the rule.

**Acceptance Scenarios**:

1. **Given** a tracked file holds a credential-shaped string, **When** `guardrails` runs, **Then** the
   secret scan fails and names the file and rule, never the value.
2. **Given** two Node pins with different majors, **When** the toolchain gate runs, **Then** it fails
   naming both pins.
3. **Given** a workflow job that runs Node without pinning it, **When** the toolchain gate runs,
   **Then** it fails naming the job.
4. **Given** a lockstep package declared with a range, **When** the toolchain gate runs, **Then** it
   fails naming the package.
5. **Given** the current tree, **When** both gates run, **Then** they pass (any drift found on the first
   run is fixed in the files, not allowlisted).

---

### User Story 3 - The knowledge bundle's rules are enforced, not reviewed (Priority: P2)

`openwiki/INSTRUCTIONS.md` states rules that today are kept by review only: front matter shape,
resolvable relative links, one `index.md` per directory, no orphan pages, `AGENTS.md` as an index only
within a size budget, `CLAUDE.md` as a shim only, every concept either derived (with a `resource`) or
authoritative, and a derived page refreshed whenever its source changes. A contributor who breaks one
gets a failing check naming the page and the rule. A contributor who refreshes a page records the
source's fingerprint with one command instead of computing it by hand.

**Why this priority**: the same-PR refresh duty in `AGENTS.md` is explicitly "not yet gated". Drift in
the bundle misleads every later session, silently.

**Independent Test**: change a file a derived page cites without refreshing the page → the gate fails
naming the page. Run the refresh command's record mode → the gate passes. Break a relative link → the
gate fails naming the link.

**Acceptance Scenarios**:

1. **Given** a derived page whose source changed after the page's recorded fingerprint, **When** the
   gate runs, **Then** it fails naming the page and its source.
2. **Given** that page, **When** the contributor runs the refresh tool's record mode after reviewing the
   page, **Then** the fingerprint is updated and the gate passes.
3. **Given** a broken relative link, a missing `index.md`, an orphan page or malformed front matter,
   **When** the gate runs, **Then** it fails naming the page and the rule.
4. **Given** `AGENTS.md` grows content outside its index and managed regions, or past its size budget,
   or `CLAUDE.md` holds more than the shim, **When** the governance gate runs, **Then** it fails.
5. **Given** an authoritative (protected) passage, **When** its text changes without its recorded
   fingerprint being updated, **Then** the governance gate fails.

---

### User Story 4 - Old dev-container images are removed on a schedule, safely (Priority: P3)

The weekly image build adds a 2–3 GB `belay-devcontainer` version to the forge registry every week, and
nothing removes old ones. A scheduled job reports which versions it would keep and delete, keeping the
newest versions and always every digest recorded as protected, and deletes only when the committed
configuration says so.

**Why this priority**: the cost is disk on the forge host, which grows slowly. It is real but not
urgent, and a wrong deletion is worse than a late one.

**Independent Test**: run the retention tool in report mode: it lists every version with keep/delete
and a reason, and every protected digest is always "keep". Run it with apply while the configuration says
report: it refuses.

**Acceptance Scenarios**:

1. **Given** the registry holds more versions than the retention window, **When** the job runs in
   report mode, **Then** it prints each version with keep or delete and why, and deletes nothing.
2. **Given** a digest listed as protected in the retention configuration (the runbook's re-pin step
   records the sandbox's pin there), **When** retention runs in any mode, **Then** that version and
   everything it references are kept.
3. **Given** a protected digest cannot be found in the registry, **When** retention runs, **Then** it
   deletes nothing and exits with a distinct code.
4. **Given** the configuration says report, **When** someone passes the apply flag, **Then** it refuses
   with a usage error.
5. **Given** the schedule, **When** the workflow runs, **Then** its log shows the report before any
   deletion.

---

### Edge Cases

- A placeholder-shaped host that merely *contains* `tailnet` as a label (`server.tailnet.ts.net`)
  passes; this is how docs and fixtures name hosts.
- Test fixtures for the topology and secret gates are built from fragments at run time, so the gates
  never flag their own tests.
- A derived page whose `resource` is a directory, or a file a bot rewrites, is refused by governance
  rather than fingerprinted.
- An `AGENTS.md` region owned by Spec Kit's agent-context extension is allowed and not counted as
  hand-written content.
- The retention job runs with no registry credential (a fork, a missing secret): it reports that the
  credential is missing and exits non-zero rather than reporting an empty registry as "nothing to do".
- An image version shared between a kept index and an old index (layer reuse) is never deleted while a
  kept version references it.

## Requirements *(mandatory)*

### Functional Requirements

**Gate shape (all gates)**

- **FR-001**: Every ported gate MUST have a selftest that proves its detection bites, MUST have its own
  unit tests, and MUST use the exit codes 0 clean, 1 violation or selftest failure, 2 bad arguments
  (plus any documented distinct code where the source gate has one).
- **FR-002**: Every ported gate MUST run in the required `guardrails` check on every pull request and
  every push to `main`, as its own command, so a failure names the gate; and the failure digest MUST
  cover it.
- **FR-003**: A ported gate MUST change only what removes MCM-specific coupling; its rules MUST NOT be
  weakened to make the current tree pass. Drift found on the first run MUST be fixed in the files.
- **FR-004**: Every MCM candidate named in items #1, #2 and #28 MUST end the feature either ported or
  dropped with a stated reason recorded in the plan and on the backlog item.

**Topology scrub (item #2)**

- **FR-010**: The repository MUST fail its required check when any tracked file contains a tailnet
  host that is not a placeholder; a placeholder is any host containing `tailnet` or `example`.
- **FR-011**: Neither the gate nor its tests MAY contain a real tailnet identifier or a contiguous
  real-shaped host literal.
- **FR-012**: The "never commit the tailnet host" rule MUST be stated in `AGENTS.md` and the runbook,
  naming the gate.

**Secret scan and toolchain consistency (item #1)**

- **FR-020**: The existing credential-shape rules MUST scan all tracked files in the required check.
- **FR-021**: The repository MUST fail its required check when Node pins disagree on major, when a
  Node-running workflow job does not pin Node, when a pnpm version is named anywhere but
  `packageManager` (or `packageManager` is declared outside the root), or when `nx`, any `@nx/*` or
  `@playwright/test` is declared with a range.

**OpenWiki (item #28)**

- **FR-030**: The repository MUST fail its required check on any knowledge-bundle conformance
  violation: unparseable or untyped front matter, a non-ISO timestamp, a `resource` that does not
  resolve, a directory without `index.md`, an orphan page, a site-root link, a relative link that does
  not resolve, or a derived page whose recorded source fingerprint does not match its source.
- **FR-031**: The repository MUST fail its required check on any governance violation: `AGENTS.md`
  outside its index and managed regions or past its size budget, `CLAUDE.md` other than the shim, a
  concept that is neither or both derived and authoritative, a `resource` that is a directory or a
  bot-rewritten file, or a protected passage whose fingerprint does not match.
- **FR-032**: Contributors MUST be able to list stale derived pages, see what changed in a page's
  source since its fingerprint, and record a new fingerprint, with one command each; fingerprints MUST
  never be hand-typed.
- **FR-033**: Every derived page MUST carry a recorded fingerprint and every protected passage a
  computed fingerprint when the feature merges.
- **FR-034**: `openwiki/INSTRUCTIONS.md` §9, `openwiki/process/wiki-maintenance.md`, the header of
  `openwiki/protected.yaml` and the `AGENTS.md` wiki gate MUST say these rules are enforced, naming the
  gates.

**Registry retention (item #32)**

- **FR-040**: A scheduled job MUST compute, for `belay-devcontainer`, which versions to keep (the
  newest N tagged versions, every digest listed as protected in the committed retention
  configuration, and everything a kept version references) and which to delete, and MUST print that
  report before any deletion.
- **FR-041**: Deletion MUST happen only when the committed retention configuration says apply AND the
  job is invoked to apply; the shipped configuration MUST say report.
- **FR-042**: If a protected digest cannot be located, or a kept version cannot be read, the job MUST
  delete nothing that could be referenced and MUST exit with a distinct non-zero code.
- **FR-043**: `docs/runbooks/devcontainer.md` MUST state the retention window and how to switch from
  report to apply.

### Key Entities

- **Gate**: a repository check with a selftest, a scan, an exit-code contract and a digest entry.
- **Derived page**: a knowledge-bundle page that summarises one source file and records that file's
  fingerprint.
- **Protected passage**: an authoritative passage whose fingerprint is recorded so an unreviewed edit
  is caught.
- **Image version**: a registry entry for `belay-devcontainer`: a tagged index, or a digest child that
  an index references.
- **Retention configuration**: the committed window and mode (report or apply) for each package.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A real-shaped tailnet host planted in any tracked file fails the required check, 100% of
  the time, with the file named.
- **SC-002**: Every candidate in items #1, #2 and #28 has a recorded outcome (ported or dropped with a
  reason): zero candidates left undecided.
- **SC-003**: The required check runs every new gate and stays green on `main`, and its total run time
  grows by no more than one minute.
- **SC-004**: Every derived knowledge-bundle page carries a fingerprint, and changing any cited source
  without refreshing its page fails the required check.
- **SC-005**: A retention report run lists every `belay-devcontainer` version with a keep/delete
  decision, and a protected digest is never marked delete.
- **SC-006**: Items #1, #2, #28 and #32 can each be closed with their acceptance criteria verified, or
  carry a comment stating what remains and why.

## Out of scope

- MCM's app CI, deploy and image-scan workflows; the paid wiki generator and `wiki-maintain` workflow.
- The public domain name, which cannot be pattern-gated without embedding it.
- Forge issue and pull-request text, which is not part of git.
- Running the retention job in apply mode: that is the maintainer's switch after reviewing reports.

## Assumptions

- **Dropped candidates.** The MCM gates for Maestro argv secrets, Docker Compose inline secrets and
  resource naming, and the Komodo, port-collision, restart-policy, server-import, realm and DAST
  gates, guard surfaces BELAY does not have (no compose files, no Maestro, no deployed services).
  The override-floor gate guards `pnpm-workspace.yaml` overrides, and BELAY has none. These are dropped
  with that reason, and can be ported when the surface appears.
- **SAST is deferred, not ported.** It needs Semgrep and other scanner toolchains on the CI runner,
  which is a structural decision the maintainer takes, and BELAY has no application code yet. It is
  re-filed as its own backlog item.
- **Wiki regeneration policy.** BELAY has no wiki generator, so MCM's per-path regeneration policy is
  not needed; governance runs without it.
- **Registry credential.** Report mode needs a registry-read credential and apply mode a
  package-delete credential, provisioned by the maintainer as Actions secrets. Without them the
  scheduled job fails loudly; it does not fall back to a broader token.
- **Pinned image.** The sandbox's pin lives in the VM's env file, never in git (the registry host must
  not be committed), so retention cannot read it from the tree. The runbook's re-pin step therefore
  records the pinned digest in the retention configuration's protected list (a digest is not a
  secret and names no host). A pin that was never recorded is still covered by the retention window,
  which the runbook states.
- The guardrails runner remains `belay` (`node:26-bookworm`), so every new gate is plain Node with no
  new dependency.
