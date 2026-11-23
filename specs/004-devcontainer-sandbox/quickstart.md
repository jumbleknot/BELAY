# Quickstart: validate the dev container end to end (004)

This guide proves the feature works. The full operating procedure, with every trap, belongs to `docs/runbooks/devcontainer.md` once the feature is implemented. Commands marked **[host]** run in Windows PowerShell 5.1, **[VM]** in the sandbox shell (`ssh belay.sbx`), and **[dc]** in the dev container.

## Prerequisites

- **[host]** `sbx version` reports v0.53.0, and `DOCKER_SANDBOXES_DOCKER_SIZE` and `DOCKER_SANDBOXES_ROOT_SIZE` are set at User scope.
- **[host]** Windows OpenSSH (`C:\Windows\System32\OpenSSH\ssh.exe`), VS Code with Remote-SSH and Dev Containers, and Node 24 or later.
- **The forge.** The BELAY repository variables `REGISTRY`, `NS` and `REGISTRY_USER` and the secret `REGISTRY_TOKEN` are set, and at least one `devcontainer-image` run has published an image.
- **The dotfiles.** `mcm-dotfiles` carries the generalised guard (see [research R9](research.md)).

## 1. The allowlist is valid, and its generated form is deterministic

```bash
node scripts/gen-egress-policy.mjs --check                                   # exit 0
node scripts/gen-egress-policy.mjs --format sbx-policy | wc -l               # 102
node scripts/gen-egress-policy.mjs --format sbx-policy --forge-host forge.example.test | tail -1
#   allow network forge.example.test
```

## 2. Create the sandbox and apply the policy before anything pulls

```powershell
# [host] an EMPTY scratch dir; never the repository
New-Item -ItemType Directory -Force "$env:USERPROFILE\sbx-workspaces\belay-vm" | Out-Null
sbx create --name belay -m 8g --skills=off shell "$env:USERPROFILE\sbx-workspaces\belay-vm"
node scripts/gen-egress-policy.mjs --format sbx-policy --forge-host <forge host> |
  ForEach-Object { $d = ($_ -split ' ')[2]; sbx policy allow network $d --sandbox belay }
sbx policy ls belay      # count: 102 + 1 (the forge host)
```

## 3. Provision the VM, clone, and build the dev container

These are the runbook's cold-recreate items: the devcontainer CLI, the insecure-registry entry for the forge, `ldconfig`, and the git identity. The env file holds the variables listed in [the data model](data-model.md).

```bash
# [VM]
set -a; . ~/.belay-sandbox-env; set +a
echo "$BELAY_DEVCONTAINER_IMAGE"          # must contain @sha256:
git clone <origin url> /workspaces/belay
devcontainer up --workspace-folder /workspaces/belay \
  --config /workspaces/belay/.devcontainer/devcontainer.json \
  --dotfiles-repository https://github.com/jumbleknot/mcm-dotfiles
```

**Expected:**
- the `initializeCommand` reports `✓ FORGE_TOKEN (N chars)` and `✓ FORGE_ISSUE_TOKEN (N chars)`;
- `postStart` prints `[assert-egress-governed] PASS`;
- no toolchain layer is rebuilt, because the base image is pulled.

## 4. Open it in one step

```powershell
# [host]
sbx stop belay
.\scripts\open-sandbox.ps1             # starts the sandbox, waits for SSH, VS Code opens in the container
.\scripts\open-sandbox.ps1 -PrintOnly  # prints vscode-remote://dev-container%2B…@ssh-remote%2Bbelay.sbx/workspaces/belay
```

**Expected:** VS Code lands in `/workspaces/belay` inside the container within 3 minutes (SC-001).

## 5. The checks behave as in CI

```bash
# [dc]
node --version; pnpm --version; specify --version; pwsh --version
pnpm nx run scripts:lint && pnpm nx run scripts:test      # same result as CI on this commit (SC-002)
pwsh -NoProfile -File .specify/scripts/powershell/check-prerequisites.ps1 -Json -PathsOnly
```

## 6. Egress is denied by default (SC-003)

```bash
# [dc] blocked hosts: each must fail
for h in example.com en.wikipedia.org api.themoviedb.org stackoverflow.com www.anthropic.com; do
  curl -sS --max-time 10 -o /dev/null "https://$h/" && echo "REACHABLE: $h" || echo "refused: $h"
done
# allowed hosts: each must succeed
for u in https://registry.npmjs.org/ https://github.com/ https://api.anthropic.com/ https://pypi.org/ https://crates.io/; do
  curl -sS --max-time 10 -o /dev/null "$u" && echo "ok: $u" || echo "BLOCKED: $u"
done
```

## 7. No credential value is anywhere it shouldn't be (SC-004)

```bash
# [VM]: each prints nothing if clean. Compare against a value without ever printing it.
img=$(docker inspect --format '{{.Image}}' <dc>)
docker history --no-trunc "$img" | grep -cF "$FORGE_TOKEN"            # 0
docker image inspect "$img" | grep -cF "$FORGE_TOKEN"                 # 0
docker exec <dc> ps -eo args | grep -cF "$FORGE_TOKEN"                # 0
# [dc]
env | grep -c '^ANTHROPIC_API_KEY='                                   # 0
node scripts/ci-status.mjs status --branch main                       # works: FORGE_TOKEN arrived
```

## 8. A recreate keeps logins and RTK (SC-005, SC-006)

```bash
# [VM]
devcontainer up --workspace-folder /workspaces/belay \
  --config /workspaces/belay/.devcontainer/devcontainer.json --remove-existing-container
# [dc]
claude --version && test -s ~/.claude/.claude.json && echo "config persisted"
grep -q 'rtk hook' ~/.claude/settings.json && echo "RTK wired"; rtk gain
```

**Expected:** no re-login is needed, RTK is wired, and the recreate takes under 10 minutes with 0 rebuilt toolchain layers.

## 9. The image workflow builds only when its inputs change

- Push a commit to `main` that touches only docs. `devcontainer-image` runs, its gate prints `build=false`, and no image is published.
- Dispatch the workflow. It builds and publishes, and its summary names `…/belay-devcontainer@sha256:…`.
- Resolve that digest from the registry's `manifests/<sha>` endpoint, re-pin `~/.belay-sandbox-env`, and recreate as in step 8.
