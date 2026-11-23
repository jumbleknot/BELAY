# Quickstart: validating feature 007

In the dev container, from the worktree root:

1. `pnpm nx run scripts:lint && pnpm nx run scripts:test`: green, 0 skipped.
2. `pnpm nx run scripts:sast`, then `node scripts/check-dependency-downgrade.mjs --base origin/main`:
   exit 0, "no package resolution moved into a known advisory … (1 lockfile(s) checked)".
3. `node scripts/check-dependency-downgrade.mjs --base no-such-ref`: exit 1. With `--native` pointing
   at a missing file: exit 1. With no `--base`: exit 2.
4. Demonstration (research R8): in a throwaway worktree, pin `yaml` to `2.2.1` in `package.json`,
   `pnpm install --no-frozen-lockfile`, run the full scan; the gate exits 0, the check exits 1 naming
   `yaml 2.9.0, 2.9.1 -> 2.2.1 enters GHSA-f9xv-q969-pqx4`. Discard the worktree.
5. CI: the PR's `guardrails / sast` runs the "no package resolution moves INTO a known advisory" step,
   green.
