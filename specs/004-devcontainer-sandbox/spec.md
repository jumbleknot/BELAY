# Feature Specification: Dev container on Docker Sandbox

**Feature Branch**: `004-devcontainer-sandbox`

**Created**: 2026-11-22

**Status**: Draft

**Input**: User description: "Dev container for BELAY on Docker Sandbox, mirroring MovieCollectionManager's sandbox dev container with the checkout at /workspaces/belay. A developer (or several concurrent AI assistant sessions) gets a reproducible, isolated engineering environment for this repo: a dedicated `belay` Docker Sandbox microVM (8 GiB) on the Windows host, with host-side default-deny egress governed by one canonical allowlist; a dev container inside it built from a slim, digest-pinned toolchain image (Node 26, pnpm from packageManager, Claude Code, gh, uv + Specify CLI pinned to the repo's Spec Kit version, PowerShell for the Spec Kit scripts, minimal Rust only so the personal layer can build RTK) published by CI to the forge's container registry; credentials (forge read and issue tokens only) delivered without ever entering image layers, command lines or logs, and ANTHROPIC_API_KEY never set; Claude Code logins and config persisting across container recreates; the personal layer (RTK and plugins) installed from the public mcm-dotfiles repo, whose guard is generalised to a neutral marker; workspace ownership kept consistent between the VM user and the container user; a one-step Windows launcher that starts the sandbox if idle-stopped and opens VS Code directly in the container; an egress self-check at container start that fails if a blocked host is reachable or an allowed one is not; and a runbook covering bring-up from nothing, recreate, re-pin, sbx upgrades and the worktree rule. Out of scope: the Docker-in-Docker/Android path, Claude Code usage capture, in-VM firewall, the full verification harness (only the egress check), and moving the dotfiles into BELAY (backlog)."

## User Scenarios & Testing *(mandatory)*

The users are the maintainer and the AI assistant sessions working on BELAY on the maintainer's Windows workstation. The environment mirrors the one MovieCollectionManager (MCM) already uses, so behaviour and traps that MCM measured apply here unless this spec says otherwise.

### User Story 1 - Open an isolated BELAY environment in one step (Priority: P1)

The maintainer runs one command on the Windows host. If the BELAY sandbox has idle-stopped, the command starts it. VS Code then opens directly inside the dev container, at `/workspaces/belay`. There, every BELAY check runs as it does in CI: `pnpm nx run scripts:lint`, `pnpm nx run scripts:test` and the Spec Kit commands, including their PowerShell scripts.

**Why this priority**: this is the environment itself. Without it, nothing else in the feature has a place to run.

**Independent Test**: from a stopped sandbox, run the launcher. Confirm that VS Code lands in the container at `/workspaces/belay`, then run both scripts targets and a Spec Kit script. All pass with the same results as on CI.

**Acceptance Scenarios**:

1. **Given** the sandbox exists but has idle-stopped, **When** the maintainer runs the launcher, **Then** the sandbox starts, the launcher waits until the sandbox is reachable, and VS Code opens inside the dev container. No manual connect or attach step is needed.
2. **Given** the dev container is open, **When** the maintainer runs the repository's lint and test targets, **Then** both pass, and the toolchain versions they use match the repository's pins: Node major, pnpm at `packageManager`, and the Spec Kit CLI at `.specify/init-options.json`.
3. **Given** the sandbox start reports a failure while the sandbox is in fact coming up, **When** the launcher runs, **Then** it judges readiness by whether the sandbox answers, not by the start command's exit code. It reports a real failure only if the sandbox never answers within its deadline.
4. **Given** the sandbox does not exist, **When** the maintainer runs the launcher, **Then** it stops with a message that names the runbook section for creating it.

---

### User Story 2 - Outbound network access is denied by default and governed by one list (Priority: P1)

All outbound traffic from the sandbox is refused unless its destination is on one canonical, reviewed allowlist committed to the repository. That covers the dev container, anything it starts, and the image pulls. The list is enforced outside the sandbox. Each time the container starts, a self-check proves that a blocked destination is refused and an allowed destination is reachable.

**Why this priority**: AI assistant sessions run unattended in this environment. A default-deny network boundary that the sessions cannot change is the main reason to have a sandbox at all.

**Independent Test**: from inside the container, request a destination that is not on the list and one that is. The first is refused and the second succeeds. Then run the self-check and see it pass. With the policy removed, it must fail.

**Acceptance Scenarios**:

1. **Given** a destination is not on the allowlist, **When** any process in the sandbox tries to reach it, **Then** the request is refused.
2. **Given** the allowlist, **When** the enforcement rules are produced from it, **Then** they come from the committed list by a generator, never by hand, and a check rejects a malformed or unexplained entry.
3. **Given** the container starts, **When** the egress self-check runs, **Then** it fails loudly if a blocked destination is reachable, and also fails if an allowed destination is unreachable. A severed network is not reported as secure.
4. **Given** the forge host must be reachable, **When** the rules are produced, **Then** the forge host is supplied at run time and never written into the committed list.

---

### User Story 3 - Credentials stay out of images and logs, and logins survive recreates (Priority: P2)

The forge read token and the forge issue token reach the dev container so that `ci-status.mjs` and `backlog.mjs` work inside it. They never appear in an image layer, a process command line, a build log or a committed file. `ANTHROPIC_API_KEY` is never set anywhere in the environment. Claude Code's login, identity and settings, and the personal layer (RTK and the maintainer's plugins), persist when the dev container is recreated.

**Why this priority**: a leaked token, or an assistant silently billing per token, is costly. Re-logging in after every recreate is friction that pushes people towards unsafe shortcuts.

**Independent Test**: recreate the dev container. Inspect the image history and configuration and the container's process list: no token value appears. Then confirm that Claude Code is still logged in with the same identity, RTK compresses commands, and `ANTHROPIC_API_KEY` is unset.

**Acceptance Scenarios**:

1. **Given** the tokens are provisioned in the sandbox, **When** the dev container is built and started, **Then** each token is available to processes in the container, and no value appears in the image's layers or configuration, the container's process command lines, or the build output.
2. **Given** a token value contains a newline or is missing, **When** the credentials are prepared, **Then** that value is skipped with a message naming only the variable. The container still starts, and the message says which credentials were not provisioned.
3. **Given** Claude Code is logged in, **When** the dev container is recreated, **Then** the login, the account identity and the per-project history are still present, and no re-login is needed.
4. **Given** a fresh dev container, **When** the personal layer is installed, **Then** RTK is both installed and wired into Claude Code so it actually compresses output, and the maintainer's plugins are present.
5. **Given** any shell in the environment, **When** its environment is listed, **Then** `ANTHROPIC_API_KEY` is absent.

---

### User Story 4 - The toolchain image is built in CI and pinned by digest (Priority: P2)

The heavy toolchain is a prebuilt image. CI builds it and publishes it to the forge's container registry whenever its inputs change, and also on a weekly schedule. The sandbox uses it by immutable digest, so a container recreate is a download, not a rebuild, and two recreates from the same pin produce the same toolchain.

**Why this priority**: without a pinned prebuilt image, every recreate rebuilds the toolchain and can silently pick up different versions.

**Independent Test**: change an image input, let CI publish, re-pin the sandbox to the new digest, recreate the container, and confirm that the toolchain versions match the new image and that no toolchain layer was rebuilt locally.

**Acceptance Scenarios**:

1. **Given** a change to an image input (the toolchain definition, the pnpm installer or the `packageManager` pin), **When** it reaches `main`, **Then** CI publishes a new image and reports its digest-pinned reference.
2. **Given** a push that changes none of the image inputs, **When** CI evaluates it, **Then** no image is built.
3. **Given** a digest pin, **When** the dev container is recreated, **Then** it uses exactly that image, and a missing pin is reported rather than silently replaced by another image.
4. **Given** the image, **When** it is inspected, **Then** it contains no credential and none of the maintainer's personal tools.

---

### User Story 5 - Operating the environment is documented end to end (Priority: P3)

A runbook covers bringing the environment up from nothing on a Windows host, recreating the dev container, re-pinning the image, recreating or resizing the sandbox, upgrading the sandbox tool, the idle-stop behaviour, and the rule that concurrent sessions commit from git worktrees. It names each measured trap with its fix.

**Why this priority**: the environment is operated rarely and from memory, and its failures look like other failures. The runbook is what keeps a recreate from costing a session.

**Independent Test**: follow the runbook from nothing (new sandbox, new container) without consulting MCM or any other source, and reach a passing lint and test run.

**Acceptance Scenarios**:

1. **Given** a host with the sandbox tool installed and no BELAY sandbox, **When** the maintainer follows the runbook, **Then** they reach a working container with the self-check passing, without needing any other document.
2. **Given** several sessions share the container, **When** one needs to commit, **Then** the runbook's worktree procedure lets it do so without changing another session's index or branch.

---

### Edge Cases

- **The sandbox idle-stops mid-session.** The container returns on its own when the sandbox restarts, without manual intervention.
- **The sandbox start reports a false failure.** The launcher waits for the sandbox to answer before believing the exit code (US1, scenario 3).
- **The container user and the sandbox's own user have different ids.** Repository files written from either side must stay writable from the container. Ownership is repaired at create and at every start, at the cost of one check when nothing is wrong.
- **An allowlisted destination redirects to a different host** (front door versus download host). Both hosts must be on the list, or downloads fail. The list records why each entry exists.
- **The image pin is missing or unexported when the container is built.** The build must not silently fall back to a stale local image without saying so.
- **The personal layer's guard does not recognise the BELAY container.** It installs nothing but still exits successfully. The generalised marker must be set, and installation must be verified rather than assumed.
- **A refused request goes to the sandbox's approval queue.** The queue is dismissed, never approved, so the committed list stays the only source of allowed destinations.
- **The host has less free memory than usual** (the MCM sandbox may also be running). The BELAY sandbox and container stay within fixed bounds.

## Requirements *(mandatory)*

### Functional Requirements

**Environment**

- **FR-001**: The environment MUST run in a dedicated sandbox named `belay`, separate from MCM's, sized at 8 GiB, with its own network policy and its own persistent volumes.
- **FR-002**: The repository MUST be checked out inside the sandbox at `/workspaces/belay`, and the dev container MUST see it at the identical path.
- **FR-003**: The dev container MUST run as a non-root user whose numeric id matches the owner of the checkout. A repair step MUST correct mismatched ownership at create and at every start.
- **FR-004**: The dev container MUST return automatically after the sandbox idle-stops and restarts, and MUST stay within a fixed memory limit sized for an 8 GiB sandbox.
- **FR-005**: The dev container MUST provide the toolchain the repository's checks and workflow need, at the repository's pinned versions: Node at the CI major, pnpm at `packageManager`, the Spec Kit CLI at `.specify/init-options.json`'s version, PowerShell for the Spec Kit scripts, the Claude Code CLI, the GitHub CLI, and the minimal Rust toolchain the personal layer needs to build RTK.
- **FR-006**: The dev container MUST be able to run containers on the sandbox's own engine without running an engine of its own, and commands it runs that way MUST return their complete output.

**Egress**

- **FR-007**: All outbound traffic from the sandbox MUST be refused unless its destination is on one canonical allowlist committed to the repository. Every entry MUST be a fully qualified domain name with a group and a stated reason.
- **FR-008**: The enforcement rules MUST be generated from the allowlist by a tool that never writes files, and a check mode MUST reject a malformed entry and name it.
- **FR-009**: The forge host MUST be injectable when the rules are generated, and MUST never appear in the committed list or any committed file.
- **FR-010**: At every container start, a self-check MUST fail if a blocked destination is reachable, and MUST also fail if an allowed destination is unreachable.

**Credentials and persistence**

- **FR-011**: Only the forge read token and the forge issue token MUST be delivered to the container, under the names BELAY's tools read (`FORGE_TOKEN`, `FORGE_ISSUE_TOKEN`).
- **FR-012**: Credential values MUST NOT appear in any image layer or image configuration, in any process command line, in build or start output, or in any committed file. Diagnostic output MAY name a variable and its length, never its value.
- **FR-013**: `ANTHROPIC_API_KEY` MUST NOT be set anywhere in the sandbox or the dev container.
- **FR-014**: Claude Code's credentials, global configuration, settings, plugins and project history MUST persist across dev-container recreates. An existing configuration MUST be carried over onto the persistent volume once, without a symlink.
- **FR-015**: The personal layer MUST be installed from the public `mcm-dotfiles` repository. That repository's guard MUST accept a neutral marker that the BELAY container sets, while still accepting MCM's existing marker.
- **FR-016**: The RTK integration MUST be verified as both installed and wired into Claude Code, and wired idempotently if the personal layer left it unwired.

**Image**

- **FR-017**: The toolchain MUST be a prebuilt image, built from a base image pinned by digest, and containing no credentials and no personal tools.
- **FR-018**: CI MUST build and publish the image to the forge's container registry when an image input changes (including the `packageManager` pin), on manual dispatch, and on a weekly schedule. It MUST build nothing when no input changed, and MUST report the published digest-pinned reference.
- **FR-019**: The dev container MUST be built from the image named by a digest pin provided in the sandbox, never committed. A local build path MUST exist that needs neither the registry nor CI. It still needs an engine with open egress.
- **FR-020**: The image workflow MUST meet the repository's CI rules: every step logged through the step wrapper, and a failure-digest step on the job.

**Operation**

- **FR-021**: A launcher on the Windows host MUST start the sandbox if it is stopped, wait for it with a deadline rather than trusting the start command's exit code, and open VS Code directly in the dev container with no manual attach step. It MUST also be able to print the target instead of opening it.
- **FR-022**: A runbook MUST cover bring-up from nothing, recreate, re-pin, sandbox recreate and resize, sandbox-tool upgrades, idle-stop, the approval-queue rule and the worktree rule, each with its measured traps. It replaces the planned-container status note in `docs/runbooks/devcontainer.md`.
- **FR-023**: New scripts MUST have tests in `scripts/__tests__/` and run under `pnpm nx run scripts:test`. Shell scripts MUST stay LF.

### Key Entities

- **Sandbox**: the `belay` microVM on the host. It holds the checkout, its own container engine, the persistent volumes and the network policy. Removing it removes all of them.
- **Dev container**: the working environment inside the sandbox, built from the toolchain image plus the repository's container configuration.
- **Toolchain image**: the prebuilt, team-neutral image, identified by an immutable digest pin.
- **Egress allowlist**: the canonical list of permitted destinations. Each entry has a domain, a group and a reason.
- **Credential set**: the two forge tokens, provisioned in the sandbox and delivered to the container out of band.
- **Personal layer**: RTK and the maintainer's plugins, installed from the public dotfiles repository onto the persistent Claude volume.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From a stopped sandbox, one command takes the maintainer into the dev container within 3 minutes, with no manual step.
- **SC-002**: Inside the container, the repository's lint and test targets pass with the same result as CI on the same commit.
- **SC-003**: Of a sample of 5 destinations not on the allowlist, 0 are reachable from the container. Of a sample of 5 that are on it, all 5 are reachable.
- **SC-004**: An inspection of the image, the container configuration, the process list and the build output finds 0 credential values.
- **SC-005**: After a dev-container recreate, 0 re-logins are needed, and RTK compression is active in the first session.
- **SC-006**: A container recreate from an unchanged pin rebuilds 0 toolchain layers locally, and completes in under 10 minutes.
- **SC-007**: A person following only the runbook brings the environment up from nothing to a passing lint and test run.

## Assumptions

- The Docker Sandbox tool is installed on the Windows host at the version MCM pins (v0.53.0). Its disk-size settings are already set at user scope.
- The host has enough memory for an 8 GiB sandbox. When the MCM sandbox is also running, both fit, but with little headroom.
- The publishing CI job runs on the shared host runner that has a container engine, because BELAY's own runner runs jobs in a container without one. The registry variables and token are configured as repository variables and secrets.
- The maintainer agrees to the change to the public `mcm-dotfiles` repository, which is reviewed before it is pushed.
- BELAY has no application stack, mobile work or model-backed agent yet. Their MCM equivalents (ports, stacks, model keys, emulator) are excluded. The allowlist starts from MCM's reviewed list and keeps every entry, because BELAY will grow into the same stacks. The one exception is MCM's movie-metadata API, which is product-specific; its removal is recorded with its reason.
- Behaviour MCM measured in its sandbox (idle-stop, start timing, the engine relay truncation, the id mismatch, the image-layer credential leak) applies unchanged at this tool version.
- Out of scope, as decided: the Docker-in-Docker path, Claude Code usage capture, the in-VM firewall, the verification harness beyond the egress self-check, and moving the dotfiles into BELAY. The last is backlog item #31.
