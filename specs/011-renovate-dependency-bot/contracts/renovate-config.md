# Contract: the `renovate.json` policy rules

`check-renovate-config.mjs` enforces these rules offline. The guard tests in `scripts:test` run them against the real
`renovate.json` and the real workflow, and the `--selftest` in `scripts:lint` proves each rule can fail. Each rule names
the requirement it holds up. A failure prints the rule ID, the file and the offending key or pin.

| ID | Rule | Holds up |
| --- | --- | --- |
| **C1** | No `automerge` or `platformAutomerge` key anywhere (top level, `packageRules`, `vulnerabilityAlerts`, `lockFileMaintenance`) is set to anything but `false`. | FR-002, SC-003 |
| **C2** | `timezone` is `UTC`. Every `schedule` in the config (top level, `lockFileMaintenance`, every `packageRules[].schedule`) is a list of five-field cron expressions, and each intersects at least one of `renovate.yml`'s `on.schedule` crons. The window cron falls inside the top-level window, and **no** security cron falls inside it. `lockFileMaintenance.schedule` is present. A preset default is never assumed. | FR-004, FR-005, FR-013 |
| **C3** | `vulnerabilityAlerts.schedule` is `[]`, its `minimumReleaseAge` is shorter than the `*` rule's, and `osvVulnerabilityAlerts` is `true`. The worst-case delay (security age + the largest gap between security crons) is ≤ 24 hours. | FR-003, FR-006, SC-001 |
| **C4** | `prHourlyLimit` ≥ 1 and `prConcurrentLimit` > `prHourlyLimit`. The `prPriority` order is `lockFileMaintenance` (set in `packageRules`) > docker base images > docker digest pins > 0. Every rule that sets `groupName` also sets `prPriority`. | FR-004, SC-004 |
| **C5** | `lockFileMaintenance.enabled` is `true`. Every **package-manager** lock file that `lockFileMaintenance` refreshes has its toolchain installed by `renovate.yml`. Today that is `pnpm-lock.yaml` with `install-pnpm.sh`. `.devcontainer/devcontainer-lock.json` is not one: no manager refreshes it, and it is excluded (data-model.md inventory). | FR-005 |
| **C6** | Every detected pin is managed or excluded (data-model, Managed pin). Every custom manager uses `managerFilePatterns`, never `fileMatch`, and captures at least one pin. Every exclusion matches at least one pin. | FR-008, SC-002 |
| **C7** | Every hold carries `Why:`, `item #N` and `Re-check:`. Every approval rule carries `Why:` and `Re-check:`. One rule sets `dependencyDashboardApproval: true` for `matchUpdateTypes: ["major"]`, and no rule sets it on a `patch` or `minor` track except the `spec kit` group. | FR-010, FR-011 |
| **C8** | Each version-and-checksum pair has a `packageRules` entry whose `postUpgradeTasks.commands` is exactly `node scripts/refresh-pin-checksum.mjs <pin>`, with `fileFilters` naming the pin's file. Each such command matches the workflow's `RENOVATE_ALLOWED_COMMANDS`. | FR-009 |
| **C9** | `dependencyDashboard` is `true`, and `dependencyDashboardLabels` is `["status/bot-managed"]`. | FR-014, SC-005 |
| **C10** | Every lockstep group in data-model.md is one `groupName`, whose matchers cover every member (for example `matchManagers` lists both `npm` and `custom.regex` for `nx`). The cooling-off holds too: the `*` rule's `minimumReleaseAge` is "3 days", and docker `pinDigest`/`digest` updates are `timestamp-optional`. | FR-006, FR-007 |
| **C11** | No `openwiki/**/*.md` page's `resource` is a file any manager rewrites. | ADR-0002, spec edge case |

## Shape (abridged; the implementation is authoritative)

```jsonc
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:recommended", "docker:pinDigests", ":semanticCommits"],
  "timezone": "UTC",
  "schedule": ["* 5-6 * * 3"],
  "prHourlyLimit": 4,
  "prConcurrentLimit": 6,
  "labels": ["dependencies"],
  "rebaseWhen": "conflicted",
  "dependencyDashboard": true,
  "dependencyDashboardLabels": ["status/bot-managed"],
  "osvVulnerabilityAlerts": true,
  "vulnerabilityAlerts": { "labels": ["security"], "schedule": [], "minimumReleaseAge": "12 hours" },
  "lockFileMaintenance": { "enabled": true, "schedule": ["* 5-6 * * 3"] },
  "customManagers": [ /* one per row of data-model.md's inventory marked "custom" */ ],
  "packageRules": [ /* cooldown, priorities, groups, holds, approvals, post-upgrade tasks: order is load-bearing */ ]
}
```
