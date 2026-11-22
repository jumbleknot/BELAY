# Quickstart: validating Guardrails CI (001)

## Prerequisites

- Node 24 or later locally.
- `CI_DIGEST_TOKEN` set as a BELAY repository Actions secret (already done).
- The `ci-homelab` runner online.

## 1. Local: workspace and targets

```bash
bash scripts/install-pnpm.sh          # or: npm i -g pnpm@12.21.0 once
pnpm install --frozen-lockfile
pnpm nx run scripts:lint              # expect: every gate and selftest ✓
pnpm nx run scripts:test              # expect: all script tests pass
node scripts/check-speckit-overrides.mjs   # still works with no install
```

**Expected:** all exit 0. `git status` is clean afterwards: `node_modules/` and `.nx/` are ignored.

## 2. First CI run (US1)

Push the branch and open a PR to `main`.

**Expected:**
- one `guardrails` run, on `ci-homelab`, green;
- no second run from the push event.

Record the exact status-context string the PR shows in `docs/runbooks/ci.md`.

## 3. Failure digest (US2)

On the PR branch, add a throwaway commit that makes one script test fail.

**Expected:**
- the run is red;
- one PR comment starting `<!-- ci-digest:job=guardrails -->` names the failing step and shows a redacted tail;
- the comment links the evidence bundle in the `belay-ci-failures` package.

Push a second failing commit.

**Expected:** the same comment is updated, and there are still exactly one per job.

Revert the throwaway commit. **Expected:** green.

This is the SC-003 and SC-004 evidence. It goes in the PR's closing comment, not in `tasks.md`.

## 4. Digest can't change the outcome (SC-005)

Covered by the ported digest tests: with an invalid token, exit 0 and the job result unchanged. Optionally, watch it live on a run where the secret is unavailable: the digest falls back to the run token or the inline log.

## 5. Coverage gate (US3, SC-006)

```bash
pnpm nx run scripts:lint   # after adding, on a scratch branch, a job with no digest step
```

**Expected:** exit 1, naming the workflow and the job. Adding `# ci-digest-exempt: <reason>` to the job makes it pass, and a blank reason fails.

## 6. Branch protection (US4, SC-007)

Follow `docs/runbooks/ci.md` → "Branch protection".

**Expected:**
- `git push origin HEAD:main` is refused;
- a PR whose guardrails failed shows merge blocked.

## 7. No MCM leftovers (SC-008)

```bash
git grep -niE 'mcm|movie|tmdb.*(feature|item)|mc-service|komodo' -- scripts .forgejo package.json nx.json pnpm-workspace.yaml docs/runbooks/ci.md
```

**Expected:** only the deliberate `tmdb-*` vendor-key rule names in `secret-scan.mjs` and its tests.
