# Quickstart: validating the health loop

## §1 Offline (any machine)

```bash
pnpm nx run scripts:lint     # runs every new --selftest
pnpm nx run scripts:test     # unit tests and workflow guards; expect 0 skipped
node scripts/reap-merged-branches.mjs          # a dry run against the real remote: lists keep / would-reap, deletes nothing
node scripts/check-lockfile-refresh.mjs --now 2026-11-25T08:30:00Z
```

**Expect**:
- The reaper prints a reason for every branch.
- `main` is `keep (protected)`.
- A just-created branch is `keep (too-new)`.

## §2 After the merge: the first real report (SC-006)

1. Dispatch the health job:

   ```bash
   node scripts/forge-pr.mjs dispatch renovate-health.yml --ref main
   ```

2. Then check the outcome. **Expect**:
   - the tracking issue `Dependency-bot health reports` exists, labelled `status/bot-managed`;
   - `backlog.mjs ready` does not list it;
   - it has exactly one new comment: one line if healthy, findings otherwise.
3. Dispatch the reaper as a dry run (the default) and read its job log. **Expect**: nothing is deleted.
4. Record the report and the reaper's list on item #48.

## §3 The first Wednesday (2026-11-25 or the next)

At 08:30 UTC the scheduled health job runs.

**Expect**: its lock-file line names the 05:00–06:59 window, and its verdict is `unaided`, or `current` if there was
nothing to refresh.

**A `no-window-run`, `not-scheduled` or `starved` verdict is a real finding**: fix it, do not dismiss it.

## §4 The watchdog (SC-001)

Every bot run executes `--check-freshness`. To prove it can fail, run it with an injected clock 9 days after the last
report:

```bash
node scripts/renovate-health.mjs --selftest
```

**Expect**: the freshness case fails at 8 days + 1 minute, and passes when there is no report yet.
