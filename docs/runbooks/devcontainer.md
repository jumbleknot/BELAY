# Runbook: the dev container

BELAY's development environment is a dev container inside a dedicated Docker Sandbox microVM,
`belay`, on the Windows host. The VM holds the checkout at `/workspaces/belay`, its own container
engine and the persistent volumes. All its outbound traffic is default-deny, governed host-side by
one committed allowlist. The container is built from a digest-pinned toolchain image that CI
publishes. Design and decisions: [specs/004-devcontainer-sandbox/](../../specs/004-devcontainer-sandbox/plan.md).

Where each command runs:
- **[host]**: Windows PowerShell 5.1 on the workstation;
- **[VM]**: the sandbox shell (`sbx exec -i belay sh -s`, or `ssh belay.sbx`);
- **[dc]**: the dev container, which is a VS Code terminal or `docker exec -u coder <dc>` from the VM.

## Daily use

**[host]** `.\scripts\open-sandbox.ps1`. It starts the sandbox if it has idle-stopped, waits for SSH,
and opens VS Code directly in the container at `/workspaces/belay`. From stopped to VS Code was
measured at 9 s. `-PrintOnly` prints the URI instead, which is useful for a shortcut. If script
execution is blocked: `powershell -ExecutionPolicy Bypass -File .\scripts\open-sandbox.ps1`.

**The VM idle-stops about 30 s after the last session**, with no setting to change that. The container
comes back on its own (`--restart=always`). To keep it up for a long job, hold a session open, for
example `ssh belay.sbx 'sleep 5400'`.

## What is where

| Thing | Where | Survives a container recreate? | Survives `sbx rm`? |
| --- | --- | --- | --- |
| The checkout | `/workspaces/belay` on the VM root volume (a clone, not a host mount) | yes | **no** |
| Claude Code login, settings, plugins, RTK, the `gh` login | volume `belay-claude` → `/home/coder/.claude` (`CLAUDE_CONFIG_DIR`, `GH_CONFIG_DIR`) | yes | **no** |
| pnpm store / shell history | volumes `belay-pnpm-store` / `belay-commandhistory` | yes | **no** |
| Image pin, forge tokens | `~/.belay-sandbox-env` on the VM (mode 600) | yes | **no** |
| Egress policy | host-side, per sandbox (`sbx policy ls belay`) | yes | **no** |
| Worktrees | `/home/coder/worktrees/` in the container | **no** | no |

## Credentials

AI-assisted coding runs on the **subscription**. **`ANTHROPIC_API_KEY` must never be set** on the
host, in the VM or in the container, because Claude Code silently prefers it over a subscription
login and bills per token. The VM itself carries `ANTHROPIC_API_KEY=proxy-managed`, which is sbx's
marker and not a key. It never reaches the container, which receives only the two forge tokens.

How the forge tokens reach the container, and why each other route is wrong:
- They live in `~/.belay-sandbox-env` on the VM, as `KEY='value'` lines with no `export`, mode 600.
- At every `devcontainer up`, `initializeCommand` runs `.devcontainer/gen-container-secrets-env.sh`,
  which re-emits them as bare `KEY=value` lines into `~/.belay-devcontainer-secrets.env`. That file
  is passed by `docker run --env-file`, which does no quote processing.
- **Never** in `containerEnv`: the devcontainer CLI compiles it into image `ENV` layers.
- **Never** `docker run -e NAME=value`: argv is visible to every user through `ps`.
- **Never paste `docker inspect <container>` output.** An `--env-file` value is, by design, in the
  running container's environment, and `docker inspect` prints it. Measured: 0 occurrences in the
  image history, the image config, the process list and the `devcontainer up` log, and 1 in the
  container's runtime config.

**Git credentials.** The VM keeps the forge credential in git's `store` helper (`~/.git-credentials`,
mode 600). The container has no credential file of its own: git there uses the helper VS Code
forwards. So `git push` and `node scripts/forge-pr.mjs` work in a **VS Code terminal**, and not in a
bare `docker exec` shell. The read-only `FORGE_TOKEN` and `FORGE_ISSUE_TOKEN` work everywhere.

## Bring-up from nothing

Prerequisites **[host]**:
- `sbx version` reports **v0.53.0** (see [Upgrading sbx](#upgrading-sbx)).
- `DOCKER_SANDBOXES_DOCKER_SIZE=250GB` and `DOCKER_SANDBOXES_ROOT_SIZE=40GB` at User scope. They are
  read at creation only; after setting them, run `sbx daemon stop; sbx ls`. The engine disk was
  raised from 150GB to 250GB on 2026-11-23. A sandbox created before then keeps its 150GB engine
  disk until it is recreated (`lsblk` in the VM shows it).
- Windows OpenSSH (`C:\Windows\System32\OpenSSH\ssh.exe`). Git Bash's ssh cannot resolve `<name>.sbx`.
- VS Code with Remote-SSH and Dev Containers, Node 24 or later, and `FORGE_TOKEN` and
  `FORGE_ISSUE_TOKEN` as user environment variables.
- A published image pin (see [Re-pin the image](#re-pin-the-image)).

1. **Create the sandbox [host]**, with an EMPTY scratch directory as its workspace. `sbx` mounts its
   workspace read-write, so never pass the repository.
   ```powershell
   New-Item -ItemType Directory -Force "$env:USERPROFILE\sbx-workspaces\belay-vm" | Out-Null
   sbx create --name belay -m 8g --skills=off shell "$env:USERPROFILE\sbx-workspaces\belay-vm"
   ```
2. **Apply the egress policy before anything pulls [host].** A global `default-deny-all` policy
   already refuses everything; this adds the allow rules for `belay` only.
   ```powershell
   $forge = ([Uri](git remote get-url origin)).Host
   node scripts/gen-egress-policy.mjs --format sbx-policy --forge-host $forge |
     ForEach-Object { sbx policy allow network ($_ -split ' ')[2] --sandbox belay }
   sbx policy ls belay      # "allow 103 hosts", fallback "deny when no rule decides"
   ```
3. **Provision the VM [VM].** The shell kit has git, docker and curl, but **no Node**, and its own
   package repository (`dhi.io`) is not on the allowlist. Debian's `npm` package cannot install either,
   because it conflicts with the kit's patched system libraries. So install the official Node tarball
   (on the allowlist as `nodejs.org`), verify it, and install the devcontainer CLI with it:
   ```bash
   V=v24.14.1; F=node-$V-linux-x64.tar.gz; cd /tmp      # .tar.gz: the kit has no xz
   curl -fsSLO "https://nodejs.org/dist/$V/$F"
   curl -fsSL "https://nodejs.org/dist/$V/SHASUMS256.txt" | grep " $F\$" | sha256sum -c -
   sudo tar -xzf "$F" -C /usr/local --strip-components=1 --no-same-owner && rm -f "$F"
   sudo /usr/local/bin/npm install -g @devcontainers/cli
   sudo mkdir -p /workspaces && sudo chown agent:agent /workspaces
   ```
4. **Configure the VM's engine and git**, from **Git Bash on the host**. Every value is piped over
   stdin into `sbx exec -i`; `printf` is a bash builtin, so no value appears in any process's argv.
   Set the variables once:
   ```bash
   SBX="$LOCALAPPDATA/DockerSandboxes/bin/sbx.exe"; SB=belay
   ORIGIN=$(git remote get-url origin)                                   # in your BELAY checkout
   FORGE_HOST=$(echo "$ORIGIN" | sed -E 's#^[a-z]+://([^/:]+).*#\1#')     # <forge-host>
   FORGE_AUTH=$(echo "$ORIGIN" | sed -E 's#^[a-z]+://([^/]+)/.*#\1#')     # <forge-host>:3000
   FORGE_SCHEME=$(echo "$ORIGIN" | sed -E 's#^([a-z]+)://.*#\1#')
   OWNER=$(echo "$ORIGIN" | sed -E 's#^[a-z]+://[^/]+/([^/]+)/.*#\1#')
   ```
   - **The insecure registry.** The forge registry is plain HTTP. The kit has no `/etc/docker`, so
     create it:
     ```bash
     printf 'sudo mkdir -p /etc/docker && printf "{\\n  \\"insecure-registries\\": [\\"%%s\\"]\\n}\\n" "%s" | sudo tee /etc/docker/daemon.json >/dev/null && sudo chmod 644 /etc/docker/daemon.json\n' "$FORGE_AUTH" \
       | MSYS_NO_PATHCONV=1 "$SBX" exec -i $SB sh -s
     MSYS_NO_PATHCONV=1 "$SBX" stop $SB; MSYS_NO_PATHCONV=1 "$SBX" run --name $SB -d
     ```
     Restart with `sbx stop` and `sbx run`, because `/etc/init.d/docker restart` fails (PID 1 is not
     an init system). Check with `docker info | grep -A1 'Insecure Registries'` in the VM.
   - **Git identity and the forge credential.** The credential goes from the host's helper straight
     into the VM's store:
     ```bash
     printf 'git config --global user.name "%s"\ngit config --global user.email "%s"\ngit config --global credential.helper store\n' \
       "$(git config user.name)" "$(git config user.email)" | MSYS_NO_PATHCONV=1 "$SBX" exec -i $SB sh -s
     printf 'protocol=%s\nhost=%s\n\n' "$FORGE_SCHEME" "$FORGE_AUTH" | git credential fill \
       | MSYS_NO_PATHCONV=1 "$SBX" exec -i $SB git credential approve
     ```
5. **Write `~/.belay-sandbox-env`**, from Git Bash on the host. It holds `KEY='value'` lines with no
   `export`, at mode 600, and never an `ANTHROPIC_API_KEY` line. `PIN` is the digest-pinned
   reference from [Re-pin the image](#re-pin-the-image):
   ```bash
   PIN="$FORGE_AUTH/$OWNER/belay-devcontainer@sha256:<digest>"
   printf "BELAY_DEVCONTAINER_IMAGE='%s'\nFORGE_REGISTRY_HOST='%s'\nFORGE_TOKEN='%s'\nFORGE_ISSUE_TOKEN='%s'\n" \
     "$PIN" "$FORGE_HOST" "$FORGE_TOKEN" "$FORGE_ISSUE_TOKEN" \
     | MSYS_NO_PATHCONV=1 "$SBX" exec -i $SB sh -c 'umask 077; cat > ~/.belay-sandbox-env'
   ```
   Check it in the VM: `stat -c '%a' ~/.belay-sandbox-env` prints `600`, and
   `cut -d= -f1 ~/.belay-sandbox-env` lists the four keys.
6. **Log the VM's engine in to the registry [VM].** The image package is private:
   `set -a; . ~/.belay-sandbox-env; set +a; printf %s "$FORGE_TOKEN" | docker login <forge-host>:3000 -u <owner> --password-stdin`,
   then `docker pull "$BELAY_DEVCONTAINER_IMAGE"`. The image is about 4.2 GB.
7. **Clone and bring the container up [VM].**
   ```bash
   git clone <origin url> /workspaces/belay          # as `agent`, uid 1000 like `coder`
   set -a; . ~/.belay-sandbox-env; set +a
   devcontainer up --workspace-folder /workspaces/belay \
     --config /workspaces/belay/.devcontainer/devcontainer.json \
     --dotfiles-repository https://github.com/jumbleknot/mcm-dotfiles 2>&1 | tee ~/devcontainer-up.log
   ```
   **Expect:**
   - `[check-image-pin] ✓ pinned: sha256:…`;
   - `✓ FORGE_TOKEN (N chars)` and `✓ FORGE_ISSUE_TOKEN (N chars)`;
   - the RTK build and 14 plugins from the personal layer. This took about 6 minutes the first time,
     and it is skipped once installed;
   - `[assert-egress-governed] PASS`;
   - `"outcome":"success"`.
8. **Log in once [dc]**, in a VS Code terminal (open it with `.\scripts\open-sandbox.ps1`):
   - Claude Code: `claude`, then `/login` and choose the **subscription**;
   - GitHub: `gh auth login`, choosing GitHub.com, HTTPS and the browser.

   Both logins persist on the `belay-claude` volume.
9. **Check it [dc]:** `pnpm nx run scripts:lint && pnpm nx run scripts:test` pass. All 667 tests pass
   with 0 skips in the container, because Linux runs the bash tests the Windows host skips.

## Recreate the dev container

A change to `containerEnv`, `mounts` or a lifecycle command applies only to a **new** container. A
plain `devcontainer up` re-attaches to the existing one and reports success.

```bash
# [VM]
cd /workspaces/belay && git pull --ff-only
set -a; . ~/.belay-sandbox-env; set +a
echo "$BELAY_DEVCONTAINER_IMAGE"     # must end in @sha256:<digest>
devcontainer up --workspace-folder /workspaces/belay \
  --config /workspaces/belay/.devcontainer/devcontainer.json \
  --remove-existing-container --dotfiles-repository https://github.com/jumbleknot/mcm-dotfiles
```

This was measured at 31–41 s with 0 toolchain layers rebuilt, and no re-login. Traps:
- **Without `set -a`**, the pin is sourced but not exported, and the build silently uses the local
  `belay-devcontainer` tag. `check-image-pin.sh` now prints a `⚠` warning when that happens. Never
  ignore it.
- **`devcontainer-lock.json` blocks the first `git pull`.** The first `devcontainer up` writes it into
  the VM's clone. Once it is committed upstream, `git pull` refuses ("untracked working tree files
  would be overwritten"). Compare it with the committed copy, delete the untracked one, then pull.
- **`--config` must be absolute.** It resolves against the current directory otherwise.

## Re-pin the image

`.forgejo/workflows/devcontainer-image.yml` publishes `belay-devcontainer:<commit sha>`, but only after its
image scan passes: a fixable Critical publishes nothing (see [image-scanning.md](image-scanning.md)). It runs on
a push to `main` that touches an image input, on dispatch, and on Fridays (see
[ci.md](ci.md#the-devcontainer-image-workflow)). The forge cannot read back the step summary, so
resolve the digest from the registry:

```bash
# from any machine with FORGE_TOKEN (read:package)
curl -sS -I -u "<owner>:$FORGE_TOKEN" \
  -H "Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json" \
  "http://<forge-host>:3000/v2/<owner>/belay-devcontainer/manifests/<commit sha>" | grep -i docker-content-digest
```

Update `BELAY_DEVCONTAINER_IMAGE` in `~/.belay-sandbox-env` with that digest. Then
`docker pull "$BELAY_DEVCONTAINER_IMAGE"` and recreate. The packages API's first row is an
attestation, not the image, so never take the digest from there.

**Record the pin so retention keeps it.** The weekly
[`registry-retention`](ci.md#the-registry-retention-workflow) workflow keeps the newest **4**
`belay-devcontainer` versions, or every version younger than **21 days**, whichever keeps more. A pin
older than that window survives only if it is listed under `protect:` in
[`infrastructure-as-code/forgejo/registry-retention.yaml`](../../infrastructure-as-code/forgejo/registry-retention.yaml).
So after every re-pin, open a PR that adds the digest there and removes the one it replaces:

```yaml
protect:
  - { package: belay-devcontainer, digest: sha256:<digest>, note: sandbox pin, 2026-11-23 }
```

The digest is neither a secret nor a host, so it may be committed. The registry host stays in the VM's
env file. **Re-pin before recreating the sandbox, too**: once retention runs in apply mode, an
unrecorded pin older than the window can disappear.

Retention ships in **report** mode: it prints what it would keep and delete, and deletes nothing.
Switching to apply takes two steps. First, a PR that flips `mode: report` to `mode: apply`, linking a
reviewed report. Then a dispatch of the workflow with `apply: true`. The schedule itself never
deletes.

**A local build** (`pnpm nx run scripts:build-devcontainer-image`, tag `belay-devcontainer`) needs an
engine with **open egress**, such as CI or Docker Desktop. **It never works inside the sandbox**,
because rustup fetches from hosts the allowlist deliberately does not carry.

## Egress

- **Change a destination** in `.devcontainer/egress-allowlist.json`, with a group and a reason, and
  check it with `node scripts/gen-egress-policy.mjs --check` (also run by `scripts:lint`). Then apply
  it to the running sandbox: `sbx policy allow network <domain> --sandbox belay`. A committed entry
  does nothing until it is applied, and templates do not carry the policy.
- **The approval queue.** Every refusal queues an entry in `sbx policy approval ls`. **Dismiss**
  entries; never approve one, because that bypasses the committed list.
- **Matching is per FQDN.** A front door and its download host are separate entries, for example
  `github.com` and `release-assets.githubusercontent.com`. Follow a redirect chain with
  `curl -sSL -o /dev/null -w '%{url_effective}\n' <url>`.
- **Judge a probe by curl's exit code.** `nc -z` reports blocked hosts as open, and curl's `000` status
  is a placeholder.
- **The self-check** (`assert-egress-governed.sh`) runs at every real container start, and fails if
  `example.com` is reachable or `registry.npmjs.org` is not. It does not run on a Docker-level restart
  after an idle-stop. The host-side policy enforces either way.

## Shared dev container: commit from a worktree

**Several assistant sessions share one container and one checkout.** They share the filesystem,
the pnpm store and, the part that causes damage, **the git index and the checked-out branch**.
`git checkout -b`, `git add`, `git stash` and `git rebase` in `/workspaces/belay` are not private
acts. They change what every other session is looking at, mid-edit. The damage lands silently on
the *other* session, which sees files it did not write, a branch it did not create, or its
half-finished work swept into someone else's commit by `git add -A`.

**So never commit or switch branches in `/workspaces/belay` when another session may be active.
Add a worktree instead:**

```bash
git fetch -q origin main
git worktree add -b <branch> /home/coder/worktrees/<slug> origin/main
ln -sfn /workspaces/belay/node_modules /home/coder/worktrees/<slug>/node_modules
```

Treat "another session may be active" as the default when you have not checked. In Claude Code, the
session list shows the others. A worktree costs seconds, and a collision costs someone else's work.

### Traps

- **`/home/coder/...`, never `/workspaces/.worktrees/...`.** `/workspaces` itself is not writable.
  Only the checkout inside it is. The wrong path fails with a bare `Permission denied` that reads
  like a git problem rather than a path problem.
- **A symlinked `node_modules` is enough for `node --test` and the `scripts/*.mjs` gates, and for
  nothing that runs through `pnpm nx`.** pnpm checks dependencies before running a target, decides
  the symlinked tree is foreign, and refuses:

  ```text
  ERR_PNPM_UNSAFE_MODULES_DIR  Refusing to remove the modules directory at
  "/workspaces/belay/node_modules" because its resolved target is not a strict
  subdirectory of the project root at "/home/coder/worktrees/<slug>"
  ```

  That reads like a permissions bug in the target. Two plausible workarounds both fail, so don't
  spend the time: `npm_config_verify_deps_before_run=false` does not suppress the check, and
  `cp -al` cannot hardlink the tree because `/workspaces` and `/home/coder` are different devices
  (`Invalid cross-device link`). The only fix is a real install in the worktree:

  ```bash
  cd /home/coder/worktrees/<slug>
  rm -f node_modules                          # the symlink
  CI=true pnpm install --frozen-lockfile      # CI=true answers pnpm's purge prompt
  ```

  It writes only inside the worktree, and the content-addressed store is shared, so it does not
  disturb the other session. **Decide from the diff.** BELAY's required checks, `scripts:lint` and
  `scripts:test`, are Nx targets, so a change you push should be proven through them, which needs
  the real install.
- **`.gitignore` says `node_modules` with NO trailing slash. Keep it that way.** A trailing slash
  matches only a directory, so the symlink would not be ignored and `git add -A` would commit it.
  `git diff --stat` does not list untracked files, so reviewing the diff does not catch it. CI then
  checks out a symlink where pnpm needs a directory, and every install fails with
  `ENOTDIR: not a directory`, which reads like a broken toolchain. With any symlink into the main
  checkout, check `git status --porcelain`, not `git diff`, before committing.
- **Nx can hand you a STALE failure.** If an Nx failure's message doesn't match what is on disk,
  re-run it with `--skip-nx-cache` before diagnosing it.
- **A fresh worktree lacks gitignored files**, such as local `.env` files or generated reports. A
  gate that reads one rather than generating it fails in a way that looks like a code failure. Copy
  the input across from the main checkout. That is a missing input, not a missing capability.
- **Reads and forge-API work need no worktree.** `git fetch`, `git log`, `git show`, and everything
  done through the forge API (`forge-pr.mjs`, `ci-status.mjs`, `backlog.mjs`) are safe from the
  shared checkout. Only operations that move `HEAD` or touch the index need a worktree.

### A worktree does not survive a rebuild

`/home/coder/worktrees/` is on the container's own filesystem, so a rebuild deletes it, while
`git worktree list` (read from the checkout's `.git`, on the mounted volume) still lists it, marked
`prunable`. **Push the branch before any risky container operation.** A pushed branch and a merged
PR survive; uncommitted worktree changes do not. Afterwards, run `git worktree prune` in
`/workspaces/belay`.

### Cleanup

Clean up when the branch merges, or the next session inherits a stale tree:

```bash
git worktree remove /home/coder/worktrees/<slug>
git worktree prune
```

## Recreate or resize the sandbox

`sbx rm belay --force` removes **everything listed in "What is where"** except the host's scratch
directory. Before it:
1. Push every branch, and back up anything not in git. Worktrees under `/home/coder/worktrees/` go
   with the container in any case.
2. Back up the VM home: `tar czf belay-vm-home.tgz .git-credentials .gitconfig .belay-sandbox-env`,
   then check the archive is not empty with `tar tzf belay-vm-home.tgz | wc -l`. A `tar` given an empty
   list writes a 45-byte archive without complaint.
3. Then follow [Bring-up from nothing](#bring-up-from-nothing). Expect to log in to Claude Code and
   `gh` again, because the `belay-claude` volume goes with the sandbox.

**To resize**, change the User-scope size variables, run `sbx daemon stop; sbx ls`, then do a full
recreate. Sizes are read at creation only. Check them in the VM with `lsblk | grep ^vd; df -h / /var/lib/docker`.

## Upgrading sbx

`sbx` is pre-1.0, and it is the layer that enforces isolation and egress, so treat an upgrade as a
security change:
1. Read the release notes for changes to policy semantics, `--network=host`, ports, idle-stop,
   secrets and templates.
2. **[host]** `sbx daemon stop`, then `winget upgrade --id Docker.sbx --version <X>`.
3. Re-run the checks: `sbx policy ls belay` (count and fallback), a container start
   (`[assert-egress-governed] PASS`), and quickstart step 6 in
   `specs/004-devcontainer-sandbox/quickstart.md`.
4. Record the new version here and in the prerequisites above.

## Traps

- **`sbx start` does not exist** and prints help without complaint. Use `sbx run --name belay -d`.
  Without `--name`, `sbx run`'s positional argument is an agent, so it creates a second sandbox.
- **`sbx run` can report "docker daemon failed to start" while the engine is starting normally.** Its
  readiness budget is shorter than the engine's restore time. Trust SSH answering, as the launcher
  does, not the exit code.
- **Reading `sbx ls --format json` from Windows PowerShell 5.1:** `ConvertFrom-Json` emits a JSON
  array as one object. Unroll it before filtering by name, or `.status` becomes every sandbox's status.
  Measured 2026-11-23: the launcher reported a stopped `belay` as running because `mcm` was up. It is
  fixed in `scripts/open-sandbox.ps1` and guarded.
- **Git Bash rewrites `/workspaces/...` arguments** passed to `sbx.exe`. Prefix the command with
  `MSYS_NO_PATHCONV=1`, or feed a script on stdin (`sbx exec -i belay sh -s < script.sh`).
- **Run git inside the container, not as `ssh belay.sbx 'git …'`.** Both users are uid 1000 now, but
  `fix-workspace-ownership.sh` repairs a mismatch at every start if one appears.
- **`gh` logins:** without `GH_CONFIG_DIR` on the volume, every recreate logged `gh` out. That was
  measured and fixed on 2026-11-23.
- **The socat relay.** `DOCKER_HOST=unix:///var/run/docker-host.sock` bypasses the feature's relay,
  which returns empty output with exit 0 for any `docker exec` slower than 0.5 s. Check with
  `docker run --rm busybox sh -c "sleep 3; echo ok"`, which must print `ok`.
- **The memory cap** is 5 GiB in an 8 GiB VM (`--memory=5g`). An out-of-memory kill lands in the
  container rather than on the VM's engine.
- **Token usage capture is not wired** in this container (backlog item #33).
