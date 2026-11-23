# Research: Dev container on Docker Sandbox (004)

Sources: MovieCollectionManager (MCM) at `ab1f68ca`:
- `.devcontainer/` (the sandbox variant, `toolchain.Dockerfile`, the lifecycle scripts, `egress-allowlist.json`);
- `scripts/{gen-egress-policy,build-devcontainer-image,devcontainer-image-gate}.mjs` and `scripts/open-sandbox.ps1`;
- `.forgejo/workflows/devcontainer-image.yml`;
- the runbooks `devcontainer.md`, `devcontainer-sandbox.md`, `devcontainer-sandbox-lifecycle.md` and `dev-usage.md`;
- `jumbleknot/mcm-dotfiles` at `ddd45e0`.

It was also checked against the live host on 2026-11-22: `sbx` v0.53.0, 31.8 GiB RAM, the running `mcm` sandbox at 16 GiB, and the sandbox disk-size variables already set at User scope.

Each decision says what MCM does, what BELAY changes, and why.

## R1. Topology: an own `belay` sandbox at 8 GiB

**Decision.** `sbx create --name belay -m 8g --skills=off shell <empty scratch dir>`. The sandbox is not shared with `mcm`.
- Default-deny network policy is applied before anything pulls.
- The checkout is a clone at `/workspaces/belay` on the VM root volume.
- The dev container caps memory at `--memory=5g --memory-swap=5g`.

**Rationale.**
- The maintainer chose this. MCM's VM takes 16 of the host's 31.8 GiB, so a second 16 GiB VM cannot run alongside it.
- The memory budget inside the 8 GiB VM is: container 5, the VM's container engine about 1, and about 2 of headroom for sibling containers and the image build.
- MCM learned that a cap makes the kernel pick its out-of-memory victim inside the container, rather than killing a bystander. BELAY has no sibling stacks, so 5 GiB is enough.

**Alternatives considered.**
- A second container inside the `mcm` VM. Rejected: MCM's container already budgets 10 of 16 GiB, it would widen MCM's policy surface, and `sbx rm mcm` would destroy BELAY too.
- A 16 GiB VM. Rejected: it cannot run alongside `mcm` on this host.

## R2. Only the sandbox path is mirrored

**Decision.** Port MCM's `.devcontainer/sandbox/` variant as BELAY's **only** `.devcontainer/devcontainer.json`.
- Drop the Docker-in-Docker path and `init-firewall.sh`, along with the `NET_ADMIN`/`NET_RAW` capabilities that existed only for it.

**Rationale.**
- MCM keeps the Docker-in-Docker path for one reason, the Android emulator's `/dev/kvm`. BELAY has no Android work.
- On the sandbox path, MCM found that the in-VM firewall would be VM-wide under `--network=host`. It also vanished on the first idle cycle unnoticed (D-18). MCM's enforcement is the host-side policy, and the container only *asserts* it.
- One config file also removes MCM's duplicated-config hazard (its FR-032).

## R3. Container config, kept as in MCM

Kept as in MCM, each for MCM's measured reason:
- The `docker-outside-of-docker:1` feature, with `moby: true` and `dockerDashComposeVersion: "none"`. The standalone compose download fails under governed egress.
- `devcontainer-lock.json` is committed. A digest diff in it is the supply-chain signal.
- `runArgs`: `--network=host`, `--restart=always` (the VM idle-stops about 30 s after the last session), the memory cap and `--env-file`.
- `remoteUser: coder` and `updateRemoteUserUID: true`. The flag is set explicitly, although MCM measured that it does not engage. The actual cure is in the image (R6).
- `workspaceMount` and `workspaceFolder` are left out, so the container path equals the VM path. Every sibling `-v` resolves on the VM.
- `containerEnv`:
  - `DOCKER_HOST=unix:///var/run/docker-host.sock`. The feature's socat relay half-closes after 0.5 s, so `docker exec` returns exit 0 with empty output.
  - `DOCKER_CONFIG=/home/coder/.docker-sandbox`. The VS Code-injected `credsStore` helper fails outside its session.
  - `CLAUDE_CONFIG_DIR=/home/coder/.claude`, which moves `~/.claude.json` onto the volume.
  - The markers `BELAY_DEVCONTAINER=1`, `BELAY_DEVCONTAINER_PLATFORM=sandbox` and `DEVCONTAINER_PERSONAL_LAYER=1` (R9).
  - `FORGE_REGISTRY_HOST` from the VM shell's environment.
- Volumes `belay-commandhistory`, `belay-pnpm-store` and `belay-claude`. Only download caches and the Claude root are volumed, never baked tool directories.
- `customizations.vscode`: `files.eol: "\n"` and the `anthropic.claude-code` extension. MCM's eslint and prettier extensions are dropped, because BELAY has no app lint.

Lifecycle commands:
- `initializeCommand`: `gen-container-secrets-env.sh`.
- `onCreateCommand`: chown the volumes, then `fix-workspace-ownership.sh`, then `persist-claude-config.sh`.
- `postCreateCommand`: `pnpm install --config.confirmModulesPurge=false`, then `ensure-rtk-hook.sh`.
- `postStartCommand`: `fix-workspace-ownership.sh`, then `assert-egress-governed.sh`.

Dropped from MCM: `forwardPorts`, the Ollama and Android `postStart` hooks, the app-path chowns, `OPENWIKI_*` and `MCM_USAGE_*`.

## R4. Credentials, delivered out of band

**Decision.** Mirror MCM's pattern, with BELAY names:
- **On the VM.** `~/.belay-sandbox-env` holds `KEY='value'` lines with no `export`:
  - `BELAY_DEVCONTAINER_IMAGE` (the digest pin);
  - `FORGE_REGISTRY_HOST`;
  - `FORGE_TOKEN` and `FORGE_ISSUE_TOKEN`.

  It is sourced with `set -a; . ~/.belay-sandbox-env; set +a` before `devcontainer up`. It is never sourced automatically.
- **Into the container.** `initializeCommand` runs `.devcontainer/gen-container-secrets-env.sh`, which re-emits `VARS="FORGE_TOKEN FORGE_ISSUE_TOKEN"` as bare `KEY=value` lines into `~/.belay-devcontainer-secrets.env`, passed by `--env-file`. It uses `umask 077`, refuses a value containing `$'\n'`, prints names and lengths only, and always exits 0.
- **The names are unprefixed**, because the container serves only BELAY and its tools read `FORGE_TOKEN` and `FORGE_ISSUE_TOKEN` directly.
- **`ANTHROPIC_API_KEY` is never set.** The sandbox's own VM carries `ANTHROPIC_API_KEY=proxy-managed`, which is sbx's marker and not a key. It must not reach the container, and the `--env-file` list never contains it.

**Rationale.** These are MCM's measured failures:
- `containerEnv` is compiled into image `ENV` layers. MCM found credentials in 3 history layers.
- `remoteEnv` does not reach `ssh` plus `docker exec` sessions.
- `--env-file` does no quote processing.
- The old newline guard `*"$(printf '\n')"*` matched every value.

**Git credentials.** These are measured on MCM's live sandbox, not stated in its runbooks.
- The VM keeps the forge credential in git's `store` helper (`~/.git-credentials`).
- The container has no credential file of its own. git there uses the credential helper that VS Code Dev Containers forwards.
- So `git push` and `forge-pr.mjs` (which calls `git credential fill`) work in a VS Code-attached terminal, and not from a bare `sbx exec` + `docker exec` shell.

BELAY mirrors this and documents it as a trap. Putting the push credential in the container is not part of this feature.

## R5. Toolchain image contents (slim)

**Decision.** `.devcontainer/toolchain.Dockerfile` contains:
- `FROM node:26-bookworm@sha256:b7087bc4d973034b30854b378ba107f9fab622b47514cb7e2592e41b8bab8d49`, the same digest MCM pins.
- Apt packages: `git`, `build-essential`, `pkg-config`, `libssl-dev`, `curl`, `ca-certificates`, `unzip`, `sudo` and `jq`.
- `npm install -g @anthropic-ai/claude-code`.
- `gh` from its apt repository.
- The `coder` user (R6).
- Cache directories pre-created and owned by `coder`.
- Minimal rustup (`--profile minimal`, toolchain `1.100.0`), with no components and no cargo utilities.
- uv `0.13.9`, and `uv tool install --from git+https://github.com/github/spec-kit.git@v1.4.2 specify-cli`.
- pwsh `7.6.5` from the linux-x64 tarball, with `libicu72` installed explicitly.
- pnpm at `packageManager`, through `scripts/install-pnpm.sh`. This goes at the tail, because it copies `package.json`.
- `ENV SHELL=/bin/bash`.

`.devcontainer/Dockerfile` is the thin seam: `ARG BASE_IMAGE=belay-devcontainer` then `FROM ${BASE_IMAGE}`. The default is colon-free, because `${localEnv:VAR:default}` truncates at the first colon.

**Rationale.**
- Rust is kept only because `mcm-dotfiles` builds RTK with `cargo install`.
- Spec Kit's scripts are PowerShell only, so without `pwsh` the `/speckit-*` commands silently fall back to hand bookkeeping.
- `SPECKIT_VERSION` must equal `.specify/init-options.json` (1.4.2). Bump both together (see `docs/runbooks/spec-kit.md`).

**Dropped.** The Android SDK and emulator, Gradle, the ten cargo utilities, OpenWiki with mermaid and jsdom, the Docker Compose v5 plugin and `.docker-dind`, and the iptables, ipset, dnsutils and iproute2 packages. This takes the image from about 13 GB to roughly 2–3 GB (to be measured).

**Alternatives considered.**
- Reuse MCM's image. Rejected: it is 13 GB, mostly Android, and it is named and published for MCM.
- Drop Rust and fetch an RTK release binary. That is deferred: it needs a change to `mcm-dotfiles` beyond the guard, and the RTK release-asset host is unverified.

## R6. User id: `coder` is uid 1000, set at user creation

**Decision.** Copy MCM's block exactly, before any heavy layer:
- `usermod -u 1100 node && groupmod -g 1100 node`;
- `groupadd -g 1000 coder` and `useradd -u 1000 -g 1000 coder`, with passwordless sudo.

Keep `fix-workspace-ownership.sh`, with its default renamed to `${BELAY_WORKSPACE:-/workspaces/belay}`, as the repair at create and at every start. The rule stands: run git **inside the container**, never as `ssh belay.sbx 'git …'`.

**Rationale.** The VM user is uid 1000. A container user on 1001 cannot write the clone, and git then fails deep, with errors that read like repository corruption. A renumber layered on top later copies up every file. On BELAY's small image that is cheaper than on MCM's, but still wrong.

## R7. Image publishing through CI

**Decision.** Port `.forgejo/workflows/devcontainer-image.yml` and `scripts/devcontainer-image-gate.mjs`, with its test.

- **Image name.** `belay-devcontainer`. The tag is `${REGISTRY}/${NS}/belay-devcontainer:${GITHUB_SHA}`. The digest ref comes from `RepoDigests` and goes in the step summary.
- **Triggers.** `workflow_dispatch`; `push` (to `main`) filtered on the image inputs (`.devcontainer/toolchain.Dockerfile`, `.devcontainer/Dockerfile`, the workflow, `scripts/install-pnpm.sh`, `scripts/devcontainer-image-gate.mjs` and `package.json`); and the cron `0 6 * * 5`.
- **Never `pull_request`.**
- **Runner.** `runs-on: kvm`, the shared global host runner, which has the `ci` user's rootless Docker at `unix:///run/user/1001/docker.sock`. That is a deliberate exception to the "BELAY jobs run on `belay`" rule:
  - BELAY's own runner maps `belay` to `docker://node:26-bookworm` with no host Docker access, which `docs/runbooks/ci.md` pins off for runner security.
  - So this job **must never run pull-request code**, because the host runner has the host's Docker daemon. Only push-to-`main`, dispatch and schedule may trigger it.
  - A new guard test asserts both points: no `pull_request` or `pull_request_target` trigger, and `runs-on: kvm`. The existing guardrails test keeps pinning `guardrails` to `belay`.
- **Operator setup.** BELAY repository variables `REGISTRY`, `NS` and `REGISTRY_USER`, and the secret `REGISTRY_TOKEN` (with `write:package`). Forgejo reserves the `FORGEJO_`, `GITEA_` and `GITHUB_` prefixes for names.
- **CI rules.** Every `run:` step goes through `scripts/ci-log-step.sh`, and the job ends with the failure-digest step. `scripts/check-ci-digest-coverage.mjs` scans every workflow, so it enforces this.
- **Reading the digest.** The forge cannot read back the step summary. Resolve the digest from the registry: `GET /v2/<ns>/belay-devcontainer/manifests/<sha>` with `Accept` set to the OCI index type, then read the `docker-content-digest` header. The packages API's first row is the attestation, not the image.

**Rationale.** A digest pin makes recreates downloads, not rebuilds, and makes them reproducible. The gate stops a no-op push from paying for a build, and fails safe: if it cannot tell, it builds.

**Follow-up (backlog).**
- **Retention.** MCM's retention workflow keeps only MCM's images. BELAY's weekly builds will accumulate until a retention rule covers `belay-devcontainer`. Backlog item #32, not built here.
- **Queueing.** The global runner runs one job at a time and is shared with MCM's long jobs, so a BELAY image build can queue. That is acceptable for a weekly, change-triggered build.

## R8. Egress allowlist: MCM's list, kept whole except one entry

**Decision.** Copy MCM's `.devcontainer/egress-allowlist.json` (103 destinations, at `ab1f68ca`) and keep its schema, groups, `$schemaNotes`, `$mustNeverAppearHere` and `$consideredAndExcluded` verbatim.
- **Remove exactly one destination: `api.themoviedb.org`**, MCM's movie-metadata API. It is product-specific and will never be needed in BELAY.
- **Keep the other 102 destinations**, including those that today serve only MCM's application stack (Fireworks, Ollama and its blob host, Quay, Alpine, Expo, MongoDB, the Playwright image, Semgrep and OSV, and the docs hosts). The maintainer decided BELAY will need them in the future, so they stay rather than being removed and re-added one by one.
- **Record the removal** under a new `$removedFromMcmBaseline` key, with its reason.
- **Reword every reason neutrally.** References to MCM components are replaced with neutral terms: the app, the BFF, mc-service, the movie assistant, the three MCP servers, `@mcm/design-system`, `--sandbox mcm`, MCM file paths, and MCM feature, item and proposal numbers. For example, "the image build for `frontend/mcm-app/Dockerfile`" becomes "an Alpine-based application image build", and "Redis docs (BFF session store)" becomes "Redis docs (session stores)".
  - **Keep every measured fact:** the dates, the error strings, the redirect chains, the front-door-versus-blob-host pairs, and the traps.
  - A test enforces the rule (see the data model). The maintainer chose this over verbatim text, so the list reads as BELAY's own; it then drifts from MCM's wording, which is accepted.
- **The `app` group** is now empty but stays valid, for BELAY's own future application entries.
- **Port `scripts/gen-egress-policy.mjs`** unchanged apart from names. It never writes files, and the forge host is injected with `--forge-host`.

**Result:** 102 destinations, plus the forge host injected at run time.

**Rationale.**
- The maintainer asked for MCM's list as the starting point, and for the entries to stay because BELAY will grow into the same stacks.
- Every entry carries a measured reason, and the front-door-versus-blob-host pairs (for example `github.com` with `release-assets.githubusercontent.com`) were each learned from a failure. Rebuilding the list would relearn them.
- Docs and registry hosts are fetched on demand, and a fetch sends a request, not repository content. `mcp.context7.com` and `docs.langchain.com` receive a library question; their reasons already state that.

**Alternative considered.** Removing the 24 entries that today serve only MCM's running application, and re-adding each when a BELAY consumer arrives. The maintainer rejected it: those consumers are planned, and each re-add would cost a policy change on a running sandbox.

**Rules carried over.**
- Telemetry hosts are blocked by configuration, never allowlisted.
- Refusals in the approval queue are **dismissed**, never approved.
- Matching is per FQDN.
- Policy is per sandbox and set at creation. A committed entry does nothing for a running sandbox until it is also run through `sbx policy allow network <d> --sandbox belay`.
- Templates do not carry the policy.

## R9. The personal layer: `mcm-dotfiles` with a generalised guard

**Decision.** Change `install.sh` in `jumbleknot/mcm-dotfiles` so it proceeds when either `MCM_DEVCONTAINER=1` or `DEVCONTAINER_PERSONAL_LAYER=1` is set, and otherwise logs and exits 0 as today. BELAY's `containerEnv` sets `DEVCONTAINER_PERSONAL_LAYER=1`. MCM's behaviour is unchanged, and MCM may adopt the neutral marker later.
- The change is shown to the maintainer before it is pushed, since it touches their public repository.
- BELAY installs the layer with `devcontainer up … --dotfiles-repository https://github.com/jumbleknot/mcm-dotfiles`, or with VS Code's `dotfiles.repository` setting.
- BELAY carries its own `ensure-rtk-hook.sh`. It wires `rtk hook claude` idempotently, and its message names the BELAY `devcontainer up` command.

**Rationale.** Without a recognised marker, `install.sh` exits 0 having done nothing, which is a silent no-op. An RTK binary without the hook gives zero compression.

**Alternatives considered.** Setting `MCM_DEVCONTAINER=1` in BELAY was rejected, because it mislabels the container and MCM's checks key on it. Forking the repository was rejected, because it would duplicate the RTK pin and plugin maintenance. Moving the installer into BELAY is backlog item #31.

## R10. The launcher

**Decision.** Port `scripts/open-sandbox.ps1` with defaults `-Sandbox belay`, `-Workspace /workspaces/belay` and `-Config /workspaces/belay/.devcontainer/devcontainer.json`. Its logic stays unchanged:
- `Invoke-Native` handles stderr under Windows PowerShell 5.1.
- It reads `sbx ls --format json` and handles its failure.
- If the sandbox is stopped, it runs `sbx run --name belay -d`, then waits for SSH with a 120 s deadline instead of trusting the exit code.
- It opens the hex-encoded dev-container URI with `code --folder-uri`, and supports `-PrintOnly`.

**Testing.** CI runs in a Linux container without `pwsh`, so the script cannot execute there. A static guard test checks:
- the defaults;
- the descriptor's key order;
- the `%2B` encoding;
- that no `sbx start` appears;
- that every native call goes through `Invoke-Native`.

The behaviour is verified by hand in the quickstart (the stopped and running cases, and `-PrintOnly`).

## R11. Egress self-check

**Decision.** Port `assert-egress-governed.sh` with neutral variable names: `EGRESS_BLOCKED_PROBE`, defaulting to `example.com`, and `EGRESS_ALLOWED_PROBE`, defaulting to `https://registry.npmjs.org/`.
- It runs in `postStartCommand`.
- It fails if the blocked probe is reachable, and also if the allowed probe is not.
- It is the only part of MCM's verification harness ported.

**Known limit (carried over).** `postStartCommand` does not run on a Docker-level restart, which happens after the VM idle-stops. So the check proves the policy at each real start, not continuously. The host-side policy is the enforcement layer either way.

## R12. Nx targets and tests

**Decision.**
- `scripts/project.json` gains a `build-devcontainer-image` target, a build operation, per the constitution's **Monorepo Build Tool** principle.
- `gen-egress-policy.mjs --check` joins `scripts:lint`, so CI validates the allowlist.
- The operator CLIs (`gen-egress-policy --format …`, `open-sandbox.ps1`) are run directly.
- New tests go in `scripts/__tests__/` and run under `scripts:test`:
  - `gen-egress-policy`: check mode, both formats, forge-host injection and absence, deterministic order;
  - `devcontainer-image-gate`: ported from MCM;
  - `gen-container-secrets-env.sh`: bare form, newline refusal, no values in output, mode 600. This one needs bash, through `shell-probe.mjs`;
  - the `devcontainer-image` workflow guard;
  - the `open-sandbox.ps1` static guard;
  - a `devcontainer.json` guard covering the memory cap, `DOCKER_HOST`, `CLAUDE_CONFIG_DIR`, no credential names in `containerEnv`, the markers, and `ANTHROPIC_API_KEY` absent.
- Shell scripts are LF, per `.gitattributes`.

## R13. Things this feature does not change

- Claude Code usage capture is skipped. It needs MCM's server-side store, and it is optional and separable.
- The full verification harness is reduced to the egress check. Other checks are added as they are needed.
- `node_modules` without the trailing slash is already in `.gitignore` (PR #30).
- The runbook `docs/runbooks/devcontainer.md` and its wiki summary are rewritten from "planned" to the real procedure. The doc-impact sweep in `tasks.md` finds the other documents that name the planned paths.
