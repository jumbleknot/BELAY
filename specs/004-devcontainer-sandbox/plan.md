# Implementation Plan: Dev container on Docker Sandbox

**Branch**: `004-devcontainer-sandbox` | **Date**: 2026-11-22 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/004-devcontainer-sandbox/spec.md`

## Summary

Port MovieCollectionManager's (MCM's) Docker Sandbox dev container to BELAY, at `/workspaces/belay` in a dedicated 8 GiB `belay` microVM. Only the sandbox path is mirrored: there is no Docker-in-Docker, no Android and no in-VM firewall.

The feature delivers:
- one `.devcontainer/devcontainer.json`, plus the thin `Dockerfile`;
- a slim `toolchain.Dockerfile`: Node 26 pinned by digest, `coder` at uid 1000, Claude Code, gh, uv and Specify 1.4.2, pwsh 7.6.5, pnpm from `packageManager`, and minimal Rust for the RTK build;
- the MCM lifecycle scripts, renamed;
- an egress allowlist made from MCM's 103 reviewed destinations, keeping 102 and removing only the movie-metadata API, with the removal recorded;
- the allowlist generator, the image gate and the image build script, ported with tests;
- a `devcontainer-image` workflow that publishes `belay-devcontainer` to the forge registry from the shared host runner, never on pull requests;
- `open-sandbox.ps1`;
- the real runbook, in place of the planned-container note.

The personal layer comes from `jumbleknot/mcm-dotfiles`, once its guard accepts a neutral marker. Research: [research.md](research.md).

## Technical Context

**Language/Version**:
- Node 26 for the scripts, with built-ins only plus the existing `yaml` dev dependency.
- POSIX bash for the container lifecycle scripts.
- Windows PowerShell 5.1 for the launcher.
- Dockerfile syntax for the image.

**Primary Dependencies**:
- Docker Sandbox (`sbx`) v0.53.0 on the host.
- The Dev Containers spec and CLI (`@devcontainers/cli`, installed on the VM).
- The `ghcr.io/devcontainers/features/docker-outside-of-docker:1` feature, locked by `devcontainer-lock.json`.
- The base image `node:26-bookworm@sha256:b7087bc4…8d49`.

**Storage**:
- Named volumes on the sandbox's engine: `belay-claude`, `belay-pnpm-store` and `belay-commandhistory`.
- VM-only env files: `~/.belay-sandbox-env` and the generated `~/.belay-devcontainer-secrets.env`.

**Testing**:
- `node:test` in `scripts/__tests__/`, through `pnpm nx run scripts:test`.
- Bash-script tests guard their skip with `shell-probe.mjs`.
- The launcher gets a static guard test. Its behaviour is verified by hand in `quickstart.md`.
- The end-to-end checks are the quickstart, run on the real sandbox.

**Target Platform**:
- A Windows 11 host, with a Debian 13 `shell` kit VM inside the sandbox.
- A Debian bookworm dev container.
- CI: the shared global host runner (`kvm` label, rootless Docker) for the image job only.

**Project Type**: developer-environment infrastructure, plus repository scripts in the Nx `scripts` project.

**Performance Goals**:
- From a stopped sandbox into the container in 3 minutes or less (SC-001).
- A pinned recreate in under 10 minutes, with 0 local toolchain layers rebuilt (SC-006).

**Constraints**:
- **Memory:** the VM has 8 GiB and the container is capped at 5 GiB. The host has 31.8 GiB, shared with MCM's 16 GiB VM.
- **Credentials:** never in image layers, argv, logs or git.
- **`ANTHROPIC_API_KEY`:** never set.
- **The forge host:** never committed (topology-scrub).
- **Egress:** default-deny, from one canonical list.
- **The image job:** never runs pull-request code.

**Scale/Scope**: one maintainer and several concurrent assistant sessions. The allowlist has 102 destinations plus the forge host.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How this plan complies |
| --- | --- | --- |
| AI Assistant Constraints | ✅ | The work follows the spec, plan and tasks. The four open decisions were asked, not assumed. |
| Security: Data Protection (Secrets Management) | ✅ | Tokens live only in the VM env file and are delivered by `--env-file`. They never appear in `containerEnv`, image layers, argv or git. Guard tests assert this (R4, R12). |
| Security: Infrastructure Hardening (Dependency Security) | ✅ | The base image is digest-pinned and the feature is locked by digest in `devcontainer-lock.json`. Tool versions are pinned: Specify, uv, pwsh, rust and pnpm. The weekly image rebuild picks up OS patches. Image vulnerability scanning is not in scope; it belongs to backlog item #1's SCA/infra-image work. |
| Least privilege / isolation | ✅ | The container is unprivileged, and the runner exposes no host Docker to pull-request code. Egress is enforced host-side and the container only asserts it. The one host-Docker job runs only on trusted events, and a guard test pins that (R7). |
| Test-Driven Development | ✅ | Every new script gets tests in Verify RED / Verify GREEN format (R12). The tasks template enforces this. |
| Logging & Monitoring | ✅ | Every CI step goes through `ci-log-step.sh` and has a failure digest. Scripts print names and lengths, never values. |
| Package Manager (pnpm only) | ✅ | pnpm is installed at `packageManager` through `scripts/install-pnpm.sh`. |
| Monorepo Build Tool (Nx) | ✅ | The image build is the Nx target `scripts:build-devcontainer-image`. The allowlist check joins `scripts:lint`. The operator CLIs are run directly, as BELAY's convention allows. |
| Token Compression (RTK) | ✅ | RTK comes from the personal layer, and `ensure-rtk-hook.sh` wires it idempotently (R9). |
| Environment & Secret Files | ✅ | No `.env` is committed. The VM env files live outside the repository. `.gitignore` already covers `node_modules` and the env patterns. |
| Documentation (doc-impact sweep) | ✅ | The runbook and its wiki summary are rewritten. The sweep in `tasks.md` covers the other documents that name the planned paths. |
| Docker-Native Operations | N/A | It governs backend services, and this feature adds none. |

**Result: PASS.** Nothing needs justifying in Complexity Tracking. The `runs-on: kvm` exception is to a repository convention, not a constitution principle, and is justified in research R7.

**Re-check after Phase 1:** PASS. The data model and contracts add no secret-bearing field to any committed artefact. Every new command has a documented exit-code contract and no value-bearing output.

## Project Structure

### Documentation (this feature)

```text
specs/004-devcontainer-sandbox/
├── plan.md              # this file
├── research.md          # Phase 0: decisions R1–R13
├── data-model.md        # configuration artefacts and their rules
├── quickstart.md        # end-to-end validation
├── contracts/cli.md     # command and workflow contracts
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks (not created here)
```

### Source code (repository root)

```text
.devcontainer/
├── devcontainer.json            # ported from MCM's sandbox variant; the ONLY config
├── devcontainer-lock.json       # generated on first build; committed
├── Dockerfile                   # thin seam: ARG BASE_IMAGE=belay-devcontainer
├── toolchain.Dockerfile         # slim toolchain image
├── egress-allowlist.json        # MCM's list minus api.themoviedb.org, plus $removedFromMcmBaseline
├── gen-container-secrets-env.sh
├── fix-workspace-ownership.sh
├── persist-claude-config.sh
├── ensure-rtk-hook.sh
└── assert-egress-governed.sh
scripts/
├── gen-egress-policy.mjs
├── devcontainer-image-gate.mjs
├── build-devcontainer-image.mjs
├── open-sandbox.ps1             # CRLF per .gitattributes
├── project.json                 # + build-devcontainer-image target; lint gains --check
└── __tests__/
    ├── gen-egress-policy.test.mjs
    ├── devcontainer-image-gate.test.mjs
    ├── gen-container-secrets-env.test.mjs
    ├── devcontainer-config.guard.test.mjs
    ├── devcontainer-image-workflow.guard.test.mjs
    └── open-sandbox.guard.test.mjs
.forgejo/workflows/devcontainer-image.yml
docs/runbooks/devcontainer.md    # rewritten: bring-up, recreate, re-pin, upgrades, traps, worktrees
openwiki/runbooks/devcontainer.md
external: jumbleknot/mcm-dotfiles install.sh (guard generalised, reviewed before pushing)
```

**Structure Decision**: everything for the container lives under `.devcontainer/`, as in MCM. The scripts join the existing Nx `scripts` project, with their tests in `scripts/__tests__/`. No new Nx project or top-level folder is added.

## Operator steps (outside the repository)

These come from the runbook and are listed here so `tasks.md` can schedule them:

1. **Forge:** set the BELAY repository variables `REGISTRY`, `NS` and `REGISTRY_USER`, and the secret `REGISTRY_TOKEN` (`write:package`).
2. **Image:** dispatch `devcontainer-image` once, then resolve the digest from the registry.
3. **Host:** `sbx create --name belay -m 8g --skills=off shell <empty dir>`, then apply the policy and count the rules.
4. **VM:** install the devcontainer CLI, add the forge registry as an insecure registry and restart with `sbx stop belay`, run `ldconfig`, set the git identity and credential store, write `~/.belay-sandbox-env`, then clone and run `devcontainer up` with `--dotfiles-repository`.
5. **Dotfiles:** review and push the guard change to `jumbleknot/mcm-dotfiles`.

## Complexity Tracking

No constitution violations, so this section is empty.
