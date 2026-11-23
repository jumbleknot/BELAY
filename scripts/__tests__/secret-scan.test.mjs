// Tests for the secret scan as a tree gate (scripts/secret-scan.mjs, scan mode).
//
// The detection rules are already proven by `--selftest` and by ci-digest-redact.test.mjs; what this
// file proves is the TREE SCAN: that a credential-shaped string in a tracked file fails the gate,
// that the finding names the file but never echoes the value, and that the CLI follows the gate
// contract (exit 0/1/2, unknown flags rejected).
//
// Runs in CI under `pnpm nx run scripts:test`, so it stays deterministic, offline and token-free:
// each scan runs against a throwaway git repository in a temp dir, through the `--dir <root>` seam.
// The planted key is assembled from fragments at run time, so the joined value never appears in
// this file — otherwise the real tree scan would (correctly) flag this test.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCAN = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'secret-scan.mjs');

const KEY_BODY = 'Q7' + 'x'.repeat(60) + 'Zk' + '9'.repeat(30);
const PLANTED_KEY = 'sk-' + 'ant-' + 'api03-' + KEY_BODY;

const run = (...args) => spawnSync(process.execPath, [SCAN, ...args], { encoding: 'utf8' });

/** A git repository holding `files` (path → text), all tracked. Caller removes it. */
function fixtureRepo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'secret-scan-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  for (const [rel, text] of Object.entries(files)) writeFileSync(join(dir, rel), text);
  execFileSync('git', ['add', '-A'], { cwd: dir });
  return dir;
}

test('a tracked file holding a key fails the scan, naming the file but not the value', () => {
  const dir = fixtureRepo({ 'readme.md': 'clean\n', 'config.ts': `export const K = '${PLANTED_KEY}';\n` });
  try {
    const r = run('--dir', dir);
    const out = r.stdout + r.stderr;
    assert.equal(r.status, 1, out);
    assert.match(out, /config\.ts/, 'the finding must name the file');
    assert.match(out, /anthropic-api-key/, 'the finding must name the rule');
    assert.equal(out.includes(PLANTED_KEY), false, 'the key value must never be printed');
    assert.equal(out.includes(KEY_BODY.slice(0, 20)), false, 'no recognisable part of the key body may be printed');
    assert.equal(out.includes('readme.md'), false, 'a clean file must not be reported');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a clean tracked tree passes the scan', () => {
  const dir = fixtureRepo({ 'readme.md': 'const x = "sk-ant-…"; // placeholder\n' });
  try {
    const r = run('--dir', dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an untracked file is outside the scan', () => {
  const dir = fixtureRepo({ 'readme.md': 'clean\n' });
  try {
    writeFileSync(join(dir, 'scratch.ts'), PLANTED_KEY + '\n');
    assert.equal(run('--dir', dir).status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a --dir that is not a git work tree exits 2, never a silent pass', () => {
  const dir = mkdtempSync(join(tmpdir(), 'secret-scan-nogit-'));
  try {
    assert.equal(run('--dir', dir).status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--selftest exits 0', () => {
  const r = run('--selftest');
  assert.equal(r.status, 0, r.stderr);
});

test('--help exits 0 and prints usage', () => {
  const r = run('--help');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Usage/);
});

test('an unknown flag exits 2', () => {
  assert.equal(run('--no-such-flag').status, 2);
});

test('--dir without a value exits 2', () => {
  assert.equal(run('--dir').status, 2);
});
