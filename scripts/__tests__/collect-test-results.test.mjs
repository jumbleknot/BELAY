// collect-test-results.mjs (feature 016; research R12, M10): a node:test reporter that writes one JSON line per test
// case: { file, name, outcome }, file from the repository root, name the full path joined with " > ", outcome one of
// pass | fail | skip | todo. Suites are not test cases. guardrails attaches it to its own test run on main, so the
// merged commit's outcomes are counted with no second run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarise } from '../lib/collect-test-results.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FIXTURE = fileURLToPath(new URL('./fixtures/collect-test-results/sample.fixture.mjs', import.meta.url));
const COLLECTOR = fileURLToPath(new URL('../lib/collect-test-results.mjs', import.meta.url));

function run() {
  const dir = mkdtempSync(join(tmpdir(), 'collect-'));
  const out = join(dir, 'results.jsonl');
  // A node --test started inside a test inherits NODE_TEST_CONTEXT and runs as a sub-test, ignoring its reporter flags
  // (the same trap check-coverage.mjs strips for): drop the runner's inherited variables.
  const env = { ...process.env };
  for (const k of ['NODE_TEST_CONTEXT', 'NODE_TEST_WORKER_ID', 'NODE_V8_COVERAGE']) delete env[k];
  const r = spawnSync(process.execPath, ['--test', `--test-reporter=${COLLECTOR}`, `--test-reporter-destination=${out}`, FIXTURE], { cwd: ROOT, encoding: 'utf8', env });
  const lines = readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  rmSync(dir, { recursive: true, force: true });
  return { status: r.status, lines };
}

test('one JSON line per test case, with the file from the repository root, the full name path and the outcome', () => {
  const { status, lines } = run();
  assert.equal(status, 1, 'the fixture has a failing test');
  const file = relative(ROOT, FIXTURE).split('\\').join('/');
  assert.deepEqual(lines.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)), [
    { file, name: 'a suite > inner passes', outcome: 'pass' },
    { file, name: 'fails', outcome: 'fail' },
    { file, name: 'is skipped', outcome: 'skip' },
    { file, name: 'is todo', outcome: 'todo' },
    { file, name: 'outer', outcome: 'pass' },
    { file, name: 'outer > sub passes', outcome: 'pass' },
    { file, name: 'passes', outcome: 'pass' },
  ]);
});

test('summarise counts outcomes per report, never adding skip or todo to pass', () => {
  assert.deepEqual(summarise('{"file":"a","name":"x","outcome":"pass"}\n{"file":"a","name":"y","outcome":"skip"}\n{"file":"a","name":"z","outcome":"todo"}\n{"file":"a","name":"w","outcome":"fail"}\n'),
    { passed: 1, failed: 1, skipped: 1, todo: 1 });
});

test('summarise refuses an unparsable report rather than guessing (FR-039: never 0 for a count it could not read)', () => {
  assert.throws(() => summarise('{"file":"a","name":"x","outcome":"pass"}\nnot json\n'), /unparsable/);
  assert.throws(() => summarise('{"file":"a","name":"x","outcome":"maybe"}\n'), /unparsable/);
});

// The reporter itself, in process: the same events node --test sends it, so its every branch is exercised here and
// counted by this suite's coverage (in the child run above it is invisible to the parent's coverage).
import collect from '../lib/collect-test-results.mjs';
test('the reporter, fed node:test events directly: name paths by nesting, suites skipped, outcomes mapped, other events ignored', async () => {
  const file = join(ROOT, 'scripts', '__tests__', 'x.test.mjs');
  async function* events() {
    yield { type: 'test:start', data: { name: 'suite', nesting: 0, file } };
    yield { type: 'test:start', data: { name: 'case', nesting: 1, file } };
    yield { type: 'test:pass', data: { name: 'case', nesting: 1, file, details: { type: 'test' } } };
    yield { type: 'test:pass', data: { name: 'suite', nesting: 0, file, details: { type: 'suite' } } };
    yield { type: 'test:start', data: { name: 'top', nesting: 0, file } };
    yield { type: 'test:fail', data: { name: 'top', nesting: 0, file, details: { type: 'test' } } };
    yield { type: 'test:pass', data: { name: 'later', nesting: 0, file, skip: true, details: { type: 'test' } } };
    yield { type: 'test:pass', data: { name: 'someday', nesting: 0, file, todo: 'x', details: { type: 'test' } } };
    yield { type: 'test:diagnostic', data: { message: 'ignored' } };
    yield { type: 'test:pass', data: { name: 'no file', nesting: 0, details: { type: 'test' } } };
  }
  const out = [];
  for await (const line of collect(events())) out.push(JSON.parse(line));
  assert.deepEqual(out, [
    { file: 'scripts/__tests__/x.test.mjs', name: 'suite > case', outcome: 'pass' },
    { file: 'scripts/__tests__/x.test.mjs', name: 'top', outcome: 'fail' },
    { file: 'scripts/__tests__/x.test.mjs', name: 'later', outcome: 'skip' },
    { file: 'scripts/__tests__/x.test.mjs', name: 'someday', outcome: 'todo' },
    { file: '', name: 'no file', outcome: 'pass' },
  ]);
});
