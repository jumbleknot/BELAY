# Quickstart: validating PR and CI-status tooling (002)

## Prerequisites

- `FORGE_TOKEN` is set: a read-only token that can read repository statuses, PRs, branch protection, Actions runs and packages.
- The git credential for `origin` works: `git push` succeeds without a prompt.
- `pnpm install --frozen-lockfile` has been run.

## 1. Read access (also checks FORGE_TOKEN's scopes)

```bash
node scripts/ci-status.mjs status --sha "$(git rev-parse origin/main)"
```

**Expected:** exit 0, and `guardrails / guardrails (push)` is listed as successful. If it exits 2 with "missing scope", regenerate `FORGE_TOKEN` with the scope it names (research R4).

## 2. Failure evidence from feature 001

```bash
node scripts/ci-status.mjs failure --run 8169            # the second deliberate failure on PR #3
node scripts/ci-status.mjs failure --run 8169 --full
```

**Expected:** exit 0. It shows failing step `guardrails-test` and the `deliberate failure #2` assertion, read from `belay-ci-failures`. It finishes in under 10 s (SC-005).

## 3. Durations

```bash
node scripts/ci-status.mjs durations --runs 5
```

**Expected:** per-step timings for `guardrails` from recent bundles. Runs that produced no bundle are noted.

## 4. Tests and selftests

```bash
pnpm nx run scripts:lint      # includes ci-status --selftest
pnpm nx run scripts:test      # includes ci-status, forge-pr and forge-credential tests
```

**Expected:** both exit 0.

## 5. This feature's own PR (SC-001)

```bash
git push origin HEAD:002-pr-ci-tooling
node scripts/forge-pr.mjs open --head 002-pr-ci-tooling --title "Feature 002: PR and CI-status tooling" --body-file <body.md>
node scripts/ci-status.mjs watch --pr <n> --timeout 900
node scripts/forge-pr.mjs merge <n> --expect-head "$(git rev-parse HEAD)"
```

**Expected:**
- `open` prints the PR number and URL;
- `watch` exits 0 once guardrails is green;
- `merge` prints the merge commit, and the branch is deleted on the forge.

## 6. Refusals (SC-003)

Before the real merge in §5:
- `forge-pr merge <n> --expect-head <a different 40-hex sha>` exits 1, names both shas, and merges nothing;
- `forge-pr open --head refs/for/main …` exits 1 and creates nothing;
- `forge-pr merge <n> --expect-head abc123` exits 2.

## 7. The workflow points at the tools (SC-006)

```bash
node scripts/check-speckit-overrides.mjs
grep -n "forge-pr.mjs open" .specify/templates/overrides/tasks-template.md
```

**Expected:** the gate passes, and the "Open the PR" task names `forge-pr.mjs open`, `ci-status.mjs watch` and `forge-pr.mjs merge`.
