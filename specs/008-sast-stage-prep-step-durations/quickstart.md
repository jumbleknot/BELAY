# Quickstart: validating feature 008

1. `pnpm nx run scripts:lint && pnpm nx run scripts:test`: green, 0 skipped.
2. `node scripts/sast-prepare.mjs rust` and `… python` on today's tree: each says there is nothing to
   prepare and exits 0.
3. In a scratch clone with a tracked `Cargo.lock` and a project `uv.lock`, `node scripts/sast-prepare.mjs
   python` syncs it; `node scripts/sast-scan.mjs --only cargo-audit,pip-audit` (scanners enabled)
   reports both as run, using the dev container's baked Rust.
4. SC-002: a dispatched run of the throwaway branch (research R7) installs both on the runner.
5. After the merge: `node scripts/ci-status.mjs durations --job sast` shows green-run samples.
