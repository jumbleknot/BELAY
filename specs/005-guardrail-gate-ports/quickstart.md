# Quickstart: validating feature 005

Run these from the worktree root after `CI=true pnpm install --frozen-lockfile`.

1. **Everything CI runs**: `pnpm nx run scripts:lint && pnpm nx run scripts:test`. Both pass with
   0 skips, and the lint output shows each new gate's selftest and scan line.
2. **Topology scrub bites** (item #2): append a real-shaped host, built from fragments, to a scratch
   tracked file. `node scripts/check-topology-scrub.mjs` exits 1 and names it. Revert, and it exits 0.
   `node scripts/check-topology-scrub.mjs --bogus` exits 2.
3. **Toolchain gate bites** (item #1): change `nx` in `package.json` to `^24.0.6`.
   `node scripts/check-toolchain-consistency.mjs` exits 1 and names `nx`. Revert.
4. **Wiki staleness** (item #28): append a line to a file some page cites as its `resource`.
   `node scripts/check-openwiki-okf.mjs` exits 1 with a V17 line. `node scripts/wiki-refresh.mjs
   --stale` lists the page. Revert, and both are clean.
5. **Governance**: `node scripts/check-openwiki-governance.mjs` exits 0. Adding a paragraph outside
   the index in `AGENTS.md` makes it exit 1.
6. **Retention** (item #32): `node --test scripts/__tests__/registry-retention.test.mjs` passes. With
   `FORGE_URL` and a read token set, `node scripts/registry-retention.mjs --package belay-devcontainer`
   prints keep/delete rows. `--apply` exits 2, because the config says `mode: report`.
