# Quickstart: validating the coverage gate

Run everything from a worktree with a real `pnpm install` (the Nx targets refuse a symlinked
`node_modules`). The CLI is in [contracts/check-coverage-cli.md](contracts/check-coverage-cli.md), and the
policy fields are in [data-model.md](data-model.md).

## 1. The gate passes on the landing tree (SC-002)

```bash
pnpm nx run scripts:test --skip-nx-cache
```

Expect:
- every test passes, with **0 skipped**;
- the last line is `[coverage] ✅ … modules ≥ 70% lines …`, with `scripts/sast-scan.mjs` at or above 70%;
- `scripts/coverage-policy.yaml` has `exceptions: []`.

## 2. It refuses each failure shape (SC-001)

Make each change on a scratch branch, and revert it afterwards.

| Change | Expected last lines |
| --- | --- |
| Add `scripts/zz-untested.mjs` with a function no test imports | `✗ scripts/zz-untested.mjs — no coverage data …`, exit 1 |
| Delete the tests added for `toSarif`/`normalizeCargoAudit`/`emitProposedAllowlist` | `✗ scripts/sast-scan.mjs — 67.x% lines, floor 70%`, exit 1 |
| Run `node scripts/check-coverage.mjs --report <a truncated copy of the report>` | total or module failures, or `report … empty`, exit 1 |
| Delete `coverage/scripts.lcov`, then run `node scripts/check-coverage.mjs` | fails closed: report missing, exit 1 |

## 3. Local and CI agree (SC-003)

Compare the summary line from step 1 with the `Script unit tests (scripts:test)` step of the PR's
`guardrails` run (`node scripts/ci-status.mjs failure --pr <n>` on a red run, or the job log). The total
must agree to within 0.1 points.

## 4. The self-test can fail (SC-005)

Make `check-coverage.mjs`'s per-module comparison always pass, then run
`node scripts/check-coverage.mjs --selftest`. It must exit 1, naming the below-floor scenario. Revert,
and record the result in the PR.

## 5. The cost (SC-004)

```bash
node scripts/ci-status.mjs durations --job guardrails   # guardrails-test, before and after the merge
```

The `guardrails-test` step's run time grows by no more than 50%. R4 measured +1% locally.

## 6. The documents (SC-006)

- The register of unenforced rules has no "nothing measures coverage" row for `scripts/`.
- Its spec-before-code row records the item 54 decision.
- The testing-tiers, validation-checklist and Nx pages name the coverage gate.
