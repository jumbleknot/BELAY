// Guards scripts/ci-log-step.sh.
//
// The exit-code case is the one that matters. `cmd | tee` returns TEE's status, so a wrapper
// without `set -o pipefail` turns every FAILING step into a passing one — CI goes silently green.
// That is strictly worse than the missing-logs problem the wrapper exists to solve, so it is pinned
// here rather than left to review.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, readdirSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { shellCanRunScript } from './shell-probe.mjs';

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'ci-log-step.sh');

// The probe lives in ./shell-probe.mjs so other suites inherit it rather than re-deriving it —
// it was already re-derived wrongly once (see that file's header). Re-exported because the
// probe meta-tests below exercise it directly.
export { shellCanRunScript };

// The wrapper is bash (it needs `pipefail`, which POSIX sh lacks). CI runs node:22-bookworm, which
// has bash and can read the checkout, so nothing here skips in CI.
const bashProbe = shellCanRunScript('bash', SCRIPT);
const needsBash = { skip: bashProbe.usable ? false : bashProbe.reason };

// The default log root is prefixed with the repository name. Repositories under one owner can
// share a persistent runner's $HOME, and an unprefixed directory would let one repository's digest
// collect another's step logs.
test('(h) the default log root is $HOME/<repo>-ci-step-logs, from GITHUB_REPOSITORY', needsBash, () => {
  const home = mkdtempSync(join(tmpdir(), 'ci-step-home-'));
  const env = { ...process.env, HOME: home, GITHUB_RUN_ID: 'r1', GITHUB_JOB: 'j1' };
  delete env.CI_STEP_LOG_ROOT;
  spawnSync('bash', [SCRIPT, 'demo', 'echo', 'hi'], { encoding: 'utf8', env: { ...env, GITHUB_REPOSITORY: 'jumbleknot/BELAY' } });
  assert.ok(existsSync(join(home, 'belay-ci-step-logs', 'r1', 'j1', 'demo.log')), 'no log under $HOME/belay-ci-step-logs');
  delete env.GITHUB_REPOSITORY;
  spawnSync('bash', [SCRIPT, 'demo', 'echo', 'hi'], { encoding: 'utf8', env });
  assert.ok(existsSync(join(home, 'local-ci-step-logs', 'r1', 'j1', 'demo.log')), 'no log under $HOME/local-ci-step-logs without GITHUB_REPOSITORY');
});

function run(args, { runId = 'test-run', job = 'test-job' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ci-step-log-'));
  const r = spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, CI_STEP_LOG_ROOT: root, GITHUB_RUN_ID: runId, GITHUB_JOB: job },
  });
  const dir = join(root, runId, job);
  const logs = existsSync(dir) ? readdirSync(dir) : [];
  return { code: r.status, stdout: r.stdout ?? '', root, dir, logs };
}

test('(a) a FAILING command still exits non-zero — tee must not mask it', needsBash, () => {
  // Without `set -o pipefail` this returns 0 and a broken build reports green.
  const r = run(['demo', 'bash', '-c', 'echo working; exit 7']);
  assert.notEqual(r.code, 0, 'a failing command exited 0 — tee masked the failure');
  assert.equal(r.code, 7, `expected the command's own exit code, got ${r.code}`);
});

test('(a2) a passing command exits 0', needsBash, () => {
  assert.equal(run(['demo', 'bash', '-c', 'echo fine']).code, 0);
});

test('(b) the output is mirrored to the log AND still reaches stdout', needsBash, () => {
  // Mirrored, not diverted: the run log a human reads in the web UI must be unchanged.
  const r = run(['demo', 'bash', '-c', 'echo hello-from-step']);
  assert.match(r.stdout, /hello-from-step/, 'output no longer reaches the job log');
  // `_`-prefixed bookkeeping (`_failed-step`, `_step-durations.tsv`) shares the directory; what this
  // guard pins is that the STEP LOG is there and named after the step.
  assert.deepEqual(r.logs.filter((f) => !f.startsWith('_')), ['demo.log']);
  assert.match(readFileSync(join(r.dir, 'demo.log'), 'utf8'), /hello-from-step/);
});

test('(c) STDERR is captured too — that is where stack traces live', needsBash, () => {
  const r = run(['demo', 'bash', '-c', 'echo to-stderr >&2; exit 1']);
  assert.equal(r.code, 1);
  assert.match(readFileSync(join(r.dir, 'demo.log'), 'utf8'), /to-stderr/);
});

test('(d) output of a FAILING command is captured before the failure propagates', needsBash, () => {
  // The whole point: the digest needs what the step printed on its way down.
  const r = run(['demo', 'bash', '-c', 'echo FAILED tests/e2e/foo.spec.ts; echo "  expected 5, got 4" >&2; exit 1']);
  assert.equal(r.code, 1);
  const log = readFileSync(join(r.dir, 'demo.log'), 'utf8');
  assert.match(log, /FAILED tests\/e2e\/foo\.spec\.ts/);
  assert.match(log, /expected 5, got 4/);
});

test('(e) logs are scoped per run — a persistent runner cannot leak a previous run in', needsBash, () => {
  // This runner IS persistent, so an unscoped directory would put a stale run's output into
  // today's digest and send the reader after a failure that already got fixed.
  const a = run(['demo', 'bash', '-c', 'echo run-one'], { runId: 'run-1', job: 'j' });
  assert.match(readFileSync(join(a.dir, 'demo.log'), 'utf8'), /run-one/);
  assert.equal(a.dir.endsWith(join('run-1', 'j')), true, 'log directory is not scoped by run id');
});

test('(f) bad usage exits 2 rather than silently doing nothing', needsBash, () => {
  assert.equal(run(['only-a-name']).code, 2);
});

test('(g) a failing wrapped step records its name so the digest can report it', needsBash, () => {
  const root = mkdtempSync(join(tmpdir(), 'ci-step-log-'));
  const env = { ...process.env, CI_STEP_LOG_ROOT: root, GITHUB_RUN_ID: 'run-x', GITHUB_JOB: 'j' };
  spawnSync('bash', [SCRIPT, 'guardrails-lint', 'bash', '-c', 'exit 1'], { encoding: 'utf8', env });
  const marker = join(root, 'run-x', 'j', '_failed-step');
  assert.ok(existsSync(marker), 'no _failed-step marker was written');
  assert.equal(readFileSync(marker, 'utf8').trim(), 'guardrails-lint');
});

test('(g2) a PASSING step records no marker', needsBash, () => {
  const root = mkdtempSync(join(tmpdir(), 'ci-step-log-'));
  const env = { ...process.env, CI_STEP_LOG_ROOT: root, GITHUB_RUN_ID: 'run-y', GITHUB_JOB: 'j' };
  spawnSync('bash', [SCRIPT, 'ok', 'bash', '-c', 'exit 0'], { encoding: 'utf8', env });
  assert.equal(existsSync(join(root, 'run-y', 'j', '_failed-step')), false, 'a passing step wrote a marker');
});

test('(g3) the FIRST failing step wins — a later wrapped step does not overwrite it', needsBash, () => {
  const root = mkdtempSync(join(tmpdir(), 'ci-step-log-'));
  const env = { ...process.env, CI_STEP_LOG_ROOT: root, GITHUB_RUN_ID: 'run-z', GITHUB_JOB: 'j' };
  spawnSync('bash', [SCRIPT, 'first-fail', 'bash', '-c', 'exit 1'], { encoding: 'utf8', env });
  spawnSync('bash', [SCRIPT, 'second-fail', 'bash', '-c', 'exit 1'], { encoding: 'utf8', env });
  assert.equal(readFileSync(join(root, 'run-z', 'j', '_failed-step'), 'utf8').trim(), 'first-fail');
});

// --- (g4) TWO JOBS, ONE RUN — a past incident ---------------------------------------------------------
//
// `e2e` and `scan` are two jobs of the same run on the same self-hosted runner, sharing $HOME.
// Run-scoped, they shared ONE `_failed-step` file: whichever failed first wrote it and the other
// published it as its own failing step. MEASURED on an earlier run — the `e2e` digest
// reported `scan-install-tools`, a step in the scan job.
//
// It was harmless that once only because both jobs died of the same upstream cause. The normal case
// is two jobs failing for different reasons, and then the digest sends its reader to the wrong job
// with full confidence and no way to tell from the digest that it happened.
test('(g4) two jobs failing in ONE run each record their OWN failing step', needsBash, () => {
  const root = mkdtempSync(join(tmpdir(), 'ci-step-log-'));
  const inJob = (job) => ({ ...process.env, CI_STEP_LOG_ROOT: root, GITHUB_RUN_ID: 'run-shared', GITHUB_JOB: job });
  spawnSync('bash', [SCRIPT, 'scan-install-tools', 'bash', '-c', 'exit 1'], { encoding: 'utf8', env: inJob('scan') });
  spawnSync('bash', [SCRIPT, 'e2e-run', 'bash', '-c', 'exit 1'], { encoding: 'utf8', env: inJob('e2e') });

  const marker = (job) => readFileSync(join(root, 'run-shared', job, '_failed-step'), 'utf8').trim();
  assert.equal(marker('scan'), 'scan-install-tools');
  assert.equal(
    marker('e2e'),
    'e2e-run',
    'e2e adopted the sibling job\'s failing step — the marker is not job-scoped',
  );
});

// --- (g5) one job's step LOGS must not appear in another job's evidence -------------------------
//
// The same sharing put each job's `*.log` into the other's digest as `step:` excerpts, because the
// collector globs every .log in the directory. An earlier fix scoped that out of its own criteria on the
// belief the step logs were "already correct"; they were not, and scoping the whole directory fixes
// both for the price of one.
test('(g5) two jobs in ONE run do not see each other\'s step logs', needsBash, () => {
  const root = mkdtempSync(join(tmpdir(), 'ci-step-log-'));
  const inJob = (job) => ({ ...process.env, CI_STEP_LOG_ROOT: root, GITHUB_RUN_ID: 'run-shared2', GITHUB_JOB: job });
  spawnSync('bash', [SCRIPT, 'scan-run', 'bash', '-c', 'echo zap'], { encoding: 'utf8', env: inJob('scan') });
  spawnSync('bash', [SCRIPT, 'e2e-run', 'bash', '-c', 'echo playwright'], { encoding: 'utf8', env: inJob('e2e') });

  const stepLogs = (job) => readdirSync(join(root, 'run-shared2', job)).filter((f) => !f.startsWith('_'));
  assert.deepEqual(stepLogs('e2e'), ['e2e-run.log']);
  assert.deepEqual(stepLogs('scan'), ['scan-run.log']);

  // The durations file is scoped the same way, and must be — the two jobs share $HOME on this
  // runner, so a run-scoped file would blend `scan`'s samples into `e2e`'s distribution and
  // silently calibrate e2e's ceilings against another job's steps (a past incident defect, in a
  // new artifact).
  const durations = (job) => readFileSync(join(root, 'run-shared2', job, '_step-durations.tsv'), 'utf8');
  assert.match(durations('e2e'), /^e2e-run\t/m);
  assert.doesNotMatch(durations('e2e'), /^scan-run\t/m);
  assert.doesNotMatch(durations('scan'), /^e2e-run\t/m);
});


// --- (probe) the capability probe must answer the question being ASKED ---------
//
// The old probe was `spawnSync('bash', ['-c', 'exit 0']).status === 0` — "does a shell called bash
// start?". On the operator's Windows host it does: `bash` on PATH is the WSL shim, which starts
// perfectly and then cannot see `E:\…` at all. So the probe reported the shell as usable and all
// nine cases failed with status 127 — nine red tests that say nothing about the code under test.
// (Git Bash is installed on that host and would work; it is simply not what is on PATH.)
//
// This is the same shape as AGENTS.md's gate on proving "it can't run in this environment": the
// probe answered *does a shell exist* when the question is *can that shell reach my files*. A wrong
// answer in either direction is bad — a false "usable" gives nine meaningless failures, a false
// "unusable" gives a silent skip, which is the false green this whole feature exists to remove.
// ⚠️ THE META-TESTS BELOW ASSERT PROPERTIES OF THE HOST, NOT OF THE CODE — so they must gate on the
// host exactly as the suite does. MEASURED ON WINDOWS 2026-08-10: `(probe1)` and `(probe4)` asserted
// unconditionally that this machine has a usable bash, and failed on a machine that does not. That is
// the Linux-assuming shape US5 exists to remove, introduced BY US5, in the very tests that prove the
// probe works. Left unfixed it would be the third instance of this feature committing its own defect.
const needsUsableBash = {
  skip: bashProbe.usable ? false : `no usable bash on this host — ${bashProbe.reason}`,
};

// `(probe2)`/`(probe3)` additionally need to EXECUTE a generated `#!` script. Windows cannot, so they
// gate on that capability separately rather than on bash alone — the two are not the same question,
// which is the whole lesson of the probe they are testing.
const canExecGeneratedScript = (() => {
  try {
    const dir = mkdtempSync(join(tmpdir(), 'exec-probe-'));
    const sh = join(dir, 'probe-exec');
    writeFileSync(sh, '#!/usr/bin/env bash\nexit 0\n');
    chmodSync(sh, 0o755);
    return spawnSync(sh, [], { encoding: 'utf8' }).status === 0;
  } catch {
    return false;
  }
})();
const needsExecutableScripts = {
  skip: canExecGeneratedScript
    ? false
    : 'this host cannot execute a generated `#!` script (Windows), so the detached-shell simulation cannot be built here',
};

/** A shell that STARTS but is in a different filesystem namespace — the WSL-shim condition. */
function fakeDetachedShell() {
  const dir = mkdtempSync(join(tmpdir(), 'fake-shell-'));
  const sh = join(dir, 'detached-sh');
  writeFileSync(sh, '#!/usr/bin/env bash\n# Succeeds at starting; cannot see the real filesystem.\n'
    + 'case "$2" in\n  "exit 0") exit 0 ;;\n  *) exit 127 ;;\nesac\n');
  chmodSync(sh, 0o755);
  return sh;
}

test('(probe1) a real bash that CAN read the script is reported usable', needsUsableBash, () => {
  const v = shellCanRunScript('bash', SCRIPT);
  assert.equal(v.usable, true, `bash was rejected on a host that has it: ${v.reason}`);
  assert.equal(v.reason, null);
});

test('(probe2) a shell that starts but cannot reach the script is reported UNUSABLE, with a reason', needsExecutableScripts, () => {
  const v = shellCanRunScript(fakeDetachedShell(), SCRIPT);
  assert.equal(v.usable, false, 'a shell that cannot see the script under test was reported usable');
  assert.ok(v.reason, 'an unusable shell must skip WITH a reason — a reasonless skip is a false green');
  assert.match(v.reason, /cannot read|cannot reach/i, `the reason does not name the unmet condition: ${v.reason}`);
});

test('(probe3) the OLD probe would have passed that same shell — this is why it changed', needsExecutableScripts, () => {
  // Pins the defect itself, so the probe cannot quietly regress to asking the easier question.
  const sh = fakeDetachedShell();
  assert.equal(spawnSync(sh, ['-c', 'exit 0']).status, 0, 'the simulation is wrong — it must START cleanly');
  assert.equal(shellCanRunScript(sh, SCRIPT).usable, false);
});

test('(probe4) on THIS host the suite does not skip — a skip here would be a false pass', needsUsableBash, () => {
  // Git Bash on Windows and the CI node:26-bookworm image both have a usable bash, so every case
  // above must actually execute. If this ever starts skipping, the skip count is the tell.
  assert.equal(needsBash.skip, false, `the ci-log-step suite skipped on a host with bash: ${needsBash.skip}`);
});

// ─── a past incident — a job killed at `timeout-minutes` publishes NO digest ───────────────────────────
//
// `always()` does not survive a job kill: when the runner enforces `timeout-minutes` the digest step
// never runs, so the ONE failure class with no other evidence trail (a hang) produces none. Measured
// when a hung step consumed the whole job ceiling,
// and `ci-status failure` reported "no bundle exists … the job may have died before the digest step
// ran".
//
// The fix is to make the hang fail the STEP rather than the JOB, below the ceiling — so the job
// stays alive, the marker is written, and the digest runs and can name what was hanging.
function runWithTimeout(args, seconds, { runId = 'test-run', job = 'test-job' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ci-step-log-'));
  const r = spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      CI_STEP_LOG_ROOT: root,
      GITHUB_RUN_ID: runId,
      GITHUB_JOB: job,
      CI_STEP_TIMEOUT_SECONDS: String(seconds),
    },
  });
  const dir = join(root, runId, job);
  const read = (f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8').trim() : null);
  return { code: r.status, dir, failedStep: read('_failed-step'), reason: read('_failed-step-reason') };
}

test('(timeout-a) a HANGING step is killed at its own timeout and reports a non-zero exit', needsBash, () => {
  const r = runWithTimeout(['hanging-step', 'sleep', '30'], 1);
  assert.notEqual(r.code, 0, 'a step that hung past its timeout reported success');
  assert.ok(r.code === 124 || r.code === 137, `expected a timeout exit (124/137), got ${r.code}`);
});

test('(timeout-b) the hung step is NAMED, so the digest does not say "_not reported_"', needsBash, () => {
  const r = runWithTimeout(['hanging-step', 'sleep', '30'], 1);
  assert.equal(r.failedStep, 'hanging-step');
});

test('(timeout-c) a TIMEOUT is distinguishable from an ordinary failure', needsBash, () => {
  // Criterion 2: the reader must not hunt for an assertion that never happened.
  const timedOut = runWithTimeout(['hanging-step', 'sleep', '30'], 1);
  assert.match(timedOut.reason ?? '', /timeout/i, 'a timeout was not recorded as such');
  assert.match(timedOut.reason ?? '', /after 1s\b/, 'the reason does not name the limit that was hit');

  const ordinary = runWithTimeout(['failing-step', 'false'], 30);
  assert.equal(ordinary.failedStep, 'failing-step');
  assert.equal(ordinary.reason, null, 'an ordinary failure was mislabelled as a timeout');
});

test('(timeout-d) an unset CI_STEP_TIMEOUT_SECONDS leaves behaviour exactly as before', needsBash, () => {
  const ok = run(['plain-step', 'echo', 'hello']);
  assert.equal(ok.code, 0);
  const bad = run(['plain-step', 'false']);
  assert.notEqual(bad.code, 0, 'pipefail semantics regressed');
});

test('(timeout-e) a step that finishes INSIDE its timeout is untouched', needsBash, () => {
  const r = runWithTimeout(['quick-step', 'echo', 'done'], 30);
  assert.equal(r.code, 0);
  assert.equal(r.failedStep, null);
  assert.equal(r.reason, null);
});

// ─── a past incident — per-step durations, recorded on EVERY run ───────────────────────────────────────
//
// The 2700 s ceiling above was calibrated against an e2e JOB duration misread as a `e2e-run`
// STEP duration, and could not be corrected because nothing in this repository records how long a
// step actually takes. The failure digest publishes only on failure, and the forge exposes no job
// logs — so "how long does this step normally take" was unanswerable from the API.
//
// These rows are the sample that answers it. They must be written whatever the step's outcome:
// a distribution built only from failures describes the failures, not the step.
function durationRows(dir) {
  const file = join(dir, '_step-durations.tsv');
  if (!existsSync(file)) return null;
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => {
      const [name, seconds, exit, ceiling] = l.split('\t');
      return { name, seconds, exit, ceiling };
    });
}

test('(durations-a) a PASSING step records a duration row — a green run is the sample that matters', needsBash, () => {
  const r = run(['quick-step', 'echo', 'hello']);
  assert.equal(r.code, 0);
  const rows = durationRows(r.dir);
  assert.ok(rows, 'no _step-durations.tsv was written — a green run left no sample');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'quick-step');
  assert.match(rows[0].seconds, /^\d+$/, `seconds is not a number: ${rows[0].seconds}`);
  assert.equal(rows[0].exit, '0');
});

test('(durations-b) a FAILING step records one too — the row is not conditional on success', needsBash, () => {
  const r = run(['broken-step', 'bash', '-c', 'exit 7']);
  assert.equal(r.code, 7, 'the wrapper stopped reporting the command exit code');
  const rows = durationRows(r.dir);
  assert.ok(rows, 'a failing step recorded no duration');
  assert.equal(rows[0].name, 'broken-step');
  assert.equal(rows[0].exit, '7');
});

test('(durations-c) a TIMED-OUT step records its ceiling, so a censored sample is identifiable', needsBash, () => {
  // The duration of a killed step EQUALS its ceiling — it is right-censored, not observed. An
  // aggregator that averages it in calibrates the ceiling against its own kills, which ratchets
  // downward for ever. The exit code and the ceiling are both recorded so the reader can exclude it.
  const r = runWithTimeout(['hanging-step', 'sleep', '30'], 1);
  const rows = durationRows(r.dir);
  assert.ok(rows, 'a timed-out step recorded no duration');
  assert.equal(rows[0].name, 'hanging-step');
  assert.ok(rows[0].exit === '124' || rows[0].exit === '137', `expected a timeout exit, got ${rows[0].exit}`);
  assert.equal(rows[0].ceiling, '1', 'the ceiling the sample was censored at is not recorded');
});

test('(durations-d) each INVOCATION is its own row — a name wrapped twice yields two samples', needsBash, () => {
  // `build-install-native-deps` is wrapped twice in a workflow, and the ceiling
  // applies per invocation — so collapsing them onto one name would understate the real duration.
  const root = mkdtempSync(join(tmpdir(), 'ci-step-log-'));
  const env = { ...process.env, CI_STEP_LOG_ROOT: root, GITHUB_RUN_ID: 'test-run', GITHUB_JOB: 'test-job' };
  for (const msg of ['first', 'second']) {
    spawnSync('bash', [SCRIPT, 'repeated-step', 'echo', msg], { encoding: 'utf8', env });
  }
  const rows = durationRows(join(root, 'test-run', 'test-job'));
  assert.equal(rows.length, 2, 'a repeated step did not append a second sample');
  assert.deepEqual(rows.map((x) => x.name), ['repeated-step', 'repeated-step']);
});

test('(durations-e) an unwritable durations file NEVER changes the step outcome', needsBash, () => {
  //'s discipline, applied here: measurement must not be able to fail a build. The whole
  // point of recording on every run is that it is cheap and invisible.
  const root = mkdtempSync(join(tmpdir(), 'ci-step-log-'));
  const dir = join(root, 'test-run', 'test-job');
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, '_step-durations.tsv')); // a directory where the file must go: append fails
  const r = spawnSync('bash', [SCRIPT, 'quick-step', 'echo', 'hello'], {
    encoding: 'utf8',
    env: { ...process.env, CI_STEP_LOG_ROOT: root, GITHUB_RUN_ID: 'test-run', GITHUB_JOB: 'test-job' },
  });
  assert.equal(r.status, 0, 'a failed duration write turned a passing step red');
});

/** Run the wrapper against a PURPOSE-BUILT ceilings table, so these never depend on the real one. */
function runWithCeilings(args, table, { env: extraEnv = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ci-step-log-'));
  const file = join(root, 'ceilings.tsv');
  writeFileSync(file, table);
  const r = spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      CI_STEP_LOG_ROOT: root,
      GITHUB_RUN_ID: 'test-run',
      GITHUB_JOB: 'test-job',
      CI_STEP_CEILINGS_FILE: file,
      ...extraEnv,
    },
  });
  const dir = join(root, 'test-run', 'test-job');
  const read = (f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8').trim() : null);
  return { code: r.status, dir, stderr: r.stderr ?? '', reason: read('_failed-step-reason') };
}

test('(durations-f) a step NAMED in the table is bounded by ITS ceiling, not the job-wide one', needsBash, () => {
  // The whole point: `e2e-run` must not inherit the ceiling that only `maestro-agent-flows` needs.
  const r = runWithCeilings(['e2e-run', 'sleep', '30'], '# step\tceiling\tbasis\ne2e-run\t1\tn=40 max=280s\n',
    { env: { CI_STEP_TIMEOUT_SECONDS: '600' } });
  assert.ok(r.code === 124 || r.code === 137, `the table ceiling did not apply — exit ${r.code}`);
  assert.match(r.reason ?? '', /after 1s\b/, 'the job-wide backstop won over the step\'s own value');
});

test('(durations-g) a step ABSENT from the table falls back to the backstop, never to unbounded', needsBash, () => {
  // Dropping to unbounded on a miss would silently restore the job-kill defect for any step the
  // sample has not reached yet — the failure shape a past incident exists to prevent.
  const r = runWithCeilings(['unlisted-step', 'sleep', '30'], '# step\tceiling\tbasis\ne2e-run\t900\tn=40\n',
    { env: { CI_STEP_TIMEOUT_SECONDS: '1' } });
  assert.ok(r.code === 124 || r.code === 137, `the backstop did not apply — exit ${r.code}`);
  assert.match(r.reason ?? '', /after 1s\b/);
});

test('(durations-h) the EFFECTIVE ceiling is what the duration row records', needsBash, () => {
  // Censoring detection is per step, so a row carrying the backstop while the table bounded the
  // step would make every kill look like an observation and corrupt the next calibration.
  const r = runWithCeilings(['e2e-run', 'echo', 'hi'], '# step\tceiling\tbasis\ne2e-run\t900\tn=40\n',
    { env: { CI_STEP_TIMEOUT_SECONDS: '2700' } });
  assert.equal(r.code, 0);
  assert.equal(durationRows(r.dir)[0].ceiling, '900', 'the row records the backstop, not the applied ceiling');
});

test('(durations-i) a missing or malformed table never fails a step, and never invents a ceiling', needsBash, () => {
  // Best-effort like every other measurement here. A comment row must not parse as a ceiling of 0,
  // which `timeout 0` would treat as "no limit" — a silent removal of the guard.
  const ok = runWithCeilings(['quick-step', 'echo', 'hi'], '# step\tceiling\tbasis\n\n#e2e-run\t1\tcommented out\n');
  assert.equal(ok.code, 0);
  assert.equal(durationRows(ok.dir)[0].ceiling, '', 'a comment row was parsed as this step\'s ceiling');

  const absent = spawnSync('bash', [SCRIPT, 'quick-step', 'echo', 'hi'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      CI_STEP_LOG_ROOT: mkdtempSync(join(tmpdir(), 'ci-step-log-')),
      GITHUB_RUN_ID: 'r', GITHUB_JOB: 'j',
      CI_STEP_CEILINGS_FILE: '/nonexistent/ceilings.tsv',
    },
  });
  assert.equal(absent.status, 0, 'an absent ceilings table failed the step');
});

test('(durations-j) a step name is matched WHOLE — a prefix must not borrow another step\'s ceiling', needsBash, () => {
  // `e2e-run` and `e2e-run-model` differ by a suffix, and `e2e-install-dependencies` shares a
  // prefix with six others. A substring match would hand one step another's bound.
  const r = runWithCeilings(['e2e-run-model', 'sleep', '30'], '# step\tceiling\tbasis\ne2e-run\t1\tn=40\n',
    { env: { CI_STEP_TIMEOUT_SECONDS: '600' } });
  assert.notEqual(r.code, 124, '`e2e-run-model` was killed at `e2e-run`\'s 1s ceiling — prefix match');
  assert.notEqual(r.code, 137, '`e2e-run-model` was killed at `e2e-run`\'s 1s ceiling — prefix match');
});

