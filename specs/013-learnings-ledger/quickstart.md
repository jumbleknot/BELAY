# Quickstart: validating the learnings ledger and its log

Run from a **full** clone (not shallow). In the shared dev container, use the feature worktree.

## 1. The tests

```bash
node --test scripts/__tests__/count-repo-metrics.test.mjs
pnpm nx run scripts:test      # includes the coverage gate
```

Expected: every test passes, and the coverage table lists `scripts/count-repo-metrics.mjs` at 70% or more.

## 2. The working copy cannot move a number (SC-001)

```bash
node scripts/count-repo-metrics.mjs --json > /tmp/a.json
echo "x" > scratch-untracked.md && echo "y" >> README.md
node scripts/count-repo-metrics.mjs --json > /tmp/b.json
git checkout -- README.md && rm scratch-untracked.md
diff /tmp/a.json /tmp/b.json && echo IDENTICAL
```

Expected: `IDENTICAL`.

## 3. Refusals

```bash
node scripts/count-repo-metrics.mjs --rev no-such-rev; echo "exit $?"     # exit 1, names the rev
node scripts/count-repo-metrics.mjs --revv HEAD; echo "exit $?"           # exit 2, usage
node scripts/count-repo-metrics.mjs --rev cf9b694 --append-log docs/BELAY-Learnings.md; echo "exit $?"
                                                                          # exit 1 once that column exists
```

## 4. The log is reproducible (SC-003)

For each column in Part 3 of `docs/BELAY-Learnings.md`, run
`node scripts/count-repo-metrics.mjs --rev <column's sha>`, and compare each value with the column. The values are
identical whenever the column's script commit is the current one.

## 5. The document

- [ ] It has Part 1, Part 2, Part 3 and the "How to update" section, plus the "narrative, not a source of truth"
      statement at the top.
- [ ] Every rule links to its home: `node --test --test-name-pattern "links resolve" scripts/__tests__/count-repo-metrics.test.mjs`
      passes, and so does `node scripts/check-openwiki-okf.mjs`.
- [ ] `docs/runbooks/doc-drift.md` has the ledger-and-log step, naming `count-repo-metrics.mjs --append-log`.
- [ ] `openwiki/projects/learnings-ledger.md` is listed in AGENTS.md's knowledge index.
