# Contracts: the feature's commands (004)

Every command follows BELAY's conventions:
- No output contains a credential value.
- Diagnostics go to stderr.
- Exit codes are documented and stable.

## `scripts/gen-egress-policy.mjs`

```text
node scripts/gen-egress-policy.mjs --format sbx-policy    [--forge-host <host>] [--file <path>]
node scripts/gen-egress-policy.mjs --format ipset-domains [--forge-host <host>] [--file <path>]
node scripts/gen-egress-policy.mjs --check                [--file <path>]
```

- **`--format sbx-policy`** prints one line per destination: `allow network <domain>`. Lines are ordered by group (`agent`, `source`, `registry`, `packages`, `app`), then by domain alphabetically, so the output is deterministic.
- **`--forge-host <host>`** appends one more line for the forge host. With no forge host the line is left out cleanly: no literal, no error. A host that is quoted, contains a scheme or port, or is otherwise not a bare FQDN or IP literal is refused.
- **`--format ipset-domains`** prints the same domains one per line. It is kept for parity with MovieCollectionManager, and no BELAY consumer uses it.
- **`--check`** validates the file against [the data model](../data-model.md). Each violation is reported as one line naming the offending entry's index and domain.
- **The tool never writes a file.** Callers pipe its output.
- **Exit codes:** 0 ok; 1 a validation failure; 2 a usage error.

## `scripts/devcontainer-image-gate.mjs`

This is ported from MCM with its behaviour unchanged.
- **Inputs:** `GITHUB_EVENT_NAME`, `GATE_BEFORE` and `GITHUB_SHA`.
- **Output:** it appends `build=true|false` to `$GITHUB_OUTPUT`.
- **It writes `build=true`** for:
  - any event other than `push`;
  - a missing or all-zero `before`;
  - any change to an image input (`.devcontainer/toolchain.Dockerfile`, `.devcontainer/Dockerfile`, `.forgejo/workflows/devcontainer-image.yml`, `scripts/install-pnpm.sh` or `scripts/devcontainer-image-gate.mjs`);
  - a change to `package.json`'s `packageManager`.
- **It writes `build=false`** for a push that changed none of these, which includes a `package.json` edit that leaves `packageManager` alone.
- **Fail-safe:** anything it cannot establish means `build=true`.
- **Exit codes:** 0, or 2 for a usage error.

## `scripts/build-devcontainer-image.mjs` (also `pnpm nx run scripts:build-devcontainer-image`)

```text
node scripts/build-devcontainer-image.mjs [--tag <ref>]
```

- It builds `.devcontainer/toolchain.Dockerfile` with the repository root as context, tagged `belay-devcontainer` unless `--tag` is given.
- **It needs an engine with open egress**: CI, or a host engine such as Docker Desktop. It is never run inside the sandbox, where rustup's hosts are blocked (research R5).
- **Exit codes:** 0 built; 1 the build failed; 2 a usage error, a missing Dockerfile, or `docker` not reachable.

## `.devcontainer/check-image-pin.sh` (the first `initializeCommand` step)

- **Input:** `BELAY_DEVCONTAINER_IMAGE`, from the VM shell that runs `devcontainer up`.
- **Behaviour:**
  - set and containing `@sha256:<64 hex>` → prints `✓ pinned: <digest>`;
  - unset, empty, or set without a digest → prints a multi-line `⚠` warning that the build will use the local `belay-devcontainer` tag. The warning says how to source `~/.belay-sandbox-env` with `set -a`, and names the runbook section.
- **It never prints the full reference.** The registry host is topology, so only the digest is shown.
- **Always exits 0.** An offline local build must still be possible.

## `.devcontainer/gen-container-secrets-env.sh` (the second `initializeCommand` step)

- **Source:** `${BELAY_SANDBOX_ENV_FILE:-$HOME/.belay-sandbox-env}`.
- **Output:** `${BELAY_CONTAINER_SECRETS_ENV:-$HOME/.belay-devcontainer-secrets.env}`.
- **Behaviour:**
  - it writes the output from empty, at mode 600;
  - it writes bare `KEY=value` lines for `FORGE_TOKEN` and `FORGE_ISSUE_TOKEN` only;
  - it skips a value that contains a newline, and says so;
  - it prints `✓ NAME (N chars)` for each written variable and `⚠ not provisioned: …` for the rest;
  - a missing source file yields an empty output file and a warning.
- **Always exits 0.** A missing credential must never block the container from starting.

## `.devcontainer/assert-egress-governed.sh` (the `postStartCommand`)

- **Probes:** `EGRESS_BLOCKED_PROBE`, default `example.com`, and `EGRESS_ALLOWED_PROBE`, default `https://registry.npmjs.org/`. Each request has a 10 s timeout.
- **Exit codes:** 0 when the blocked probe is refused and the allowed probe is reached; 1 otherwise, including when `curl` is missing.

## `.devcontainer/fix-workspace-ownership.sh`, `persist-claude-config.sh`, `ensure-rtk-hook.sh`

These are ported from MCM, with BELAY names in their defaults and messages.
- **They always exit 0.** A permissions oddity or a missing personal layer must never block the container from starting.
- **`ensure-rtk-hook.sh`** refuses to overwrite a `settings.json` that is not valid JSON, and backs the file up before it writes.

## `scripts/open-sandbox.ps1` (Windows PowerShell 5.1)

```text
.\scripts\open-sandbox.ps1 [-Sandbox belay] [-Workspace /workspaces/belay]
                           [-Config /workspaces/belay/.devcontainer/devcontainer.json]
                           [-SshHost belay.sbx] [-PrintOnly]
```

1. **It fails with a message naming the runbook** if `sbx` is not on PATH, `sbx ls --format json` fails or cannot be parsed, or the sandbox does not exist.
2. **If the sandbox is stopped**, it runs `sbx run --name <sandbox> -d`. It treats that command's exit code as advisory, and waits up to 120 s for `ssh <SshHost> true` to succeed. It fails only if SSH never answers, and reports the original exit code and output.
3. **It builds** `vscode-remote://dev-container%2B<hex>@ssh-remote%2B<SshHost><Workspace>`, where `<hex>` is the hex of the UTF-8 descriptor `{"hostPath":…,"localDocker":false,"configFile":{"$mid":1,"path":…,"scheme":"vscode-fileHost"}}`.
4. **With `-PrintOnly`** it prints the URI and exits 0. Otherwise it opens the URI with `code --folder-uri`. If `code` is not on PATH, it prints the URI.

## `.forgejo/workflows/devcontainer-image.yml`

- **Triggers:** `workflow_dispatch`; `push` with a `paths` filter on the image inputs and `package.json`; and the schedule `0 6 * * 5`. **No `pull_request` and no `pull_request_target`.**
- **Job:** one job, `build-publish`, on `runs-on: kvm` with `timeout-minutes: 60`.
- **Steps:** the gate, the Docker CLI check, the build, then the push with the digest summary. Every `run:` step goes through `scripts/ci-log-step.sh`. The job ends with the failure-digest step.
- **Configuration:** the variables `REGISTRY`, `NS` and `REGISTRY_USER`, and the secret `REGISTRY_TOKEN`.
