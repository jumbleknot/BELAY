# Research: a self-hosted dependency bot

The sources are:
- MovieCollectionManager's (MCM's) `renovate.json`, `.forgejo/workflows/renovate.yml` and `docs/runbooks/renovate.md`, read through the forge API on 2026-11-24. "Measured" below means MCM measured it on a real run.
- ADR-0004.
- BELAY's own tree.

Each decision gives the decision, the reason and the alternatives considered.

## R1 — How the bot runs: `npx renovate@<exact>` in a `belay` job

**Decision**: a new workflow, `.forgejo/workflows/renovate.yml`, runs on `runs-on: belay`, which is a
`node:26-bookworm` job container with no host Docker. The steps are:
- `actions/setup-node` at 26.13.1;
- `scripts/install-pnpm.sh`;
- `npx --yes --before=<now − 3 days> renovate@<RENOVATE_VERSION>`.

`RENOVATE_VERSION` is an **exact** version, exported from `scripts/check-renovate-config.mjs` and printed with
`--print-renovate-version`. A custom manager manages it, so the bot proposes its own upgrades. The `guardrails` validator
step on that PR runs the proposed version against `renovate.json`, which covers the spec edge case "validated against the
new version before it is used".

**Rationale**:
- MCM measured that a job-level `container: renovate/renovate` fails at setup on a rootless daemon (container in
  container), and BELAY's runner has no Docker at all.
- MCM pinned a **major** because "nothing in this repo can bump this string". An exact version in a regex-managed
  `.mjs` constant removes that reason: the version is visible and reviewed.
- `--before` is MCM's measured fix for two failures. A tarball was listed in npm's index two minutes before it was
  served (E404). And the bot holding the write token was the one thing installed at a minutes-old release, while it holds
  every proposal to three days. `--before` also bounds the age of **transitive** dependencies, which an exact top-level
  version does not.
- Node comes from `setup-node`, before the pnpm install. MCM measured both failure orders: Renovate 44.14.12 raised
  `engines.node` inside the pinned major, and `install-pnpm.sh` installs into the global prefix of whichever Node is on
  PATH.

**Alternatives**:
- The `renovate/renovate` image as a job container, rejected for the reason above.
- A `tools/renovate/package.json` with its own lock file. That would be reproducible, but Renovate's native dependencies
  (for example `re2`) would need `allowBuilds` entries in the workspace, so the bot would become a build dependency of
  BELAY. Rejected; the `--before` bound gives most of the benefit.
- A major pin (MCM's), rejected for the reason above.

**Structural decision**: ADR-0004 approves Renovate itself. `npx` installs it into the throwaway job container, never
into the workspace, so no `allowBuilds` entry, lock file change or new toolchain reaches BELAY.

## R2 — The schedule: UTC, a Wednesday window, security every six hours

**Decision**:
- `timezone: "UTC"`.
- The routine window is `schedule: ["* 5-6 * * 3"]` (Wednesday 05:00–06:59 UTC), triggered by cron `0 5 * * 3`.
- Security runs come from cron `17 1,7,13,19 * * *`. None of those times falls inside the window.
- `lockFileMaintenance.schedule` is set to the **same** window, explicitly.

**Rationale**:
- MCM's worst silent failure was a window that its cron never intersected, because the cron was UTC and the window was
  in `America/New_York` across DST. Four weekly windows were lost without anyone noticing. A UTC window removes the
  whole class. The FR-013 guard still checks the intersection, and it checks it for every `schedule` in the config.
- Wednesday falls after the Tuesday image sweep (feature 010). A base-image CVE found on Tuesday morning then gets its
  re-pin PR in the next window, as well as through the security channel if it is fixable.
- The window is two hours wide, so a run that queues behind the sweep still lands inside it.
- `config:recommended` gives `lockFileMaintenance` its own default schedule, `before 4am on monday`, which overrides the
  top level. Leaving it unset means a setting that is on but never runs. MCM measured this.

**Alternatives**:
- MCM's local-timezone window with a DST-straddling cron, rejected: it is the measured failure.
- A nightly security run, MCM's shape. With a cooling-off period (R4) and a nightly cadence, the worst case is longer
  than the 24 hours of SC-001, so it is rejected (see R4).

## R3 — Limits and priority

**Decision**:
- `prHourlyLimit: 4` and `prConcurrentLimit: 6`. Concurrent stays above hourly.
- `packageRules` priorities:
  - `lockFileMaintenance` at `prPriority: 5`, set in packageRules (inside the `lockFileMaintenance` block MCM measured
    it as silently ignored);
  - docker base-image versions at 3;
  - docker `pinDigest` and `digest` updates at 2;
  - everything else at 0, set **explicitly** on each later grouping rule.

**Rationale**:
- With one window run a week, `prHourlyLimit` is the weekly throughput.
- MCM measured that a spent hourly budget also blocks branch **creation**, and that `lockFileMaintenance` sorts last,
  so a capped budget starved the lock-file refresh entirely. The priorities produce the FR-004 order.
- A later rule that sets `groupName` inherits an earlier rule's `prPriority` unless it sets its own. MCM measured this.
- BELAY has about 20 managed dependencies, so 4 PRs a week clears a normal week and makes a backlog visible.

## R4 — Security updates: OSV, outside the schedule, a 12-hour cooling-off

**Decision**:
- `osvVulnerabilityAlerts: true`.
- `vulnerabilityAlerts` set to `{ "labels": ["security"], "minimumReleaseAge": "12 hours", "schedule": [] }`.
- No `dependencyDashboardApproval` on any patch or minor track.

**Rationale**:
- Forgejo has no advisory API, so native `vulnerabilityAlerts` alone does nothing there. MCM measured this; OSV is the
  source.
- Security branches bypass the schedule and the PR limits.
- The worst case is a fix published just after a run: 12 hours of cooling-off, then up to 6 hours to the next run, so
  about 18 hours. That meets SC-001's 24 hours with a cooling-off still in place, which FR-006 requires.
- An approval gate on a patch track would make a security patch wait for a tick. MCM measured this.

**Alternatives**:
- MCM's `1 day` age with a nightly run. The worst case is about 48 hours, which fails SC-001.
- No cooling-off for security fixes. That is a weaker supply-chain posture for the token that can push branches, so
  rejected.

## R5 — Release age and timestamps

**Decision**:
- `{ "matchPackageNames": ["*"], "minimumReleaseAge": "3 days" }`.
- For docker `pinDigest` and `digest` updates, and for `ghcr.io/` and `quay.io/` images:
  `minimumReleaseAgeBehaviour: "timestamp-optional"`.
- A `logLevelRemap` turns the expected "did not have a releaseTimestamp" warning into info.
- `RENOVATE_DOCKER_MAX_PAGES: '10'` in the run step's environment. It is a global-only option.

**Rationale**:
- Under Renovate 44's `timestamp-required` default, a release with no timestamp stays pending **forever**.
- Digest updates are aged against a version timestamp they often cannot have.
- Docker Hub returns 403 to anonymous requests from page 11. On a cold cache, a request past page 10 throws away every
  timestamp, so every Docker Hub update shows "pending" indefinitely. This is the spec's edge case, as MCM measured it.
- The remap keeps the dashboard's "Repository Problems" section for real problems.

## R6 — Lock-file maintenance and toolchains on PATH

**Decision**: `lockFileMaintenance.enabled: true`, with the window schedule (R2). pnpm is the **only** artifact
toolchain the job needs, and `install-pnpm.sh` installs it at `packageManager`. BELAY tracks no `Cargo.lock` and no
`uv.lock`.

**Rationale**:
- A channel whose binary is missing from PATH dies silently. It shows only as
  `WARN: execa promise rejection suppressed`, and the channel never appears. MCM measured this.
- The guard (contract C5) fails if a new lock-file manager appears without the job installing its toolchain.
- Lock-file maintenance re-resolves ranges with no grouping. This is why the constitution requires lockstep groups to be
  exact, and `check-toolchain-consistency.mjs` already enforces that for `nx`.

## R7 — Version-and-checksum pins move together: a post-upgrade task

**Decision**: the three version-and-sha256 pairs are:
- `TRIVY_PIN` in `install-trivy.mjs`;
- `RUSTUP_VERSION` and `RUSTUP_INIT_SHA256` in `sast-prepare.mjs`;
- `CARGO_AUDIT_VERSION` and `CARGO_AUDIT_SHA256` in `sast-prepare.mjs`.

A custom manager moves each version. Each pair's `packageRule` then runs a **`postUpgradeTasks`** command,
`node scripts/refresh-pin-checksum.mjs <pin>`, which:
1. reads the new version from the file;
2. downloads that version's asset;
3. hashes it;
4. **requires the publisher's checksum to agree**: Trivy's `trivy_<v>_checksums.txt`, rustup's `rustup-init.sha256`, and
   the digest that GitHub's release API reports for the cargo-audit asset;
5. rewrites the sha256 in place.

Any failure exits non-zero and leaves the file unchanged.

`allowedCommands` is a global option, set in the workflow environment. It permits exactly
`^node scripts/refresh-pin-checksum\.mjs (trivy|rustup-init|cargo-audit)$`.

**The second barrier, in CI**: a guardrails step runs `refresh-pin-checksum.mjs --verify-changed`, which re-derives
and checks every pair whose file changed against the base. Only a PR that moves a pair downloads anything. A PR where
the version and the checksum disagree therefore fails a required check, so it cannot merge.

**Rationale**:
- FR-009 says one PR moves both, or the PR cannot land. MCM's shape moves the version only and leaves the PR red
  "until a human copies the sha256", so the PR still opens, half-bumped.
- With the publisher's checksum as the cross-check, a bot-derived sha256 is never trusted alone.
- Today only the Trivy pair is exercised by PR CI (`image-scan.yml`'s path trigger). The rustup and cargo-audit pairs run
  only when a `Cargo.lock` is tracked, which none is, so without `--verify-changed` a wrong digest would merge unseen.

**Alternatives**:
- MCM's version-only bump plus a human copying the digest. That is weaker than FR-009 allows.
- Excluding the pairs from the bot. That leaves three supply-chain pins with nothing moving them.

**Known limitation**: when the post-upgrade task fails, Renovate still opens the PR, carrying an artifact-failure
notice. FR-009's "or not at all" therefore holds for *merging*, through the required check, not for opening. The runbook
says to close nothing by hand (R10) and to let the next run retry.

## R8 — Pin inventory: what the bot sees, and the guard (FR-008)

**Decision**: `check-renovate-config.mjs` enumerates every pin in the tree with fixed detectors, and checks that each
one is managed or excluded:
- action `uses: …@<40-hex>` → `github-actions` (built in);
- `node-version:` → `github-actions` (built in);
- `FROM …@sha256:` → `dockerfile` (built in);
- `package.json` dependencies and `packageManager` → `npm` (built in);
- the script constants (`*_PIN`, `*_VERSION`, `*_TOOLCHAIN`, `*_SHA256`, and the `version:` and `sha256:` fields of a
  frozen pin object);
- Dockerfile `ARG *_VERSION=`, `--default-toolchain <v>` and versioned installer URLs;
- `.specify/init-options.json` `speckit_version`.

A detected pin passes when one of these holds:
1. A built-in manager owns its kind.
2. A custom manager's `managerFilePatterns` matches its file **and** one of the manager's `matchStrings` captures it,
   checked offline against the file.
3. It is listed in `security/dependencies/unmanaged-pins.yaml`, with a reason.

Every custom manager must also capture at least one pin. A manager that matches nothing looks the same as one with no
work to do, which MCM measured.

The built-in `github-actions` manager extracts `actions/setup-node`'s `node-version` as the dependency `node`, with the
`node-version` datasource, so it needs no custom manager. A custom one would extract it twice. This comes from
[the github-actions manager documentation](https://docs.renovatebot.com/modules/manager/github-actions/) and
[a renovate discussion](https://github.com/renovatebot/renovate/discussions/36129). The first dry run confirms it in
"Detected Dependencies" (quickstart §3).

**Today's inventory** is in [data-model.md](data-model.md#the-pin-inventory-measured-2026-11-24).

**Rationale**:
- An invisible pin is the same as no bot for that pin.
- The detectors are deliberately broad. A false positive costs one exclusion line. A false negative is the silent case.

## R9 — Holds, approvals and automerge (FR-002, FR-010, FR-011)

**Decision**:
- `automerge` is never true. The guard refuses the key on any rule set to anything other than `false`, and refuses any
  `platformAutomerge`.
- **Every major update needs dashboard approval**, through one rule:
  `{ "matchUpdateTypes": ["major"], "dependencyDashboardApproval": true }`. Every BELAY dependency is toolchain, and
  BELAY has no stateful components, so "toolchain and stateful majors" (FR-011) means every major.
- A **hold** is a rule that sets `enabled: false`, `allowedVersions` or `ignoreDeps`. Its `description` must carry
  three things:
  - `Why:`;
  - a backlog reference (`item #N`);
  - `Re-check:`.

  The guard fails the run and names the rule otherwise. Today's holds:
  - **`actions/upload-artifact` `allowedVersions: "<4"`**: Forgejo's artifact backend rejects v4 with
    `GHESNotSupportedError`. MCM measured this. A new backlog item tracks it, and the re-check is a Forgejo release that
    supports the v4 artifact API.
  - **`npm` `depType: engines`, disabled**: `engines.node` is the toolchain floor that
    `check-toolchain-consistency.mjs` rule 1 reads. It is raised by hand when the package manager's own `engines`
    rises. Item #47 records the decision.
  - **`belay-devcontainer` (the image BELAY builds), disabled**: BELAY builds this image itself and pins it by digest,
    in `open-sandbox` and the devcontainer configuration. There is no upstream to look up. Item #47 records the decision.
  - **Spec Kit (`SPECKIT_VERSION`, together with `.specify/init-options.json`)**: one group, with
    `dependencyDashboardApproval` on **every** update type. A raw version bump without `specify integration upgrade`
    leaves the checked-in scripts behind the CLI (docs/runbooks/spec-kit.md). It is approval, not a hold, so it needs
    `Why:` and `Re-check:`.

**Rationale**:
- An unexplained hold looks exactly like a forgotten one.
- ADR-0004: a merge here is a release to consumers.

## R10 — Dashboard, labels and the backlog (FR-014)

**Decision**:
- `dependencyDashboard: true`, with `dependencyDashboardLabels: ["status/bot-managed"]`.
- `backlog.mjs ready` **excludes** any item carrying `status/bot-managed`.
- The label joins the taxonomy that `backlog.mjs labels` creates, together with `dependencies` and `security`, the labels
  bot PRs carry.
- The repository setting **delete branch after merge** is on, and `forge-pr.mjs merge` already deletes the head branch.

**Rationale**:
- Agents read `ready`, and a bot issue listed as ready work misleads them.
- MCM's dashboard label is `status/bot-managed`. A label, not a title match, because Renovate may retitle the issue.
- MCM measured that with `rebaseWhen: conflicted` a surviving merged branch is reused verbatim and opens an empty PR.
- Hand-closing a Renovate PR marks the update rejected, and pushing to a bot branch by hand fights the bot. The runbook
  says both. MCM measured both.

## R11 — Run modes, the verdict and loud failure (FR-015, FR-016)

**Decision**:
- **Dispatch** takes a `dryRun` boolean, **default true**. It sets `RENOVATE_DRY_RUN=full` through one job-level
  assignment.
- A dispatched run posts a `renovate/mode` commit status before Renovate starts, with `always()` and
  `continue-on-error`. This forge cannot read a step's resolved expression or its logs, so the status is the only
  record of the mode. MCM measured this.
- **Preflight**: the run fails at the first step, by name, if `RENOVATE_TOKEN` is empty, or if `GET /user` with it is
  refused.
- **Verdict**: Renovate runs with `LOG_FORMAT=json` and `RENOVATE_LOG_FILE`. Then
  `check-renovate-config.mjs --run-verdict <log>` passes only when:
  - a `repository finished` record for this repository has `result: done`;
  - the log has no `ERROR` or `FATAL` record.

  Otherwise it exits 1 and names the record. Missing or refused credentials, an unreachable registry and an invalid
  config therefore fail through the failure digest, never as "nothing to update".

**Rationale**: Renovate can finish a repository with a non-`done` result and still exit 0. The spec rules out "success
having done nothing". The verdict makes the run's own record the authority, not the exit code.

## R12 — Validation (FR-012), CI rules (FR-017) and the wiki (ADR-0002)

**Decision**:
- `renovate-config-validator --strict --no-global renovate.json` runs at the pinned version:
  - in the bot workflow before every run (blocking);
  - in a new step of the `guardrails` job on every PR, so it is a required check.

  `--no-global` is load-bearing. Without it the file is validated as a global config, and a stale key exits 0. MCM
  measured this.
- The offline policy checks (contracts C1–C6) run in `scripts:test` as tests, and `check-renovate-config.mjs --selftest`
  runs in `scripts:lint`.
- Every `run:` step goes through `ci-log-step.sh`, and the failure digest runs last. The new job publishes evidence
  bundles, so `belay-ci-failures` `keepNewest` rises from 125 to **150** (25 durations runs × 6 bundle jobs). The
  retention guard computes that floor.
- A guard fails if any `openwiki/` page's `resource` is a file the bot rewrites (ADR-0002).

**Alternatives**: validating only when `renovate.json` changes. That misses a Renovate release that changes the meaning
of an unchanged config, because no PR runs. MCM measured this. The bot workflow's pre-run validation covers that case.
The guardrails step covers edits.

## R13 — The bot's credential

**Decision**:
- **A dedicated Forgejo user** (`belay-renovate`), a collaborator on this repository with **Write** access and nothing
  else.
- Its token, `RENOVATE_TOKEN`, is a repository Actions secret with the scopes `read:user`, `read:organization`,
  `write:repository` and `write:issue`. MCM measured each one: a missing scope shows as a 403 on that call.
- **Optional, recommended**: `RENOVATE_GITHUB_COM_TOKEN`, a github.com token with read access to public repositories
  only. github.com's anonymous API limit is 60 requests an hour per IP, and the runner's IP is shared with MCM's bot.
  The lookups for Trivy, uv, PowerShell, Spec Kit, cargo-audit and the actions, plus changelogs, would compete for it.
  The secret takes the `RENOVATE_` prefix because Forgejo reserves `GITHUB_`.
- The token is never in the dev container. `secrets-management.md` gains both rows.

**Rationale**: FR-001. Forgejo tokens are account-wide, so a dedicated account is the only way the scope limit means
anything.
