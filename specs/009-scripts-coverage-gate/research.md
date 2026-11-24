# Research: Coverage gate for the scripts project

All measurements were taken on 2026-11-24 with Node v26.13.1, in a worktree of `main` at `7c06b83` plus this
feature's spec commit. The experiments for R1 and R2 used throwaway modules outside the repository.

## R1. Does code run as a separate process count toward coverage?

**Measured: yes.** A test that ran a module only through `spawnSync(process.execPath, ['src/spawned.mjs', 'run'])`
reported that module at 100% of lines **and** branches. Both branches had run only in the child. The
test runner's coverage collection reaches child Node processes, so a script tested by running it as a
command is measured like one that is imported.

**Consequence for the spec's edge case:** no file needs tests that import it just to be measured. The
per-file floor holds against today's tests as they are.

**Also measured, the trap the spec names:** a module that **no test loads** is absent from the
report: from the text table and from the lcov output, even when it matches `--test-coverage-include`.
It is not reported at 0%. So the gate cannot trust the report's file list (R5).

## R2. The built-in threshold, and why a gate script is still needed

`--test-coverage-lines=<n>` works: a 72.73% total against a threshold of 99 printed
`72.73% line coverage does not meet threshold of 99%` and exited 1. It checks only the **total**, though.
It cannot enforce the per-module floor (FR-002), and it cannot see modules missing from the report
(FR-004).

**Decision:** keep the measurement on the built-in tooling, with no new dependency and so no structural
decision. Judge the result with a small gate script that reads the lcov report.

Alternatives considered:
- `c8` or `nyc`. Rejected: a new dependency, and the per-file and missing-file checks still need code
  of our own, because neither tool fails on a file that was never loaded unless it is told which files
  exist (c8's `--all` comes close, but it is a dependency added for one flag).
- The built-in threshold alone. Rejected: total only (above).

## R3. The report format

`--test-reporter=lcov --test-reporter-destination=<file>` writes one record per measured module, with
`SF:` (a **repository-relative** path, e.g. `SF:scripts/backlog.mjs`), `DA:<line>,<hits>`, `LF:` (lines
found) and `LH:` (lines hit), ended by `end_of_record`. Reporters stack: `--test-reporter=spec
--test-reporter-destination=stdout` keeps the human output alongside it.

**Decision:** gate on `LH / LF` per record, and on `ΣLH / ΣLF` for the total. Branch figures (`BRF`/`BRH`)
are printed, never gated (FR-011).

## R4. What coverage costs

Two runs of the whole suite, back to back: **36.66 s plain, 37.04 s with coverage and the lcov reporter**
(+1%). SC-004 allows +50%. **Decision:** measure inside the existing test run instead of running the
suite twice. The `scripts:test` target becomes "run the tests with coverage, then gate".

## R5. The source set, and the stale-report trap

The measured set is `scripts/*.mjs` plus `scripts/lib/*.mjs`. At baseline that is 38 modules, and all 38
appeared in the lcov report. Tests (`scripts/__tests__/**`) and fixtures fall outside both patterns.

The gate takes **the file system** as the list of source modules, not `git ls-files`, so a new script
that has not been added to git yet still counts when run locally. Any module in the set but not in the
report fails as `no coverage data` (FR-004).

**A stale report is the second trap.** If the gate read whatever report the last run left behind, a run
that crashed before writing one would be judged on the previous run's numbers. **Decision:** the gate's
`--run` mode deletes the report, runs the tests, and fails closed if no report exists afterwards
(FR-006). The include patterns are written **once**, in the policy file. `--run` builds the test
runner's `--test-coverage-include` flags from them, so the measured set and the judged set cannot drift
apart.

## R6. Where the floor and the exceptions live

**Decision:** `scripts/coverage-policy.yaml` holds `floor`, `include` and `exceptions`. Each exception has:
- `module`;
- `floor`, which must be ≥ 50;
- `reason`;
- `addedBy`;
- `expiry`.

Expiry reuses `scripts/allowlist-expiry.mjs` (`classifyExpiry`, `WARNING_WINDOW_DAYS`), the single home
of expiry semantics. An expired exception stops applying, and one inside the 14-day window warns.
`yaml` is already a workspace dependency (used by `sast-scan.mjs`).

**Why under `scripts/`:** Nx's `test` target is cached with inputs `{projectRoot}/**/*`. With the policy
inside the project root, a change to the floor invalidates the cache. A policy outside it would let a
cached pass survive a raised floor.

Alternatives considered:
- The floor in `project.json` flags. Rejected: no home for exceptions with reasons, and the gate
  could not read it as data.
- JSON. Rejected: an exception's reason is prose, and YAML takes comments.

## R7. Raising the SAST orchestrator above the floor

`sast-scan.mjs`: 1,216 lines found, 824 hit (67.76%). It needs **28 more lines** to reach 70%. The
largest uncovered blocks are paths that run real scanners (`runSemgrep`, `runCargoAudit`, `runPipAudit`,
`main`'s scan path). Three **pure** transforms are also uncovered, and they are testable without any
scanner:

| Function | Uncovered lines |
| --- | --- |
| `toSarif` (SARIF output) | 20 |
| `normalizeCargoAudit` (cargo-audit → findings) | 33 |
| `emitProposedAllowlist` (the proposed-allowlist file) | 27 |

**Decision:** export these three and test their observable outputs, roughly 80 lines and well past
the 28 needed, with margin. Do not add scanner-running tests to reach the number.

## R8. How a failure reaches the reader

CI's `Script unit tests (scripts:test)` step already runs through `scripts/ci-log-step.sh guardrails-test`,
and the failure digest carries a failing step's output tail. **Decision:** the gate prints its verdict
**last**: the modules below the floor, worst first, then the total. That way the digest's tail is the
verdict. No workflow change is needed (FR-008, FR-010).

## R9. Where the gate's self-test runs

Every gate's `--selftest` runs in `scripts:lint`. **Decision:** `check-coverage.mjs --selftest` goes there
too. It needs no test run, because it judges synthetic lcov text. The real gate runs at the end of
`scripts:test`, where the report exists.

## R10. A coverage run nested inside a coverage run (measured)

The `--run` end-to-end test starts `node --test --experimental-test-coverage` against a fixture **from
inside** the outer, coverage-measured suite. R1 showed that child processes inherit the outer run's
coverage collection. The inner run's report could therefore pick up the outer run's environment, or the
outer report could absorb the fixture's modules, although those fall outside `include` and would be ignored.

**Measured 2026-11-24 (T003), and the risk was real, but in a different variable.** In a scratch project,
a test running under `node --test --experimental-test-coverage` started a nested
`node --test --experimental-test-coverage --test-reporter=lcov --test-reporter-destination=inner.lcov`. The test
process carries `NODE_TEST_CONTEXT`, `NODE_TEST_WORKER_ID` and `NODE_V8_COVERAGE`. Results by child environment:

| Child environment | Exit | Inner report |
| --- | --- | --- |
| inherited unchanged | 0 | **not written**: nothing on stdout either, a silent false green |
| `NODE_V8_COVERAGE` removed | 0 | not written |
| `NODE_TEST_CONTEXT` removed | 0 | written, with only `SF:src/fix.mjs` |
| both removed | 0 | written, with only `SF:src/fix.mjs` |

With `NODE_TEST_CONTEXT` inherited, the nested runner behaves as a worker of the outer one and never runs its
own reporters. The outer report gained no fixture paths in any case.

**Decision:** `--run` itself removes `NODE_TEST_CONTEXT`, `NODE_TEST_WORKER_ID` and `NODE_V8_COVERAGE` from the
child's environment. That makes it correct wherever it is started from (Nx, a shell, or a test), and keeps the
inner and outer measurements independent. The end-to-end tests need no special handling of their own.
`--run` still fails closed if no report is written, so a regression here would read as a failure, never as a
pass.
