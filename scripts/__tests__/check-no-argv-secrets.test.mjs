// Tests for scripts/check-no-argv-secrets.mjs — keep credential-named arguments off the Maestro
// command line.
//
// A `maestro test … --env <SECRET>=…` argument puts the secret on the process's argv, where `ps` and
// `/proc/<pid>/cmdline` show it to every user on a shared CI host. The gate fails the tree on that
// argument PATTERN, whatever the value. BELAY has no Maestro flow yet (the constitution puts them under
// `frontend/<app>/tests/e2e/mobile/`), so the gate is in place before the first one lands.
//
// Runs in CI under `pnpm nx run scripts:test`: offline, token-free, node built-ins only. Each scan runs
// against a throwaway git repository through the `--dir <root>` seam. Secret-looking key names are
// assembled from fragments at run time, so no line of this file is itself a violation of this gate
// or of the secret scan.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const GATE = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'check-no-argv-secrets.mjs');
const run = (...args) => spawnSync(process.execPath, [GATE, ...args], { encoding: 'utf8' });

// Key names built from fragments: the joined names never appear on one line of this file.
const PASSWORD_KEY = 'E2E_TEST_' + 'PASS' + 'WORD';
const API_KEY = 'MODEL_API' + '_' + 'KEY';
const RUNNER = 'maes' + 'tro';
const FLOW = 'frontend/demo-app/tests/e2e/mobile/login.yaml';

const made = [];
after(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** A git repository holding `files` (path → text), all tracked. */
function fixtureRepo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'argv-secrets-'));
  made.push(dir);
  execFileSync('git', ['init', '-q'], { cwd: dir });
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(dir, dirname(rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  execFileSync('git', ['add', '-A'], { cwd: dir });
  return dir;
}

test('a secret-named --env argument to maestro fails, naming the file and line', () => {
  const dir = fixtureRepo({
    'scripts/run-mobile-e2e.sh': `#!/usr/bin/env bash\nset -eu\n${RUNNER} test ${FLOW} --env ${PASSWORD_KEY}="$P"\n`,
  });
  const r = run('--dir', dir);
  const out = r.stdout + r.stderr;
  assert.equal(r.status, 1, out);
  assert.match(out, new RegExp(`^scripts/run-mobile-e2e\\.sh:3: argv-secret: .*${PASSWORD_KEY}`, 'm'));
});

test('the short -e form is caught too', () => {
  const dir = fixtureRepo({ 'scripts/e2e.sh': `${RUNNER} test ${FLOW} -e ${API_KEY}=abc\n` });
  const r = run('--dir', dir);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /^scripts\/e2e\.sh:1: argv-secret: /m);
});

test('a flag split from maestro by a backslash continuation is still caught, at the invocation line', () => {
  const workflow = [
    'jobs:',
    '  mobile:',
    '    steps:',
    '      - run: |',
    `          ${RUNNER} test ${FLOW} \\`,
    `            --env ${PASSWORD_KEY}="$P"`,
    '',
  ].join('\n');
  const dir = fixtureRepo({ '.forgejo/workflows/mobile-e2e.yml': workflow });
  const r = run('--dir', dir);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /^\.forgejo\/workflows\/mobile-e2e\.yml:5: argv-secret: /m);
});

test('a package.json script string and a file beside the flows are in scope', () => {
  const dir = fixtureRepo({
    'frontend/demo-app/package.json': JSON.stringify({ scripts: { 'e2e:mobile': `${RUNNER} test tests/e2e/mobile --env ${API_KEY}=x` } }, null, 2),
    'frontend/demo-app/tests/e2e/mobile/README.txt': `run: ${RUNNER} test . -e ${PASSWORD_KEY}=x\n`,
  });
  const r = run('--dir', dir);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /^frontend\/demo-app\/package\.json:\d+: argv-secret: /m);
  assert.match(r.stderr, /^frontend\/demo-app\/tests\/e2e\/mobile\/README\.txt:1: argv-secret: /m);
});

test('a non-secret --env name passes, and the scanned-file count is printed', () => {
  const dir = fixtureRepo({
    'scripts/e2e.sh': `${RUNNER} test ${FLOW} --env TEST_USER="$U" --env COLLECTION_NAME=t-1\n`,
  });
  const r = run('--dir', dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /\b1 file\(s\) scanned/);
});

test('a secret-named --env NOT passed to maestro is out of this gate', () => {
  // `docker run -e …` is a different exposure with its own rules; this gate is about the test runner.
  const dir = fixtureRepo({ 'scripts/other.sh': `docker run -e ${PASSWORD_KEY}=x image\n` });
  assert.equal(run('--dir', dir).status, 0);
});

test('a tree with nothing in scope passes and says it scanned 0 files', () => {
  const dir = fixtureRepo({ 'notes/readme.md': 'nothing to see\n' });
  const r = run('--dir', dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /\b0 file\(s\) scanned/);
});

test('historical spec records are out of scope', () => {
  const dir = fixtureRepo({ 'specs/001-x/plan.md': `${RUNNER} test x --env ${PASSWORD_KEY}=x\n` });
  assert.equal(run('--dir', dir).status, 0);
});

test('a --dir that is not a git work tree is an error (exit 2), never a silent pass', () => {
  const dir = mkdtempSync(join(tmpdir(), 'argv-secrets-nogit-'));
  made.push(dir);
  assert.equal(run('--dir', dir).status, 2);
});

test('--selftest passes; --help exits 0; an unknown flag and a bare --dir exit 2', () => {
  assert.equal(run('--selftest').status, 0);
  const help = run('--help');
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage/);
  assert.equal(run('--bogus').status, 2);
  assert.equal(run('--dir').status, 2);
});

test('the real tree passes', () => {
  const r = run();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /file\(s\) scanned/);
});
