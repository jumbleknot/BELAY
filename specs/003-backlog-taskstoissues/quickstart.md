# Quickstart: validating backlog tooling and tasks-to-issues (003)

## Prerequisites

- `FORGE_ISSUE_TOKEN` (`write:issue`) and `FORGE_TOKEN` (read-only) are set.
- `pnpm install --frozen-lockfile` has been run.

## 1. Tests, the gate and the selftests

```bash
pnpm nx run scripts:lint      # the Spec Kit gate now covers the project-owned taskstoissues skill
pnpm nx run scripts:test      # includes backlog.test.mjs
```

**Expected:** both exit 0.

## 2. Reads

```bash
node scripts/backlog.mjs list --state all
node scripts/backlog.mjs show 1
node scripts/backlog.mjs validate-form
```

**Expected:**
- issue #1 is listed, with a total;
- `show 1` prints its body;
- `validate-form` reports the backlog form once it's on the default branch, or "zero templates present" before that.

## 3. Labels (live, once)

```bash
node scripts/backlog.mjs setup-labels --dry-run   # lists the 9 labels it would create
node scripts/backlog.mjs setup-labels             # creates them
node scripts/backlog.mjs setup-labels             # creates nothing
node scripts/backlog.mjs update 1 --add-label type/tech-debt --add-label priority/p2
node scripts/backlog.mjs ready
```

**Expected:** issue #1 carries both labels and appears in `ready` (SC-005).

## 4. Refusals (no writes happen)

```bash
node scripts/backlog.mjs create --title "x" --body-file - --label type/nope   < /dev/null   # exit 2, unknown label
node scripts/backlog.mjs update 1 --milestone 999-nope                                      # exit 2, unknown milestone
env -u FORGE_ISSUE_TOKEN node scripts/backlog.mjs comment 1 --body-file -  < /dev/null      # exit 3
```

## 5. Tasks to issues (SC-001)

Run `/speckit-taskstoissues` on `specs/003-backlog-taskstoissues/tasks.md`.

**Expected:**
- milestone `003-backlog-taskstoissues` exists;
- one issue per task, titled `T0NN: …`;
- `ready` shows the first task.

Run it again. **Expected:** "0 created". Then check the issue count in the milestone:

```bash
node scripts/backlog.mjs list --state all --milestone 003-backlog-taskstoissues --json
```

## 6. The PR (SC-006)

Use `forge-pr open`, then `ci-status watch --pr <n>`, then `forge-pr merge <n> --expect-head <sha>`. These are the "Open the PR" steps from the tasks-template override.
