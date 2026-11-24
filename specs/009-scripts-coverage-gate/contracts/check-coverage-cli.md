# Contract: `scripts/check-coverage.mjs`

```text
node scripts/check-coverage.mjs --run        # delete the report, run the suite with coverage, gate (scripts:test)
node scripts/check-coverage.mjs [--report <lcov>]   # gate an existing report only (default coverage/scripts.lcov)
node scripts/check-coverage.mjs --selftest   # judge synthetic reports; no test run (scripts:lint)
node scripts/check-coverage.mjs --help
```

## `--run`

1. Read and validate `scripts/coverage-policy.yaml`.
2. Delete `coverage/scripts.lcov` if it exists.
3. Run `node --test --experimental-test-coverage`. It takes one `--test-coverage-include=<glob>` per policy
   pattern, the `spec` reporter to stdout, the `lcov` reporter to `coverage/scripts.lcov`, and the test
   glob `scripts/__tests__/*.test.mjs`. stdio is inherited, so test output reads as before.
4. If the tests failed, exit with their exit code **after** printing the gate's verdict for information.
   A failing test is never masked by a passing gate, nor the reverse.
5. Otherwise, gate the report as below.

## Gate output (stdout). The verdict comes last, so the CI digest's tail is the verdict

Pass:

```text
[coverage] ✅ 38 modules ≥ 70% lines; total 91.4% lines (81.1% branches, not gated); lowest: scripts/sast-scan.mjs 71.2%
```

Fail, one line per failing module, worst first, then the summary line:

```text
[coverage] ✗ scripts/new-tool.mjs — no coverage data (no test loads it; a module no test loads is uncovered, not skipped)
[coverage] ✗ scripts/sast-scan.mjs — 67.8% lines, floor 70%
[coverage] ❌ 2 of 39 modules below the floor; total 90.9% lines (floor 70%). Add tests, or delete code nobody needs. Never lower the floor to pass
```

An exception that is inside its warning window prints
`[coverage] ⚠ exception for <module> expires <date> (<n> days)`. An expired exception prints that it no
longer applies, and the module is then judged at the policy floor.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | every module and the total meet their floors |
| 1 | a module is below its floor, a module has no data, the total is below the floor, or the report is missing or empty |
| 2 | bad arguments, an invalid policy, or an exception naming a module that does not exist |
| *n* | under `--run`, the test runner's own non-zero exit code when tests failed |

## `--selftest`

It judges in-memory lcov text against an in-memory policy. Each scenario must produce its stated result:
- a passing report (pass);
- a module below the floor (fail, naming it);
- a source module missing from the report (fail, `no coverage data`);
- a total below the floor, while every module meets its *applied* floor because one has an active exception at 55% (fail on the total);
- an empty report (fail closed);
- an active exception (pass at its floor);
- an expired exception (fail at the policy floor);
- an exception floor below 50 (exit 2);
- an exception for a missing module (exit 2);
- an lcov record outside the include set (ignored).

On success it prints `✓ check-coverage --selftest passed (…)` and exits 0. Otherwise it exits 1, naming
each scenario judged wrongly.
