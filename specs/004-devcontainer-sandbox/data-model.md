# Data model: Dev container on Docker Sandbox (004)

This feature stores no application data. Its "entities" are configuration artefacts. Each one has a single home, an owner and validation rules, and some have states.

## Egress allowlist: `.devcontainer/egress-allowlist.json` (committed)

| Field | Type | Rules |
| --- | --- | --- |
| `$comment`, `$schemaNotes`, `$mustNeverAppearHere`, `$consideredAndExcluded` | documentation | Carried over from MovieCollectionManager (MCM). Never read by the generator. |
| `$removedFromMcmBaseline` | object: domain → `{ why }` | New in BELAY. Lists the one MCM destination left out (`api.themoviedb.org`), with a non-empty reason. |
| `destinations[]` | array | 102 entries at creation, and at least one always. Each `domain` is unique. |
| `destinations[].domain` | string | Lowercase FQDN, optionally with a leading `*.`. Never an IP, a host and port, a URL, or a `.ts.net` address. |
| `destinations[].group` | enum | `agent`, `source`, `registry`, `packages` or `app`. |
| `destinations[].reason` | string | Non-empty, and neutral: no MCM component name, MCM file path, `--sandbox mcm` example, or MCM feature, item or proposal number (checked by a test). Measured facts and dates stay. |
| `destinations[].cdnRotating` | boolean, optional | Informational in BELAY, because there is no ipset form in use. |

**Relationships.** `scripts/gen-egress-policy.mjs` turns the list into enforcement form. The forge host is added at generation time and is never stored. The list is applied **per sandbox** with `sbx policy allow network`, so a change takes effect only after it is applied to `belay`.

## Sandbox environment file: `~/.belay-sandbox-env` (VM only, never committed)

| Key | Secret? | Used by |
| --- | --- | --- |
| `BELAY_DEVCONTAINER_IMAGE` | no | `build.args.BASE_IMAGE`. Must contain `@sha256:` for a pinned build. |
| `FORGE_REGISTRY_HOST` | no (topology) | `containerEnv`, and `--forge-host` when generating the policy |
| `FORGE_TOKEN` | yes | `ci-status.mjs`, and reads in `backlog.mjs` |
| `FORGE_ISSUE_TOKEN` | yes | writes in `backlog.mjs` and `taskstoissues.mjs` |

**Rules.**
- Lines are `KEY='value'`, with no `export`. The file has mode 600.
- It is sourced only as `set -a; . ~/.belay-sandbox-env; set +a`.
- `ANTHROPIC_API_KEY` must never appear in it.

## Container secrets file: `~/.belay-devcontainer-secrets.env` (VM only, generated)

`.devcontainer/gen-container-secrets-env.sh` derives it at every `initializeCommand`.

**Rules.**
- Lines are bare `KEY=value`.
- Only `FORGE_TOKEN` and `FORGE_ISSUE_TOKEN` are written.
- A value containing a newline is skipped.
- The file has mode 600 and is rewritten from empty each time.

## Toolchain image: `belay-devcontainer`

| Attribute | Value |
| --- | --- |
| Source | `.devcontainer/toolchain.Dockerfile` |
| Published ref | `<registry>/<ns>/belay-devcontainer:<git sha>` |
| Pin used | `<registry>/<ns>/belay-devcontainer@sha256:<digest>`, held in `BELAY_DEVCONTAINER_IMAGE` |
| Local fallback tag | `belay-devcontainer` (no colon) |
| Must contain | the toolchain at the repository's pins |
| Must not contain | any credential or personal tool, or any `ENV` holding a credential |

**States.** A pin moves from *published* to *pinned*, when it is set in the VM's env file, to *superseded*, when a newer pin is set, and then to *expired*, when retention deletes it. Recreate only from a pin that still exists, and re-pin first when in doubt.

## Sandbox: `belay`

| Attribute | Value |
| --- | --- |
| VM memory | 8 GiB |
| Disks | Sizes are read at creation from `DOCKER_SANDBOXES_DOCKER_SIZE` and `DOCKER_SANDBOXES_ROOT_SIZE`. |
| Workspace | An empty scratch directory on the host. The clone is at `/workspaces/belay` on the VM root volume. |
| Policy | Per sandbox, applied at creation from the allowlist |
| SSH alias | `belay.sbx` |

**States.** *Running* changes to *stopped* about 30 s after the last session ends. `sbx run --name belay -d` returns it to *running*. `sbx rm --force` removes the VM, the clone, its engine, its volumes and its policy; nothing survives.

## Persistent volumes (on the sandbox's engine)

| Volume | Mount | Holds |
| --- | --- | --- |
| `belay-claude` | `/home/coder/.claude` | Claude credentials, `.claude.json` (through `CLAUDE_CONFIG_DIR`), settings, plugins, projects, and `tools/bin/rtk` |
| `belay-pnpm-store` | `/home/coder/.local/share/pnpm/store` | the pnpm content-addressed store |
| `belay-commandhistory` | `/commandhistory` | shell history |

They survive a container recreate, but not `sbx rm`.

## Markers (container environment)

| Variable | Value | Read by |
| --- | --- | --- |
| `BELAY_DEVCONTAINER` | `1` | the guard tests, and scripts that need to know they run in the container |
| `BELAY_DEVCONTAINER_PLATFORM` | `sandbox` | the egress check's messages |
| `DEVCONTAINER_PERSONAL_LAYER` | `1` | the `mcm-dotfiles` guard, once generalised |
