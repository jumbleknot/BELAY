# Data model: a self-hosted dependency bot

Files are the storage. `renovate.json` is Renovate's own schema, with the policy rules in
[contracts/renovate-config.md](contracts/renovate-config.md). This page defines the entities the guards read and the
fields they constrain.

## Managed pin

A version or digest in the tree that the bot tracks. Pins are computed by the detectors in
`check-renovate-config.mjs` (research R8), never stored.

| Field | Constraint |
| --- | --- |
| `ManagedPin.file` | Repository-relative POSIX path of a tracked file. Required. |
| `ManagedPin.line` | 1-based line number of the pinned value. Required. |
| `ManagedPin.kind` | One of `action-sha`, `node-version`, `image-digest`, `npm`, `package-manager`, `script-constant`, `dockerfile-arg`, `installer-url`, `toolchain-flag`, `init-option`. Required. |
| `ManagedPin.value` | The pinned string, exactly as written. Required, non-empty. |
| `ManagedPin.managedBy` | `builtin:<manager>`, `custom:<index>` (the custom manager's position in `customManagers`), or `excluded`. Exactly one. A pin that matches none of the three is the FR-008 failure. |
| `ManagedPin.checksumOf` | For a `script-constant` that is a sha256, the name of the version pin it belongs to (`trivy`, `rustup-init`, `cargo-audit`). The checksum is managed through its pair's post-upgrade task (research R7), never by a manager of its own. |

## Exclusion

A pin the bot deliberately does not manage. Stored in `security/dependencies/unmanaged-pins.yaml` as a list.

| Field | Constraint |
| --- | --- |
| `Exclusion.file` | Repository-relative path. Required. Must exist. |
| `Exclusion.match` | A regular expression, without slashes, that must match the excluded line's text. Required. An exclusion that matches no detected pin is **stale** and fails the guard, the same rule as an unmatched allowlist entry in feature 010. |
| `Exclusion.reason` | Free text, at least 20 characters. Required. |
| `Exclusion.addedBy` | Who added it, and in which feature or item. Required. |

No expiry: an exclusion is a property of the file, such as a test fixture, not a waiver of a finding.

## Hold

A `renovate.json` `packageRules` entry that limits or disables updates (research R9). It is recognised by setting
`enabled: false`, `allowedVersions` or `ignoreDeps`.

| Field | Constraint |
| --- | --- |
| `Hold.description` | Required. Renovate allows a string or an array of strings; the guard joins them. Must contain `Why:`, a backlog reference matching `item #\d+`, and `Re-check:`. |
| `Hold.matcher` | At least one `match*` key. A hold that matches everything is refused. |

**Approval rules**, which set `dependencyDashboardApproval: true`, are not holds. They need `Why:` and `Re-check:`, but
no backlog reference.

## Group

| Field | Constraint |
| --- | --- |
| `Group.groupName` | Unique across `packageRules`. |
| `Group.prPriority` | Set explicitly on every rule that sets `groupName` (research R3). |
| `Group.members` | The `matchPackageNames` / `matchDepNames`, with `matchManagers` naming **both** `npm` (or the built-in manager) **and** `custom.regex` when a lockstep set spans both. MCM measured that a rule matching only one manager half-bumps the set. |

The lockstep groups today:
- `node toolchain`: the `FROM node:` digest and tag, and every `node-version:`;
- `nx`: `nx` and every `@nx/*`;
- `rust toolchain`: `RUST_TOOLCHAIN` and `--default-toolchain`;
- `uv`: the Dockerfile and guardrails installer URLs;
- `spec kit`: `SPECKIT_VERSION` and `speckit_version`.

## Dashboard

Renovate's single tracking issue. Its title is Renovate's default, `Dependency Dashboard`. It carries the label
`status/bot-managed` (`Dashboard.label`, required, the value `backlog.mjs ready` excludes). The bot owns its body: no
human edits the prose, retitles, relabels or closes it. Ticking a checkbox is the only allowed interaction.

## Run verdict

The bot workflow's result, derived from Renovate's JSON log (research R11).

| Field | Constraint |
| --- | --- |
| `RunVerdict.result` | Renovate's `repository finished` result. `done`, `no-work` and `not-scheduled` pass. Every other value fails, reported by name (see below). |
| `RunVerdict.errors` | The count of `level >= 50` (ERROR) records. Must be 0. |
| `RunVerdict.repository` | Must be `jumbleknot/BELAY`. A log with no `repository finished` record for it fails, as "the run never reached the repository". |

`not-scheduled` is a pass on the security cron, because routine work defers by design. `no-work` is a pass. Every other
non-`done` result fails: `disabled`, `blocked`, `uninitiated`, any `*-error`, or an absent record.

## The pin inventory, measured 2026-11-24

| Pin | Where | Managed by |
| --- | --- | --- |
| `actions/checkout`, `actions/setup-node`, `actions/upload-artifact` SHAs (13 sites) | `.forgejo/workflows/*.yml` | `builtin:github-actions`; `upload-artifact` held at `<4` |
| `node-version: 26.13.1` (5 sites) | `.forgejo/workflows/*.yml` | `builtin:github-actions` (dependency `node`), group `node toolchain` |
| `node:26-bookworm@sha256:…` | `.devcontainer/toolchain.Dockerfile` | `builtin:dockerfile`, group `node toolchain` / `docker digest pins` |
| `ARG BASE_IMAGE=belay-devcontainer` | `.devcontainer/Dockerfile` | held (`belay-devcontainer` is built here) |
| `packageManager: pnpm@12.21.0`, `nx`, `yaml` | `package.json` | `builtin:npm` |
| `engines.node: >=24` | `package.json` | held (the toolchain floor) |
| `TRIVY_PIN.version` and `.sha256` | `scripts/install-trivy.mjs` | custom (github-releases `aquasecurity/trivy`) and its checksum |
| `SEMGREP_PIN` | `scripts/sast-scan.mjs` | custom (pypi `semgrep`) |
| `RUST_TOOLCHAIN`, `--default-toolchain 1.100.0` | `scripts/sast-prepare.mjs`, `.devcontainer/toolchain.Dockerfile` | custom (`rust-version`), group `rust toolchain` |
| `RUSTUP_VERSION` and `RUSTUP_INIT_SHA256` | `scripts/sast-prepare.mjs` | custom (github-tags `rust-lang/rustup`) and its checksum |
| `CARGO_AUDIT_VERSION` and `CARGO_AUDIT_SHA256` | `scripts/sast-prepare.mjs` | custom (github-releases `rustsec/rustsec`, tag `cargo-audit/v…`) and its checksum |
| `astral.sh/uv/0.13.9/install.sh` (2 sites) | `.devcontainer/toolchain.Dockerfile`, `.forgejo/workflows/guardrails.yml` | custom (github-releases `astral-sh/uv`), group `uv` |
| `ARG SPECKIT_VERSION=v1.4.2`, `speckit_version: 1.4.2` | `.devcontainer/toolchain.Dockerfile`, `.specify/init-options.json` | custom (github-releases `github/spec-kit`), group `spec kit`, approval on every update |
| `ARG POWERSHELL_VERSION=7.6.5` | `.devcontainer/toolchain.Dockerfile` | custom (github-releases `PowerShell/PowerShell`) |
| `RENOVATE_VERSION` (new) | `scripts/check-renovate-config.mjs` | custom (npm `renovate`) |
| `docker-outside-of-docker@sha256:…` | `.devcontainer/devcontainer-lock.json` | **excluded**: the lock file is written by the devcontainer CLI, which the bot's job does not have (research R6) |
| `node:26-bookworm@sha256:…` allowlist key | `security/images/allowlist.yaml` | **excluded**: a finding key that the re-pin PR deletes by hand (spec edge case) |
| `astral.sh/uv/0.13.9` in the SAST rule's test fixture and comment | `security/sast/rules/belay-ci-curl-pipe-shell.*` | **excluded**: fixtures that test the rule, not installs |
| `speckit_version: ">=…"` in `.specify/extensions/*` and `.specify/workflows/*` | Spec Kit-owned files | **excluded**: compatibility ranges owned by Spec Kit, rewritten by `specify integration upgrade` |
