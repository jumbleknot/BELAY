// Attaching the test-result collector to a test target, by an explicit opt-in argument (feature 016; research R12, as
// measured in T007: NODE_OPTIONS leaks into the child node processes tests start, so it is never used).
//   resultsReporterArgs(results)  [] for no results path, else the collector's --test-reporter pair (absolute paths)
//   node-test-with-results.mjs    `node scripts/lib/node-test-with-results.mjs "<results or empty>" <node args…>`: the
//                                 Nx targets pass "{args.results}", which Nx makes "" when not given (measured). The
//                                 reporter flags go BEFORE the test paths (node's flags after a path are not flags),
//                                 and the default spec output is kept when the target named no reporter of its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resultsReporterArgs, withResults } from '../lib/node-test-with-results.mjs';

const COLLECTOR = fileURLToPath(new URL('../lib/collect-test-results.mjs', import.meta.url));
const WRAPPER = fileURLToPath(new URL('../lib/node-test-with-results.mjs', import.meta.url));
const FIXTURE = fileURLToPath(new URL('./fixtures/collect-test-results/sample.fixture.mjs', import.meta.url));
const cleanEnv = () => { const e = { ...process.env }; for (const k of ['NODE_TEST_CONTEXT', 'NODE_TEST_WORKER_ID', 'NODE_V8_COVERAGE']) delete e[k]; return e; };

test('resultsReporterArgs: nothing for an empty or absent path; the collector pair, absolute, otherwise', () => {
  assert.deepEqual(resultsReporterArgs(''), []);
  assert.deepEqual(resultsReporterArgs(undefined), []);
  assert.deepEqual(resultsReporterArgs('/tmp/r/x.jsonl'), [`--test-reporter=${COLLECTOR}`, '--test-reporter-destination=/tmp/r/x.jsonl']);
});

test('withResults: the pair goes right after --test, before any path; spec to stdout is added only when the args name no reporter', () => {
  assert.deepEqual(withResults(['--test', 'a.test.mjs'], ''), ['--test', 'a.test.mjs']);
  assert.deepEqual(withResults(['--test', 'a.test.mjs'], '/r.jsonl'),
    ['--test', `--test-reporter=${COLLECTOR}`, '--test-reporter-destination=/r.jsonl', '--test-reporter=spec', '--test-reporter-destination=stdout', 'a.test.mjs']);
  assert.deepEqual(withResults(['--test', '--test-reporter=spec', '--test-reporter-destination=stdout', 'a.test.mjs'], '/r.jsonl'),
    ['--test', `--test-reporter=${COLLECTOR}`, '--test-reporter-destination=/r.jsonl', '--test-reporter=spec', '--test-reporter-destination=stdout', 'a.test.mjs']);
  assert.throws(() => withResults(['a.test.mjs'], '/r.jsonl'), /--test/);
});

test('the wrapper with a results path writes the report AND keeps the console output; without one it is plain node --test', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ntwr-'));
  try {
    const out = join(dir, 'sub', 'r.jsonl');
    const a = spawnSync(process.execPath, [WRAPPER, out, '--test', FIXTURE], { encoding: 'utf8', env: cleanEnv() });
    assert.equal(a.status, 1, 'the fixture fails one test, and the exit code passes through');
    assert.match(a.stdout, /ℹ tests 7/);
    assert.equal(readFileSync(out, 'utf8').trim().split('\n').length, 7);
    const b = spawnSync(process.execPath, [WRAPPER, '', '--test', FIXTURE], { encoding: 'utf8', env: cleanEnv() });
    assert.equal(b.status, 1);
    assert.match(b.stdout, /ℹ tests 7/);
    assert.equal(existsSync(join(dir, 'sub', 'other.jsonl')), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
